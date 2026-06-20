"""
Round-trip tests for pipeline/database.py and an end-to-end exercise of
pipeline/export.py against a temporary SQLite database.

A two-seat synthetic election is loaded through the real loaders, then queried
through the real query helpers and exported through the real export functions.
This validates the actual vote aggregation and JSON generation (the schema test
in test_export_schema.py only checks shapes on synthetic payloads), and proves
the export output passes the schema validator wired into _write_json.
"""

import json
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pipeline import database as db
from pipeline import export
from pipeline.export_schemas import ExportSchemaError, validate_export

ELECTION_ID = 2022  # present in config.ELECTIONS (needed by upsert_election)


@pytest.fixture
def loaded_db(tmp_path):
    """A temp DB holding a two-seat election: Alpha (ALP win), Beta (LP win)."""
    db_path = str(tmp_path / "test.db")
    db.init_db(db_path)
    db.upsert_election(ELECTION_ID, db_path)

    candidates = [
        {"candidate_id": 1, "election_id": ELECTION_ID, "division_id": 101,
         "state_ab": "NSW", "division_name": "Alpha", "surname": "Red",
         "given_name": "Alice", "party_ab": "ALP", "party_name": "Labor", "elected": 1},
        {"candidate_id": 2, "election_id": ELECTION_ID, "division_id": 101,
         "state_ab": "NSW", "division_name": "Alpha", "surname": "Blue",
         "given_name": "Bob", "party_ab": "LP", "party_name": "Liberal", "elected": 0},
        {"candidate_id": 3, "election_id": ELECTION_ID, "division_id": 102,
         "state_ab": "NSW", "division_name": "Beta", "surname": "Rose",
         "given_name": "Carol", "party_ab": "ALP", "party_name": "Labor", "elected": 0},
        {"candidate_id": 4, "election_id": ELECTION_ID, "division_id": 102,
         "state_ab": "NSW", "division_name": "Beta", "surname": "Sky",
         "given_name": "Dan", "party_ab": "LP", "party_name": "Liberal", "elected": 1},
    ]
    db.load_candidates(candidates, db_path)

    # Booth-level first preferences (one booth each).
    fp = [
        {"election_id": ELECTION_ID, "division_id": 101, "polling_place_id": 1,
         "candidate_id": 1, "total_votes": 30000},
        {"election_id": ELECTION_ID, "division_id": 101, "polling_place_id": 1,
         "candidate_id": 2, "total_votes": 25000},
        {"election_id": ELECTION_ID, "division_id": 102, "polling_place_id": 1,
         "candidate_id": 3, "total_votes": 24000},
        {"election_id": ELECTION_ID, "division_id": 102, "polling_place_id": 1,
         "candidate_id": 4, "total_votes": 28000},
    ]
    db.load_first_preferences(fp, db_path)

    # Final-count distribution of preferences (count 2) → TCP totals.
    dop = [
        {"election_id": ELECTION_ID, "division_id": 101, "candidate_id": 1,
         "count_number": 2, "calculation_type": "Preference Count", "calculation_value": 32000},
        {"election_id": ELECTION_ID, "division_id": 101, "candidate_id": 2,
         "count_number": 2, "calculation_type": "Preference Count", "calculation_value": 27000},
        {"election_id": ELECTION_ID, "division_id": 102, "candidate_id": 3,
         "count_number": 2, "calculation_type": "Preference Count", "calculation_value": 26000},
        {"election_id": ELECTION_ID, "division_id": 102, "candidate_id": 4,
         "count_number": 2, "calculation_type": "Preference Count", "calculation_value": 30000},
    ]
    db.load_dop(dop, db_path)
    return db_path


# ── Loader + query round-trip ─────────────────────────────────────────────────

def test_national_summary_aggregates_votes_and_seats(loaded_db):
    summary = db.get_national_summary(ELECTION_ID, loaded_db)
    assert summary["total_votes"] == 107000  # 30000+25000+24000+28000

    by_party = {p["party_ab"]: p for p in summary["parties"]}
    assert by_party["ALP"]["total_votes"] == 54000
    assert by_party["LP"]["total_votes"] == 53000
    assert by_party["ALP"]["vote_share_pct"] == pytest.approx(54000 / 107000 * 100, abs=0.01)

    seats = {s["party_ab"]: s["seats_won"] for s in summary["seats_won"]}
    assert seats == {"ALP": 1, "LP": 1}


def test_get_all_divisions_returns_both_seats_with_winners(loaded_db):
    divs = db.get_all_divisions(ELECTION_ID, loaded_db)
    assert len(divs) == 2
    by_name = {d["division_name"]: d for d in divs}
    assert by_name["Alpha"]["party_ab"] == "ALP"   # elected candidate
    assert by_name["Beta"]["party_ab"] == "LP"


def test_division_summary_fp_and_tcp(loaded_db):
    summary = db.get_division_summary(101, ELECTION_ID, loaded_db)
    fp = {r["party_ab"]: r["total_votes"] for r in summary["first_prefs"]}
    assert fp == {"ALP": 30000, "LP": 25000}
    tcp = {r["party_ab"]: r["total_votes"] for r in summary["tcp"]}
    assert tcp == {"ALP": 32000, "LP": 27000}  # final-count DOP totals


# ── Export end-to-end (real data through the validated writer) ────────────────

def _read(path):
    with open(path) as f:
        return json.load(f)


def test_export_divisions_list_values_and_schema(loaded_db, tmp_path):
    exports = str(tmp_path / "exports")
    export.export_divisions_list(ELECTION_ID, loaded_db, exports)

    data = _read(os.path.join(exports, str(ELECTION_ID), "divisions.json"))
    # Passing the validated _write_json already proves schema conformance; assert
    # again explicitly for clarity.
    validate_export("divisions.json", data)

    by_name = {d["division_name"]: d for d in data}
    assert by_name["Alpha"]["winner"]["party_ab"] == "ALP"
    assert by_name["Alpha"]["margin_votes"] == 5000          # 32000 - 27000
    assert by_name["Beta"]["winner"]["party_ab"] == "LP"
    assert by_name["Beta"]["margin_votes"] == 4000           # 30000 - 26000


def test_export_national_summary_schema_and_coalition(loaded_db, tmp_path):
    exports = str(tmp_path / "exports")
    export.export_national_summary(ELECTION_ID, loaded_db, exports)

    data = _read(os.path.join(exports, str(ELECTION_ID), "national_summary.json"))
    validate_export("national_summary.json", data)
    assert data["coalition_combined"]["total_votes"] == 53000  # LP only here


def test_export_preference_flows_schema(loaded_db, tmp_path):
    exports = str(tmp_path / "exports")
    export.export_preference_flows(ELECTION_ID, loaded_db, exports)

    data = _read(os.path.join(exports, str(ELECTION_ID), "preference_flows.json"))
    validate_export("preference_flows.json", data)
    assert data["election_id"] == ELECTION_ID


def test_write_json_rejects_malformed_payload(tmp_path):
    # The validator wired into _write_json must block a shape-violating write.
    bad = [{"division_id": 1}]  # missing required keys
    with pytest.raises(ExportSchemaError):
        export._write_json(bad, tmp_path / "divisions.json")
    assert not (tmp_path / "divisions.json").exists()  # nothing written


# ── pure helper ───────────────────────────────────────────────────────────────

def test_round2():
    assert export._round2(1.23456) == 1.23
    assert export._round2(None) is None
