"""
Unit tests for the AEC CSV parser.

Tests use synthetic CSV data that mirrors the AEC format
(metadata header row + data rows), so no actual AEC files needed.
"""

import csv
import io
import os
import sys
import tempfile
import pytest

# Make sure the project root is on the path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pipeline.parse import (
    _iter_aec_csv,
    _safe_int,
    _safe_float,
    parse_candidates,
    parse_polling_places,
    parse_first_preferences,
    parse_tcp,
)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_csv(header_row: list[str], data_rows: list[list], add_metadata: bool = True) -> str:
    """Build a CSV string mimicking AEC format (with optional metadata first row)."""
    buf = io.StringIO()
    writer = csv.writer(buf)
    if add_metadata:
        writer.writerow(["GeneratedDate", "21/05/2022 10:23:45 PM"])
    writer.writerow(header_row)
    for row in data_rows:
        writer.writerow(row)
    return buf.getvalue()


def _write_temp_csv(content: str) -> str:
    """Write CSV content to a temp file, return the path."""
    fd, path = tempfile.mkstemp(suffix=".csv")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(content)
    return path


# ── _safe_int / _safe_float ───────────────────────────────────────────────────

def test_safe_int_normal():
    assert _safe_int("123") == 123

def test_safe_int_comma():
    assert _safe_int("1,234") == 1234

def test_safe_int_empty():
    assert _safe_int("") == 0

def test_safe_int_none():
    assert _safe_int(None) == 0

def test_safe_int_custom_default():
    assert _safe_int("abc", default=99) == 99

def test_safe_float_normal():
    assert _safe_float("3.14") == pytest.approx(3.14)

def test_safe_float_none_value():
    assert _safe_float("") is None

def test_safe_float_custom_default():
    assert _safe_float("", default=0.0) == 0.0


# ── _iter_aec_csv ─────────────────────────────────────────────────────────────

def test_iter_aec_csv_with_metadata():
    content = _make_csv(
        ["StateAb", "DivisionID", "Name"],
        [["NSW", "200", "Alice"], ["VIC", "201", "Bob"]],
        add_metadata=True,
    )
    path = _write_temp_csv(content)
    try:
        rows = list(_iter_aec_csv(path))
        assert len(rows) == 2
        assert rows[0]["StateAb"] == "NSW"
        assert rows[1]["Name"] == "Bob"
    finally:
        os.unlink(path)


def test_iter_aec_csv_without_metadata():
    content = _make_csv(
        ["StateAb", "DivisionID", "Name"],
        [["NSW", "200", "Alice"]],
        add_metadata=False,
    )
    path = _write_temp_csv(content)
    try:
        rows = list(_iter_aec_csv(path))
        assert len(rows) == 1
        assert rows[0]["StateAb"] == "NSW"
    finally:
        os.unlink(path)


def test_iter_aec_csv_skips_blank_rows():
    content = "GeneratedDate,date\nCol1,Col2\nA,B\n\n\nC,D\n"
    path = _write_temp_csv(content)
    try:
        rows = list(_iter_aec_csv(path))
        assert len(rows) == 2
    finally:
        os.unlink(path)


def test_iter_aec_csv_missing_file():
    with pytest.raises(FileNotFoundError):
        list(_iter_aec_csv("/nonexistent/path/file.csv"))


# ── parse_candidates ──────────────────────────────────────────────────────────

CANDIDATE_HEADERS = [
    "StateAb", "DivisionID", "DivisionNm", "PartyAb", "PartyNm",
    "CandidateID", "Surname", "GivenNm", "BallotPosition", "Elected", "HistoricElected"
]

def test_parse_candidates_basic():
    content = _make_csv(
        CANDIDATE_HEADERS,
        [["NSW", "200", "Sydney", "ALP", "Australian Labor Party",
          "10001", "SMITH", "John", "1", "Y", "N"]],
    )
    path = _write_temp_csv(content)
    try:
        records = parse_candidates(path, election_id=2022)
        assert len(records) == 1
        r = records[0]
        assert r["candidate_id"] == 10001
        assert r["division_id"] == 200
        assert r["party_ab"] == "ALP"
        assert r["surname"] == "SMITH"
        assert r["elected"] == 1
        assert r["historic_elected"] == 0
        assert r["election_id"] == 2022
    finally:
        os.unlink(path)


def test_parse_candidates_not_elected():
    content = _make_csv(
        CANDIDATE_HEADERS,
        [["VIC", "201", "Melbourne", "GRN", "The Greens",
          "10002", "JONES", "Jane", "2", "N", "N"]],
    )
    path = _write_temp_csv(content)
    try:
        records = parse_candidates(path, election_id=2022)
        assert records[0]["elected"] == 0
    finally:
        os.unlink(path)


# ── parse_polling_places ──────────────────────────────────────────────────────

BOOTH_HEADERS = [
    "State", "DivisionID", "DivisionNm", "PollingPlaceID", "PollingPlaceTypeID",
    "PollingPlaceNm", "PremisesNm", "PremisesAddress", "PremisesSuburb",
    "PremisesStateAb", "PremisesPostCode", "Latitude", "Longitude"
]

def test_parse_polling_places_basic():
    content = _make_csv(
        BOOTH_HEADERS,
        [["NSW", "200", "Sydney", "5001", "1",
          "Sydney Town Hall", "Sydney Town Hall", "483 George St",
          "Sydney", "NSW", "2000", "-33.8737", "151.2073"]],
    )
    path = _write_temp_csv(content)
    try:
        records = parse_polling_places(path, election_id=2022)
        assert len(records) == 1
        r = records[0]
        assert r["polling_place_id"] == 5001
        assert r["latitude"] == pytest.approx(-33.8737)
        assert r["longitude"] == pytest.approx(151.2073)
        assert r["suburb"] == "Sydney"
    finally:
        os.unlink(path)


# ── parse_first_preferences ───────────────────────────────────────────────────

FP_HEADERS = [
    "StateAb", "DivisionID", "DivisionNm", "PollingPlaceID", "PollingPlaceNm",
    "CandidateID", "Surname", "GivenNm", "BallotPosition", "Elected", "HistoricElected",
    "PartyAb", "PartyNm",
    "OrdinaryVotes", "AbsentVotes", "ProvisionalVotes", "PrePollVotes",
    "PostalVotes", "TotalVotes"
]

def test_parse_first_preferences_vote_totals():
    content = _make_csv(
        FP_HEADERS,
        [["NSW", "200", "Sydney", "5001", "Town Hall",
          "10001", "SMITH", "John", "1", "Y", "N", "ALP", "Labor",
          "300", "10", "5", "50", "20", "385"]],
    )
    path = _write_temp_csv(content)
    try:
        records = parse_first_preferences(path, election_id=2022)
        assert len(records) == 1
        r = records[0]
        assert r["total_votes"] == 385
        assert r["ordinary_votes"] == 300
        assert r["postal_votes"] == 20
        assert r["polling_place_id"] == 5001
        assert r["candidate_id"] == 10001
    finally:
        os.unlink(path)


# ── parse_tcp ────────────────────────────────────────────────────────────────

def test_parse_tcp_basic():
    content = _make_csv(
        FP_HEADERS,  # TCP uses same columns
        [["NSW", "200", "Sydney", "5001", "Town Hall",
          "10001", "SMITH", "John", "1", "Y", "N", "ALP", "Labor",
          "700", "30", "10", "120", "55", "915"],
         ["NSW", "200", "Sydney", "5001", "Town Hall",
          "10002", "JONES", "Jane", "2", "N", "N", "LP", "Liberal",
          "500", "20", "8", "90", "40", "658"]],
    )
    path = _write_temp_csv(content)
    try:
        records = parse_tcp(path, election_id=2022)
        assert len(records) == 2
        total_votes = sum(r["total_votes"] for r in records)
        assert total_votes == 915 + 658
    finally:
        os.unlink(path)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
