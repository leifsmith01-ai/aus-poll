"""
Unit tests for the deterministic aggregation math in pipeline/poll_aggregator.py
(decay weighting, sample-size weighting, weighted moments, TPP imputation from
primaries, and the iterative house-effect correction). These are the core of
the BludgerTrack-style aggregation and were previously untested.
"""

import math
import os
import sys
from datetime import date

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pipeline import poll_aggregator as pa


# ── adaptive_half_life ────────────────────────────────────────────────────────

def test_adaptive_half_life_far_from_election():
    assert pa.adaptive_half_life(None) == pa.HALF_LIFE_DAYS
    assert pa.adaptive_half_life(365) == pa.HALF_LIFE_DAYS
    assert pa.adaptive_half_life(1000) == pa.HALF_LIFE_DAYS


def test_adaptive_half_life_scales_down_near_election():
    # Halfway through the year → halved base half-life.
    assert pa.adaptive_half_life(182.5) == pytest.approx(pa.HALF_LIFE_DAYS / 2)


def test_adaptive_half_life_floored_at_minimum():
    # Very close to election day clamps to the minimum half-life.
    assert pa.adaptive_half_life(1) == pa.HALF_LIFE_MIN_DAYS


# ── _decay_weight ─────────────────────────────────────────────────────────────

def test_decay_weight_today_is_one():
    assert pa._decay_weight(0) == pytest.approx(1.0)


def test_decay_weight_at_half_life_is_half():
    assert pa._decay_weight(pa.HALF_LIFE_DAYS, half_life=pa.HALF_LIFE_DAYS) == pytest.approx(0.5)


def test_decay_weight_monotonic_decreasing():
    assert pa._decay_weight(10) > pa._decay_weight(20) > pa._decay_weight(40)


# ── weighted moments ──────────────────────────────────────────────────────────

def test_weighted_mean_basic():
    assert pa._weighted_mean([50.0, 60.0], [1.0, 3.0]) == pytest.approx(57.5)


def test_weighted_mean_zero_weight_is_nan():
    assert math.isnan(pa._weighted_mean([1.0, 2.0], [0.0, 0.0]))


def test_weighted_variance_zero_when_all_equal():
    assert pa._weighted_variance([5.0, 5.0, 5.0], [1.0, 2.0, 3.0], 5.0) == pytest.approx(0.0)


def test_weighted_variance_basic():
    # values 0 and 10, equal weights, mean 5 → variance 25.
    assert pa._weighted_variance([0.0, 10.0], [1.0, 1.0], 5.0) == pytest.approx(25.0)


# ── _sample_weight ────────────────────────────────────────────────────────────

def test_sample_weight_at_median_is_one():
    assert pa._sample_weight({"n": pa.MEDIAN_SAMPLE_SIZE}) == pytest.approx(1.0)


def test_sample_weight_missing_n_is_one():
    assert pa._sample_weight({}) == 1.0
    assert pa._sample_weight({"n": 0}) == 1.0


def test_sample_weight_larger_sample_weighs_more():
    small = pa._sample_weight({"n": pa.MEDIAN_SAMPLE_SIZE // 2})
    big = pa._sample_weight({"n": pa.MEDIAN_SAMPLE_SIZE * 2})
    assert big > 1.0 > small


# ── _pollster_quality_weight ──────────────────────────────────────────────────

def test_pollster_quality_weight_known_and_unknown():
    assert pa._pollster_quality_weight({"pollster": "Roy Morgan"}) == pytest.approx(1.05)
    assert pa._pollster_quality_weight({"pollster": "Newspoll"}) == pytest.approx(1.0)
    assert pa._pollster_quality_weight({"pollster": "Nonexistent Pollster"}) == pytest.approx(1.0)


# ── _impute_tpp (federal) ─────────────────────────────────────────────────────

def test_impute_tpp_known_primaries():
    # alp 40, coal 40, grn 12, on 8, no teal/other.
    # alp_tcp = 40 + 12*.81 + 8*.255 = 51.76 ; total 100 → 51.76
    poll = {"alp": 40.0, "coal": 40.0, "grn": 12.0, "on": 8.0}
    assert pa._impute_tpp(poll) == pytest.approx(51.76, abs=0.01)


def test_impute_tpp_missing_data_returns_none():
    assert pa._impute_tpp({"alp": 40.0, "coal": 40.0, "grn": 12.0}) is None  # no 'on'


def test_impute_tpp_teal_flows_more_to_alp_than_other():
    # Tracking the same points as teal (62% → ALP) vs folding into other (50%)
    # should lift ALP's imputed 2PP.
    base = {"alp": 35.0, "coal": 40.0, "grn": 12.0, "on": 5.0}
    with_teal = pa._impute_tpp({**base, "teal": 8.0})
    without_teal = pa._impute_tpp(base)  # those 8 points fall into "other"
    assert with_teal > without_teal


# ── _impute_vic_tpp (state, uses 'lp' + 'ind') ────────────────────────────────

def test_impute_vic_tpp_known_primaries():
    poll = {"alp": 38.0, "lp": 35.0, "grn": 12.0, "ind": 10.0, "on": 5.0}
    result = pa._impute_vic_tpp(poll)
    assert result is not None and 0 < result < 100


def test_impute_vic_tpp_missing_returns_none():
    assert pa._impute_vic_tpp({"alp": 38.0, "grn": 12.0}) is None  # no 'lp'


# ── compute_house_effects ─────────────────────────────────────────────────────

def test_house_effects_recovers_symmetric_bias():
    # Pollster A consistently +2 above truth (50), B consistently -2 below.
    # Equal dates/sample sizes → consensus ~50, recovered effects ~ +2 / -2.
    ref = date(2025, 1, 1)
    polls = []
    for _ in range(4):
        polls.append({"pollster": "A", "date": "2025-01-01", "n": 1500, "alp2pp": 52.0})
        polls.append({"pollster": "B", "date": "2025-01-01", "n": 1500, "alp2pp": 48.0})

    he = pa.compute_house_effects(polls, "alp2pp", ref)

    assert he["__converged"] is True
    assert he["A"] == pytest.approx(2.0, abs=0.2)
    assert he["B"] == pytest.approx(-2.0, abs=0.2)


def test_house_effects_ignores_pollsters_below_min_polls():
    ref = date(2025, 1, 1)
    polls = [{"pollster": "A", "date": "2025-01-01", "n": 1500, "alp2pp": 52.0}
             for _ in range(pa.MIN_POLLS_FOR_HE)]
    # One-off pollster with too few polls to estimate a bias.
    polls.append({"pollster": "Solo", "date": "2025-01-01", "n": 1500, "alp2pp": 70.0})

    he = pa.compute_house_effects(polls, "alp2pp", ref)
    assert "Solo" not in he


def test_house_effects_empty_input():
    assert pa.compute_house_effects([], "alp2pp", date(2025, 1, 1)) == {}
