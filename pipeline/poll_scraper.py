"""
Wikipedia poll scraper for aus-poll.

Fetches the latest federal and Victorian opinion polls from Wikipedia tables and
appends new entries to data/polls/bludgertrack.json and data/polls/vic_polls.json
in place. The existing pipeline.poll_aggregator then reads those files unchanged.

Soft-fail design: any network or parse error returns an empty list and logs a
warning. Manually-curated entries in the input files are never overwritten —
records are merged keyed by (pollster, date) and only new keys are appended.

Usage:
    python -m pipeline.poll_scraper                # scrape + merge federal + VIC
    python -m pipeline.poll_scraper --federal-only
    python -m pipeline.poll_scraper --vic-only
    python -m pipeline.poll_scraper --dry-run      # print records, no file writes
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import sys
from datetime import date
from pathlib import Path
from typing import Iterable

import requests
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

# ── Paths ─────────────────────────────────────────────────────────────────────
BASE_DIR         = Path(__file__).parent.parent
FEDERAL_JSON     = BASE_DIR / "data" / "polls" / "bludgertrack.json"
VIC_JSON         = BASE_DIR / "data" / "polls" / "vic_polls.json"

# ── Sources ───────────────────────────────────────────────────────────────────
WIKI_FEDERAL_URL = "https://en.wikipedia.org/wiki/Opinion_polling_for_the_next_Australian_federal_election"
WIKI_VIC_URL     = "https://en.wikipedia.org/wiki/Opinion_polling_for_the_2026_Victorian_state_election"

USER_AGENT = "aus-poll/1.0 (+https://github.com/leifsmith01-ai/aus-poll)"

# ── Pollster normalisation ────────────────────────────────────────────────────
# Canonical names mirror keys of POLLSTER_METHODOLOGY in pipeline/poll_aggregator.py.
# Records that don't normalise to one of these are skipped — house-effect
# correction in the aggregator only applies to known pollsters.
CANONICAL_POLLSTERS = {
    "Newspoll", "Roy Morgan", "Essential Research", "YouGov",
    "Resolve Strategic", "RedBridge Group", "DemosAU",
    "Freshwater Strategy", "Fox & Hedgehog", "Spectre Strategy",
}

POLLSTER_ALIASES = {
    "redbridge":             "RedBridge Group",
    "redbridge group":       "RedBridge Group",
    "youGov":                "YouGov",
    "yougov":                "YouGov",
    "yougov/public first":   "YouGov",
    "yougov public first":   "YouGov",
    "demosau":               "DemosAU",
    "demosau/afr":           "DemosAU",
    "demosau / afr":         "DemosAU",
    "demos au":              "DemosAU",
    "newspoll":              "Newspoll",
    "newspoll/the australian": "Newspoll",
    "roy morgan":            "Roy Morgan",
    "roy morgan sms":        "Roy Morgan",
    "morgan":                "Roy Morgan",
    "essential":             "Essential Research",
    "essential research":    "Essential Research",
    "essential media":       "Essential Research",
    "resolve":               "Resolve Strategic",
    "resolve strategic":     "Resolve Strategic",
    "resolve political monitor": "Resolve Strategic",
    "freshwater":            "Freshwater Strategy",
    "freshwater strategy":   "Freshwater Strategy",
    "fox & hedgehog":        "Fox & Hedgehog",
    "fox and hedgehog":      "Fox & Hedgehog",
    "spectre":               "Spectre Strategy",
    "spectre strategy":      "Spectre Strategy",
}


def normalise_pollster(raw: str) -> str | None:
    """Map a raw pollster string to a canonical name, or None if unknown."""
    if not raw:
        return None
    cleaned = re.sub(r"\[[^\]]*\]", "", raw)        # strip refs like [1]
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if not cleaned:
        return None
    if cleaned in CANONICAL_POLLSTERS:
        return cleaned
    return POLLSTER_ALIASES.get(cleaned.lower())


# ── Date parsing ──────────────────────────────────────────────────────────────
_MONTHS = {
    "jan": 1,  "january":   1, "feb": 2,  "february":  2,
    "mar": 3,  "march":     3, "apr": 4,  "april":     4,
    "may": 5,  "jun": 6,   "june":      6, "jul": 7, "july": 7,
    "aug": 8,  "august":    8, "sep": 9, "sept": 9, "september": 9,
    "oct": 10, "october":  10, "nov": 11, "november": 11,
    "dec": 12, "december": 12,
}

# Matches "20–22 Apr 2026", "20-22 April 2026", "20 Apr 2026", "Apr 20–22, 2026".
_DATE_DAY_FIRST = re.compile(
    r"(\d{1,2})\s*(?:[–\-]\s*(\d{1,2}))?\s+([A-Za-z]+)\s+(\d{4})"
)
_DATE_MONTH_FIRST = re.compile(
    r"([A-Za-z]+)\s+(\d{1,2})\s*(?:[–\-]\s*(\d{1,2}))?,?\s+(\d{4})"
)


def parse_fieldwork_date(raw: str) -> str | None:
    """Return the LATEST day in a Wikipedia fieldwork range as ISO YYYY-MM-DD."""
    if not raw:
        return None
    cleaned = re.sub(r"\[[^\]]*\]", "", raw)
    cleaned = cleaned.replace("\xa0", " ")
    m = _DATE_DAY_FIRST.search(cleaned)
    if m:
        d_start, d_end, mon_raw, year = m.groups()
        day = int(d_end or d_start)
    else:
        m = _DATE_MONTH_FIRST.search(cleaned)
        if not m:
            return None
        mon_raw, d_start, d_end, year = m.groups()
        day = int(d_end or d_start)
    month = _MONTHS.get(mon_raw.lower())
    if not month or not (1 <= day <= 31):
        return None
    try:
        return date(int(year), month, day).isoformat()
    except ValueError:
        return None


# ── Numeric coercion ──────────────────────────────────────────────────────────
def _to_float(raw: str) -> float | None:
    if raw is None:
        return None
    cleaned = re.sub(r"\[[^\]]*\]", "", str(raw))
    cleaned = cleaned.replace("%", "").replace(",", "").replace("\xa0", " ").strip()
    if cleaned in {"", "—", "–", "-", "N/A", "n/a", "?"}:
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def _to_int(raw: str) -> int | None:
    f = _to_float(raw)
    return int(round(f)) if f is not None else None


# ── Header column matching ────────────────────────────────────────────────────
def _cell_text(cell) -> str:
    return re.sub(r"\s+", " ", cell.get_text(" ", strip=True)).strip()


def _match_columns(headers: list[str], schema: dict[str, list[str]]) -> dict[str, int]:
    """Map field name -> column index, picking the first header that contains
    any of the schema's keywords (case-insensitive, whole-token match preferred)."""
    out: dict[str, int] = {}
    lower = [h.lower() for h in headers]
    for field, keywords in schema.items():
        for i, h in enumerate(lower):
            if any(kw in h for kw in keywords):
                out[field] = i
                break
    return out


_FEDERAL_SCHEMA = {
    "date":     ["date", "fieldwork"],
    "pollster": ["firm", "pollster", "polling firm"],
    "n":        ["sample"],
    "alp":      ["alp"],
    "coal":     ["l/np", "lnp", "coalition", "coal"],
    "grn":      ["grn", "green"],
    "on":       ["onp", "one nation"],
    "tpp":      ["2pp", "tpp"],
}

_VIC_SCHEMA = {
    "date":     ["date", "fieldwork"],
    "pollster": ["firm", "pollster", "polling firm"],
    "n":        ["sample"],
    "alp":      ["alp"],
    "lp":       ["lib", "liberal", "l/np", "lnp", "coalition"],
    "grn":      ["grn", "green"],
    "ind":      ["ind", "oth", "other"],
    "on":       ["onp", "one nation"],
    "tpp":      ["2pp", "tpp"],
}


def _is_alp_2pp(header_text: str) -> bool:
    """Wikipedia uses either 'ALP 2pp' or 'L 2pp'/'L/NP 2pp'. Returns True if
    the column reports the ALP 2PP figure directly."""
    h = header_text.lower()
    return "2pp" in h and ("alp" in h or "labor" in h)


def _is_coal_2pp(header_text: str) -> bool:
    h = header_text.lower()
    return "2pp" in h and ("l/np" in h or "lnp" in h or "coal" in h or "lib" in h)


# ── Table parsing ─────────────────────────────────────────────────────────────
def _iter_data_rows(table) -> Iterable[list]:
    """Yield <td> rows of a wikitable, skipping pure-header rows."""
    for tr in table.find_all("tr"):
        cells = tr.find_all(["td", "th"])
        if not cells:
            continue
        if all(c.name == "th" for c in cells):
            continue
        yield cells


def _parse_table(table, schema: dict, allow_coal_2pp: bool) -> list[dict]:
    """Parse one wikitable using header-driven column mapping. Returns a list
    of dicts in the schema's keys; rows missing required fields are dropped."""
    header_row = table.find("tr")
    if not header_row:
        return []
    headers = [_cell_text(c) for c in header_row.find_all(["th", "td"])]
    if not headers:
        return []

    cols = _match_columns(headers, schema)
    if "pollster" not in cols or "date" not in cols or "alp" not in cols:
        return []

    tpp_idx = cols.get("tpp")
    tpp_is_alp = tpp_idx is not None and _is_alp_2pp(headers[tpp_idx])
    tpp_is_coal = tpp_idx is not None and _is_coal_2pp(headers[tpp_idx])
    if tpp_idx is not None and not tpp_is_alp and not tpp_is_coal:
        # Default: assume ALP 2PP if header is ambiguous.
        tpp_is_alp = True

    out: list[dict] = []
    for row in _iter_data_rows(table):
        if len(row) < max(cols.values()) + 1:
            continue
        texts = [_cell_text(c) for c in row]

        pollster = normalise_pollster(texts[cols["pollster"]])
        if not pollster:
            logger.info("skip unknown pollster: %r", texts[cols["pollster"]])
            continue

        iso = parse_fieldwork_date(texts[cols["date"]])
        if not iso:
            continue

        alp = _to_float(texts[cols["alp"]])
        if alp is None:
            continue

        rec: dict = {"pollster": pollster, "date": iso, "alp": alp}

        for f in ("coal", "lp", "grn", "ind", "on"):
            if f in cols:
                v = _to_float(texts[cols[f]])
                rec[f] = v if v is not None else 0.0

        if tpp_idx is not None:
            tpp = _to_float(texts[tpp_idx])
            if tpp is not None and tpp_is_coal and not allow_coal_2pp:
                tpp = round(100.0 - tpp, 2)
            rec["tpp"] = tpp
        else:
            rec["tpp"] = None

        if "n" in cols:
            rec["n"] = _to_int(texts[cols["n"]])
        else:
            rec["n"] = None

        if rec["tpp"] is None or rec["alp"] is None:
            continue

        out.append(rec)
    return out


# ── Public scrape API ─────────────────────────────────────────────────────────
def fetch_html(url: str, timeout: int = 20) -> str | None:
    """GET the URL and return text, or None on any network error."""
    try:
        resp = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=timeout)
        resp.raise_for_status()
        return resp.text
    except Exception as exc:                                       # noqa: BLE001
        logger.warning("fetch_html(%s) failed: %s", url, exc)
        return None


def parse_federal(html: str) -> list[dict]:
    """Extract federal poll records from Wikipedia HTML."""
    soup = BeautifulSoup(html, "html.parser")
    records: list[dict] = []
    for table in soup.find_all("table", class_="wikitable"):
        rows = _parse_table(table, _FEDERAL_SCHEMA, allow_coal_2pp=False)
        for r in rows:
            records.append({
                "scope":    "NAT",
                "pollster": r["pollster"],
                "date":     r["date"],
                "alp":      r["alp"],
                "coal":     r.get("coal", 0.0),
                "grn":      r.get("grn", 0.0),
                "on":       r.get("on", 0.0),
                "teal":     0.0,
                "tpp":      r["tpp"],
                "n":        r.get("n"),
            })
    return records


def parse_vic(html: str) -> list[dict]:
    """Extract Victorian state poll records from Wikipedia HTML."""
    soup = BeautifulSoup(html, "html.parser")
    records: list[dict] = []
    for table in soup.find_all("table", class_="wikitable"):
        rows = _parse_table(table, _VIC_SCHEMA, allow_coal_2pp=False)
        for r in rows:
            records.append({
                "scope":    "VIC",
                "pollster": r["pollster"],
                "date":     r["date"],
                "alp":      r["alp"],
                "lp":       r.get("lp", 0.0),
                "grn":      r.get("grn", 0.0),
                "ind":      r.get("ind", 0.0),
                "on":       r.get("on", 0.0),
                "tpp":      r["tpp"],
                "n":        r.get("n"),
            })
    return records


def scrape_federal() -> list[dict]:
    html = fetch_html(WIKI_FEDERAL_URL)
    if html is None:
        return []
    try:
        return parse_federal(html)
    except Exception as exc:                                       # noqa: BLE001
        logger.warning("parse_federal failed: %s", exc)
        return []


def scrape_vic() -> list[dict]:
    html = fetch_html(WIKI_VIC_URL)
    if html is None:
        return []
    try:
        return parse_vic(html)
    except Exception as exc:                                       # noqa: BLE001
        logger.warning("parse_vic failed: %s", exc)
        return []


# ── Append-only merge ─────────────────────────────────────────────────────────
def merge_into_file(path: Path, new_records: list[dict]) -> int:
    """Merge new_records into the JSON file at path. Returns the count of
    records actually appended (0 if nothing new). Existing rows are NEVER
    overwritten — dedup is keyed by (pollster, date)."""
    if not new_records:
        logger.warning("no new records to merge into %s", path)
        return 0

    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)

    existing = data.get("polls", [])
    existing_keys = {(p.get("pollster"), p.get("date")) for p in existing}

    additions = [
        r for r in new_records
        if (r.get("pollster"), r.get("date")) not in existing_keys
    ]
    if not additions:
        logger.info("merge_into_file(%s): all %d scraped records already present",
                    path.name, len(new_records))
        return 0

    data["polls"] = sorted(existing + additions, key=lambda p: p.get("date", ""))
    data["retrieved"] = date.today().isoformat()

    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")

    logger.info("merge_into_file(%s): appended %d new record(s)", path.name, len(additions))
    return len(additions)


# ── CLI ───────────────────────────────────────────────────────────────────────
def _main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[1])
    parser.add_argument("--federal-only", action="store_true", help="Skip VIC scrape")
    parser.add_argument("--vic-only",     action="store_true", help="Skip federal scrape")
    parser.add_argument("--dry-run",      action="store_true",
                        help="Print scraped records, do not write files")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )

    appended = 0
    if not args.vic_only:
        records = scrape_federal()
        logger.info("scraped %d federal records", len(records))
        if args.dry_run:
            print(json.dumps(records, indent=2))
        else:
            appended += merge_into_file(FEDERAL_JSON, records)

    if not args.federal_only:
        records = scrape_vic()
        logger.info("scraped %d VIC records", len(records))
        if args.dry_run:
            print(json.dumps(records, indent=2))
        else:
            appended += merge_into_file(VIC_JSON, records)

    logger.info("total new records appended: %d", appended)
    return 0


if __name__ == "__main__":
    sys.exit(_main())
