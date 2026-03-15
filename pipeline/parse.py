"""
Parse AEC CSV files into clean Python dicts.

AEC CSV format quirk:
  Row 0 → metadata  e.g. "GeneratedDate","21/05/2022 10:23:45 PM"
  Row 1 → blank (sometimes)
  Row 2 → actual column headers
  Row 3+ → data

We detect this automatically by checking whether the first row
looks like a data/header row or a metadata row.
"""

import csv
import logging
from pathlib import Path
from typing import Iterator

logger = logging.getLogger(__name__)


# ── Low-level CSV reader ─────────────────────────────────────────────────────

def _iter_aec_csv(filepath: str | Path) -> Iterator[dict]:
    """
    Yield rows from an AEC CSV file as dicts, skipping the metadata header.
    Handles both UTF-8 and UTF-8-BOM encodings.
    """
    path = Path(filepath)
    if not path.exists():
        raise FileNotFoundError(f"AEC data file not found: {filepath}")

    with open(path, encoding="utf-8-sig", newline="") as fh:
        reader = csv.reader(fh)
        rows = list(reader)

    if not rows:
        logger.warning("Empty file: %s", filepath)
        return

    # Find the header row: skip any rows where the first cell is "GeneratedDate"
    # or is blank, or looks like a date string.
    header_idx = 0
    for i, row in enumerate(rows):
        first = row[0].strip() if row else ""
        if first.lower() in ("generateddate", "") or first[0:4].isdigit():
            continue
        header_idx = i
        break

    headers = [h.strip() for h in rows[header_idx]]
    data_rows = rows[header_idx + 1:]

    logger.debug(
        "%s: header at row %d, %d data rows, columns: %s",
        path.name, header_idx, len(data_rows), headers
    )

    for row in data_rows:
        if not any(cell.strip() for cell in row):
            continue  # skip blank rows
        # Zip even if row is shorter than headers (pad with empty strings)
        padded = row + [""] * (len(headers) - len(row))
        yield dict(zip(headers, padded))


def _safe_int(value: str, default: int = 0) -> int:
    try:
        return int(str(value).replace(",", "").strip())
    except (ValueError, AttributeError):
        return default


def _safe_float(value: str, default: float = None):
    try:
        return float(str(value).replace(",", "").strip())
    except (ValueError, AttributeError):
        return default


# ── Candidates ───────────────────────────────────────────────────────────────

def parse_candidates(filepath: str | Path, election_id: int) -> list[dict]:
    """
    Parse HouseCandidatesDownload-{event_id}.csv

    Expected columns (AEC):
        StateAb, DivisionID, DivisionNm, PartyAb, PartyNm,
        CandidateID, Surname, GivenNm, Elected, HistoricElected
    """
    records = []
    for row in _iter_aec_csv(filepath):
        records.append({
            "candidate_id":      _safe_int(row.get("CandidateID")),
            "election_id":       election_id,
            "division_id":       _safe_int(row.get("DivisionID")),
            "division_name":     row.get("DivisionNm", "").strip(),
            "state_ab":          row.get("StateAb", "").strip(),
            "surname":           row.get("Surname", "").strip(),
            "given_name":        row.get("GivenNm", "").strip(),
            "party_ab":          row.get("PartyAb", "").strip(),
            "party_name":        row.get("PartyNm", "").strip(),
            "ballot_position":   _safe_int(row.get("BallotPosition"), None),
            "elected":           1 if row.get("Elected", "").strip() == "Y" else 0,
            "historic_elected":  1 if row.get("HistoricElected", "").strip() == "Y" else 0,
        })

    logger.info("Parsed %d candidates for election %d", len(records), election_id)
    return records


# ── Polling places (booths) ──────────────────────────────────────────────────

def parse_polling_places(filepath: str | Path, election_id: int) -> list[dict]:
    """
    Parse GeneralPollingPlacesDownload-{event_id}.csv

    Expected columns (AEC):
        State, DivisionID, DivisionNm, PollingPlaceID, PollingPlaceTypeID,
        PollingPlaceNm, PremisesNm, PremisesAddress, PremisesSuburb,
        PremisesStateAb, PremisesPostCode, Latitude, Longitude
    """
    records = []
    for row in _iter_aec_csv(filepath):
        records.append({
            "polling_place_id":      _safe_int(row.get("PollingPlaceID")),
            "election_id":           election_id,
            "division_id":           _safe_int(row.get("DivisionID")),
            "polling_place_name":    row.get("PollingPlaceNm", "").strip(),
            "polling_place_type_id": _safe_int(row.get("PollingPlaceTypeID"), None),
            "premises_name":         row.get("PremisesNm", "").strip() or None,
            "address":               row.get("PremisesAddress", "").strip() or None,
            "suburb":                row.get("PremisesSuburb", "").strip() or None,
            "state_ab":              row.get("PremisesStateAb", "").strip() or None,
            "postcode":              row.get("PremisesPostCode", "").strip() or None,
            "latitude":              _safe_float(row.get("Latitude")),
            "longitude":             _safe_float(row.get("Longitude")),
        })

    logger.info("Parsed %d polling places for election %d", len(records), election_id)
    return records


# ── First preferences by booth ───────────────────────────────────────────────

def parse_first_preferences(filepath: str | Path, election_id: int) -> list[dict]:
    """
    Parse HouseFirstPrefsByPollingPlaceDownload-{event_id}.csv

    Expected columns (AEC):
        StateAb, DivisionID, DivisionNm, PollingPlaceID, PollingPlaceNm,
        CandidateID, Surname, GivenNm, BallotPosition, Elected,
        HistoricElected, PartyAb, PartyNm,
        OrdinaryVotes, AbsentVotes, ProvisionalVotes, PrePollVotes,
        PostalVotes, TotalVotes
    """
    records = []
    for row in _iter_aec_csv(filepath):
        cid = _safe_int(row.get("CandidateID"))
        if cid == 999:
            continue  # Skip AEC informal-votes virtual row
        ordinary = _safe_int(row.get("OrdinaryVotes"))
        absent = _safe_int(row.get("AbsentVotes"))
        provisional = _safe_int(row.get("ProvisionalVotes"))
        prepoll = _safe_int(row.get("PrePollVotes"))
        postal = _safe_int(row.get("PostalVotes"))
        # TotalVotes absent from 2025 per-state files; fall back to sum of components
        total = _safe_int(row.get("TotalVotes")) or (ordinary + absent + provisional + prepoll + postal)
        records.append({
            "election_id":        election_id,
            "division_id":        _safe_int(row.get("DivisionID")),
            "polling_place_id":   _safe_int(row.get("PollingPlaceID")),
            "candidate_id":       cid,
            "ordinary_votes":     ordinary,
            "absent_votes":       absent,
            "provisional_votes":  provisional,
            "prepoll_votes":      prepoll,
            "postal_votes":       postal,
            "total_votes":        total,
        })

    logger.info(
        "Parsed %d first-preference booth rows for election %d",
        len(records), election_id
    )
    return records


# ── Two-candidate preferred (TCP) by booth ───────────────────────────────────

def parse_tcp(filepath: str | Path, election_id: int) -> list[dict]:
    """
    Parse HouseTcpByCandidateByPollingPlaceDownload-{event_id}.csv

    Same column structure as first preferences, but only two candidates
    per division (the two who made it to the final TCP count).
    """
    records = []
    for row in _iter_aec_csv(filepath):
        records.append({
            "election_id":        election_id,
            "division_id":        _safe_int(row.get("DivisionID")),
            "polling_place_id":   _safe_int(row.get("PollingPlaceID")),
            "candidate_id":       _safe_int(row.get("CandidateID")),
            "ordinary_votes":     _safe_int(row.get("OrdinaryVotes")),
            "absent_votes":       _safe_int(row.get("AbsentVotes")),
            "provisional_votes":  _safe_int(row.get("ProvisionalVotes")),
            "prepoll_votes":      _safe_int(row.get("PrePollVotes")),
            "postal_votes":       _safe_int(row.get("PostalVotes")),
            "total_votes":        _safe_int(row.get("TotalVotes")),
        })

    logger.info(
        "Parsed %d TCP booth rows for election %d", len(records), election_id
    )
    return records


# ── Distribution of preferences ──────────────────────────────────────────────

def parse_dop(filepath: str | Path, election_id: int) -> list[dict]:
    """
    Parse HouseDopByDivisionDownload-{event_id}.csv

    Expected columns (AEC):
        StateAb, DivisionID, DivisionNm, PollingPlaceID, PollingPlaceNm,
        CandidateID, Surname, GivenNm, BallotPosition, Elected,
        HistoricElected, PartyAb, PartyNm,
        CalculationType, CalculationValue, CountNumber

    Each row represents one candidate's vote tally at a given count
    in the preference distribution.
    """
    records = []
    for row in _iter_aec_csv(filepath):
        records.append({
            "election_id":       election_id,
            "division_id":       _safe_int(row.get("DivisionID")),
            "polling_place_id":  _safe_int(row.get("PollingPlaceID")) or None,
            "candidate_id":      _safe_int(row.get("CandidateID")),
            "count_number":      _safe_int(row.get("CountNumber")),
            "calculation_type":  row.get("CalculationType", "").strip(),
            "calculation_value": _safe_float(row.get("CalculationValue")),
        })

    logger.info(
        "Parsed %d DOP rows for election %d", len(records), election_id
    )
    return records


# ── Division-level first preferences (with vote type breakdown) ───────────────

def parse_division_first_prefs(filepath: str | Path, election_id: int) -> list[dict]:
    """
    Parse HouseDivisionFirstPrefsByStateByVoteTypeDownload-{event_id}.csv

    Used to cross-check totals and for enrolment figures.
    """
    records = []
    for row in _iter_aec_csv(filepath):
        records.append({
            "election_id":       election_id,
            "division_id":       _safe_int(row.get("DivisionID")),
            "candidate_id":      _safe_int(row.get("CandidateID")),
            "vote_type":         row.get("VoteType", "").strip(),
            "votes":             _safe_int(row.get("Votes")),
        })
    return records


# ── Convenience: parse all files for one election ────────────────────────────

def parse_all(file_paths: dict, election_id: int) -> dict:
    """
    Parse all downloaded files for an election.

    ``file_paths`` is the dict returned by download.list_local_files()
    or download.download_election() i.e. {file_key: local_path}.

    Returns a dict of {data_type: list_of_records}.
    """
    parsers = {
        "candidates":          parse_candidates,
        "polling_places":      parse_polling_places,
        "first_preferences":   parse_first_preferences,
        "tcp":                 parse_tcp,
        "dop":                 parse_dop,
        "division_first_prefs": parse_division_first_prefs,
    }

    results = {}
    for key, parser_fn in parsers.items():
        if key not in file_paths:
            logger.warning("No local file for '%s', skipping.", key)
            continue
        path_or_paths = file_paths[key]
        try:
            if isinstance(path_or_paths, list):
                # Multiple files (e.g. 2025 per-state first_preferences) — merge
                merged = []
                for p in path_or_paths:
                    merged.extend(parser_fn(p, election_id))
                results[key] = merged
                logger.info("Merged %d files for '%s': %d records", len(path_or_paths), key, len(merged))
            else:
                results[key] = parser_fn(path_or_paths, election_id)
        except FileNotFoundError:
            logger.warning("File not found for key '%s', skipping.", key)
        except Exception as e:
            logger.error("Error parsing '%s': %s", key, e, exc_info=True)

    return results
