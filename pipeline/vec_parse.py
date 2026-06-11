"""
VEC (Victorian Electoral Commission) data parser.

Reads Excel (.xlsx) and CSV files obtained from vec.vic.gov.au (or The Tally Room)
and converts them into clean Python dicts compatible with the VIC database schema.

VEC Excel structure (typical):
    The VEC publishes two main tables per election:
    1. First Preferences by District — one row per candidate, columns include
       district name, candidate name, party, ordinary/postal/provisional/prepoll
       votes (sometimes combined as "Total Formal Votes"), and a percentage.
    2. Two-Candidate Preferred (2CP) — one row per candidate in the final two,
       with total 2CP votes and percentage.

    The exact column names vary between elections (VEC doesn't guarantee
    consistent naming). This parser tries several known column name variants
    and falls back to positional detection where possible.

Tally Room CSV structure:
    The Tally Room uses a well-documented format with columns:
    candidates.csv:    DistrictID, DistrictName, CandidateID, Surname, GivenName,
                       PartyName, PartyAb, Elected
    polling_places.csv: DistrictID, PollingPlaceID, PollingPlaceName, Latitude, Longitude
    results.csv:       DistrictID, PollingPlaceID (or 0 for district total),
                       CandidateID, Ordinary, Postal, PrePoll, Absent, Total
"""

import logging
import re
from pathlib import Path
from typing import Any

import pandas as pd

from .config import VIC_ELECTIONS

logger = logging.getLogger(__name__)


# ── VEC Excel parser ──────────────────────────────────────────────────────────

# Known column name variants across VEC Excel publications
_FP_DISTRICT_COLS  = ["district", "electorate", "seat", "division"]
_FP_SURNAME_COLS   = ["surname", "last name", "family name", "candidate surname"]
_FP_GIVEN_COLS     = ["given name", "given names", "first name", "forename"]
_FP_PARTY_COLS     = ["party", "party name", "political party"]
_FP_VOTES_COLS     = ["total formal votes", "total votes", "votes", "formal votes", "fp votes", "first preference votes"]
_FP_PCT_COLS       = ["percentage", "percent", "pct", "%", "fp %", "vote %"]

_TCP_DISTRICT_COLS = _FP_DISTRICT_COLS
_TCP_CANDIDATE_COLS= ["candidate", "name", "candidate name"]
_TCP_PARTY_COLS    = _FP_PARTY_COLS
_TCP_VOTES_COLS    = ["tcp votes", "2cp votes", "two candidate preferred votes", "total votes", "votes"]
_TCP_PCT_COLS      = ["tcp %", "2cp %", "percentage", "percent", "pct"]
_TCP_ELECTED_COLS  = ["elected", "winner", "returned"]

# Heuristic: columns that suggest enrolment data
_ENROL_COLS        = ["enrolment", "enrolled", "total enrolled"]


def _find_col(df: pd.DataFrame, candidates: list[str]) -> str | None:
    """Return the first DataFrame column name that fuzzy-matches any candidate string."""
    lower_cols = {c.lower().strip(): c for c in df.columns}
    for cand in candidates:
        c = cand.lower().strip()
        if c in lower_cols:
            return lower_cols[c]
        # Partial match
        for lc, orig in lower_cols.items():
            if c in lc or lc in c:
                return orig
    return None


def _safe_int(val) -> int:
    """Convert a value to int, stripping commas; return 0 on failure."""
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return 0
    try:
        return int(str(val).replace(",", "").replace(" ", "").strip())
    except (ValueError, TypeError):
        return 0


def _safe_float(val) -> float | None:
    """Convert a value to float; return None on failure."""
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return None
    try:
        return float(str(val).replace(",", "").replace("%", "").strip())
    except (ValueError, TypeError):
        return None


def _normalise_district(name: str) -> str:
    """Normalise district name for consistent matching (title case, strip whitespace)."""
    return " ".join(str(name).title().split())


def _guess_party_ab(party_name: str) -> str:
    """
    Map long-form party names to abbreviations used in the database.
    VEC Excel files often use the full party name.
    """
    if not party_name:
        return "IND"
    n = party_name.strip().upper()

    MAPPING = {
        "AUSTRALIAN LABOR PARTY": "ALP",
        "LABOR": "ALP",
        "LABOUR": "ALP",
        "LIBERAL PARTY OF AUSTRALIA": "LP",
        "LIBERAL": "LP",
        "THE NATIONALS": "NP",
        "NATIONALS": "NP",
        "NATIONAL PARTY": "NP",
        "THE GREENS": "GRN",
        "AUSTRALIAN GREENS": "GRN",
        "GREENS": "GRN",
        "INDEPENDENT": "IND",
        "PAULINE HANSON'S ONE NATION": "ON",
        "ONE NATION": "ON",
        "DEMOCRATIC LABOUR PARTY": "DLP",
        "DERRYN HINCH'S JUSTICE PARTY": "DHJP",
        "SUSTAINABLE AUSTRALIA": "SAP",
        "ANIMAL JUSTICE PARTY": "AJP",
        "REASON AUSTRALIA": "REASON",
        "VICTORIAN SOCIALISTS": "VS",
        "FAMILY FIRST": "FF",
        "LIBERAL DEMOCRATS": "LDP",
    }
    # Direct lookup
    if n in MAPPING:
        return MAPPING[n]
    # Partial match
    for k, v in MAPPING.items():
        if k in n or n in k:
            return v
    # Return first word if unrecognised
    words = party_name.strip().split()
    return words[0].upper()[:6] if words else "OTH"


def _load_sheet(path: Path) -> list[pd.DataFrame]:
    """Load all sheets from an Excel file. Returns list of DataFrames."""
    try:
        xl = pd.ExcelFile(path)
        sheets = []
        for sheet_name in xl.sheet_names:
            df = xl.parse(sheet_name, header=None)
            sheets.append((sheet_name, df))
        return sheets
    except Exception as exc:
        logger.error("Failed to read Excel file %s: %s", path, exc)
        return []


def _detect_header_row(df: pd.DataFrame) -> int:
    """
    Find the row index that looks like a header (contains text in most cells).
    Returns 0 if the first row is the header.
    """
    for i, row in df.iterrows():
        non_null = row.dropna()
        text_count = sum(1 for v in non_null if isinstance(v, str) and len(v) > 1)
        if text_count >= 3:
            return i
    return 0


def _reshape_sheet(df: pd.DataFrame, header_row: int) -> pd.DataFrame:
    """Set the given row as header and drop rows above + the header itself."""
    df = df.copy()
    df.columns = [str(c).strip() if not pd.isna(c) else f"col_{i}"
                  for i, c in enumerate(df.iloc[header_row])]
    df = df.iloc[header_row + 1:].reset_index(drop=True)
    # Drop entirely empty rows
    df = df.dropna(how="all")
    return df


def parse_vec_fp_excel(path: Path, election_id: int) -> list[dict]:
    """
    Parse a VEC first-preferences Excel file.

    Returns a list of dicts with keys:
        election_id, district_id, district_name, candidate_id,
        surname, given_name, party_ab, party_name, elected,
        total_votes, vote_pct
    """
    logger.info("Parsing VEC FP Excel: %s", path.name)
    sheets = _load_sheet(path)
    records: list[dict] = []
    district_index: dict[str, int] = {}  # name → synthetic district_id

    for sheet_name, raw_df in sheets:
        header_row = _detect_header_row(raw_df)
        df = _reshape_sheet(raw_df, header_row)

        # Detect required columns
        district_col = _find_col(df, _FP_DISTRICT_COLS)
        surname_col  = _find_col(df, _FP_SURNAME_COLS)
        given_col    = _find_col(df, _FP_GIVEN_COLS)
        party_col    = _find_col(df, _FP_PARTY_COLS)
        votes_col    = _find_col(df, _FP_VOTES_COLS)
        pct_col      = _find_col(df, _FP_PCT_COLS)

        if not district_col:
            logger.debug("  Sheet '%s': no district column found, skipping", sheet_name)
            continue
        if not votes_col:
            logger.debug("  Sheet '%s': no votes column found, skipping", sheet_name)
            continue
        if not party_col:
            # Without a party column every candidate defaults to IND, which
            # silently corrupts downstream party-share aggregates.
            logger.warning(
                "  Sheet '%s' in %s: no party column found — all candidates "
                "will be classified IND. Columns: %s",
                sheet_name, path.name, list(df.columns)[:12],
            )

        logger.debug(
            "  Sheet '%s': district=%s, surname=%s, party=%s, votes=%s",
            sheet_name, district_col, surname_col, party_col, votes_col
        )

        # Per-district counter so IDs are stable regardless of sheet order.
        # Key: district_id → number of candidates seen so far in that district.
        district_candidate_counter: dict[int, int] = {}

        for _, row in df.iterrows():
            district_name = _normalise_district(row.get(district_col, ""))
            if not district_name or district_name.lower() in ("district", "electorate", "seat", "total", ""):
                continue

            # Assign synthetic district IDs (consistent within a parse run)
            if district_name not in district_index:
                district_index[district_name] = len(district_index) + 1
            district_id = district_index[district_name]

            party_name = str(row.get(party_col, "") or "").strip() if party_col else ""
            party_ab   = _guess_party_ab(party_name)

            surname    = str(row.get(surname_col, "") or "").strip().title() if surname_col else ""
            given_name = str(row.get(given_col,  "") or "").strip().title() if given_col  else ""

            total_votes = _safe_int(row.get(votes_col, 0))
            vote_pct    = _safe_float(row.get(pct_col)) if pct_col else None

            if total_votes == 0 and not surname:
                continue  # skip empty / sub-total rows

            # Increment per-district counter (1-based) for stable, collision-free IDs
            district_candidate_counter[district_id] = district_candidate_counter.get(district_id, 0) + 1
            dc = district_candidate_counter[district_id]

            records.append({
                "election_id":   election_id,
                "district_id":   district_id,
                "district_name": district_name,
                "candidate_id":  election_id * 10000 + district_id * 100 + dc,
                "surname":       surname,
                "given_name":    given_name,
                "party_ab":      party_ab,
                "party_name":    party_name or party_ab,
                "elected":       0,
                "total_votes":   total_votes,
                "vote_pct":      vote_pct,
            })

    logger.info("  Parsed %d FP records from %s", len(records), path.name)
    return records


def parse_vec_tcp_excel(path: Path, election_id: int,
                         fp_records: list[dict] | None = None) -> list[dict]:
    """
    Parse a VEC two-candidate-preferred (2CP) Excel file.

    fp_records is used to look up candidate_ids for name matching.

    Returns a list of dicts with keys:
        election_id, district_id, district_name, candidate_id,
        surname, given_name, party_ab, elected, total_votes, vote_pct
    """
    logger.info("Parsing VEC 2CP Excel: %s", path.name)
    sheets = _load_sheet(path)
    records: list[dict] = []

    # Build name → candidate_id lookup from FP records (for matching)
    fp_lookup: dict[tuple[str, str], dict] = {}
    if fp_records:
        for r in fp_records:
            key = (r["district_name"], r["party_ab"])
            fp_lookup[key] = r

    district_index: dict[str, int] = {}
    if fp_records:
        for r in fp_records:
            district_index[r["district_name"]] = r["district_id"]

    for sheet_name, raw_df in sheets:
        header_row = _detect_header_row(raw_df)
        df = _reshape_sheet(raw_df, header_row)

        district_col = _find_col(df, _TCP_DISTRICT_COLS)
        party_col    = _find_col(df, _TCP_PARTY_COLS)
        votes_col    = _find_col(df, _TCP_VOTES_COLS)
        pct_col      = _find_col(df, _TCP_PCT_COLS)
        elected_col  = _find_col(df, _TCP_ELECTED_COLS)

        if not district_col or not votes_col:
            logger.debug("  Sheet '%s': missing required columns, skipping", sheet_name)
            continue

        candidate_counter = 1

        for _, row in df.iterrows():
            district_name = _normalise_district(row.get(district_col, ""))
            if not district_name or district_name.lower() in ("district", "total", ""):
                continue

            if district_name not in district_index:
                district_index[district_name] = len(district_index) + 1
            district_id = district_index[district_name]

            party_name = str(row.get(party_col, "") or "").strip() if party_col else ""
            party_ab   = _guess_party_ab(party_name)

            total_votes = _safe_int(row.get(votes_col, 0))
            vote_pct    = _safe_float(row.get(pct_col)) if pct_col else None

            elected = 0
            if elected_col:
                ev = str(row.get(elected_col, "")).lower().strip()
                elected = 1 if ev in ("yes", "y", "elected", "true", "1", "✓", "x") else 0
            elif vote_pct and vote_pct > 50.0:
                elected = 1  # infer from 2CP % if no explicit column

            if total_votes == 0:
                continue

            # Try to match a candidate from FP records
            fp_match = fp_lookup.get((district_name, party_ab))
            candidate_id = (
                fp_match["candidate_id"] if fp_match
                else election_id * 10000 + district_id * 100 + candidate_counter
            )
            surname    = fp_match["surname"]    if fp_match else party_ab
            given_name = fp_match["given_name"] if fp_match else ""

            records.append({
                "election_id":   election_id,
                "district_id":   district_id,
                "district_name": district_name,
                "candidate_id":  candidate_id,
                "surname":       surname,
                "given_name":    given_name,
                "party_ab":      party_ab,
                "party_name":    party_name or party_ab,
                "elected":       elected,
                "total_votes":   total_votes,
                "vote_pct":      vote_pct,
            })
            candidate_counter += 1

    logger.info("  Parsed %d 2CP records from %s", len(records), path.name)
    return records


def parse_vec_combined_excel(path: Path, election_id: int) -> dict[str, list[dict]]:
    """
    Attempt to parse a combined VEC results Excel file.
    Returns {"fp": [...], "tcp": [...]} or a subset if only one type detected.
    """
    logger.info("Parsing combined VEC Excel: %s", path.name)
    fp = parse_vec_fp_excel(path, election_id)
    tcp: list[dict] = []
    if fp:
        tcp = parse_vec_tcp_excel(path, election_id, fp_records=fp)
        # If TCP parsing returned the same records as FP, it's not really a TCP sheet
        if len(tcp) == len(fp):
            tcp = []
    return {"fp": fp, "tcp": tcp}


# ── Tally Room CSV parser ─────────────────────────────────────────────────────

def parse_tally_room_candidates(path: Path, election_id: int) -> list[dict]:
    """
    Parse a Tally Room candidates CSV.
    Expected columns: DistrictID, DistrictName, CandidateID, Surname, GivenName,
                      PartyName, PartyAb, Elected
    """
    logger.info("Parsing Tally Room candidates CSV: %s", path.name)
    try:
        df = pd.read_csv(path, encoding="utf-8-sig")
    except Exception as exc:
        logger.error("Failed to read %s: %s", path, exc)
        return []

    records = []
    for _, row in df.iterrows():
        district_name = _normalise_district(row.get("DistrictName", row.get("district_name", "")))
        party_name    = str(row.get("PartyName", row.get("party_name", "")) or "").strip()
        party_ab      = str(row.get("PartyAb",   row.get("party_ab",   "")) or "").strip()
        if not party_ab:
            party_ab = _guess_party_ab(party_name)

        records.append({
            "election_id":   election_id,
            "district_id":   _safe_int(row.get("DistrictID",   row.get("district_id",   0))),
            "district_name": district_name,
            "candidate_id":  _safe_int(row.get("CandidateID",  row.get("candidate_id",  0))),
            "surname":       str(row.get("Surname",    row.get("surname",    "")) or "").strip().title(),
            "given_name":    str(row.get("GivenName",  row.get("given_name", "")) or "").strip().title(),
            "party_ab":      party_ab,
            "party_name":    party_name or party_ab,
            "elected":       _safe_int(row.get("Elected", row.get("elected", 0))),
        })

    logger.info("  Parsed %d candidate records", len(records))
    return records


def parse_tally_room_results(
    path: Path,
    election_id: int,
    candidates: list[dict] | None = None,
    result_type: str = "fp",   # "fp" or "tcp"
) -> list[dict]:
    """
    Parse a Tally Room results CSV.
    Expected columns: DistrictID, PollingPlaceID (0 = district total),
                      CandidateID, Total (or Ordinary, Postal, PrePoll, Absent)
    """
    logger.info("Parsing Tally Room %s results CSV: %s", result_type.upper(), path.name)
    try:
        df = pd.read_csv(path, encoding="utf-8-sig")
    except Exception as exc:
        logger.error("Failed to read %s: %s", path, exc)
        return []

    # Build candidate lookup for additional metadata
    cand_lookup: dict[int, dict] = {}
    if candidates:
        for c in candidates:
            cand_lookup[c["candidate_id"]] = c

    # Filter to district-level totals (PollingPlaceID == 0 or not present)
    pp_col = next((c for c in df.columns if "pollingplace" in c.lower().replace("_", "")), None)
    if pp_col:
        df = df[df[pp_col] == 0].copy()

    records = []
    for _, row in df.iterrows():
        district_id  = _safe_int(row.get("DistrictID",  row.get("district_id",  0)))
        candidate_id = _safe_int(row.get("CandidateID", row.get("candidate_id", 0)))
        total_votes  = _safe_int(
            row.get("Total", row.get("total",
            row.get("Formal", row.get("formal", 0))))
        )

        cand = cand_lookup.get(candidate_id, {})

        records.append({
            "election_id":   election_id,
            "district_id":   district_id,
            "district_name": cand.get("district_name", ""),
            "candidate_id":  candidate_id,
            "surname":       cand.get("surname", ""),
            "given_name":    cand.get("given_name", ""),
            "party_ab":      cand.get("party_ab", ""),
            "party_name":    cand.get("party_name", ""),
            "elected":       cand.get("elected", 0),
            "total_votes":   total_votes,
            "vote_pct":      _safe_float(row.get("Percentage", row.get("percentage"))),
        })

    logger.info("  Parsed %d %s result records", len(records), result_type.upper())
    return records


# ── Tally Room booth-level parser ─────────────────────────────────────────────

def parse_vec_booths(
    path: Path,
    election_id: int,
    candidates: list[dict] | None = None,
    result_type: str = "fp",   # "fp" or "tcp"
) -> tuple[list[dict], list[dict]]:
    """Parse a VEC Tally Room booth-level results CSV.

    Expected columns (case-insensitive): DistrictID, PollingPlaceID, CandidateID,
    PollingPlaceName / PremisesName / Address / Suburb / Postcode / Latitude /
    Longitude, and at least one of: Ordinary, PrePoll, Total.

    Rows with PollingPlaceID == 0 are district-level totals and are skipped —
    this function extracts only real booth rows.

    Returns:
        (polling_places, votes) where
            polling_places: [{polling_place_id, election_id, district_id,
                              polling_place_name, premises_name, address,
                              suburb, postcode, latitude, longitude}]
            votes:          [{election_id, district_id, polling_place_id,
                              candidate_id, ordinary_votes, prepoll_votes,
                              total_votes}]
    """
    path = Path(path)
    logger.info("Parsing Tally Room booth %s CSV: %s", result_type.upper(), path.name)
    try:
        df = pd.read_csv(path, encoding="utf-8-sig")
    except Exception as exc:
        logger.error("Failed to read %s: %s", path, exc)
        return [], []

    # Normalise column access: case/underscore insensitive lookup.
    def col(row, *names, default=None):
        for n in names:
            if n in df.columns:
                v = row.get(n)
                if pd.notna(v):
                    return v
        return default

    pp_col = next(
        (c for c in df.columns if c.lower().replace("_", "") == "pollingplaceid"),
        None,
    )
    if pp_col:
        df = df[df[pp_col].fillna(0).astype(int) != 0].copy()

    seen_places: dict[tuple[int, int], dict] = {}
    votes: list[dict] = []
    for _, row in df.iterrows():
        district_id      = _safe_int(col(row, "DistrictID", "district_id"))
        polling_place_id = _safe_int(col(row, "PollingPlaceID", "polling_place_id"))
        candidate_id     = _safe_int(col(row, "CandidateID", "candidate_id"))
        if not (district_id and polling_place_id and candidate_id):
            continue

        ordinary = _safe_int(col(row, "Ordinary", "ordinary"))
        prepoll  = _safe_int(col(row, "PrePoll", "Prepoll", "pre_poll", "prepoll"))
        total    = _safe_int(col(row, "Total", "total"))
        if total == 0 and (ordinary or prepoll):
            total = ordinary + prepoll

        key = (district_id, polling_place_id)
        if key not in seen_places:
            seen_places[key] = {
                "polling_place_id":   polling_place_id,
                "election_id":        election_id,
                "district_id":        district_id,
                "polling_place_name": str(col(row, "PollingPlaceName",
                                               "polling_place_name", default="") or ""),
                "premises_name":      str(col(row, "PremisesName",
                                               "premises_name", default="") or ""),
                "address":            str(col(row, "Address", "address", default="") or ""),
                "suburb":             str(col(row, "Suburb", "suburb", default="") or ""),
                "postcode":           str(col(row, "Postcode", "postcode", default="") or ""),
                "latitude":           _safe_float(col(row, "Latitude", "latitude")),
                "longitude":          _safe_float(col(row, "Longitude", "longitude")),
            }

        votes.append({
            "election_id":      election_id,
            "district_id":      district_id,
            "polling_place_id": polling_place_id,
            "candidate_id":     candidate_id,
            "ordinary_votes":   ordinary,
            "prepoll_votes":    prepoll,
            "total_votes":      total,
        })

    polling_places = list(seen_places.values())
    logger.info(
        "  Parsed %d booths, %d %s vote rows",
        len(polling_places), len(votes), result_type.upper(),
    )
    return polling_places, votes


# ── Enrolment parser ──────────────────────────────────────────────────────────

def parse_vec_enrolment(path: Path, election_id: int) -> dict[str, int]:
    """
    Parse VEC enrolment data if present (district name → enrolled voters).
    Works for both Excel and CSV inputs.
    """
    try:
        if path.suffix.lower() in (".xlsx", ".xls"):
            df = pd.read_excel(path)
        else:
            df = pd.read_csv(path, encoding="utf-8-sig")
    except Exception as exc:
        logger.warning("Could not parse enrolment file %s: %s", path, exc)
        return {}

    district_col = _find_col(df, _FP_DISTRICT_COLS)
    enrol_col    = _find_col(df, _ENROL_COLS)
    if not district_col or not enrol_col:
        return {}

    result = {}
    for _, row in df.iterrows():
        name = _normalise_district(row.get(district_col, ""))
        enrol = _safe_int(row.get(enrol_col, 0))
        if name and enrol:
            result[name] = enrol

    return result


# ── Top-level parse dispatcher ────────────────────────────────────────────────

def parse_all_vec(file_paths: dict[str, Path], election_id: int) -> dict[str, list[dict]]:
    """
    Parse all available VEC data files for an election.

    file_paths: dict returned by vec_download.list_local_vec_files() or
                vec_download.download_vec_election().

    Returns dict with keys "fp", "tcp", "candidates", "enrolment" containing
    parsed records. "enrolment" is a dict of {district_name: enrolled_count}.
    """
    result: dict[str, list[dict]] = {
        "fp": [], "tcp": [], "candidates": [],
        "polling_places": [], "booth_fp": [], "booth_2cp": [],
    }

    # Tally Room candidates CSV takes priority (better structured)
    tally_cands_path = file_paths.get("tally_room_candidates")
    if tally_cands_path:
        result["candidates"] = parse_tally_room_candidates(tally_cands_path, election_id)

    # Tally Room results CSVs
    tally_fp_path  = file_paths.get("tally_room_fp")
    tally_tcp_path = file_paths.get("tally_room_tcp")
    if tally_fp_path:
        result["fp"] = parse_tally_room_results(
            tally_fp_path, election_id, result["candidates"], result_type="fp"
        )
    if tally_tcp_path:
        result["tcp"] = parse_tally_room_results(
            tally_tcp_path, election_id, result["candidates"], result_type="tcp"
        )

    # Tally Room booth-level CSVs (optional — only if user has downloaded them)
    booth_fp_path  = file_paths.get("tally_room_booth_fp")
    booth_tcp_path = file_paths.get("tally_room_booth_tcp")
    if booth_fp_path:
        pps, votes = parse_vec_booths(
            booth_fp_path, election_id, result["candidates"], result_type="fp",
        )
        result["polling_places"] = pps
        result["booth_fp"] = votes
    if booth_tcp_path:
        pps2, votes2 = parse_vec_booths(
            booth_tcp_path, election_id, result["candidates"], result_type="tcp",
        )
        # Merge any new polling places from the TCP file; votes go into booth_2cp
        known = {(p["polling_place_id"], p["district_id"])
                 for p in result["polling_places"]}
        for p in pps2:
            if (p["polling_place_id"], p["district_id"]) not in known:
                result["polling_places"].append(p)
        result["booth_2cp"] = votes2

    # VEC Excel files
    fp_path  = file_paths.get("fp_xlsx")
    tcp_path = file_paths.get("tcp_xlsx")
    results_path = file_paths.get("results_xlsx") or file_paths.get("other_xlsx")

    if fp_path and not result["fp"]:
        result["fp"] = parse_vec_fp_excel(fp_path, election_id)
    if tcp_path and not result["tcp"]:
        result["tcp"] = parse_vec_tcp_excel(tcp_path, election_id, result["fp"])
    if results_path and not result["fp"]:
        combined = parse_vec_combined_excel(results_path, election_id)
        if combined["fp"] and not result["fp"]:
            result["fp"] = combined["fp"]
        if combined["tcp"] and not result["tcp"]:
            result["tcp"] = combined["tcp"]

    # Mark elected candidates from TCP data (highest vote_pct per district)
    if result["tcp"]:
        _mark_elected(result["tcp"])
        # Propagate elected status to FP records
        elected_candidates = {r["candidate_id"] for r in result["tcp"] if r.get("elected")}
        for r in result["fp"]:
            if r["candidate_id"] in elected_candidates:
                r["elected"] = 1

    # Parse enrolment from any available file (try each in priority order)
    enrolment: dict[str, int] = {}
    for key in ("fp_xlsx", "results_xlsx", "other_xlsx", "tally_room_candidates"):
        path = file_paths.get(key)
        if path and path.exists():
            enrolment = parse_vec_enrolment(path, election_id)
            if enrolment:
                logger.info("parse_all_vec: enrolment     %d districts (from %s)", len(enrolment), path.name)
                break
    result["enrolment"] = enrolment  # type: ignore[assignment]

    # Propagate enrolment into FP records so the DB loader can write it to vic_districts
    if enrolment:
        for r in result["fp"]:
            if r["district_name"] in enrolment:
                r["enrolment"] = enrolment[r["district_name"]]

    for key, records in result.items():
        if isinstance(records, list):
            logger.info("parse_all_vec: %-12s %d records", key, len(records))

    return result


def _mark_elected(tcp_records: list[dict]) -> None:
    """
    For each district in tcp_records, mark the candidate with the highest
    votes as elected=1 (if no explicit elected flag is set).
    """
    # Group by district
    by_district: dict[int, list[dict]] = {}
    for r in tcp_records:
        by_district.setdefault(r["district_id"], []).append(r)

    for district_id, candidates in by_district.items():
        if any(c.get("elected") == 1 for c in candidates):
            continue  # already marked
        if not candidates:
            continue
        winner = max(candidates, key=lambda c: c.get("total_votes") or 0)
        winner["elected"] = 1
