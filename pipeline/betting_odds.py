"""
Betting odds pipeline for aus-poll.

Fetches betting market data for the Australian federal election and converts
implied win probabilities to estimated 2PP values. Writes data/polls/betting_odds.json.

Usage:
    python pipeline/betting_odds.py               # auto-detects available keys
    python pipeline/betting_odds.py --source manual  # force manual placeholder

Priority cascade:
    1. Betfair Exchange API  (BETFAIR_APP_KEY + BETFAIR_SESSION_TOKEN env vars)
    2. The Odds API          (ODDS_API_KEY env var)
    3. Manual placeholder    (data/polls/betting_odds_manual.json)

Math: win probability → implied 2PP
    Model: 2PP ~ Normal(mu, sigma)
    P(ALP wins) = Φ((mu - 50) / sigma)
    Inverting: implied_2pp = 50 + sigma × Φ⁻¹(P_ALP_win)
"""

import json
import logging
import math
import os
import sys
from datetime import date
from pathlib import Path

import requests

logger = logging.getLogger(__name__)

# ── Paths ─────────────────────────────────────────────────────────────────────
BASE_DIR    = Path(__file__).parent.parent
MANUAL_JSON = BASE_DIR / "data" / "polls" / "betting_odds_manual.json"
OUTPUT_JSON = BASE_DIR / "data" / "polls" / "betting_odds.json"

# ── Model parameters ──────────────────────────────────────────────────────────
# Seat-level σ from calibration_report.txt (historical prediction error)
SIGMA_PER_SEAT = 2.5
# National σ is tighter (averaging across 151 seats reduces variance)
SIGMA_NATIONAL = 1.5


# ── Math helpers ──────────────────────────────────────────────────────────────

def _norm_ppf(p: float) -> float:
    """Inverse normal CDF (probit) — uses scipy if available, else Beasley-Springer-Moro approximation."""
    try:
        from scipy.stats import norm
        return float(norm.ppf(p))
    except ImportError:
        # Rational approximation (Abramowitz & Stegun 26.2.17), accurate to ±4.5e-4
        if p <= 0 or p >= 1:
            raise ValueError(f"p must be in (0, 1), got {p}")
        a = [0, -3.969683028665376e+01, 2.209460984245205e+02,
             -2.759285104469687e+02, 1.383577518672690e+02,
             -3.066479806614716e+01, 2.506628277459239e+00]
        b = [0, -5.447609879822406e+01, 1.615858368580409e+02,
             -1.556989798598866e+02, 6.680131188771972e+01,
             -1.328068155288572e+01]
        c = [-7.784894002430293e-03, -3.223964580411365e-01,
             -2.400758277161838e+00, -2.549732539343734e+00,
              4.374664141464968e+00,  2.938163982698783e+00]
        d = [7.784695709041462e-03, 3.224671290700398e-01,
             2.445134137142996e+00, 3.754408661907416e+00]
        p_low, p_high = 0.02425, 1 - 0.02425
        if p < p_low:
            q = math.sqrt(-2 * math.log(p))
            return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1)
        elif p <= p_high:
            q = p - 0.5
            r = q * q
            return (((((a[1]*r+a[2])*r+a[3])*r+a[4])*r+a[5])*r+a[6])*q / (((((b[1]*r+b[2])*r+b[3])*r+b[4])*r+b[5])*r+1)
        else:
            q = math.sqrt(-2 * math.log(1 - p))
            return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1)


def remove_overround(odds: dict[str, float]) -> dict[str, float]:
    """
    Normalise decimal odds so implied probabilities sum to 1.0.
    Removes the bookmaker margin (overround).

    e.g. {ALP: 1.60, Coal: 2.60} → raw probs (0.625, 0.385) sum to 1.01
         → normalised (0.619, 0.381)
    """
    raw = {k: 1.0 / v for k, v in odds.items()}
    total = sum(raw.values())
    return {k: v / total for k, v in raw.items()}


def prob_to_implied_2pp(p_win: float, sigma: float = SIGMA_PER_SEAT) -> float | None:
    """
    Convert P(ALP wins seat) → implied ALP 2PP.

    Model: 2PP ~ Normal(mu, sigma)
    P(ALP wins) = Φ((mu - 50) / sigma)
    Inverting: mu = 50 + sigma × Φ⁻¹(p_win)

    Returns None if p_win is outside (0.02, 0.98) — too extreme to invert reliably.
    """
    if p_win is None or p_win <= 0.02 or p_win >= 0.98:
        return None
    return round(50.0 + sigma * _norm_ppf(p_win), 2)


# ── Betfair Exchange ───────────────────────────────────────────────────────────

BETFAIR_BASE_URL = "https://api.betfair.com/exchange/betting/rest/v1.0"

# Betfair competition ID for Australian Federal Politics (approximate).
# Discover exact IDs using pipeline/discover_betfair_markets.py
BETFAIR_AU_POLITICS_COMPETITION_ID = "6423930"


def _betfair_headers(app_key: str, session_token: str) -> dict:
    return {
        "X-Application": app_key,
        "X-Authentication": session_token,
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def _betfair_request(endpoint: str, body: dict, app_key: str, session_token: str) -> dict:
    url = f"{BETFAIR_BASE_URL}/{endpoint}/"
    resp = requests.post(url, json=body, headers=_betfair_headers(app_key, session_token), timeout=15)
    resp.raise_for_status()
    return resp.json()


def _list_markets(app_key: str, session_token: str, competition_id: str) -> list[dict]:
    """List open markets for the given competition."""
    body = {
        "filter": {
            "competitionIds": [competition_id],
            "marketTypeCodes": ["WINNER"],
        },
        "marketProjection": ["MARKET_NAME", "RUNNER_DESCRIPTION", "COMPETITION"],
        "maxResults": 200,
    }
    return _betfair_request("listMarketCatalogue", body, app_key, session_token)


def _get_best_prices(market_ids: list[str], app_key: str, session_token: str) -> list[dict]:
    """Fetch best available back prices for the given market IDs."""
    body = {
        "marketIds": market_ids,
        "priceProjection": {"priceData": ["EX_BEST_OFFERS"]},
    }
    return _betfair_request("listMarketBook", body, app_key, session_token)


def _parse_betfair_market(market_cat: dict, market_book: dict) -> dict | None:
    """
    Parse a single Betfair market into our output format.
    Returns None if insufficient price data.
    """
    name = market_cat.get("marketName", "")
    runners = market_cat.get("runners", [])
    runner_prices = {
        r["selectionId"]: r.get("ex", {}).get("availableToBack", [{}])[0].get("price")
        for r in market_book.get("runners", [])
        if r.get("ex", {}).get("availableToBack")
    }

    # Map runner names → prices
    named_odds = {}
    for r in runners:
        price = runner_prices.get(r["selectionId"])
        if price:
            named_odds[r["runnerName"]] = price

    if len(named_odds) < 2:
        return None

    probs = remove_overround(named_odds)
    return {"market_name": name, "named_odds": named_odds, "probs": probs}


def fetch_betfair(app_key: str, session_token: str, seat_market_ids: dict[str, str]) -> dict:
    """
    Fetch national and seat-level markets from Betfair Exchange.

    seat_market_ids: mapping of seat name → Betfair market ID
                     (populated from BETTING_CONFIG["seat_market_ids"] in config.py,
                      or discovered with pipeline/discover_betfair_markets.py)
    """
    from pipeline.config import BETTING_CONFIG

    result = {"source": "betfair", "national": {}, "seats": {}}
    national_market_id = BETTING_CONFIG.get("national_market_id", "")

    # ── National government market ─────────────────────────────────────────────
    if national_market_id:
        try:
            books = _get_best_prices([national_market_id], app_key, session_token)
            # Catalogue lookup (simplified — in practice you'd cache this)
            cats = _list_markets(app_key, session_token, BETFAIR_AU_POLITICS_COMPETITION_ID)
            cat_map = {c["marketId"]: c for c in cats}
            cat = cat_map.get(national_market_id)
            if cat and books:
                parsed = _parse_betfair_market(cat, books[0])
                if parsed:
                    # Expect runners like "ALP Majority", "Coalition Majority", etc.
                    probs = parsed["probs"]
                    odds = parsed["named_odds"]
                    for runner, prob in probs.items():
                        key = runner.lower().replace(" ", "_")
                        if "alp" in key or "labor" in key:
                            result["national"]["alp_majority"] = {
                                "decimal_odds": odds.get(runner),
                                "implied_prob": round(prob, 4),
                                "implied_2pp": prob_to_implied_2pp(prob, SIGMA_NATIONAL),
                            }
                        elif "coalition" in key or "liberal" in key:
                            result["national"]["coalition_majority"] = {
                                "decimal_odds": odds.get(runner),
                                "implied_prob": round(prob, 4),
                            }
        except Exception as e:
            logger.warning("Betfair: error fetching national market: %s", e)

    # ── Seat-level markets ─────────────────────────────────────────────────────
    if seat_market_ids:
        try:
            market_ids = list(seat_market_ids.values())
            books_list = _get_best_prices(market_ids, app_key, session_token)
            cats = _list_markets(app_key, session_token, BETFAIR_AU_POLITICS_COMPETITION_ID)
            cat_map = {c["marketId"]: c for c in cats}
            book_map = {b["marketId"]: b for b in books_list}

            for seat_name, market_id in seat_market_ids.items():
                cat = cat_map.get(market_id)
                book = book_map.get(market_id)
                if not cat or not book:
                    continue
                parsed = _parse_betfair_market(cat, book)
                if not parsed:
                    continue

                probs = parsed["probs"]
                odds = parsed["named_odds"]
                runners = sorted(probs.items(), key=lambda x: -x[1])
                if len(runners) < 2:
                    continue

                finalist_a_name, finalist_a_prob = runners[0]
                finalist_b_name, finalist_b_prob = runners[1]

                def classify_runner(name: str) -> str:
                    n = name.lower()
                    if "labor" in n or "alp" in n:
                        return "alp"
                    if "liberal" in n or "coalition" in n or "lnp" in n or "national" in n:
                        return "coalition"
                    if "green" in n:
                        return "greens"
                    if "teal" in n or "independent" in n or "ind" in n:
                        return "teal"
                    if "one nation" in n or "on " in n:
                        return "on"
                    return "other"

                fa_group = classify_runner(finalist_a_name)
                fb_group = classify_runner(finalist_b_name)

                # Compute implied 2PP for ALP vs Coalition finals only
                implied_2pp = None
                if fa_group == "alp" and fb_group == "coalition":
                    implied_2pp = prob_to_implied_2pp(finalist_a_prob)
                elif fa_group == "coalition" and fb_group == "alp":
                    implied_2pp = prob_to_implied_2pp(finalist_b_prob)

                result["seats"][seat_name] = {
                    "source": "betfair",
                    "finalist_a": fa_group,
                    "finalist_b": fb_group,
                    "finalist_a_prob": round(finalist_a_prob, 4),
                    "finalist_b_prob": round(finalist_b_prob, 4),
                    "finalist_a_odds": odds.get(finalist_a_name),
                    "finalist_b_odds": odds.get(finalist_b_name),
                    "implied_2pp_alp": implied_2pp,
                }
        except Exception as e:
            logger.warning("Betfair: error fetching seat markets: %s", e)

    return result


# ── The Odds API ───────────────────────────────────────────────────────────────

ODDS_API_BASE = "https://api.the-odds-api.com/v4"

# Odds API sport key for Australian politics.
# Run: GET /sports to discover available keys near an election.
ODDS_API_AU_POLITICS_SPORT = "politics_aus"


def fetch_odds_api(api_key: str) -> dict:
    """
    Fetch government-winner market from the-odds-api.com.

    Returns a dict with the same shape as fetch_betfair() (national only;
    seat-by-seat markets are rarely available via The Odds API).
    """
    result = {"source": "the-odds-api", "national": {}, "seats": {}}

    try:
        # List available sports first to find the AU politics key
        sports_resp = requests.get(
            f"{ODDS_API_BASE}/sports",
            params={"apiKey": api_key},
            timeout=10,
        )
        sports_resp.raise_for_status()
        sports = sports_resp.json()
        sport_keys = [s["key"] for s in sports if "australia" in s.get("title", "").lower()
                      or "politic" in s.get("group", "").lower()]

        if not sport_keys:
            logger.warning("Odds API: no Australian politics sport found. Available: %s",
                           [s["key"] for s in sports[:10]])
            return result

        sport_key = sport_keys[0]
        logger.info("Odds API: using sport key '%s'", sport_key)

        # Fetch odds for the selected sport
        odds_resp = requests.get(
            f"{ODDS_API_BASE}/sports/{sport_key}/odds",
            params={
                "apiKey": api_key,
                "regions": "au",
                "markets": "h2h",
                "oddsFormat": "decimal",
            },
            timeout=10,
        )
        odds_resp.raise_for_status()
        events = odds_resp.json()

        if not events:
            logger.warning("Odds API: no events found for sport '%s'", sport_key)
            return result

        # Use the first event (most likely the federal government market)
        event = events[0]
        bookmakers = event.get("bookmakers", [])
        if not bookmakers:
            return result

        # Aggregate odds across bookmakers (simple mean)
        outcome_prices: dict[str, list[float]] = {}
        for bm in bookmakers:
            for market in bm.get("markets", []):
                if market.get("key") == "h2h":
                    for outcome in market.get("outcomes", []):
                        name = outcome["name"]
                        price = outcome["price"]
                        outcome_prices.setdefault(name, []).append(price)

        if not outcome_prices:
            return result

        avg_odds = {k: sum(v) / len(v) for k, v in outcome_prices.items()}
        probs = remove_overround(avg_odds)

        for name, prob in probs.items():
            n = name.lower()
            if "labor" in n or "alp" in n:
                result["national"]["alp_majority"] = {
                    "decimal_odds": round(avg_odds[name], 2),
                    "implied_prob": round(prob, 4),
                    "implied_2pp": prob_to_implied_2pp(prob, SIGMA_NATIONAL),
                }
            elif "coalition" in n or "liberal" in n:
                result["national"]["coalition_majority"] = {
                    "decimal_odds": round(avg_odds[name], 2),
                    "implied_prob": round(prob, 4),
                }

        remaining = requests.get("", headers={"X-RateLimit-Requests-Remaining": "?"})
        logger.info("Odds API: %s requests remaining this month",
                    odds_resp.headers.get("x-requests-remaining", "?"))

    except Exception as e:
        logger.warning("Odds API: error: %s", e)

    return result


# ── Manual fallback ────────────────────────────────────────────────────────────

def load_manual() -> dict:
    """Load data/polls/betting_odds_manual.json as fallback."""
    with open(MANUAL_JSON, encoding="utf-8") as f:
        data = json.load(f)
    data["source"] = "manual"
    return data


# ── Main ───────────────────────────────────────────────────────────────────────

def run(force_source: str | None = None) -> dict:
    """
    Priority cascade: Betfair → Odds API → manual placeholder.
    Writes data/polls/betting_odds.json and returns the output dict.

    force_source: "betfair" | "odds_api" | "manual" to skip the cascade.
    """
    logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")

    betfair_key = os.environ.get("BETFAIR_APP_KEY", "")
    betfair_token = os.environ.get("BETFAIR_SESSION_TOKEN", "")
    odds_api_key = os.environ.get("ODDS_API_KEY", "")

    output: dict | None = None

    if force_source != "manual":
        # ── Tier 1: Betfair ────────────────────────────────────────────────────
        if (force_source == "betfair" or (betfair_key and betfair_token)):
            logger.info("Fetching from Betfair Exchange...")
            try:
                from pipeline.config import BETTING_CONFIG
                seat_market_ids = BETTING_CONFIG.get("seat_market_ids", {})
                output = fetch_betfair(betfair_key, betfair_token, seat_market_ids)
                logger.info("Betfair: fetched %d seat markets + national",
                            len(output.get("seats", {})))
            except Exception as e:
                logger.warning("Betfair fetch failed: %s — trying next source", e)
                output = None

        # ── Tier 2: The Odds API ───────────────────────────────────────────────
        if output is None and (force_source == "odds_api" or odds_api_key):
            logger.info("Fetching from The Odds API...")
            try:
                output = fetch_odds_api(odds_api_key)
                if not output.get("national"):
                    logger.warning("Odds API returned no national data — falling back to manual")
                    output = None
                else:
                    logger.info("Odds API: fetched national market")
            except Exception as e:
                logger.warning("Odds API fetch failed: %s — falling back to manual", e)
                output = None

    # ── Tier 3: Manual placeholder ─────────────────────────────────────────────
    if output is None:
        logger.info("Using manual placeholder data from %s", MANUAL_JSON)
        output = load_manual()

    # Attach metadata
    output["generated"] = date.today().isoformat()
    output.setdefault("sigma_per_seat", SIGMA_PER_SEAT)
    output.setdefault("sigma_national", SIGMA_NATIONAL)

    # Write output
    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2)
    logger.info("Written to %s (source: %s)", OUTPUT_JSON, output.get("source"))

    return output


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="Fetch betting odds and export to data/polls/betting_odds.json"
    )
    parser.add_argument(
        "--source",
        choices=["betfair", "odds_api", "manual"],
        default=None,
        help="Force a specific data source (default: auto-detect from env vars)",
    )
    args = parser.parse_args()
    run(force_source=args.source)
