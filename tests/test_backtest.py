"""
Unit tests for the deterministic swing model in pipeline/backtest.py: FP-share
grouping, national-primary averaging, uniform swing, elasticity-adjusted swing,
preference-flow resolution and the primary-vote-based seat projection. These
are the model functions the calibration/backtest figures depend on, previously
untested.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pipeline import backtest as bt
from pipeline.backtest import SeatResult


def _seat(alp_2pp=55.0, alp_fp=40.0, coal_fp=38.0, grn_fp=12.0, on_fp=5.0,
          oth_fp=5.0, winner="ALP", name="Testville"):
    return SeatResult(
        division_id=1, name=name, state="NSW", winner_party=winner,
        alp_2pp=alp_2pp, alp_fp=alp_fp, coal_fp=coal_fp, grn_fp=grn_fp,
        on_fp=on_fp, oth_fp=oth_fp, enrolment=100000,
    )


# ── _group_fp_shares ──────────────────────────────────────────────────────────

def test_group_fp_shares_buckets_and_normalises():
    votes = {"ALP": 40, "LP": 30, "NP": 8, "GRN": 12, "ON": 5, "IND": 5}
    shares = bt._group_fp_shares(votes)
    assert shares["alp"] == pytest.approx(40.0)
    assert shares["coal"] == pytest.approx(38.0)  # LP + NP
    assert shares["grn"] == pytest.approx(12.0)
    assert shares["on"] == pytest.approx(5.0)
    assert shares["oth"] == pytest.approx(5.0)
    assert sum(shares.values()) == pytest.approx(100.0)


def test_group_fp_shares_empty_returns_none():
    assert bt._group_fp_shares({}) is None
    assert bt._group_fp_shares({"ALP": 0}) is None


# ── _national_primary ─────────────────────────────────────────────────────────

def test_national_primary_averages_present_values():
    seats = [_seat(alp_fp=40.0, coal_fp=40.0, grn_fp=10.0, alp_2pp=52.0),
             _seat(alp_fp=50.0, coal_fp=30.0, grn_fp=14.0, alp_2pp=58.0)]
    nat = bt._national_primary(seats)
    assert nat["alp"] == pytest.approx(45.0)
    assert nat["coal"] == pytest.approx(35.0)
    assert nat["alp_2pp"] == pytest.approx(55.0)


def test_national_primary_skips_none():
    seats = [_seat(alp_fp=None, alp_2pp=None), _seat(alp_fp=40.0, alp_2pp=52.0)]
    nat = bt._national_primary(seats)
    assert nat["alp"] == pytest.approx(40.0)  # only the non-None seat counts


# ── apply_uniform_swing ───────────────────────────────────────────────────────

def test_uniform_swing_shifts_2pp():
    res = bt.apply_uniform_swing(_seat(alp_2pp=55.0), nat_2pp_swing=-3.0)
    assert res["pred_alp_2pp"] == pytest.approx(52.0)
    assert res["pred_winner_party"] == "ALP"
    assert res["changed"] is False


def test_uniform_swing_flips_seat():
    res = bt.apply_uniform_swing(_seat(alp_2pp=51.0), nat_2pp_swing=-3.0)
    assert res["pred_alp_2pp"] == pytest.approx(48.0)
    assert res["pred_winner_party"] != "ALP"
    assert res["changed"] is True


def test_uniform_swing_clamps_to_range():
    assert bt.apply_uniform_swing(_seat(alp_2pp=98.0), 10.0)["pred_alp_2pp"] == 100.0
    assert bt.apply_uniform_swing(_seat(alp_2pp=2.0), -10.0)["pred_alp_2pp"] == 0.0


def test_uniform_swing_non_alp_coal_seat_holds():
    res = bt.apply_uniform_swing(_seat(alp_2pp=None, winner="GRN"), -5.0)
    assert res["pred_alp_2pp"] is None
    assert res["pred_winner_party"] == "GRN"
    assert res["changed"] is False


# ── apply_swing_with_elasticity ───────────────────────────────────────────────

def test_elasticity_amplifies_marginal_more_than_safe():
    swing = -4.0
    marginal = bt.apply_swing_with_elasticity(_seat(alp_2pp=50.5), swing)
    safe = bt.apply_swing_with_elasticity(_seat(alp_2pp=70.0), swing)
    # Marginal seat's applied swing magnitude should exceed the safe seat's.
    marginal_shift = 50.5 - marginal["pred_alp_2pp"]
    safe_shift = 70.0 - safe["pred_alp_2pp"]
    assert marginal_shift > safe_shift
    assert marginal["elasticity_mult"] > safe["elasticity_mult"]


def test_elasticity_disabled_matches_uniform():
    seat = _seat(alp_2pp=55.0)
    off = bt.apply_swing_with_elasticity(seat, -3.0, elasticity_curve=False)
    uni = bt.apply_uniform_swing(seat, -3.0)
    assert off["pred_alp_2pp"] == uni["pred_alp_2pp"]


# ── _flow_for ─────────────────────────────────────────────────────────────────

def test_flow_for_prefers_division_then_national_then_default():
    div = {"GRN": 0.9}
    nat = {"GRN": 0.8}
    assert bt._flow_for(div, nat, ("GRN",), 0.5) == 0.9        # division wins
    assert bt._flow_for({}, nat, ("GRN",), 0.5) == 0.8         # national fallback
    assert bt._flow_for({}, {}, ("GRN",), 0.5) == 0.5          # default fallback


# ── apply_primary_swing ───────────────────────────────────────────────────────

def test_primary_swing_zero_reproduces_baseline_2pp():
    # With zero primary swings and default flows, the projected 2PP should be a
    # stable function of the baseline FP shares (sanity: ALP-leaning seat stays ALP).
    seat = _seat(alp_2pp=55.0, alp_fp=42.0, coal_fp=36.0, grn_fp=12.0, on_fp=4.0, oth_fp=6.0)
    fp = {"alp": 42.0, "coal": 36.0, "grn": 12.0, "on": 4.0, "oth": 6.0}
    res = bt.apply_primary_swing(seat, fp, primary_swings={})
    assert res["pred_winner_party"] == "ALP"
    assert res["pred_alp_2pp"] > 50.0


def test_primary_swing_applies_grouped_swings():
    seat = _seat(alp_2pp=52.0, alp_fp=40.0, coal_fp=40.0, grn_fp=12.0, on_fp=4.0, oth_fp=4.0)
    fp = {"alp": 40.0, "coal": 40.0, "grn": 12.0, "on": 4.0, "oth": 4.0}
    up = bt.apply_primary_swing(seat, fp, primary_swings={"alp": 5.0, "coal": -5.0})
    down = bt.apply_primary_swing(seat, fp, primary_swings={"alp": -5.0, "coal": 5.0})
    assert up["pred_alp_2pp"] > down["pred_alp_2pp"]


def test_primary_swing_falls_back_to_uniform_without_fp():
    seat = _seat(alp_2pp=55.0)
    res = bt.apply_primary_swing(seat, None, primary_swings={"alp_2pp": -3.0})
    assert res["pred_alp_2pp"] == pytest.approx(52.0)
