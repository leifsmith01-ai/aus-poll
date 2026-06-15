"""
Contract tests for the export JSON schemas (pipeline/export_schemas.py).

These guard the shape of the federal exports that feed the hardcoded frontend
constants (SEAT_FP_2025, SEAT_PREF_FLOWS_2025, …) via
scripts/update_s25_from_exports.py. They run without a database: each test
asserts a representative valid payload passes and that dropping a required key
or using the wrong type raises ExportSchemaError, so the contract is encoded
and the validator is itself verified.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pipeline.export_schemas import ExportSchemaError, validate_export


# ── Representative valid payloads (mirror export.py output) ───────────────────

def _valid_divisions():
    return [
        {
            "division_id": 101,
            "division_name": "Example",
            "state_ab": "NSW",
            "enrolment": 110000,
            "winner": {"candidate_id": 1, "name": "Jane Doe", "party_ab": "ALP"},
            "tcp": [
                {"candidate_id": 1, "name": "Jane Doe", "party_ab": "ALP", "votes": 50000, "pct": 55.0},
                {"candidate_id": 2, "name": "John Roe", "party_ab": "LP", "votes": 40000, "pct": 45.0},
            ],
            "margin_votes": 10000,
            "margin_pct": 10.0,
            "first_prefs": [{"party_ab": "ALP", "votes": 45000, "pct": 45.0}],
        }
    ]


def _valid_national_summary():
    return {
        "parties": [{"party_ab": "ALP", "total_votes": 100}],
        "seats_won": [{"party_ab": "ALP", "seats_won": 94}],
        "total_votes": 100,
        "coalition_combined": {"party_ab": "COAL", "seats_won": 43},
    }


def _valid_preference_flows():
    return {"election_id": 31496, "by_division": {"101": {"GRN": {"alp_share": 0.81}}}}


# ── divisions.json ────────────────────────────────────────────────────────────

def test_divisions_valid_passes():
    validate_export("divisions.json", _valid_divisions())


def test_divisions_empty_list_raises():
    with pytest.raises(ExportSchemaError):
        validate_export("divisions.json", [])


def test_divisions_missing_key_raises():
    data = _valid_divisions()
    del data[0]["first_prefs"]
    with pytest.raises(ExportSchemaError):
        validate_export("divisions.json", data)


def test_divisions_wrong_type_raises():
    data = _valid_divisions()
    data[0]["tcp"] = "not-a-list"
    with pytest.raises(ExportSchemaError):
        validate_export("divisions.json", data)


def test_divisions_nullable_winner_ok():
    data = _valid_divisions()
    data[0]["winner"] = None
    data[0]["margin_votes"] = None
    data[0]["margin_pct"] = None
    validate_export("divisions.json", data)


# ── national_summary.json ─────────────────────────────────────────────────────

def test_national_summary_valid_passes():
    validate_export("national_summary.json", _valid_national_summary())


def test_national_summary_missing_key_raises():
    data = _valid_national_summary()
    del data["coalition_combined"]
    with pytest.raises(ExportSchemaError):
        validate_export("national_summary.json", data)


# ── preference_flows.json ─────────────────────────────────────────────────────

def test_preference_flows_valid_passes():
    validate_export("preference_flows.json", _valid_preference_flows())


def test_preference_flows_bad_division_raises():
    data = _valid_preference_flows()
    data["by_division"]["101"] = "not-an-object"
    with pytest.raises(ExportSchemaError):
        validate_export("preference_flows.json", data)


# ── unregistered files are not validated ──────────────────────────────────────

def test_unregistered_filename_is_noop():
    # booths.geojson / division detail etc. have no schema; anything passes.
    validate_export("booths.geojson", {"anything": [1, 2, 3]})
    validate_export("elections.json", [{"whatever": True}])
