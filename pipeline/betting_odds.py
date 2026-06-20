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
# Sport keys are discovered dynamically from /sports — no hardcoded keys needed.

# Search terms used to match Australian state election sports/events on The Odds API.
# Each entry maps a state code → list of lowercase substrings to look for in the
# sport title or event name.
STATE_SEARCH_TERMS: dict[str, list[str]] = {
    "vic": ["victoria", "victorian"],
    "nsw": ["new south wales", "nsw state"],
    "qld": ["queensland", "qld state"],
    "wa":  ["western australia", "wa state"],
    "sa":  ["south australia", "sa state"],
    "tas": ["tasmania", "tasmanian"],
    "act": ["australian capital territory", "act election", "act assembly"],
    "nt":  ["northern territory", "nt election"],
}

# State metadata for display — kept here so the frontend JSON is self-describing.
STATE_META: dict[str, dict] = {
    "vic": {"election_name": "2026 Victorian State Election",  "date": "2026-11-28", "chamber": "Legislative Assembly", "total_seats": 88, "majority": 45},
    "nsw": {"election_name": "2027 NSW State Election",        "date": "2027-03-27", "chamber": "Legislative Assembly", "total_seats": 93, "majority": 47},
    "qld": {"election_name": "2028 Queensland State Election", "date": "2028-10-26", "chamber": "Legislative Assembly", "total_seats": 93, "majority": 47},
    "wa":  {"election_name": "2029 WA State Election",         "date": "2029-03-08", "chamber": "Legislative Assembly", "total_seats": 59, "majority": 30},
    "sa":  {"election_name": "2026 SA State Election",         "date": "2026-03-21", "chamber": "House of Assembly",    "total_seats": 47, "majority": 24},
    "tas": {"election_name": "2028 Tasmanian State Election",  "date": "2028-03-01", "chamber": "House of Assembly",    "total_seats": 25, "majority": 13},
    "act": {"election_name": "2028 ACT Assembly Election",     "date": "2028-10-17", "chamber": "Legislative Assembly", "total_seats": 25, "majority": 13},
    "nt":  {"election_name": "2028 NT Election",               "date": "2028-08-24", "chamber": "Legislative Assembly", "total_seats": 25, "majority": 13},
}


def _select_federal_sport_keys(sports: list[dict]) -> list[str]:
    """
    Pick sport keys that could be the Australian federal election market.

    Every candidate MUST mention Australia in its title. An earlier fallback
    accepted anything in the "politics" group, which selected
    politics_us_presidential_election_winner when no Australian market was
    listed and broke the whole fetch with a 422.
    """
    def is_au(s: dict) -> bool:
        title = s.get("title", "").lower()
        return "australia" in title or "aussie" in title

    keys = [
        s["key"] for s in sports
        if is_au(s)
        and ("election" in s.get("title", "").lower() or "politic" in s.get("group", "").lower())
    ]
    if not keys:
        # Broader fallback, still Australia-only.
        keys = [s["key"] for s in sports if is_au(s)]
    return keys


def _parse_odds_event(event: dict) -> dict[str, dict]:
    """
    Extract averaged decimal odds and normalised probabilities from a single
    Odds API event (aggregated across all bookmakers).
    Returns: {"Outcome Name": {"decimal_odds": float, "implied_prob": float}, ...}
    """
    outcome_prices: dict[str, list[float]] = {}
    for bm in event.get("bookmakers", []):
        for market in bm.get("markets", []):
            if market.get("key") == "h2h":
                for outcome in market.get("outcomes", []):
                    outcome_prices.setdefault(outcome["name"], []).append(outcome["price"])

    if not outcome_prices:
        return {}

    avg_odds = {k: sum(v) / len(v) for k, v in outcome_prices.items()}
    probs = remove_overround(avg_odds)
    return {
        name: {"decimal_odds": round(avg_odds[name], 2), "implied_prob": round(prob, 4)}
        for name, prob in probs.items()
    }


def _get_odds_for_sport(api_key: str, sport_key: str) -> list[dict]:
    """Fetch h2h odds for a sport key from The Odds API."""
    resp = requests.get(
        f"{ODDS_API_BASE}/sports/{sport_key}/odds",
        params={"apiKey": api_key, "regions": "au", "markets": "h2h", "oddsFormat": "decimal"},
        timeout=10,
    )
    resp.raise_for_status()
    logger.info("Odds API [%s]: %s requests remaining this month",
                sport_key, resp.headers.get("x-requests-remaining", "?"))
    return resp.json()


def fetch_odds_api(api_key: str) -> dict:
    """
    Fetch federal government-winner AND available state election markets from
    the-odds-api.com.

    Returns:
        {
            "source": "the-odds-api",
            "national": { "alp_majority": {...}, "coalition_majority": {...} },
            "seats": {},
            "state_elections": {
                "vic": { "election_name": ..., "alp_win": {...}, "coalition_win": {...} },
                ...  (only states with active markets)
            }
        }
    """
    result: dict = {"source": "the-odds-api", "national": {}, "seats": {}, "state_elections": {}}

    try:
        # ── Fetch sports list (1 request) ──────────────────────────────────────
        sports_resp = requests.get(
            f"{ODDS_API_BASE}/sports",
            params={"apiKey": api_key},
            timeout=10,
        )
        sports_resp.raise_for_status()
        sports = sports_resp.json()

        # Build lookup: sport title (lower) → sport key
        sport_by_title = {s.get("title", "").lower(): s["key"] for s in sports}

        # ── Federal election ───────────────────────────────────────────────────
        federal_keys = _select_federal_sport_keys(sports)

        if federal_keys:
            sport_key = federal_keys[0]
            logger.info("Odds API: federal market sport key '%s'", sport_key)
            try:
                events = _get_odds_for_sport(api_key, sport_key)
            except Exception as e:
                # A per-market error must not abort the state-market scan below.
                logger.warning("Odds API: error fetching federal market %s: %s", sport_key, e)
                result["fetch_error"] = f"federal market {sport_key}: {e}"
                events = []
            for event in events:
                name_lower = event.get("sport_title", event.get("home_team", "")).lower()
                # Skip obvious state matches at the federal level
                if any(term in name_lower for state_terms in STATE_SEARCH_TERMS.values() for term in state_terms):
                    continue
                parsed = _parse_odds_event(event)
                for outcome_name, odds in parsed.items():
                    n = outcome_name.lower()
                    if "labor" in n or "alp" in n:
                        result["national"]["alp_majority"] = {
                            **odds,
                            "implied_2pp": prob_to_implied_2pp(odds["implied_prob"], SIGMA_NATIONAL),
                        }
                    elif "coalition" in n or "liberal" in n:
                        result["national"]["coalition_majority"] = odds
                if result["national"]:
                    break  # found the federal market
        else:
            # Expected between election cycles — bookmakers may not list the next
            # federal election yet. Informational, not an error.
            logger.info("Odds API: no Australian federal election market currently listed. "
                        "Available sports: %s", [s["key"] for s in sports[:15]])

        # ── State elections ────────────────────────────────────────────────────
        for state_code, search_terms in STATE_SEARCH_TERMS.items():
            # Find a matching sport by title
            matched_key = None
            for title_lower, key in sport_by_title.items():
                if any(term in title_lower for term in search_terms):
                    matched_key = key
                    break

            if not matched_key:
                continue  # no market for this state right now

            try:
                events = _get_odds_for_sport(api_key, matched_key)
            except Exception as e:
                logger.warning("Odds API: error fetching %s state market: %s", state_code.upper(), e)
                continue

            if not events:
                continue

            # Use the first event for this state
            parsed = _parse_odds_event(events[0])
            if not parsed:
                continue

            meta = STATE_META.get(state_code, {})
            state_entry: dict = {
                "source": "the-odds-api",
                **meta,
            }

            for outcome_name, odds in parsed.items():
                n = outcome_name.lower()
                if "labor" in n or "alp" in n:
                    state_entry["alp_win"] = odds
                elif "liberal" in n or "coalition" in n or "lnp" in n:
                    state_entry["coalition_win"] = odds
                else:
                    # Preserve any other runner (e.g. Greens, minor parties)
                    safe_key = outcome_name.lower().replace(" ", "_").replace("'", "")
                    state_entry[f"other_{safe_key}"] = odds

            result["state_elections"][state_code] = state_entry
            logger.info("Odds API: found %s state election market (%d outcomes)",
                        state_code.upper(), len(parsed))

        if result["state_elections"]:
            logger.info("Odds API: state election markets found: %s",
                        list(result["state_elections"].keys()))

    except Exception as e:
        logger.warning("Odds API: error: %s", e)
        result["fetch_error"] = str(e)

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
    # Why the manual placeholder ended up being served (recorded in the output
    # JSON so CI can distinguish "API broken" from "no markets listed yet"):
    #   no_credentials — no API keys configured
    #   no_au_markets  — API reachable but no Australian election market listed
    #   api_error: ... — a request failed (bad key, quota, API change)
    fallback_reason = "forced_manual" if force_source == "manual" else "no_credentials"

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
                fetch_error = output.pop("fetch_error", None)
                # Any live market — national or state — counts as a live result;
                # the federal market is often unlisted between election cycles.
                if not output.get("national") and not output.get("state_elections"):
                    fallback_reason = f"api_error: {fetch_error}" if fetch_error else "no_au_markets"
                    logger.warning("Odds API returned no usable markets (%s) — falling back to manual",
                                   fallback_reason)
                    output = None
                else:
                    logger.info("Odds API: fetched %s%s",
                                "national market" if output.get("national") else "",
                                f" + {len(output.get('state_elections', {}))} state market(s)"
                                if output.get("state_elections") else "")
            except Exception as e:
                fallback_reason = f"api_error: {e}"
                logger.warning("Odds API fetch failed: %s — falling back to manual", e)
                output = None

    # ── Tier 3: Manual placeholder ─────────────────────────────────────────────
    if output is None:
        logger.info("Using manual placeholder data from %s (reason: %s)",
                    MANUAL_JSON, fallback_reason)
        output = load_manual()
        output["fallback_reason"] = fallback_reason
    else:
        output.pop("fallback_reason", None)

    # Per-state merge: live markets win, manual placeholders fill only the
    # states the live feed didn't return. Each manual entry keeps its
    # source="manual" tag so the frontend can label it indicative rather than
    # passing it off as live.
    if output.get("source") != "manual":
        manual = load_manual()
        live_states = output.setdefault("state_elections", {})
        manual_states = manual.get("state_elections", {})
        filled = []
        for code, entry in manual_states.items():
            if code not in live_states:
                live_states[code] = entry
                filled.append(code)
        if filled:
            logger.info("State elections: no live market for %s — using manual placeholder",
                        ", ".join(c.upper() for c in sorted(filled)))
        # Same for the national market — often unlisted between election cycles
        # even when state markets are live. national_source flags it as manual.
        if not output.get("national") and manual.get("national"):
            output["national"] = manual["national"]
            output["national_source"] = "manual"
            logger.info("National: no live market — using manual placeholder")

    output.setdefault("state_elections", {})

    # Attach metadata. Live sources are stamped with today's date. The manual
    # fallback keeps its own as-of date (already present in the loaded data) so
    # the dashboard never implies a freshness the placeholder doesn't have.
    if output.get("source") != "manual":
        output["generated"] = date.today().isoformat()
    output.setdefault("generated", date.today().isoformat())
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
