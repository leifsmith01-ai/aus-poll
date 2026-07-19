"""
Poll scraper for aus-poll.

Fetches the latest federal polls from the BludgerTrack XML feed (falling back
to the Wikipedia federal polling page if the feed is unavailable) and state
(VIC/NSW/QLD/WA/SA) opinion polls from Wikipedia tables, appending new entries
to data/polls/bludgertrack.json and data/polls/{state}_polls.json in place.
The existing pipeline.poll_aggregator then reads those files unchanged.

Soft-fail design: any network or parse error returns an empty list and logs a
warning; a state whose polling page has not been created yet (404 on every URL
candidate) is skipped with an info log, not an error. Manually-curated entries
in the input files are never overwritten — records are merged keyed by
(pollster, date) and only new keys are appended.

Usage:
    python -m pipeline.poll_scraper                # scrape + merge federal + all states
    python -m pipeline.poll_scraper --federal-only
    python -m pipeline.poll_scraper --states vic,qld
    python -m pipeline.poll_scraper --vic-only     # deprecated alias for --states vic
    python -m pipeline.poll_scraper --dry-run      # print records, no file writes
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import sys
import xml.etree.ElementTree as ET
from datetime import date, datetime
from pathlib import Path
from typing import Iterable

import requests
from bs4 import BeautifulSoup

from pipeline.poll_validation import filter_plausible

logger = logging.getLogger(__name__)

# ── Paths ─────────────────────────────────────────────────────────────────────
BASE_DIR         = Path(__file__).parent.parent
FEDERAL_JSON     = BASE_DIR / "data" / "polls" / "bludgertrack.json"
VIC_JSON         = BASE_DIR / "data" / "polls" / "vic_polls.json"
NSW_JSON         = BASE_DIR / "data" / "polls" / "nsw_polls.json"
QLD_JSON         = BASE_DIR / "data" / "polls" / "qld_polls.json"
WA_JSON          = BASE_DIR / "data" / "polls" / "wa_polls.json"
SA_JSON          = BASE_DIR / "data" / "polls" / "sa_polls.json"

# ── Sources ───────────────────────────────────────────────────────────────────
WIKI_FEDERAL_URL = "https://en.wikipedia.org/wiki/Opinion_polling_for_the_next_Australian_federal_election"
WIKI_VIC_URL     = "https://en.wikipedia.org/wiki/Opinion_polling_for_the_2026_Victorian_state_election"
# BludgerTrack's structured feed — primary federal source. data/polls/
# bludgertrack.json was originally seeded from this feed (see its url field).
BLUDGERTRACK_XML_URL = "https://www.pollbludger.net/fed2028/bludgertrack/xml/current.xml"

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
    "redbridge/accent":      "RedBridge Group",
    "redbridge / accent":    "RedBridge Group",
    "redbridge/accent research": "RedBridge Group",
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
    hit = POLLSTER_ALIASES.get(cleaned.lower())
    if hit:
        return hit
    # Joint-badged polls ("Redbridge/Accent", "DemosAU/AFR"): match any single
    # component so new partner brandings don't silently drop a known pollster.
    for part in re.split(r"\s*/\s*", cleaned):
        if part in CANONICAL_POLLSTERS:
            return part
        hit = POLLSTER_ALIASES.get(part.lower())
        if hit:
            return hit
    return None


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
# Year-less variants ("17–28 June", "28 Feb – 3 Mar", "June 17–28"): the current
# election-year table on Wikipedia omits the year from its date cells, taking it
# from the section heading instead — callers pass that year as default_year.
_DATE_DAY_FIRST_NOYEAR = re.compile(
    r"(\d{1,2})\s*(?:[–\-]\s*(\d{1,2}))?\s+([A-Za-z]+)"
)
_DATE_MONTH_FIRST_NOYEAR = re.compile(
    r"([A-Za-z]+)\s+(\d{1,2})\s*(?:[–\-]\s*(\d{1,2}))?"
)
# Month-only range with an explicit year ("May – June 2026", "Nov – Dec 2025"):
# the QLD-style pages date some fieldwork windows by month only, with no year
# section heading to fall back on.
_DATE_MONTH_YEAR = re.compile(r"([A-Za-z]+)\s*,?\s+(\d{4})")
_MONTH_TOKEN = re.compile(r"[A-Za-z]+")


def parse_fieldwork_date(raw: str, default_year: int | None = None) -> str | None:
    """Return the LATEST day in a Wikipedia fieldwork range as ISO YYYY-MM-DD.

    Dates without an explicit year ("17–28 June") are resolved against
    default_year, and month-only ranges ("May – Jun") resolve to the 15th of the
    final month — a deliberate midpoint so a two-month fieldwork window is never
    dated more than ~2 weeks too recent. Both forms return None when no
    default_year is supplied. Month-only ranges WITH an explicit year
    ("May – June 2026") resolve the same mid-month way without needing
    default_year.
    """
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
        if m:
            mon_raw, d_start, d_end, year = m.groups()
            day = int(d_end or d_start)
        else:
            my = None
            for cand in _DATE_MONTH_YEAR.finditer(cleaned):
                if cand.group(1).lower() in _MONTHS:
                    my = cand                       # keep the LAST month before the year
            if my:
                try:
                    return date(int(my.group(2)), _MONTHS[my.group(1).lower()], 15).isoformat()
                except ValueError:
                    return None
            if default_year is not None:
                return _parse_yearless_date(cleaned, default_year)
            return None
    month = _MONTHS.get(mon_raw.lower())
    if not month or not (1 <= day <= 31):
        return None
    try:
        return date(int(year), month, day).isoformat()
    except ValueError:
        return None


def _parse_yearless_date(cleaned: str, year: int) -> str | None:
    """Resolve a year-less fieldwork string against *year*. Uses the LAST
    day+month (or month+day) pair in the string, so cross-month ranges like
    "28 Feb – 3 Mar" land on the end of fieldwork."""
    last: tuple[int, int] | None = None            # (month, day)
    for m in _DATE_DAY_FIRST_NOYEAR.finditer(cleaned):
        d_start, d_end, mon_raw = m.groups()
        month = _MONTHS.get(mon_raw.lower())
        if month:
            last = (month, int(d_end or d_start))
    if last is None:
        for m in _DATE_MONTH_FIRST_NOYEAR.finditer(cleaned):
            mon_raw, d_start, d_end = m.groups()
            month = _MONTHS.get(mon_raw.lower())
            if month:
                last = (month, int(d_end or d_start))
    if last is None:
        # Month-only range ("May – Jun"): mid-month of the final month.
        months = [t for t in _MONTH_TOKEN.findall(cleaned) if t.lower() in _MONTHS]
        if not months:
            return None
        last = (_MONTHS[months[-1].lower()], 15)
    month, day = last
    if not (1 <= day <= 31):
        return None
    try:
        return date(year, month, day).isoformat()
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
    any of the schema's keywords (case-insensitive, whole-token match preferred).

    Fields are matched in schema order and each column is claimed at most once,
    so a schema can disambiguate overlapping keywords by ordering — e.g. listing
    "on" (One Nation) before "np" (Nationals) stops "nat" from binding to a
    "One Nation" header."""
    out: dict[str, int] = {}
    claimed: set[int] = set()
    lower = [h.lower() for h in headers]
    for field, keywords in schema.items():
        for i, h in enumerate(lower):
            if i in claimed:
                continue
            if any(kw in h for kw in keywords):
                out[field] = i
                claimed.add(i)
                break
    return out


_FEDERAL_SCHEMA = {
    "date":     ["date", "fieldwork"],
    "pollster": ["firm", "pollster", "polling firm"],
    "n":        ["sample"],
    "alp":      ["alp"],
    "coal":     ["l/np", "lnp", "coalition", "coal", "liberal", "lib"],
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

_QLD_SCHEMA = {
    "date":     ["date", "fieldwork"],
    "pollster": ["firm", "pollster", "polling firm"],
    "n":        ["sample"],
    "alp":      ["alp"],
    "lnp":      ["lnp", "l/np"],
    "grn":      ["grn", "green"],
    "ind":      ["ind"],
    "on":       ["onp", "one nation"],
    "tpp":      ["2pp", "tpp"],
    # KAP and OTH columns are intentionally unmapped — they land in the
    # imputation residual, same as VIC micro-parties.
}

# NSW/WA track the two Coalition partners as separate columns. "on" is listed
# BEFORE "np"/"nat" so the One Nation header can't be claimed by the Nationals
# keywords ("nat" is a substring of "nation") — see _match_columns.
_NSW_SCHEMA = {
    "date":     ["date", "fieldwork"],
    "pollster": ["firm", "pollster", "polling firm"],
    "n":        ["sample"],
    "alp":      ["alp"],
    "on":       ["onp", "one nation"],
    "lp":       ["lib", "liberal"],
    "np":       ["nat", "national"],
    "grn":      ["grn", "green"],
    "ind":      ["ind", "oth", "other"],
    "tpp":      ["2pp", "tpp"],
}

_WA_SCHEMA = {
    "date":     ["date", "fieldwork"],
    "pollster": ["firm", "pollster", "polling firm"],
    "n":        ["sample"],
    "alp":      ["alp"],
    "on":       ["onp", "one nation"],
    "lp":       ["lib", "liberal"],
    "nat":      ["nat", "national"],
    "grn":      ["grn", "green"],
    "ind":      ["ind", "oth", "other"],
    "tpp":      ["2pp", "tpp"],
}

_SA_SCHEMA = {
    "date":     ["date", "fieldwork"],
    "pollster": ["firm", "pollster", "polling firm"],
    "n":        ["sample"],
    "alp":      ["alp"],
    "lp":       ["lib", "liberal"],
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
def _build_col_labels(table) -> list[str]:
    """Flatten a multi-row wikitable header (colspan + rowspan) into one label per column.

    Handles tables like the 2028 Wikipedia polling table where 'Primary vote'
    spans 8 sub-columns and 'Date'/'Polling Firm' use rowspan across 5 header rows.
    Labels from different rows are combined with a space (e.g. 'Primary vote ALP').
    """
    header_rows: list[list] = []
    for tr in table.find_all("tr"):
        cells = tr.find_all(["th", "td"])
        if not cells or not all(c.name == "th" for c in cells):
            break
        header_rows.append(cells)

    if not header_rows:
        return []

    n_cols = sum(int(c.get("colspan", 1)) for c in header_rows[0])
    n_rows = len(header_rows)
    grid: list[list[str | None]] = [[None] * n_cols for _ in range(n_rows)]

    for r, cells in enumerate(header_rows):
        col = 0
        for cell in cells:
            while col < n_cols and grid[r][col] is not None:
                col += 1
            colspan = int(cell.get("colspan", 1))
            rowspan = int(cell.get("rowspan", 1))
            text = _cell_text(cell)
            for dr in range(rowspan):
                for dc in range(colspan):
                    rr, cc = r + dr, col + dc
                    if rr < n_rows and cc < n_cols:
                        grid[rr][cc] = text
            col += colspan

    labels: list[str] = []
    for c in range(n_cols):
        parts: list[str] = []
        for r in range(n_rows):
            t = grid[r][c]
            if t and t not in parts:
                parts.append(t)
        labels.append(" ".join(parts))
    return labels


def _iter_data_rows(table) -> Iterable[list]:
    """Yield <td> rows of a wikitable, skipping pure-header rows."""
    for tr in table.find_all("tr"):
        cells = tr.find_all(["td", "th"])
        if not cells:
            continue
        if all(c.name == "th" for c in cells):
            continue
        yield cells


def _parse_table(table, schema: dict, allow_coal_2pp: bool,
                 default_year: int | None = None) -> list[dict]:
    """Parse one wikitable using header-driven column mapping. Returns a list
    of dicts in the schema's keys; rows missing required fields are dropped.
    default_year resolves date cells that omit the year (current-year tables)."""
    headers = _build_col_labels(table)
    if not headers:
        return []

    cols = _match_columns(headers, schema)
    if "pollster" not in cols or "date" not in cols or "alp" not in cols:
        return []

    tpp_idx = cols.get("tpp")
    if tpp_idx is not None and not _is_alp_2pp(headers[tpp_idx]):
        # Pages like QLD 2028 carry BOTH "2PP vote LNP" and "2PP vote ALP"
        # columns; keyword matching finds the LNP one first. Prefer a direct
        # ALP 2PP column over inverting the Coalition figure.
        for i, h in enumerate(headers):
            if _is_alp_2pp(h):
                tpp_idx = i
                break
    tpp_is_alp = tpp_idx is not None and _is_alp_2pp(headers[tpp_idx])
    tpp_is_coal = tpp_idx is not None and _is_coal_2pp(headers[tpp_idx])
    if tpp_idx is not None and not tpp_is_alp and not tpp_is_coal:
        # Default: assume ALP 2PP if header is ambiguous.
        tpp_is_alp = True

    out: list[dict] = []
    for row in _iter_data_rows(table):
        # Expand cells by colspan so indices align with the header grid.
        texts: list[str] = []
        for cell in row:
            texts.extend([_cell_text(cell)] * int(cell.get("colspan", 1)))

        if len(texts) < max(cols.values()) + 1:
            continue

        pollster = normalise_pollster(texts[cols["pollster"]])
        if not pollster:
            logger.info("skip unknown pollster: %r", texts[cols["pollster"]])
            continue

        iso = parse_fieldwork_date(texts[cols["date"]], default_year=default_year)
        if not iso:
            continue

        alp = _to_float(texts[cols["alp"]])
        if alp is None:
            continue

        rec: dict = {"pollster": pollster, "date": iso, "alp": alp}

        for f in schema:
            if f in ("date", "pollster", "n", "alp", "tpp"):
                continue
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

        if rec["alp"] is None:
            continue

        out.append(rec)
    return out


# ── Public scrape API ─────────────────────────────────────────────────────────
def fetch_html(url: str, timeout: int = 20) -> str | None:
    """GET the URL and return text, or None on any network error.

    A 404 logs at info level — state polling pages routinely don't exist until
    Wikipedia editors create them for the next election cycle, and that is an
    expected skip, not a scraper failure."""
    try:
        resp = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=timeout)
        resp.raise_for_status()
        return resp.text
    except requests.HTTPError as exc:
        status = exc.response.status_code if exc.response is not None else None
        if status == 404:
            logger.info("fetch_html(%s): page does not exist (404)", url)
        else:
            logger.warning("fetch_html(%s) failed: %s", url, exc)
        return None
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
    # The federal page carries seat-projection, leadership and breakout tables
    # with headers that can satisfy the column schema; drop any row whose
    # figures are not poll-shaped before it can be merged permanently.
    return filter_plausible(records, kind="federal", logger=logger)


# ── BludgerTrack XML feed (primary federal source) ────────────────────────────
def _xml_float(point: ET.Element, tag: str) -> float | None:
    text = point.findtext(tag)
    if text is None or not text.strip():
        return None
    try:
        return float(text)
    except ValueError:
        return None


def parse_bludgertrack_xml(xml_text: str) -> list[dict]:
    """Extract national voting-intention records from the BludgerTrack feed.

    The feed carries several <table> elements (leadership ratings, voting
    intention); the voting-intention one is identified by its <point>s having
    <ALP> children. Non-NAT scopes (state and demographic crosstabs like
    "Rent" or "University") are dropped, as is the anchored "Election" row —
    the election result is already a curated entry in bludgertrack.json.
    """
    root = ET.fromstring(xml_text)
    records: list[dict] = []
    for table in root.iter("table"):
        points = list(table.iter("point"))
        if not points or points[0].find("ALP") is None:
            continue                       # leadership-ratings table
        for p in points:
            if p.get("scope") != "NAT":
                continue
            pollster = normalise_pollster(p.get("pollster") or "")
            if pollster is None:
                continue                   # "Election" anchor rows, unknowns
            # Use the fieldwork END date: bludgertrack.json keys records by the
            # last day of fieldwork (parse_fieldwork_date's convention), and the
            # feed's median dates would re-add every existing poll under a
            # shifted date.
            raw_date = p.get("end") or p.get("median") or ""
            try:
                iso_date = datetime.strptime(raw_date, "%d/%m/%Y").date().isoformat()
            except ValueError:
                logger.warning("bludgertrack: bad date %r for %s — skipped",
                               raw_date, pollster)
                continue
            sample = (p.get("sample") or "").replace(",", "").strip()
            records.append({
                "scope":    "NAT",
                "pollster": pollster,
                "date":     iso_date,
                "alp":      _xml_float(p, "ALP"),
                "coal":     _xml_float(p, "LNC"),
                "grn":      _xml_float(p, "GRN"),
                "on":       _xml_float(p, "PHON"),
                "teal":     0.0,
                "tpp":      _xml_float(p, "ALP2"),
                "n":        int(sample) if sample.isdigit() else None,
            })
    return filter_plausible(records, kind="federal", logger=logger)


def scrape_bludgertrack() -> list[dict]:
    """Fetch and parse the BludgerTrack XML feed. Soft-fails to []."""
    xml_text = fetch_html(BLUDGERTRACK_XML_URL)
    if xml_text is None:
        return []
    try:
        return parse_bludgertrack_xml(xml_text)
    except Exception as exc:                                       # noqa: BLE001
        logger.warning("parse_bludgertrack_xml failed: %s", exc)
        return []


_HEADING_YEAR_RE = re.compile(r"^\s*(20\d{2})\b")


def _table_section_year(table) -> int | None:
    """Year from the table's nearest preceding section heading, or None.

    On the VIC polling page the statewide Legislative Assembly tables sit under
    year headings ("2026", "2025", …) while regional/demographic breakouts,
    Legislative Council, leadership and individual-seat tables sit under name
    headings ("Inner Melbourne", "Women", "Hawthorn", …) with IDENTICAL column
    headers. The heading therefore doubles as the statewide-table filter AND
    supplies the year that the current-year table's date cells omit.
    """
    heading = table.find_previous(["h2", "h3", "h4", "h5"])
    if heading is None:
        return None
    text = re.sub(r"\[[^\]]*\]", "", heading.get_text(" ", strip=True))
    m = _HEADING_YEAR_RE.match(text)
    return int(m.group(1)) if m else None


# Section headings that mark statewide voting-intention tables on pages laid
# out like QLD 2028 (named sections rather than year headings). Sub-state,
# demographic, leadership and by-election tables sit under other headings.
_SECTION_ALLOW_TERMS = ("voting intention", "primary vote", "two-party", "2pp")


def _table_allowed_section(table) -> tuple[bool, int | None]:
    """(allowed, default_year) for pages that group statewide tables under
    named sections ("Voting intention") rather than year headings. A year
    heading is also accepted and doubles as default_year for year-less date
    cells, matching the VIC-page behaviour."""
    heading = table.find_previous(["h2", "h3", "h4", "h5"])
    if heading is None:
        return False, None
    text = re.sub(r"\[[^\]]*\]", "", heading.get_text(" ", strip=True)).strip()
    m = _HEADING_YEAR_RE.match(text)
    if m:
        return True, int(m.group(1))
    low = text.lower()
    if any(term in low for term in _SECTION_ALLOW_TERMS):
        return True, None
    return False, None


# ── State scraper registry ────────────────────────────────────────────────────
# One entry per scraped state. "urls" are tried in order, so list the expected
# next-election page first and the "next_..." redirect-style title as fallback;
# a 404 on every candidate soft-skips the state (the page simply doesn't exist
# yet). "table_filter" picks the statewide-table strategy: "year_heading"
# (VIC layout — statewide tables under year headings) or "section" (QLD 2028
# layout — named "Voting intention" sections, year headings also accepted).
# When a new state page appears, save it as a tests/fixtures/wiki_{state}.html
# fixture and verify the filter + schema against the real layout before
# trusting the scrape (see tests/test_poll_scraper.py).
STATE_SCRAPER_REGISTRY: dict[str, dict] = {
    "vic": {
        "urls":         [WIKI_VIC_URL],
        "json_path":    VIC_JSON,
        "scope":        "VIC",
        "schema":       _VIC_SCHEMA,
        "out_fields":   ("lp", "grn", "ind", "on"),
        "table_filter": "year_heading",
    },
    "nsw": {
        "urls": [
            "https://en.wikipedia.org/wiki/Opinion_polling_for_the_2027_New_South_Wales_state_election",
            "https://en.wikipedia.org/wiki/Opinion_polling_for_the_next_New_South_Wales_state_election",
        ],
        "json_path":    NSW_JSON,
        "scope":        "NSW",
        "schema":       _NSW_SCHEMA,
        "out_fields":   ("lp", "np", "grn", "ind", "on"),
        "table_filter": "section",
    },
    "qld": {
        "urls": [
            "https://en.wikipedia.org/wiki/Opinion_polling_for_the_2028_Queensland_state_election",
            "https://en.wikipedia.org/wiki/Opinion_polling_for_the_next_Queensland_state_election",
        ],
        "json_path":    QLD_JSON,
        "scope":        "QLD",
        "schema":       _QLD_SCHEMA,
        "out_fields":   ("lnp", "grn", "ind", "on"),
        "table_filter": "section",
    },
    "wa": {
        "urls": [
            "https://en.wikipedia.org/wiki/Opinion_polling_for_the_2029_Western_Australian_state_election",
            "https://en.wikipedia.org/wiki/Opinion_polling_for_the_next_Western_Australian_state_election",
        ],
        "json_path":    WA_JSON,
        "scope":        "WA",
        "schema":       _WA_SCHEMA,
        "out_fields":   ("lp", "nat", "grn", "ind", "on"),
        "table_filter": "section",
    },
    "sa": {
        "urls": [
            "https://en.wikipedia.org/wiki/Opinion_polling_for_the_2030_South_Australian_state_election",
            "https://en.wikipedia.org/wiki/Opinion_polling_for_the_next_South_Australian_state_election",
        ],
        "json_path":    SA_JSON,
        "scope":        "SA",
        "schema":       _SA_SCHEMA,
        "out_fields":   ("lp", "grn", "ind", "on"),
        "table_filter": "section",
    },
}


def parse_state(html: str, cfg: dict) -> list[dict]:
    """Extract state poll records from Wikipedia HTML using a registry config.

    Only tables passing the config's statewide-table filter are parsed — the
    demographic and regional breakout tables share the statewide tables' exact
    column layout, and parsing them would merge subgroup figures as statewide
    polls (dedup is keyed by pollster+date, so whichever table parsed first
    would win).
    """
    soup = BeautifulSoup(html, "html.parser")
    records: list[dict] = []
    for table in soup.find_all("table", class_="wikitable"):
        if cfg["table_filter"] == "year_heading":
            year = _table_section_year(table)
            if year is None:
                continue
            default_year: int | None = year
        else:
            allowed, default_year = _table_allowed_section(table)
            if not allowed:
                continue
        rows = _parse_table(table, cfg["schema"], allow_coal_2pp=False,
                            default_year=default_year)
        for r in rows:
            rec = {
                "scope":    cfg["scope"],
                "pollster": r["pollster"],
                "date":     r["date"],
                "alp":      r["alp"],
            }
            for f in cfg["out_fields"]:
                rec[f] = r.get(f, 0.0)
            rec["tpp"] = r["tpp"]
            rec["n"] = r.get("n")
            records.append(rec)
    return filter_plausible(records, kind="state", logger=logger)


def parse_vic(html: str) -> list[dict]:
    """Extract Victorian state poll records (wrapper kept for compatibility)."""
    return parse_state(html, STATE_SCRAPER_REGISTRY["vic"])


def scrape_federal() -> list[dict]:
    html = fetch_html(WIKI_FEDERAL_URL)
    if html is None:
        return []
    try:
        return parse_federal(html)
    except Exception as exc:                                       # noqa: BLE001
        logger.warning("parse_federal failed: %s", exc)
        return []


def scrape_state(state: str) -> tuple[list[dict], bool]:
    """Scrape one registered state. Returns (records, page_found).

    page_found is False when every URL candidate failed to fetch — for the
    states whose next-election polling page hasn't been created yet this is
    the normal outcome and the caller should treat it as a skip, not an error.
    """
    cfg = STATE_SCRAPER_REGISTRY[state]
    for url in cfg["urls"]:
        html = fetch_html(url)
        if html is None:
            continue
        try:
            return parse_state(html, cfg), True
        except Exception as exc:                                   # noqa: BLE001
            logger.warning("parse_state(%s) failed: %s", state, exc)
            return [], True
    logger.info("no polling page found for %s yet — skipped "
                "(expected until Wikipedia editors create it)", state.upper())
    return [], False


def scrape_vic() -> list[dict]:
    """Scrape VIC (wrapper kept for compatibility)."""
    return scrape_state("vic")[0]


# ── Append-only merge ─────────────────────────────────────────────────────────
def merge_into_file(path: Path, new_records: list[dict],
                    near_days: int = 0) -> int:
    """Merge new_records into the JSON file at path. Returns the count of
    records actually appended (0 if nothing new). Existing rows are NEVER
    overwritten — dedup is keyed by (pollster, date).

    near_days > 0 additionally treats a record as a duplicate when the file
    already has a same-pollster entry within that many days. Sources date the
    same poll differently (Wikipedia end-of-fieldwork vs. feed publication
    dates can drift by a day), and no tracked pollster fields more than one
    national poll a week, so a small window only ever catches re-dated twins."""
    if not new_records:
        logger.warning("no new records to merge into %s", path)
        return 0

    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)

    existing = data.get("polls", [])
    existing_keys = {(p.get("pollster"), p.get("date")) for p in existing}

    def is_near_duplicate(rec: dict) -> bool:
        if near_days <= 0:
            return False
        try:
            d = date.fromisoformat(rec.get("date", ""))
        except ValueError:
            return False
        for p in existing:
            if p.get("pollster") != rec.get("pollster"):
                continue
            try:
                delta = abs((d - date.fromisoformat(p.get("date", ""))).days)
            except ValueError:
                continue
            if delta <= near_days:
                logger.info("skipping near-duplicate %s %s (existing entry %s)",
                            rec.get("pollster"), rec.get("date"), p.get("date"))
                return True
        return False

    # Deduplicate within new_records too (state-level tables can yield multiple
    # rows for the same pollster+date with different state breakdowns; keep the
    # entry with the largest sample size, or the first one if n is missing).
    seen_new: dict[tuple, dict] = {}
    for r in new_records:
        key = (r.get("pollster"), r.get("date"))
        if key in existing_keys or is_near_duplicate(r):
            continue
        if key not in seen_new:
            seen_new[key] = r
        else:
            prev = seen_new[key]
            if (r.get("n") or 0) > (prev.get("n") or 0):
                seen_new[key] = r
    additions = list(seen_new.values())

    # A successful scrape always refreshes 'retrieved', even when every record
    # was already present. This keeps 'retrieved' a true "last successful fetch"
    # signal so the Data Health Check can tell a dead scraper apart from a quiet
    # polling week — without it, a run that finds no new poll leaves the file
    # untouched and the stamp drifts stale, tripping a false alarm.
    data["retrieved"] = date.today().isoformat()
    if additions:
        data["polls"] = sorted(existing + additions, key=lambda p: p.get("date", ""))

    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")

    if not additions:
        logger.info("merge_into_file(%s): all %d scraped records already present "
                    "(refreshed retrieved stamp)", path.name, len(new_records))
        return 0
    logger.info("merge_into_file(%s): appended %d new record(s)", path.name, len(additions))
    return len(additions)


# ── CLI ───────────────────────────────────────────────────────────────────────
def _main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[1])
    parser.add_argument("--federal-only", action="store_true",
                        help="Scrape only the federal page")
    parser.add_argument("--states", default=None, metavar="ST[,ST...]",
                        help="Comma-separated states to scrape (skips federal); "
                             f"available: {','.join(STATE_SCRAPER_REGISTRY)}")
    parser.add_argument("--vic-only", action="store_true",
                        help="Deprecated alias for --states vic")
    parser.add_argument("--dry-run",      action="store_true",
                        help="Print scraped records, do not write files")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )

    if args.vic_only and args.states is None:
        args.states = "vic"
    if args.federal_only:
        states: list[str] = []
        do_federal = True
    elif args.states is not None:
        states = [s.strip().lower() for s in args.states.split(",") if s.strip()]
        unknown = [s for s in states if s not in STATE_SCRAPER_REGISTRY]
        if unknown:
            parser.error(f"unknown state(s): {','.join(unknown)} "
                         f"(available: {','.join(STATE_SCRAPER_REGISTRY)})")
        do_federal = False
    else:
        states = list(STATE_SCRAPER_REGISTRY)
        do_federal = True

    appended = 0
    total_fetched = 0
    pages_found = 0
    if do_federal:
        # BludgerTrack's structured feed is authoritative; the Wikipedia table
        # scrape is the fallback (its crosstab tables can shear into bogus
        # rows), used only when the feed yields nothing.
        records = scrape_bludgertrack()
        if records:
            logger.info("scraped %d federal records from BludgerTrack feed",
                        len(records))
        else:
            logger.warning("BludgerTrack feed yielded no records — "
                           "falling back to Wikipedia scrape")
            records = scrape_federal()
        total_fetched += len(records)
        pages_found += 1 if records else 0
        logger.info("scraped %d federal records", len(records))
        if args.dry_run:
            print(json.dumps(records, indent=2))
        else:
            # near_days guards against the feed and Wikipedia dating the same
            # poll a day or two apart across scrapes.
            appended += merge_into_file(FEDERAL_JSON, records, near_days=3)

    for state in states:
        records, page_found = scrape_state(state)
        total_fetched += len(records)
        pages_found += 1 if page_found else 0
        if not page_found:
            continue                       # page doesn't exist yet — skip quietly
        logger.info("scraped %d %s records", len(records), state.upper())
        if args.dry_run:
            print(json.dumps(records, indent=2))
        else:
            appended += merge_into_file(STATE_SCRAPER_REGISTRY[state]["json_path"], records)

    logger.info("total new records appended: %d", appended)
    if total_fetched == 0:
        if pages_found == 0 and not do_federal:
            # Every requested state page is yet to be created — nothing to do.
            logger.info("no polling pages exist yet for the requested state(s)")
            return 0
        logger.error("scraper returned 0 records from all sources — Wikipedia fetch or parse failed")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(_main())
