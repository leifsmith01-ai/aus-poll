"""
Fetch Australian macroeconomic indicators from ABS and RBA APIs.

Data collected:
  - CPI (All Groups, Australia): ABS catalogue 6401.0
  - Unemployment rate (seasonally adjusted): ABS catalogue 6202.0
  - RBA cash rate target: rba.gov.au JSON feed

Output: data/economics.json (also copied to webapp/src/data/economics.json)

Usage:
    python -m pipeline.fetch_economics
    python -m pipeline.fetch_economics --no-copy    # skip webapp copy
    python -m pipeline.fetch_economics --dry-run    # print what would be fetched

Cameron & Crosby (2000) model context:
  - Inflation (CPI annual change) and change in unemployment are the two
    significant predictors of incumbent vote in Australian elections.
  - GDP and real wage growth are NOT significant in Australia.
  - 1pp rise in CPI     → approx -0.08pp incumbent primary vote
  - 1pp rise in unemployment → -0.58pp incumbent primary vote
"""

from __future__ import annotations

import argparse
import json
import logging
import shutil
from datetime import date, datetime
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).parent.parent
OUTPUT_FILE = BASE_DIR / "data" / "economics.json"
WEBAPP_COPY = BASE_DIR / "webapp" / "src" / "data" / "economics.json"

# ── ABS SDMX REST API ─────────────────────────────────────────────────────────
# Docs: https://api.data.abs.gov.au/
ABS_API_BASE = "https://api.data.abs.gov.au/data"

# CPI All Groups Australia — quarterly
# Dataflow: CPI / Key: 1.10.999999.20.50.Q (index number, all groups, Australia)
CPI_DATAFLOW = "CPI"
CPI_KEY = "1.10.999999.20.50.Q"

# Unemployment rate, seasonally adjusted, Australia — monthly
# Dataflow: LF / Key: M.13.3.Unemployed.15+.T.P.SA.AUS (unemployment rate)
UNEMP_DATAFLOW = "LF"
UNEMP_KEY = "M.13.3.Unemployed.15+.T.P.SA.AUS"

# ── RBA API ───────────────────────────────────────────────────────────────────
RBA_CASH_RATE_URL = "https://api.rba.gov.au/statistics/tables/f1?output=json"

# ── Cameron & Crosby model coefficients ───────────────────────────────────────
# Source: Cameron, L. & Crosby, M. (2000). Economic Record, 76(235), 354-364.
CC_INFLATION_COEFF = -0.08       # pp incumbent primary per 1pp rise in CPI
CC_UNEMPLOYMENT_COEFF = -0.58   # pp incumbent primary per 1pp rise in unemployment


def _fetch_abs_series(dataflow: str, key: str, start_period: str = "2023-Q3") -> list[dict]:
    """
    Fetch a time series from the ABS SDMX REST API.
    Returns list of {period, value} dicts, sorted by period ascending.
    """
    try:
        import urllib.request
        url = f"{ABS_API_BASE}/{dataflow}/{key}?startPeriod={start_period}&detail=DataOnly"
        logger.info("Fetching ABS %s/%s from %s", dataflow, key, url)
        req = urllib.request.Request(url, headers={
            "Accept": "application/json",
            "User-Agent": "aus-poll/1.0 (github.com/leifsmith01-ai/aus-poll)",
        })
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        return _parse_sdmx_json(data)
    except Exception as e:
        logger.warning("Failed to fetch ABS %s/%s: %s", dataflow, key, e)
        return []


def _parse_sdmx_json(data: dict) -> list[dict]:
    """Parse SDMX-JSON structure into [{period, value}, ...] list."""
    try:
        structure = data["data"]["dataSets"][0]["series"]
        time_periods = data["data"]["structure"]["dimensions"]["observation"][0]["values"]
        # First (and typically only) series
        series_key = list(structure.keys())[0]
        observations = structure[series_key]["observations"]
        result = []
        for idx_str, obs_values in observations.items():
            idx = int(idx_str)
            period = time_periods[idx]["id"]
            value = obs_values[0]
            if value is not None:
                result.append({"period": period, "value": round(float(value), 2)})
        return sorted(result, key=lambda x: x["period"])
    except (KeyError, IndexError, TypeError) as e:
        logger.warning("Failed to parse SDMX JSON: %s", e)
        return []


def _compute_cpi_annual_change(index_data: list[dict]) -> list[dict]:
    """
    Convert CPI index numbers to annual % change (YoY).
    ABS quarterly data: compare same quarter of previous year.
    """
    by_period = {d["period"]: d["value"] for d in index_data}
    result = []
    for d in index_data:
        period = d["period"]
        # Parse year and quarter from "YYYY-QN"
        try:
            year, q = period.split("-")
            year = int(year)
            prev_period = f"{year - 1}-{q}"
        except ValueError:
            continue
        if prev_period in by_period:
            prev_val = by_period[prev_period]
            curr_val = d["value"]
            if prev_val > 0:
                annual_change = round((curr_val - prev_val) / prev_val * 100, 1)
                result.append({"period": period, "value": annual_change})
    return sorted(result, key=lambda x: x["period"])


def _fetch_rba_cash_rate() -> list[dict]:
    """Fetch RBA cash rate target history from RBA JSON API."""
    try:
        import urllib.request
        logger.info("Fetching RBA cash rate from %s", RBA_CASH_RATE_URL)
        req = urllib.request.Request(RBA_CASH_RATE_URL, headers={
            "User-Agent": "aus-poll/1.0",
        })
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        # RBA F1 table: cash rate target series
        # Structure varies; look for "FIRMMCRTD" (cash rate target, daily)
        series = data.get("series", {})
        target_series = series.get("FIRMMCRTD", {}).get("data", [])
        result = []
        for row in target_series[-36:]:  # last ~3 years
            d, v = row[0], row[1]
            if d and v is not None:
                result.append({
                    "date": d,
                    "value": round(float(v), 2),
                })
        return sorted(result, key=lambda x: x["date"])
    except Exception as e:
        logger.warning("Failed to fetch RBA cash rate: %s", e)
        return []


def _load_existing(path: Path) -> dict:
    """Load existing economics.json, returning empty dict on failure."""
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _compute_cameron_crosby(
    election_cpi: float,
    current_cpi: float,
    election_unemployment: float,
    current_unemployment: float,
) -> dict:
    """Compute Cameron & Crosby structural vote estimate."""
    cpi_change = round(current_cpi - election_cpi, 2)
    unemp_change = round(current_unemployment - election_unemployment, 2)
    cpi_effect = round(cpi_change * CC_INFLATION_COEFF, 2)
    unemp_effect = round(unemp_change * CC_UNEMPLOYMENT_COEFF, 2)
    net = round(cpi_effect + unemp_effect, 2)

    if net > 0:
        interp = f"Economic conditions have improved since the election (+{net:.2f}pp structural incumbent benefit)."
    elif net < -0.5:
        interp = f"Economic conditions have deteriorated since the election ({net:.2f}pp structural incumbent penalty)."
    else:
        interp = f"Economic conditions are broadly unchanged since the election ({net:+.2f}pp, within noise margin)."

    return {
        "election_cpi": election_cpi,
        "current_cpi": current_cpi,
        "cpi_change_pp": cpi_change,
        "election_unemployment": election_unemployment,
        "current_unemployment": current_unemployment,
        "unemployment_change_pp": unemp_change,
        "cpi_vote_effect_pp": cpi_effect,
        "unemployment_vote_effect_pp": unemp_effect,
        "net_vote_effect_pp": net,
        "interpretation": interp,
    }


def run(copy_to_webapp: bool = True, dry_run: bool = False) -> dict:
    """
    Fetch economic data and update data/economics.json.

    Falls back to existing data for any series that cannot be fetched.
    Always preserves the manually-entered RBA rate history in the existing file
    when the live API fetch fails.
    """
    existing = _load_existing(OUTPUT_FILE)

    # ── Fetch CPI ─────────────────────────────────────────────────────────────
    logger.info("Fetching CPI data...")
    cpi_index = _fetch_abs_series(CPI_DATAFLOW, CPI_KEY, start_period="2022-Q3")
    if cpi_index:
        cpi_data = _compute_cpi_annual_change(cpi_index)
        logger.info("Fetched %d CPI annual-change points", len(cpi_data))
    else:
        logger.warning("CPI fetch failed; retaining existing data")
        cpi_data = existing.get("cpi", {}).get("data", [])

    # ── Fetch unemployment ────────────────────────────────────────────────────
    logger.info("Fetching unemployment data...")
    unemp_data = _fetch_abs_series(UNEMP_DATAFLOW, UNEMP_KEY, start_period="2025-01")
    if not unemp_data:
        logger.warning("Unemployment fetch failed; retaining existing data")
        unemp_data = existing.get("unemployment", {}).get("data", [])

    # ── Fetch RBA cash rate ───────────────────────────────────────────────────
    logger.info("Fetching RBA cash rate...")
    rba_data = _fetch_rba_cash_rate()
    if not rba_data:
        logger.warning("RBA fetch failed; retaining existing data")
        rba_data = existing.get("rba_cash_rate", {}).get("data",
            existing.get("rba_cash_rate", {}).get("data", []))

    # ── Compute Cameron & Crosby estimate ─────────────────────────────────────
    election_ref = existing.get("election_reference", {})
    election_cpi = election_ref.get("cpi_annual_pct", 2.4)
    election_unemp = election_ref.get("unemployment_pct", 4.1)
    current_cpi = cpi_data[-1]["value"] if cpi_data else election_cpi
    current_unemp = unemp_data[-1]["value"] if unemp_data else election_unemp

    cc_model = _compute_cameron_crosby(election_cpi, current_cpi, election_unemp, current_unemp)

    output = {
        "generated": date.today().isoformat(),
        "source": "ABS (abs.gov.au) and RBA (rba.gov.au); refresh via: python pipeline/fetch_economics.py",
        "note": "CPI and unemployment sourced from ABS; RBA cash rate from rba.gov.au. Cameron & Crosby model uses CPI annual change and unemployment change to estimate structural incumbent vote effect.",
        "election_reference": existing.get("election_reference", {
            "date": "2025-05-03",
            "alp_2pp": 55.2,
            "cpi_annual_pct": 2.4,
            "unemployment_pct": 4.1,
            "rba_rate_pct": 4.10,
            "notes": "2025 federal election result. All economic changes measured relative to this baseline.",
        }),
        "cpi": {
            "series": "Consumer Price Index, All Groups, Australia (ABS 6401.0)",
            "unit": "% annual change (YoY)",
            "series_id": "A2325846C",
            "data": cpi_data,
        },
        "unemployment": {
            "series": "Unemployment Rate, Seasonally Adjusted, Australia (ABS 6202.0)",
            "unit": "% of labour force",
            "series_id": "A84423349L",
            "data": unemp_data,
        },
        "rba_cash_rate": {
            "series": "RBA Cash Rate Target (rba.gov.au)",
            "unit": "% per annum",
            "data": rba_data,
        },
        "cameron_crosby_model": {
            "description": (
                "Cameron & Crosby (2000, Uni Melbourne): structural economic model estimating "
                "incumbent primary vote effect. Key variables: CPI annual change (inflation) and "
                "change in unemployment rate. GDP and real wage growth are NOT significant in Australia."
            ),
            "citation": "Cameron, L. & Crosby, M. (2000). Economic Record, 76(235), 354-364.",
            "coefficients": {
                "inflation_per_pp": CC_INFLATION_COEFF,
                "unemployment_change_per_pp": CC_UNEMPLOYMENT_COEFF,
                "note": (
                    "1pp rise in CPI → approx -0.08pp incumbent primary. "
                    "1pp rise in unemployment → -0.58pp incumbent primary. "
                    "Coalition govts punished more for unemployment rises than Labor govts."
                ),
            },
            "current_estimate": cc_model,
        },
    }

    if dry_run:
        print(json.dumps(output, indent=2))
        return output

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    logger.info("Wrote economics data → %s", OUTPUT_FILE)

    if copy_to_webapp:
        WEBAPP_COPY.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(OUTPUT_FILE, WEBAPP_COPY)
        logger.info("Copied → %s", WEBAPP_COPY)

    return output


def main():
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    parser = argparse.ArgumentParser(description="Fetch ABS economic indicators")
    parser.add_argument("--no-copy", action="store_true", help="Skip copying to webapp/src/data/")
    parser.add_argument("--dry-run", action="store_true", help="Print output without writing files")
    args = parser.parse_args()
    run(copy_to_webapp=not args.no_copy, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
