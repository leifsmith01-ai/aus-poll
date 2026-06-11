"""
Tests for VEC (Victorian Electoral Commission) file handling.

Covers the regression that shipped corrupt VIC seat-FP data:
  1. vec_download._classify_file did not recognise the VEC's published
     filenames (VIC-2022-LA-Primary-Electorate.xlsx etc.), so the
     first-preference file was never parsed and booth-level 2CP data was
     loaded in its place with every candidate defaulting to party "IND".
  2. generate_state_seat_fp now refuses to write degenerate FP data.
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from pipeline.vec_download import _classify_file
from pipeline.vec_parse import _guess_party_ab, parse_vec_fp_excel
from scripts.generate_state_seat_fp import classify_party, degeneracy_reason


# ── File classification ────────────────────────────────────────────────────────

class TestClassifyFile:
    def test_vec_2022_published_names(self):
        # The exact filenames published for the 2022 Victorian state election
        assert _classify_file("VIC-2022-LA-Primary-Electorate.xlsx") == "fp_xlsx"
        assert _classify_file("VIC-2022-LA-Primary-Pollingplace.xlsx") == "fp_booth_xlsx"
        assert _classify_file("VIC-2022-LA-2CP-Electorate.xlsx") == "tcp_xlsx"
        assert _classify_file("VIC-2022-LA-2CP-Pollingplace.xlsx") == "tcp_booth_xlsx"
        assert _classify_file("VIC-2022-LA-Candidates.xlsx") == "candidates_xlsx"

    def test_district_and_booth_files_get_distinct_keys(self):
        # Booth-level files must never overwrite the district-level key.
        assert _classify_file("VIC-2022-LA-Primary-Electorate.xlsx") != \
            _classify_file("VIC-2022-LA-Primary-Pollingplace.xlsx")
        assert _classify_file("VIC-2022-LA-2CP-Electorate.xlsx") != \
            _classify_file("VIC-2022-LA-2CP-Pollingplace.xlsx")

    def test_legislative_council_files_skipped(self):
        assert _classify_file("VIC-2022-LC-Candidates.xlsx") is None
        assert _classify_file("VIC-2022-LC-Votes-Region.xlsx") is None

    def test_generic_names_still_classified(self):
        assert _classify_file("two-candidate-preferred-2022.xlsx") == "tcp_xlsx"
        assert _classify_file("first-preference-votes.xlsx") == "fp_xlsx"
        assert _classify_file("district-results-summary.xlsx") == "results_xlsx"
        assert _classify_file("random-notes.txt") is None


# ── Party mapping ──────────────────────────────────────────────────────────────

class TestPartyMapping:
    def test_guess_party_ab_codes(self):
        assert _guess_party_ab("Australian Labor Party") == "ALP"
        assert _guess_party_ab("LIB") == "LP"
        assert _guess_party_ab("The Nationals") == "NP"
        assert _guess_party_ab("Australian Greens") == "GRN"
        assert _guess_party_ab("") == "IND"

    def test_classify_party_vic_coalition_codes(self):
        # VEC party codes (LIB/NP) and parser-normalised codes (LP/NAT) must all
        # land in the 'coal' bucket — previously LIB/NP were classified 'other'.
        for code in ("LP", "LIB", "NP", "NAT"):
            assert classify_party(code, "vic") == "coal", code
        assert classify_party("ALP", "vic") == "alp"
        assert classify_party("GRN", "vic") == "grn"
        assert classify_party("IND", "vic") == "ind"


# ── FP Excel parsing ───────────────────────────────────────────────────────────

@pytest.fixture
def fp_workbook(tmp_path):
    """Synthetic VEC primary-vote workbook in the 2022 published format."""
    openpyxl = pytest.importorskip("openpyxl")
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["district_name", "district_id", "region_name", "region_id",
               "candidate_id", "candidate_name", "surname", "first_name",
               "party_code", "ballot_order", "votes"])
    rows = [
        ["Albert Park", 1, "Southern Metropolitan", 6, 1, "TAYLOR, Nina", "TAYLOR", "Nina", "ALP", 1, 14254],
        ["Albert Park", 1, "Southern Metropolitan", 6, 2, "SHERSON, Lauren", "SHERSON", "Lauren", "LIB", 2, 11659],
        ["Albert Park", 1, "Southern Metropolitan", 6, 3, "SAMIOTIS, Kim", "SAMIOTIS", "Kim", "GRN", 3, 8178],
        ["Ashwood", 2, "Southern Metropolitan", 6, 4, "FREGON, Matt", "FREGON", "Matt", "ALP", 1, 16000],
        ["Ashwood", 2, "Southern Metropolitan", 6, 5, "JUDAH, Asher", "JUDAH", "Asher", "LIB", 2, 14000],
    ]
    for r in rows:
        ws.append(r)
    path = tmp_path / "VIC-2022-LA-Primary-Electorate.xlsx"
    wb.save(path)
    return path


class TestParseVecFpExcel:
    def test_parses_records_with_real_parties(self, fp_workbook):
        records = parse_vec_fp_excel(fp_workbook, 202211)
        assert len(records) == 5
        parties = {r["surname"]: r["party_ab"] for r in records}
        # The party_code column must be detected — this is the regression that
        # previously classified every candidate as IND.
        assert parties["Taylor"] == "ALP"
        assert parties["Sherson"] == "LP"   # LIB normalised by _guess_party_ab
        assert parties["Samiotis"] == "GRN"
        assert not all(p == "IND" for p in parties.values())

    def test_votes_and_districts(self, fp_workbook):
        records = parse_vec_fp_excel(fp_workbook, 202211)
        albert_park = [r for r in records if r["district_name"] == "Albert Park"]
        assert sum(r["total_votes"] for r in albert_park) == 14254 + 11659 + 8178
        assert len({r["district_id"] for r in records}) == 2


# ── Degenerate-output guard ────────────────────────────────────────────────────

class TestDegeneracyGuard:
    def test_rejects_the_shipped_corruption(self):
        # The exact failure mode that reached production: every district 100% ind.
        garbage = {i: {"alp": 0.0, "coal": 0.0, "grn": 0.0, "ind": 100.0, "on": 0.0, "other": 0.0}
                   for i in range(1, 88)}
        reason = degeneracy_reason(garbage)
        assert reason is not None

    def test_accepts_real_data(self):
        good = {
            1: {"alp": 35.2, "coal": 28.8, "grn": 20.2, "ind": 5.7, "on": 0.0, "other": 10.1},
            2: {"alp": 38.9, "coal": 35.9, "grn": 14.3, "ind": 2.5, "on": 0.0, "other": 8.4},
        }
        assert degeneracy_reason(good) is None

    def test_rejects_identical_profiles(self):
        same = {i: {"alp": 40.0, "coal": 40.0, "grn": 10.0, "ind": 5.0, "on": 0.0, "other": 5.0}
                for i in range(1, 20)}
        assert degeneracy_reason(same) is not None

    def test_empty_map_is_not_degenerate(self):
        assert degeneracy_reason({}) is None
