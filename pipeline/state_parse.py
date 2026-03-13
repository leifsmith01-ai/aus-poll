"""
State/Territory Election Data Parser
======================================

Parses downloaded result files from each state and territory electoral
commission into the standardised dict format expected by the database
loader functions in database.py.

Each function returns a dict with keys:
    'candidates'  — list of candidate dicts
    'districts'   — list of district dicts (derived from candidates/FP data)
    'fp'          — list of first-preference vote dicts
    'tcp'         — list of two-candidate-preferred dicts (None for Hare-Clark)
    'party_seats' — list of party-seat dicts (Hare-Clark states only)

Record schemas
--------------
District dict:
    district_id (int), election_id (int), district_name (str),
    enrolment (int|None), seats_in_district (int, Hare-Clark only)

Candidate dict:
    candidate_id (int), election_id (int), district_id (int),
    surname (str), given_name (str|None), party_ab (str|None),
    party_name (str|None), ballot_position (int|None), elected (int 0/1)

FP dict:
    election_id (int), district_id (int), candidate_id (int),
    total_votes (int), vote_pct (float|None)

TCP dict (preferential states only):
    election_id (int), district_id (int), candidate_id (int),
    total_votes (int), vote_pct (float|None), elected (int 0/1)

Party-seats dict (Hare-Clark states only):
    election_id (int), district_id (int), party_ab (str),
    seats_won (int), total_fp_votes (int|None)

File format notes per EC
------------------------
NSWEC (NSW): CSV, columns vary slightly by year.  Key files:
  - House of Assembly candidates: CandidatesByDistrict*.csv
  - First preferences by district: FPbyDistrict*.csv or DistrictSummary*.csv
  - TCP by district: TCPbyDistrict*.csv or 2CPbyDistrict*.csv

ECQ (QLD): CSV downloads from results portal.  Key files:
  - Candidate list: candidates*.csv
  - First preferences: firstprefs*.csv or results*.csv
  - TCP: twocandpref*.csv

WAEC (WA): CSV.  Key files:
  - Candidates: CandidateList*.csv
  - First preferences: FirstPrefs*.csv
  - TCP: TwoCP*.csv

ECSA (SA): CSV.  Key files:
  - Candidates: CandidateDetails*.csv
  - First preferences: FormalBallotPapers*.csv or FirstPrefs*.csv
  - TCP: TwoCP*.csv

TEC (TAS): CSV, Hare-Clark format.  Key files:
  - Candidates: Candidates*.csv
  - First preferences: FirstPrefs*.csv (per electorate or combined)
  - No TCP — use quota-based count summaries instead

ACT EC (ACT): CSV, Hare-Clark format.  Key files:
  - Candidates: Candidates*.csv
  - First preferences: FP*.csv or TotalVotes*.csv (per electorate)
  - No TCP — use quota-based count summaries instead

NTEC (NT): CSV or Excel.  Key files:
  - Candidates: Candidates*.csv or Results*.xlsx
  - First preferences: FP*.csv
  - TCP: TCP*.csv (optional preferential; exhausted tallies may be present)
"""

import csv
import logging
from pathlib import Path

logger = logging.getLogger(__name__)


# ── Shared helpers ────────────────────────────────────────────────────────────

def _safe_int(val) -> int | None:
    """Convert val to int, returning None on failure."""
    try:
        return int(str(val).replace(",", "").strip())
    except (ValueError, TypeError):
        return None


def _safe_float(val) -> float | None:
    """Convert val to float, returning None on failure."""
    try:
        return float(str(val).replace(",", "").strip())
    except (ValueError, TypeError):
        return None


def _read_csv(path: str) -> list[dict]:
    """Read a CSV file into a list of dicts (header row as keys)."""
    rows = []
    with open(path, encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            rows.append({k.strip(): v.strip() for k, v in row.items()})
    return rows


def _find_col(row: dict, *candidates: str) -> str | None:
    """
    Return the first column name in row whose lower-cased key contains
    any of the candidate substrings.  Returns None if not found.
    """
    lower_keys = {k.lower(): k for k in row}
    for candidate in candidates:
        for lk, orig in lower_keys.items():
            if candidate.lower() in lk:
                return orig
    return None


def _assign_district_ids(district_names: list[str]) -> dict[str, int]:
    """
    Assign sequential integer IDs to district names in alphabetical order,
    matching the convention used in vec_parse.py.
    """
    return {name: i + 1 for i, name in enumerate(sorted(set(district_names)))}


def _guess_party_ab(party_name: str, parties: dict[str, str]) -> str:
    """
    Attempt to match a full party name string to a known abbreviation.
    Falls back to a 3-letter truncation of the party name if no match.
    """
    if not party_name:
        return "IND"
    pn_lower = party_name.strip().lower()
    for ab, full in parties.items():
        if full.lower() == pn_lower or ab.lower() == pn_lower:
            return ab
    # Partial match
    for ab, full in parties.items():
        if ab.lower() in pn_lower or any(w in pn_lower for w in full.lower().split()):
            return ab
    # Fallback: capitalised first 3 letters
    words = party_name.strip().split()
    if words:
        return "".join(w[0] for w in words[:4]).upper()[:5]
    return "OTH"


def _empty_result() -> dict:
    return {"candidates": [], "districts": [], "fp": [], "tcp": [], "party_seats": []}


# ── NSW parser ────────────────────────────────────────────────────────────────

def parse_nsw(file_paths: dict[str, str], election_id: int) -> dict:
    """
    Parse NSWEC result files for a NSW state election.

    Attempts to parse whichever combination of files is available.
    Returns an empty result set (with warning) if no usable files found.

    Expected file roles (from state_download.list_local_state_files):
      'candidates' — candidate list CSV
      'fp'         — first preferences by district CSV
      'tcp'        — two-candidate preferred by district CSV
      'results'    — combined results CSV (used if fp/tcp not separately available)
    """
    from .config import NSW_PARTIES
    result = _empty_result()

    if not file_paths:
        logger.warning("NSW %d: No files to parse.", election_id)
        return result

    # ── Candidates ──────────────────────────────────────────────────────────
    cand_path = file_paths.get("candidates") or file_paths.get("results")
    if cand_path:
        rows = _read_csv(cand_path)
        district_names = []
        for row in rows:
            dname_col = _find_col(row, "district", "electorate", "division")
            dname = row.get(dname_col, "").strip() if dname_col else ""
            if dname:
                district_names.append(dname)

        dist_ids = _assign_district_ids(district_names)

        cand_id = 1
        for row in rows:
            dname_col = _find_col(row, "district", "electorate", "division")
            dname = row.get(dname_col, "").strip() if dname_col else ""
            if not dname:
                continue

            surname_col  = _find_col(row, "surname", "last", "family")
            given_col    = _find_col(row, "given", "first", "christian")
            party_ab_col = _find_col(row, "party_ab", "partyab", "abbrev")
            party_nm_col = _find_col(row, "party_name", "partyname", "party")
            ballot_col   = _find_col(row, "ballot", "position", "order")
            elected_col  = _find_col(row, "elected", "winner", "result")

            party_ab   = row.get(party_ab_col, "").strip() if party_ab_col else ""
            party_name = row.get(party_nm_col, "").strip() if party_nm_col else ""
            if not party_ab and party_name:
                party_ab = _guess_party_ab(party_name, NSW_PARTIES)

            elected_raw = row.get(elected_col, "0") if elected_col else "0"
            elected = 1 if elected_raw.strip().lower() in ("1", "y", "yes", "true", "elected") else 0

            result["candidates"].append({
                "candidate_id":   cand_id,
                "election_id":    election_id,
                "district_id":    dist_ids[dname],
                "surname":        row.get(surname_col, "").strip() if surname_col else "UNKNOWN",
                "given_name":     row.get(given_col, "").strip() if given_col else None,
                "party_ab":       party_ab or None,
                "party_name":     party_name or None,
                "ballot_position": _safe_int(row.get(ballot_col)) if ballot_col else None,
                "elected":        elected,
            })
            cand_id += 1

        # Build districts from collected names
        for dname, did in dist_ids.items():
            result["districts"].append({
                "district_id":   did,
                "election_id":   election_id,
                "district_name": dname,
                "enrolment":     None,
            })

    # ── First Preferences ───────────────────────────────────────────────────
    fp_path = file_paths.get("fp") or file_paths.get("results")
    if fp_path and result["candidates"]:
        cand_lookup = {
            (c["district_id"], c["surname"].upper()): c["candidate_id"]
            for c in result["candidates"]
        }
        dist_lookup = {
            c["district_name"].upper(): c["district_id"]
            for c in result["districts"]
        } if result["districts"] else {}

        rows = _read_csv(fp_path)
        for row in rows:
            dname_col  = _find_col(row, "district", "electorate")
            votes_col  = _find_col(row, "total", "votes", "fp", "count")
            pct_col    = _find_col(row, "pct", "percent", "%")
            surname_col = _find_col(row, "surname", "last", "candidate")

            dname   = row.get(dname_col, "").strip().upper() if dname_col else ""
            surname = row.get(surname_col, "").strip().upper() if surname_col else ""
            did     = dist_lookup.get(dname)
            cid     = cand_lookup.get((did, surname)) if did else None

            if cid is None:
                continue

            result["fp"].append({
                "election_id": election_id,
                "district_id": did,
                "candidate_id": cid,
                "total_votes":  _safe_int(row.get(votes_col)) or 0,
                "vote_pct":     _safe_float(row.get(pct_col)) if pct_col else None,
            })

    # ── TCP ─────────────────────────────────────────────────────────────────
    tcp_path = file_paths.get("tcp")
    if tcp_path and result["candidates"]:
        cand_lookup = {
            (c["district_id"], c["surname"].upper()): c["candidate_id"]
            for c in result["candidates"]
        }
        dist_lookup = {
            c["district_name"].upper(): c["district_id"]
            for c in result["districts"]
        } if result["districts"] else {}

        rows = _read_csv(tcp_path)
        for row in rows:
            dname_col   = _find_col(row, "district", "electorate")
            votes_col   = _find_col(row, "total", "votes", "tcp", "count")
            pct_col     = _find_col(row, "pct", "percent", "%")
            surname_col = _find_col(row, "surname", "last", "candidate")
            elected_col = _find_col(row, "elected", "winner")

            dname   = row.get(dname_col, "").strip().upper() if dname_col else ""
            surname = row.get(surname_col, "").strip().upper() if surname_col else ""
            did     = dist_lookup.get(dname)
            cid     = cand_lookup.get((did, surname)) if did else None

            if cid is None:
                continue

            elected_raw = row.get(elected_col, "0") if elected_col else "0"
            elected = 1 if elected_raw.strip().lower() in ("1", "y", "yes", "true", "elected") else 0

            result["tcp"].append({
                "election_id": election_id,
                "district_id": did,
                "candidate_id": cid,
                "total_votes":  _safe_int(row.get(votes_col)) or 0,
                "vote_pct":     _safe_float(row.get(pct_col)) if pct_col else None,
                "elected":      elected,
            })

    _log_parse_summary("NSW", election_id, result)
    return result


# ── QLD parser ────────────────────────────────────────────────────────────────

def parse_qld(file_paths: dict[str, str], election_id: int) -> dict:
    """
    Parse ECQ result files for a QLD state election.

    The ECQ publishes a structured CSV format from its results portal.
    Returns standardised candidate/FP/TCP dicts.
    """
    from .config import QLD_PARTIES
    result = _empty_result()

    if not file_paths:
        logger.warning("QLD %d: No files to parse.", election_id)
        return result

    result = _parse_generic_preferential(
        file_paths, election_id, QLD_PARTIES, "QLD"
    )
    _log_parse_summary("QLD", election_id, result)
    return result


# ── WA parser ─────────────────────────────────────────────────────────────────

def parse_wa(file_paths: dict[str, str], election_id: int) -> dict:
    """
    Parse WAEC result files for a WA state election.

    Returns standardised candidate/FP/TCP dicts.
    """
    from .config import WA_PARTIES
    result = _empty_result()

    if not file_paths:
        logger.warning("WA %d: No files to parse.", election_id)
        return result

    result = _parse_generic_preferential(
        file_paths, election_id, WA_PARTIES, "WA"
    )
    _log_parse_summary("WA", election_id, result)
    return result


# ── SA parser ─────────────────────────────────────────────────────────────────

def parse_sa(file_paths: dict[str, str], election_id: int) -> dict:
    """
    Parse ECSA result files for a SA state election.

    Returns standardised candidate/FP/TCP dicts.
    """
    from .config import SA_PARTIES
    result = _empty_result()

    if not file_paths:
        logger.warning("SA %d: No files to parse.", election_id)
        return result

    result = _parse_generic_preferential(
        file_paths, election_id, SA_PARTIES, "SA"
    )
    _log_parse_summary("SA", election_id, result)
    return result


# ── TAS parser ────────────────────────────────────────────────────────────────

def parse_tas(file_paths: dict[str, str], election_id: int) -> dict:
    """
    Parse TEC result files for a TAS state election (Hare-Clark).

    The TEC publishes CSV files per electorate.  This parser reads first
    preferences and derives party seat tallies from the elected column.

    Returns standardised candidate/FP/party_seats dicts.
    tcp is always empty for TAS (use party_seats instead).
    """
    from .config import TAS_PARTIES
    result = _empty_result()

    if not file_paths:
        logger.warning("TAS %d: No files to parse.", election_id)
        return result

    result = _parse_hare_clark(file_paths, election_id, TAS_PARTIES, "TAS")
    _log_parse_summary("TAS", election_id, result)
    return result


# ── ACT parser ────────────────────────────────────────────────────────────────

def parse_act(file_paths: dict[str, str], election_id: int) -> dict:
    """
    Parse ACT Electoral Commission result files (Hare-Clark).

    Returns standardised candidate/FP/party_seats dicts.
    tcp is always empty for ACT (use party_seats instead).
    """
    from .config import ACT_PARTIES
    result = _empty_result()

    if not file_paths:
        logger.warning("ACT %d: No files to parse.", election_id)
        return result

    result = _parse_hare_clark(file_paths, election_id, ACT_PARTIES, "ACT")
    _log_parse_summary("ACT", election_id, result)
    return result


# ── NT parser ─────────────────────────────────────────────────────────────────

def parse_nt(file_paths: dict[str, str], election_id: int) -> dict:
    """
    Parse NTEC result files for a NT election (optional preferential voting).

    Returns standardised candidate/FP/TCP dicts.
    Note: exhausted ballots may be present in TCP data under NT's
    optional preferential system; these are silently dropped here as
    they have no candidate_id to attach to.
    """
    from .config import NT_PARTIES
    result = _empty_result()

    if not file_paths:
        logger.warning("NT %d: No files to parse.", election_id)
        return result

    result = _parse_generic_preferential(
        file_paths, election_id, NT_PARTIES, "NT"
    )
    _log_parse_summary("NT", election_id, result)
    return result


# ── Shared parsing logic ──────────────────────────────────────────────────────

def _parse_generic_preferential(file_paths: dict[str, str], election_id: int,
                                  parties: dict, label: str) -> dict:
    """
    Generic CSV parser for single-member preferential states
    (NSW, QLD, WA, SA, NT).

    Builds candidates from the 'candidates' file (or 'results' fallback),
    then reads FP and TCP files if available.
    """
    result = _empty_result()

    # ── Candidates / districts ───────────────────────────────────────────────
    cand_path = file_paths.get("candidates") or file_paths.get("results")
    if not cand_path:
        logger.warning("%s %d: No candidates file found.", label, election_id)
        return result

    rows = _read_csv(cand_path)
    if not rows:
        return result

    district_names = []
    for row in rows:
        col = _find_col(row, "district", "electorate", "division", "seat")
        if col:
            district_names.append(row[col].strip())

    dist_ids = _assign_district_ids(district_names)

    cand_id = 1
    for row in rows:
        dcol     = _find_col(row, "district", "electorate", "division", "seat")
        dname    = row.get(dcol, "").strip() if dcol else ""
        if not dname:
            continue

        scol     = _find_col(row, "surname", "last", "family", "candidate")
        gcol     = _find_col(row, "given", "first", "christian")
        pab_col  = _find_col(row, "party_ab", "partyab", "abbrev", "code")
        pnm_col  = _find_col(row, "party_name", "partyname", "party")
        bal_col  = _find_col(row, "ballot", "position", "order", "no")
        el_col   = _find_col(row, "elected", "winner", "result", "returned")

        pab  = row.get(pab_col, "").strip() if pab_col else ""
        pnm  = row.get(pnm_col, "").strip() if pnm_col else ""
        if not pab and pnm:
            pab = _guess_party_ab(pnm, parties)

        elected_raw = row.get(el_col, "0") if el_col else "0"
        elected = 1 if elected_raw.strip().lower() in ("1", "y", "yes", "true", "elected") else 0

        result["candidates"].append({
            "candidate_id":    cand_id,
            "election_id":     election_id,
            "district_id":     dist_ids[dname],
            "surname":         row.get(scol, "UNKNOWN").strip() if scol else "UNKNOWN",
            "given_name":      row.get(gcol, "").strip() or None if gcol else None,
            "party_ab":        pab or None,
            "party_name":      pnm or None,
            "ballot_position": _safe_int(row.get(bal_col)) if bal_col else None,
            "elected":         elected,
        })
        cand_id += 1

    for dname, did in dist_ids.items():
        result["districts"].append({
            "district_id":   did,
            "election_id":   election_id,
            "district_name": dname,
            "enrolment":     None,
        })

    # ── First preferences ────────────────────────────────────────────────────
    fp_path = file_paths.get("fp") or file_paths.get("results")
    if fp_path:
        result["fp"] = _parse_fp_csv(fp_path, election_id, result["candidates"],
                                      result["districts"])

    # ── TCP ──────────────────────────────────────────────────────────────────
    tcp_path = file_paths.get("tcp")
    if tcp_path:
        result["tcp"] = _parse_tcp_csv(tcp_path, election_id, result["candidates"],
                                        result["districts"])

    return result


def _parse_hare_clark(file_paths: dict[str, str], election_id: int,
                       parties: dict, label: str) -> dict:
    """
    Generic CSV parser for Hare-Clark multi-member states (TAS, ACT).

    Reads first preferences per candidate and derives party seat tallies
    from the elected column (0 = not elected, 1–5 = election order).
    """
    result = _empty_result()

    cand_path = file_paths.get("candidates") or file_paths.get("fp") or file_paths.get("results")
    if not cand_path:
        logger.warning("%s %d: No candidates/FP file found.", label, election_id)
        return result

    rows = _read_csv(cand_path)
    if not rows:
        return result

    # Determine if this file has both candidate info and votes in one
    sample = rows[0]
    has_votes = bool(_find_col(sample, "total", "votes", "fp", "count"))

    district_names = []
    for row in rows:
        col = _find_col(row, "district", "electorate", "division", "region")
        if col:
            district_names.append(row[col].strip())

    dist_ids = _assign_district_ids(district_names)

    # Detect seats_in_district from data if possible
    dist_seat_count: dict[str, int] = {}

    cand_id = 1
    for row in rows:
        dcol  = _find_col(row, "district", "electorate", "division", "region")
        dname = row.get(dcol, "").strip() if dcol else ""
        if not dname:
            continue

        scol    = _find_col(row, "surname", "last", "family", "candidate")
        gcol    = _find_col(row, "given", "first", "christian")
        pab_col = _find_col(row, "party_ab", "partyab", "abbrev", "code")
        pnm_col = _find_col(row, "party_name", "partyname", "party")
        bal_col = _find_col(row, "ballot", "position", "order", "no")
        el_col  = _find_col(row, "elected", "winner", "result", "returned", "elected_order")

        pab = row.get(pab_col, "").strip() if pab_col else ""
        pnm = row.get(pnm_col, "").strip() if pnm_col else ""
        if not pab and pnm:
            pab = _guess_party_ab(pnm, parties)

        elected_raw = row.get(el_col, "0") if el_col else "0"
        try:
            elected = int(elected_raw.strip())
        except ValueError:
            elected = 1 if elected_raw.strip().lower() in ("y", "yes", "true", "elected") else 0

        result["candidates"].append({
            "candidate_id":    cand_id,
            "election_id":     election_id,
            "district_id":     dist_ids[dname],
            "surname":         row.get(scol, "UNKNOWN").strip() if scol else "UNKNOWN",
            "given_name":      row.get(gcol, "").strip() or None if gcol else None,
            "party_ab":        pab or None,
            "party_name":      pnm or None,
            "ballot_position": _safe_int(row.get(bal_col)) if bal_col else None,
            "elected":         elected,
        })

        if has_votes:
            v_col = _find_col(row, "total", "votes", "fp", "count")
            p_col = _find_col(row, "pct", "percent", "%")
            result["fp"].append({
                "election_id":  election_id,
                "district_id":  dist_ids[dname],
                "candidate_id": cand_id,
                "total_votes":  _safe_int(row.get(v_col)) or 0 if v_col else 0,
                "vote_pct":     _safe_float(row.get(p_col)) if p_col else None,
            })

        cand_id += 1

    for dname, did in dist_ids.items():
        # Count how many candidates were elected in this district
        n_elected = sum(
            1 for c in result["candidates"]
            if c["district_id"] == did and c["elected"] > 0
        )
        seats = max(n_elected, dist_seat_count.get(dname, 5))
        result["districts"].append({
            "district_id":     did,
            "election_id":     election_id,
            "district_name":   dname,
            "enrolment":       None,
            "seats_in_district": seats,
        })

    # If FP data is in a separate file
    if not has_votes:
        fp_path = file_paths.get("fp") or file_paths.get("results")
        if fp_path and fp_path != cand_path:
            result["fp"] = _parse_fp_csv(fp_path, election_id,
                                          result["candidates"], result["districts"])

    # Derive party_seats from candidates
    result["party_seats"] = _derive_party_seats(
        election_id, result["candidates"], result["districts"]
    )

    return result


def _parse_fp_csv(path: str, election_id: int,
                   candidates: list[dict], districts: list[dict]) -> list[dict]:
    """Parse a first-preferences CSV and match to known candidates/districts."""
    cand_lookup = {
        (c["district_id"], c["surname"].upper()): c["candidate_id"]
        for c in candidates
    }
    dist_lookup = {d["district_name"].upper(): d["district_id"] for d in districts}

    rows = _read_csv(path)
    fp = []
    for row in rows:
        dcol = _find_col(row, "district", "electorate", "division")
        scol = _find_col(row, "surname", "last", "candidate")
        vcol = _find_col(row, "total", "votes", "fp", "count")
        pcol = _find_col(row, "pct", "percent", "%")

        dname   = row.get(dcol, "").strip().upper() if dcol else ""
        surname = row.get(scol, "").strip().upper() if scol else ""
        did     = dist_lookup.get(dname)
        cid     = cand_lookup.get((did, surname)) if did else None

        if cid is None:
            continue

        fp.append({
            "election_id":  election_id,
            "district_id":  did,
            "candidate_id": cid,
            "total_votes":  _safe_int(row.get(vcol)) or 0 if vcol else 0,
            "vote_pct":     _safe_float(row.get(pcol)) if pcol else None,
        })
    return fp


def _parse_tcp_csv(path: str, election_id: int,
                    candidates: list[dict], districts: list[dict]) -> list[dict]:
    """Parse a TCP CSV and match to known candidates/districts."""
    cand_lookup = {
        (c["district_id"], c["surname"].upper()): c["candidate_id"]
        for c in candidates
    }
    dist_lookup = {d["district_name"].upper(): d["district_id"] for d in districts}

    rows = _read_csv(path)
    tcp = []
    for row in rows:
        dcol  = _find_col(row, "district", "electorate", "division")
        scol  = _find_col(row, "surname", "last", "candidate")
        vcol  = _find_col(row, "total", "votes", "tcp", "count")
        pcol  = _find_col(row, "pct", "percent", "%")
        ecol  = _find_col(row, "elected", "winner", "result")

        dname   = row.get(dcol, "").strip().upper() if dcol else ""
        surname = row.get(scol, "").strip().upper() if scol else ""
        did     = dist_lookup.get(dname)
        cid     = cand_lookup.get((did, surname)) if did else None

        if cid is None:
            continue

        elected_raw = row.get(ecol, "0") if ecol else "0"
        elected = 1 if elected_raw.strip().lower() in ("1", "y", "yes", "true", "elected") else 0

        tcp.append({
            "election_id":  election_id,
            "district_id":  did,
            "candidate_id": cid,
            "total_votes":  _safe_int(row.get(vcol)) or 0 if vcol else 0,
            "vote_pct":     _safe_float(row.get(pcol)) if pcol else None,
            "elected":      elected,
        })
    return tcp


def _derive_party_seats(election_id: int,
                          candidates: list[dict],
                          districts: list[dict]) -> list[dict]:
    """
    Derive party seat totals per district from the elected column.
    Used for Hare-Clark states where individual candidates can be
    elected multiple times (up to seats_in_district).
    """
    from collections import defaultdict
    # {(district_id, party_ab): seats_won}
    tally: dict[tuple, int] = defaultdict(int)
    fp_total: dict[tuple, int] = defaultdict(int)

    for c in candidates:
        if c["elected"] > 0:
            key = (c["district_id"], c.get("party_ab") or "IND")
            tally[key] += 1

    # fp totals per (district, party) are not readily available here
    # without the fp list; leave as None — callers can enrich if needed.
    result = []
    for (did, pab), seats in tally.items():
        result.append({
            "election_id":   election_id,
            "district_id":   did,
            "party_ab":      pab,
            "seats_won":     seats,
            "total_fp_votes": None,
        })
    return result


def _log_parse_summary(label: str, election_id: int, result: dict) -> None:
    logger.info(
        "%s %d — candidates: %d  districts: %d  fp: %d  tcp: %d  party_seats: %d",
        label, election_id,
        len(result["candidates"]),
        len(result["districts"]),
        len(result["fp"]),
        len(result["tcp"]),
        len(result["party_seats"]),
    )


# ── Unified dispatcher ────────────────────────────────────────────────────────

_PARSERS = {
    "nsw": parse_nsw,
    "qld": parse_qld,
    "wa":  parse_wa,
    "sa":  parse_sa,
    "tas": parse_tas,
    "act": parse_act,
    "nt":  parse_nt,
}


def parse_state_election(state_ab: str, file_paths: dict[str, str],
                          election_id: int) -> dict:
    """
    Parse election result files for any supported state/territory.

    Args:
        state_ab:   State abbreviation: 'nsw', 'qld', 'wa', 'sa', 'tas', 'act', 'nt'
        file_paths: Dict of {role: local_file_path} as returned by
                    state_download.list_local_state_files()
        election_id: YYYYMM election identifier

    Returns:
        dict with keys 'candidates', 'districts', 'fp', 'tcp', 'party_seats'
    """
    key = state_ab.lower()
    if key not in _PARSERS:
        raise ValueError(
            f"Unknown state '{state_ab}'. Supported: {list(_PARSERS)}"
        )
    return _PARSERS[key](file_paths, election_id)
