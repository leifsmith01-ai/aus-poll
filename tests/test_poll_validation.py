"""Tests for pipeline.poll_validation — the plausibility gate that keeps
mis-parsed Wikipedia tables (seat projections, demographic breakouts) out of
the poll files and the aggregate."""

import logging

from pipeline.poll_validation import filter_plausible, poll_implausibility


def _fed(**kw):
    rec = {"pollster": "Newspoll", "date": "2026-01-14",
           "alp": 32.0, "coal": 21.0, "grn": 12.0, "on": 22.0, "teal": 0.0,
           "tpp": 55.0, "n": 1500}
    rec.update(kw)
    return rec


class TestFederalBounds:
    def test_typical_poll_passes(self):
        assert poll_implausibility(_fed()) is None

    def test_on_surge_era_poll_passes(self):
        # 2026 polling: ON ~33, Coalition in the teens — genuine, must pass.
        assert poll_implausibility(
            _fed(alp=25.0, coal=18.0, grn=11.0, on=33.0, tpp=None)) is None

    def test_seat_projection_row_rejected(self):
        # Seat counts parsed as primaries (ALP 98 / Coal 29 / ON 12).
        assert poll_implausibility(
            _fed(alp=98.0, coal=29.0, grn=0.0, on=12.0, tpp=None)) is not None

    def test_subsample_tpp_rejected(self):
        assert poll_implausibility(_fed(tpp=64.0)) is not None
        assert poll_implausibility(_fed(tpp=38.0)) is not None

    def test_missing_grn_column_rejected(self):
        # A table without a real Greens column scrapes grn=0.0.
        assert poll_implausibility(_fed(grn=0.0)) is not None

    def test_sum_too_high_rejected(self):
        assert poll_implausibility(
            _fed(alp=34.0, coal=30.0, grn=23.0, on=39.0, tpp=None)) is not None

    def test_none_tpp_is_fine(self):
        assert poll_implausibility(_fed(tpp=None)) is None


class TestStateBounds:
    def test_vic_poll_passes(self):
        rec = {"pollster": "Newspoll", "date": "2026-05-01", "scope": "VIC",
               "alp": 36.0, "lp": 33.0, "grn": 12.0, "ind": 8.0, "on": 6.0,
               "tpp": 53.0}
        assert poll_implausibility(rec, kind="state") is None

    def test_lopsided_state_tpp_passes(self):
        # VIC 2023 polling had ALP 2PP above 60 — state bounds are wider.
        rec = {"pollster": "Roy Morgan", "date": "2023-05-22", "scope": "VIC",
               "alp": 42.0, "lp": 28.5, "grn": 12.5, "ind": 9.0, "on": 0.0,
               "tpp": 61.5}
        assert poll_implausibility(rec, kind="state") is None

    def test_qld_lnp_key_counts_toward_sum(self):
        rec = {"pollster": "2024 Election Result", "date": "2024-10-26",
               "alp": 33.4, "lnp": 40.3, "grn": 11.5, "ind": 6.6, "on": 8.2,
               "tpp": 46.3}
        assert poll_implausibility(rec, kind="state") is None

    def test_all_none_placeholder_passes(self):
        # Election-result marker rows carry no numbers to validate.
        rec = {"pollster": "2025 Election Result", "date": "2025-03-08",
               "tpp": None}
        assert poll_implausibility(rec, kind="state") is None


class TestFilterPlausible:
    def test_drops_only_bad_rows_and_logs(self, caplog):
        good, bad = _fed(), _fed(alp=98.0, grn=0.0, tpp=None)
        with caplog.at_level(logging.WARNING):
            kept = filter_plausible([good, bad, good],
                                    logger=logging.getLogger("t"))
        assert kept == [good, good]
        assert "rejecting implausible poll record" in caplog.text

    def test_order_preserved(self):
        recs = [_fed(alp=30.0), _fed(alp=31.0), _fed(alp=32.0)]
        assert filter_plausible(recs) == recs
