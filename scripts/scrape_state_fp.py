#!/usr/bin/env python3
"""
scrape_state_fp.py
==================
Fetch per-district first-preference vote percentages from state electoral
commission websites and inject them directly into App.jsx as JS constants.

Populates: NSW_SEAT_FP_2023, QLD_SEAT_FP_2024, VIC_SEAT_FP_2022,
           WA_SEAT_FP_2025, SA_SEAT_FP_2026

Usage:
    python scripts/scrape_state_fp.py

The script reads App.jsx to find seat IDs for each state, fetches FP data
from the EC websites, and writes the populated constants back to App.jsx.

Sources:
  NSW 2023: pastvtr.elections.nsw.gov.au/SG2301/LA/{slug}/cc/fp_summary
  QLD 2024: resultsdata.elections.qld.gov.au/SGE2024-table-booths-{slug}.json
  WA  2025: eis.waec.wa.gov.au/api/sgElections/sg2025/{CODE}/results
  SA  2026: apim-ecsa-production.azure-api.net/results-display/HAChange/2026-03-21/0
  VIC 2022: vec.vic.gov.au/results/state-election-results/2022-state-election-results/results-by-district/{slug}-district-results
"""

from __future__ import annotations

import re
import sys
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).parent.parent
APP_JSX = ROOT / "webapp" / "src" / "App.jsx"

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; aus-poll-scraper/1.0)"}


# ── Party classification ──────────────────────────────────────────────────────

def _classify(party: str, state: str) -> str:
    """Map a party name/code to model key: alp|coal|grn|on|ind."""
    p = party.upper().strip()
    # ALP
    if p in ("ALP", "LABOR", "LABOUR", "LAB",
             "AUSTRALIAN LABOR PARTY",
             "AUSTRALIAN LABOR PARTY - VICTORIAN BRANCH",
             "AUSTRALIAN LABOR PARTY (NSW BRANCH)",
             "AUSTRALIAN LABOR PARTY (STATE OF QUEENSLAND)",
             "AUSTRALIAN LABOR PARTY (SOUTH AUSTRALIAN BRANCH)"):
        return "alp"
    # Explicitly NOT coalition
    if "DEMOCRAT" in p and "LIBERAL" in p:
        return "ind"
    if "COUNTRY LABOR" in p:
        return "alp"
    # Coalition: Liberal Party, Nationals, LNP, CLP
    COAL_EXACT = {"LIB", "LP", "NAT", "NP", "LNP", "CLP",
                  "LIBERAL", "NATIONALS", "THE NATIONALS"}
    if p in COAL_EXACT:
        return "coal"
    if ("LIBERAL PARTY" in p or "NATIONAL PARTY" in p or
            "NATIONALS" in p or "LNP" in p or "COUNTRY LIBERAL" in p):
        return "coal"
    # Greens
    if p in ("GRN", "GREENS", "THE GREENS", "AUSTRALIAN GREENS",
             "QUEENSLAND GREENS", "THE GREENS NSW",
             "AUSTRALIAN GREENS (WA)"):
        return "grn"
    # One Nation
    if p in ("ON", "ONP", "PHON", "ONE NATION",
             "PAULINE HANSON'S ONE NATION",
             "PAULINE HANSON'S ONE NATION QUEENSLAND DIVISION",
             "PAULINE HANSON'S ONE NATION (NSW)",
             "ONE NATION SOUTH AUSTRALIA"):
        return "on"
    # Independents
    if p in ("IND", "INDEPENDENT", "INDEPENDENTS"):
        return "ind"
    return "ind"  # everything else → ind bucket


# ── App.jsx seat ID extraction ────────────────────────────────────────────────

def _normalize(name: str) -> str:
    # Replace hyphens with spaces so "South-West Coast" == "South West Coast"
    name = name.replace("-", " ")
    return re.sub(r"[^a-z0-9 ]", "", name.lower()).strip()


def parse_app_seats(app_src: str, array_name: str) -> dict[str, int]:
    """Extract { normalized_district_name: seat_id } from the named JS array."""
    pattern = rf"const {re.escape(array_name)}\s*=\s*\[(.*?)\];"
    m = re.search(pattern, app_src, re.DOTALL)
    if not m:
        return {}
    block = m.group(1)
    seats: dict[str, int] = {}
    for entry in re.finditer(r"\[\s*(\d+)\s*,\s*\"([^\"]+)\"", block):
        sid = int(entry.group(1))
        name = _normalize(entry.group(2))
        seats[name] = sid
    return seats


# ── NSW 2023 ──────────────────────────────────────────────────────────────────

def _nsw_slugs() -> list[tuple[str, str]]:
    """Return [(slug, district_name), ...] for NSW 2023."""
    r = requests.get(
        "https://pastvtr.elections.nsw.gov.au/SG2301/LA/results",
        headers=HEADERS, timeout=20,
    )
    r.raise_for_status()
    slugs = re.findall(r"/SG2301/LA/([a-z-]+)/cc/fp_summary", r.text)
    slugs = sorted(set(slugs))
    # Convert slug → display name (title-case, replace hyphens)
    return [(s, s.replace("-", " ").title()) for s in slugs]


def _nsw_fp(slug: str) -> dict[str, int]:
    """Return {party_code: votes} for one NSW district."""
    url = f"https://pastvtr.elections.nsw.gov.au/SG2301/LA/{slug}/cc/fp_summary"
    r = requests.get(url, headers=HEADERS, timeout=20)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")
    table = soup.find("table")
    if not table:
        return {}
    result: dict[str, int] = {}
    for row in table.find_all("tr"):
        cells = [c.get_text(strip=True) for c in row.find_all("td")]
        if len(cells) < 3:
            continue
        # Skip the "TOTAL FORMAL VOTES" summary row
        if "TOTAL" in cells[0].upper():
            continue
        party = cells[1]
        votes_str = cells[2].replace(",", "")
        try:
            votes = int(votes_str)
        except ValueError:
            continue
        key = _classify(party, "nsw")
        result[key] = result.get(key, 0) + votes
    return result


def fetch_nsw(app_seats: dict[str, int]) -> dict[int, dict]:
    """Fetch NSW 2023 FP data. Returns {seat_id: {alp,coal,grn,on,ind}}."""
    print("  Fetching NSW district slugs...", file=sys.stderr)
    slugs = _nsw_slugs()
    print(f"  Found {len(slugs)} NSW districts", file=sys.stderr)
    result: dict[int, dict] = {}
    unmatched = []
    for slug, display_name in slugs:
        norm = _normalize(display_name)
        sid = app_seats.get(norm)
        if sid is None:
            unmatched.append(display_name)
            continue
        try:
            fp = _nsw_fp(slug)
        except Exception as exc:
            print(f"  [NSW] {display_name}: {exc}", file=sys.stderr)
            continue
        total = sum(fp.values())
        if total == 0:
            continue
        result[sid] = {k: round(fp.get(k, 0) / total * 100, 1)
                       for k in ("alp", "coal", "grn", "on", "ind")}
        time.sleep(0.1)
    if unmatched:
        print(f"  [NSW] {len(unmatched)} unmatched: {unmatched[:5]}", file=sys.stderr)
    print(f"  NSW: {len(result)} seats populated", file=sys.stderr)
    return result


# ── QLD 2024 ──────────────────────────────────────────────────────────────────

def fetch_qld(app_seats: dict[str, int]) -> dict[int, dict]:
    """Fetch QLD 2024 FP data."""
    print("  Fetching QLD electorate list...", file=sys.stderr)
    r = requests.get(
        "https://resultsdata.elections.qld.gov.au/SGE2024-electorates.json",
        headers=HEADERS, timeout=20,
    )
    r.raise_for_status()
    electorates = r.json()["electorates"]
    print(f"  Found {len(electorates)} QLD electorates", file=sys.stderr)

    result: dict[int, dict] = {}
    unmatched = []
    for el in electorates:
        name = el["electorateName"]
        stub = el["stub"]
        norm = _normalize(name)
        sid = app_seats.get(norm)
        if sid is None:
            unmatched.append(name)
            continue
        try:
            data_r = requests.get(
                f"https://resultsdata.elections.qld.gov.au/SGE2024-table-booths-{stub}.json",
                headers=HEADERS, timeout=20,
            )
            data_r.raise_for_status()
            data = data_r.json()
        except Exception as exc:
            print(f"  [QLD] {name}: {exc}", file=sys.stderr)
            continue

        primary = data.get("primary", {})
        totals = primary.get("totals", {})
        candidates = totals.get("candidates", [])
        formal = totals.get("formalVotes", 0)
        if not formal:
            continue

        fp: dict[str, int] = {}
        for c in candidates:
            key = _classify(c.get("party", ""), "qld")
            fp[key] = fp.get(key, 0) + c.get("count", 0)

        total = sum(fp.values())
        if total == 0:
            continue
        result[sid] = {k: round(fp.get(k, 0) / total * 100, 1)
                       for k in ("alp", "coal", "grn", "on", "ind")}
        time.sleep(0.05)

    if unmatched:
        print(f"  [QLD] {len(unmatched)} unmatched: {unmatched[:5]}", file=sys.stderr)
    print(f"  QLD: {len(result)} seats populated", file=sys.stderr)
    return result


# ── WA 2025 ───────────────────────────────────────────────────────────────────

def fetch_wa(app_seats: dict[str, int]) -> dict[int, dict]:
    """Fetch WA 2025 FP data."""
    print("  Fetching WA electorate list...", file=sys.stderr)
    r = requests.get(
        "https://eis.waec.wa.gov.au/api/sgElections/sg2025/LACandidateParty",
        headers={**HEADERS, "Accept": "application/json",
                 "Referer": "https://www.elections.wa.gov.au/"},
        timeout=20,
    )
    r.raise_for_status()
    electorates = r.json()["electorates"]
    print(f"  Found {len(electorates)} WA electorates", file=sys.stderr)

    result: dict[int, dict] = {}
    unmatched = []
    for el in electorates:
        name = el["ElectorateName"]
        code = el["ElectorateCode"]
        norm = _normalize(name)
        sid = app_seats.get(norm)
        if sid is None:
            unmatched.append(name)
            continue
        try:
            data_r = requests.get(
                f"https://eis.waec.wa.gov.au/api/sgElections/sg2025/{code}/results",
                headers={**HEADERS, "Accept": "application/json",
                         "Referer": "https://www.elections.wa.gov.au/"},
                timeout=20,
            )
            data_r.raise_for_status()
            data = data_r.json()
        except Exception as exc:
            print(f"  [WA] {name}: {exc}", file=sys.stderr)
            continue

        candidates = data.get("resultsCandidates", [])
        fp: dict[str, int] = {}
        for c in candidates:
            key = _classify(c.get("PARTY_AFFILIATION", ""), "wa")
            fp[key] = fp.get(key, 0) + (c.get("Votes_Counted") or 0)

        total = sum(fp.values())
        if total == 0:
            continue
        result[sid] = {k: round(fp.get(k, 0) / total * 100, 1)
                       for k in ("alp", "coal", "grn", "on", "ind")}
        time.sleep(0.05)

    if unmatched:
        print(f"  [WA] {len(unmatched)} unmatched: {unmatched[:5]}", file=sys.stderr)
    print(f"  WA: {len(result)} seats populated", file=sys.stderr)
    return result


# ── SA 2026 ───────────────────────────────────────────────────────────────────

def fetch_sa(app_seats: dict[str, int]) -> dict[int, dict]:
    """Fetch SA 2026 FP data."""
    print("  Fetching SA 2026 static data...", file=sys.stderr)
    r_static = requests.get(
        "https://apim-ecsa-production.azure-api.net/results-display/HAStatic/2026-03-21",
        headers=HEADERS, timeout=30,
    )
    r_static.raise_for_status()
    static = r_static.json()

    # Build candidate_id → party_id mapping per district
    district_cands: dict[str, dict[int, str]] = {}
    for dist in static.get("districts", []):
        dname = dist["districtName"]
        district_cands[dname] = {
            c["candidateId"]: c["partyId"]
            for c in dist.get("candidates", [])
        }

    print("  Fetching SA 2026 vote counts...", file=sys.stderr)
    r_change = requests.get(
        "https://apim-ecsa-production.azure-api.net/results-display/HAChange/2026-03-21/0",
        headers=HEADERS, timeout=60,
    )
    r_change.raise_for_status()
    change = r_change.json()

    result: dict[int, dict] = {}
    unmatched = []
    for dist in change.get("districts", []):
        dname = dist["districtId"]
        norm = _normalize(dname)
        sid = app_seats.get(norm)
        if sid is None:
            unmatched.append(dname)
            continue

        cand_party = district_cands.get(dname, {})
        fp: dict[str, int] = {}

        # Sum votes across polling places
        for pp in dist.get("pollingPlaces", []):
            for c in pp.get("pollingCandidates", []):
                cid = c["candidateId"]
                party_code = cand_party.get(cid, "IND")
                key = _classify(party_code, "sa")
                fp[key] = fp.get(key, 0) + (c.get("formalVotes") or 0)
        # Sum declaration votes
        for dv in dist.get("declarations", []):
            for c in dv.get("pollingCandidates", []):
                cid = c["candidateId"]
                party_code = cand_party.get(cid, "IND")
                key = _classify(party_code, "sa")
                fp[key] = fp.get(key, 0) + (c.get("formalVotes") or 0)

        total = sum(fp.values())
        if total == 0:
            continue
        result[sid] = {k: round(fp.get(k, 0) / total * 100, 1)
                       for k in ("alp", "coal", "grn", "on", "ind")}

    if unmatched:
        print(f"  [SA] {len(unmatched)} unmatched: {unmatched[:5]}", file=sys.stderr)
    print(f"  SA: {len(result)} seats populated", file=sys.stderr)
    return result


# ── VIC 2022 ──────────────────────────────────────────────────────────────────

def _vic_slugs() -> list[tuple[str, str]]:
    """Return [(slug, display_name), ...] for VIC 2022."""
    r = requests.get(
        "https://www.vec.vic.gov.au/results/state-election-results/2022-state-election-results",
        headers=HEADERS, timeout=20,
    )
    r.raise_for_status()
    slugs = re.findall(
        r"/results/state-election-results/2022-state-election-results/"
        r"results-by-district/([a-z-]+)-district-results",
        r.text,
    )
    slugs = sorted(set(slugs))
    return [(s, s.replace("-", " ").title()) for s in slugs]


def _vic_fp(slug: str) -> dict[str, int]:
    """Return {party_key: votes} for one VIC district."""
    url = (
        "https://www.vec.vic.gov.au/results/state-election-results/"
        f"2022-state-election-results/results-by-district/{slug}-district-results"
    )
    r = requests.get(url, headers=HEADERS, timeout=20)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")
    tables = soup.find_all("table")
    if not tables:
        return {}
    # First table is primary votes
    table = tables[0]
    result: dict[str, int] = {}
    for row in table.find_all("tr"):
        cells = [c.get_text(strip=True) for c in row.find_all("td")]
        if len(cells) < 3:
            continue
        # Skip summary rows (Total, Totals, etc.)
        if "TOTAL" in cells[0].upper():
            continue
        party = cells[1]
        votes_str = cells[2].replace(",", "")
        try:
            votes = int(votes_str)
        except ValueError:
            continue
        key = _classify(party, "vic")
        result[key] = result.get(key, 0) + votes
    return result


def fetch_vic(app_seats: dict[str, int]) -> dict[int, dict]:
    """Fetch VIC 2022 FP data."""
    print("  Fetching VIC 2022 electorate slugs...", file=sys.stderr)
    slugs = _vic_slugs()
    print(f"  Found {len(slugs)} VIC districts", file=sys.stderr)
    result: dict[int, dict] = {}
    unmatched = []
    for slug, display_name in slugs:
        norm = _normalize(display_name)
        # Handle special cases: "South West Coast" → "south-west-coast"
        sid = app_seats.get(norm)
        if sid is None:
            unmatched.append(display_name)
            continue
        try:
            fp = _vic_fp(slug)
        except Exception as exc:
            print(f"  [VIC] {display_name}: {exc}", file=sys.stderr)
            continue
        total = sum(fp.values())
        if total == 0:
            continue
        result[sid] = {k: round(fp.get(k, 0) / total * 100, 1)
                       for k in ("alp", "coal", "grn", "on", "ind")}
        time.sleep(0.08)
    if unmatched:
        print(f"  [VIC] {len(unmatched)} unmatched: {unmatched[:10]}", file=sys.stderr)
    print(f"  VIC: {len(result)} seats populated", file=sys.stderr)
    return result


# ── JS constant formatting ────────────────────────────────────────────────────

def format_const(name: str, data: dict[int, dict], comments: dict[int, str]) -> str:
    """Format a JS constant block."""
    lines = [f"const {name} = {{"]
    for sid in sorted(data.keys()):
        d = data[sid]
        alp  = d.get("alp",  0.0)
        coal = d.get("coal", 0.0)
        grn  = d.get("grn",  0.0)
        on   = d.get("on",   0.0)
        ind  = d.get("ind",  0.0)
        comment = comments.get(sid, "")
        lines.append(
            f"  {sid}: {{ alp: {alp:5.1f}, coal: {coal:5.1f}, grn: {grn:5.1f},"
            f" on: {on:5.1f}, ind: {ind:5.1f} }},"
            + (f"  // {comment}" if comment else "")
        )
    lines.append("};")
    return "\n".join(lines)


# ── App.jsx injection ─────────────────────────────────────────────────────────

def inject_constant(app_src: str, const_name: str, new_body: str) -> str:
    """Replace the existing const {const_name} = {...}; in app_src."""
    pattern = rf"(const {re.escape(const_name)}\s*=\s*)\{{[^}}]*\}};"
    replacement = rf"\g<1>{{\n{new_body}\n}};"
    # Use a block replace instead (multi-line)
    # Find start/end of existing block
    start = re.search(rf"const {re.escape(const_name)}\s*=\s*\{{", app_src)
    if not start:
        print(f"  [WARN] Could not find {const_name} in App.jsx", file=sys.stderr)
        return app_src
    # Find matching closing brace
    pos = start.end() - 1  # position of opening {
    depth = 0
    i = pos
    while i < len(app_src):
        if app_src[i] == "{":
            depth += 1
        elif app_src[i] == "}":
            depth -= 1
            if depth == 0:
                break
        i += 1
    end = i + 1  # after closing }
    # Check for semicolon
    if end < len(app_src) and app_src[end] == ";":
        end += 1

    replacement_str = f"const {const_name} = {{\n{new_body}\n}};"
    return app_src[:start.start()] + replacement_str + app_src[end:]


# ── Name lookup tables ────────────────────────────────────────────────────────

def _make_id_to_name(app_seats: dict[str, int]) -> dict[int, str]:
    """Reverse lookup: seat_id → display name."""
    return {v: k for k, v in app_seats.items()}


# ── Main ──────────────────────────────────────────────────────────────────────

STATE_CONFIG = [
    # (array_name, const_name, fetch_fn, state_label)
    ("_NSW", "NSW_SEAT_FP_2023", fetch_nsw, "NSW 2023"),
    ("_QLD", "QLD_SEAT_FP_2024", fetch_qld, "QLD 2024"),
    ("_WA",  "WA_SEAT_FP_2025",  fetch_wa,  "WA 2025"),
    ("_SA",  "SA_SEAT_FP_2026",  fetch_sa,  "SA 2026"),
    ("_VS",  "VIC_SEAT_FP_2022", fetch_vic, "VIC 2022"),
]


def main() -> None:
    if not APP_JSX.exists():
        print(f"ERROR: {APP_JSX} not found", file=sys.stderr)
        sys.exit(1)

    app_src = APP_JSX.read_text(encoding="utf-8")

    for array_name, const_name, fetch_fn, label in STATE_CONFIG:
        print(f"\n── {label} ──", file=sys.stderr)
        app_seats = parse_app_seats(app_src, array_name)
        if not app_seats:
            print(f"  [WARN] {array_name} not found in App.jsx", file=sys.stderr)
            continue
        print(f"  {array_name}: {len(app_seats)} seats to match", file=sys.stderr)

        try:
            fp_data = fetch_fn(app_seats)
        except Exception as exc:
            print(f"  ERROR fetching {label}: {exc}", file=sys.stderr)
            continue

        if not fp_data:
            print(f"  No data for {label}, skipping", file=sys.stderr)
            continue

        id_to_name = _make_id_to_name(app_seats)
        lines: list[str] = []
        for sid in sorted(fp_data.keys()):
            d = fp_data[sid]
            alp  = d.get("alp",  0.0)
            coal = d.get("coal", 0.0)
            grn  = d.get("grn",  0.0)
            on   = d.get("on",   0.0)
            ind  = d.get("ind",  0.0)
            comment = id_to_name.get(sid, "")
            lines.append(
                f"  {sid}: {{ alp: {alp:5.1f}, coal: {coal:5.1f}, grn: {grn:5.1f},"
                f" on: {on:5.1f}, ind: {ind:5.1f} }},"
                + (f"  // {comment}" if comment else "")
            )
        new_body = "\n".join(lines)
        app_src = inject_constant(app_src, const_name, new_body)
        print(f"  Injected {len(fp_data)} entries into {const_name}", file=sys.stderr)

    APP_JSX.write_text(app_src, encoding="utf-8")
    print(f"\nDone. Updated {APP_JSX}", file=sys.stderr)


if __name__ == "__main__":
    main()
