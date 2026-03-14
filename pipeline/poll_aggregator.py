"""
Poll aggregator for Australian federal election polling data.

Methodology:
  1. Exponential time-decay weighting  (half-life = HALF_LIFE_DAYS)
  2. Iterative house-effect correction (pollster bias removal)
  3. TPP imputation from primary votes when TPP is not reported
  4. Weighted rolling confidence intervals from cross-pollster variance

The output JSON is consumed by the frontend polling tracker.

Usage:
    python -m pipeline.poll_aggregator            # writes data/polls/aggregated.json
    python -m pipeline.poll_aggregator --plot     # also prints ASCII trend summary
"""

from __future__ import annotations

import argparse
import json
import logging
import math
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# ── Paths ─────────────────────────────────────────────────────────────────────
POLLS_DIR = Path(__file__).parent.parent / "data" / "polls"
INPUT_FILE = POLLS_DIR / "bludgertrack.json"
OUTPUT_FILE = POLLS_DIR / "aggregated.json"

# ── Aggregation parameters ────────────────────────────────────────────────────
HALF_LIFE_DAYS = 90          # Exponential decay half-life (≈3 months)
HOUSE_EFFECT_ITERATIONS = 50 # Max iterations for bias-correction (convergence usually faster)
HOUSE_EFFECT_TOLERANCE = 1e-4 # Stop iterating when max house-effect change < this
MIN_POLLS_FOR_HE = 3         # Minimum polls from a house to estimate its bias
SMOOTHING_WINDOW_DAYS = 14   # Rolling window for trend output points (days either side)
TREND_STEP_DAYS = 7          # Generate one trend point per week
MEDIAN_SAMPLE_SIZE = 1500    # Normalisation base for sample-size weighting

# ── Standard preference flows for TPP imputation ─────────────────────────────
# Based on observed flows at the 2022 federal election (AEC DOP data).
# These convert primary votes → estimated ALP 2PP when TPP is not reported.
DEFAULT_PREF_FLOWS = {
    "grn_alp":   0.857,  # Greens → ALP (2022 AEC DOP: 85.7%)
    "teal_alp":  0.735,  # Teal/IND → ALP
    "on_alp":    0.149,  # One Nation → ALP (2022 AEC DOP: 14.9%)
    "other_alp": 0.574,  # Other minor parties → ALP (2022 AEC DOP: 57.4%)
}

# Parties that sum to 100% in the poll data; "other" is the residual.
PRIMARY_PARTIES = ["alp", "coal", "grn", "on"]


def _decay_weight(days_ago: float, half_life: float = HALF_LIFE_DAYS) -> float:
    """Return exponential decay weight for a poll published `days_ago` days ago."""
    lam = math.log(2) / half_life
    return math.exp(-lam * days_ago)


def _impute_tpp(poll: dict, flows: dict = DEFAULT_PREF_FLOWS) -> Optional[float]:
    """
    Estimate ALP 2PP from primary votes when TPP is not reported.

    Assumes the "other" residual splits at the `other_alp` rate.
    Returns None if primary data is incomplete.
    """
    alp  = poll.get("alp")
    coal = poll.get("coal")
    grn  = poll.get("grn")
    on   = poll.get("on")
    if any(v is None for v in [alp, coal, grn, on]):
        return None
    other = max(0.0, 100.0 - alp - coal - grn - on)

    alp_tcp = (
        alp
        + grn   * flows["grn_alp"]
        + other  * flows["other_alp"]   # teal/IND rolled into "other" for most polls
        + on    * flows["on_alp"]
    )
    coal_tcp = (
        coal
        + grn   * (1 - flows["grn_alp"])
        + other  * (1 - flows["other_alp"])
        + on    * (1 - flows["on_alp"])
    )
    total = alp_tcp + coal_tcp
    if total <= 0:
        return None
    return round(alp_tcp / total * 100, 2)


def _weighted_mean(values: list[float], weights: list[float]) -> float:
    total_w = sum(weights)
    if total_w == 0:
        return float("nan")
    return sum(v * w for v, w in zip(values, weights)) / total_w


def _weighted_variance(values: list[float], weights: list[float], mean: float) -> float:
    total_w = sum(weights)
    if total_w == 0:
        return float("nan")
    return sum(w * (v - mean) ** 2 for v, w in zip(values, weights)) / total_w


def _sample_weight(poll: dict, median_n: float = MEDIAN_SAMPLE_SIZE) -> float:
    """Return a sample-size scaling factor: sqrt(n / median_n), or 1.0 if n is unknown."""
    n = poll.get("n")
    if n and n > 0:
        return math.sqrt(n / median_n)
    return 1.0


def compute_house_effects(
    polls: list[dict],
    metric: str,
    ref_date: date,
    iterations: int = HOUSE_EFFECT_ITERATIONS,
    tolerance: float = HOUSE_EFFECT_TOLERANCE,
    min_polls: int = MIN_POLLS_FOR_HE,
) -> dict[str, float]:
    """
    Iterative house-effect (pollster bias) correction.

    Algorithm:
      1. Compute an initial decay+sample-size-weighted national mean for `metric`.
      2. For each pollster, compute their weighted-mean deviation from the national mean.
      3. Subtract house effects from each poll and recompute national mean.
      4. Repeat until convergence (max house-effect change < `tolerance`) or `iterations`.

    Weights combine exponential time-decay with sqrt(n/median_n) sample-size scaling.

    Returns a dict of {pollster: bias} where a positive bias means the pollster
    shows higher values for `metric` than the consensus.
    """
    valid = [p for p in polls if p.get(metric) is not None]
    if not valid:
        return {}

    house_effects: dict[str, float] = {}

    for _ in range(iterations):
        # Compute decay+size-weighted mean after subtracting current house effects
        values, weights = [], []
        for p in valid:
            days_ago = (ref_date - date.fromisoformat(p["date"])).days
            if days_ago < 0:
                continue
            he = house_effects.get(p["pollster"], 0.0)
            values.append(p[metric] - he)
            weights.append(_decay_weight(days_ago) * _sample_weight(p))

        nat_mean = _weighted_mean(values, weights)
        if math.isnan(nat_mean):
            break

        # Update house effects: weighted mean residual per pollster
        pollster_residuals: dict[str, list[tuple[float, float]]] = defaultdict(list)
        for p in valid:
            days_ago = (ref_date - date.fromisoformat(p["date"])).days
            if days_ago < 0:
                continue
            he = house_effects.get(p["pollster"], 0.0)
            residual = (p[metric] - he) - nat_mean
            pollster_residuals[p["pollster"]].append(
                (residual, _decay_weight(days_ago) * _sample_weight(p))
            )

        max_change = 0.0
        for pollster, res_weights in pollster_residuals.items():
            if len(res_weights) < min_polls:
                continue
            vals, wts = zip(*res_weights)
            delta = _weighted_mean(list(vals), list(wts))
            house_effects[pollster] = house_effects.get(pollster, 0.0) + delta
            max_change = max(max_change, abs(delta))

        if max_change < tolerance:
            break

    return {k: round(v, 3) for k, v in house_effects.items()}


def aggregate_at_date(
    polls: list[dict],
    target_date: date,
    house_effects: dict[str, float],
    metric: str,
    window_days: int = SMOOTHING_WINDOW_DAYS,
) -> Optional[dict]:
    """
    Compute the weighted aggregate for `metric` at `target_date`.

    Only polls within `window_days` either side of `target_date` are used
    (but future polls relative to target_date are excluded for temporal integrity).
    Only polls within `window_days` before `target_date` contribute.
    Returns dict with mean, std_error, 95% CI bounds, and poll count.
    """
    window_start = target_date - timedelta(days=window_days)
    relevant = [
        p for p in polls
        if p.get(metric) is not None
        and window_start <= date.fromisoformat(p["date"]) <= target_date
    ]
    if not relevant:
        return None

    values, weights = [], []
    for p in relevant:
        days_ago = (target_date - date.fromisoformat(p["date"])).days
        he = house_effects.get(p["pollster"], 0.0)
        adjusted = p[metric] - he
        values.append(adjusted)
        weights.append(_decay_weight(days_ago) * _sample_weight(p))

    mean = _weighted_mean(values, weights)
    variance = _weighted_variance(values, weights, mean)
    std = math.sqrt(variance) if variance >= 0 else 0.0

    # Effective sample size for standard error calculation
    total_w = sum(weights)
    sum_w2  = sum(w ** 2 for w in weights)
    n_eff   = (total_w ** 2 / sum_w2) if sum_w2 > 0 else 1.0

    std_err = std / math.sqrt(n_eff) if n_eff > 0 else std
    margin  = 1.96 * std_err

    return {
        "mean":   round(mean, 2),
        "lo95":   round(mean - margin, 2),
        "hi95":   round(mean + margin, 2),
        "std":    round(std, 2),
        "n":      len(relevant),
        "n_eff":  round(n_eff, 1),
    }


def build_trend(
    polls: list[dict],
    house_effects: dict[str, dict[str, float]],
    metrics: list[str],
    first_date: date,
    last_date: date,
    step_days: int = TREND_STEP_DAYS,
    window_days: int = SMOOTHING_WINDOW_DAYS,
) -> list[dict]:
    """
    Build a weekly trend series from `first_date` to `last_date`.
    Each point contains house-effect-corrected weighted aggregates and 95% CIs.
    """
    trend = []
    current = first_date
    while current <= last_date:
        point: dict = {"date": current.isoformat()}
        has_data = False
        for metric in metrics:
            he = house_effects.get(metric, {})
            result = aggregate_at_date(polls, current, he, metric, window_days)
            if result:
                point[metric] = result
                has_data = True
            else:
                point[metric] = None
        if has_data:
            trend.append(point)
        current += timedelta(days=step_days)
    return trend


def run(
    input_path: Path = INPUT_FILE,
    output_path: Path = OUTPUT_FILE,
    verbose: bool = False,
) -> dict:
    """
    Main aggregation pipeline.

    Steps:
      1. Load raw poll data.
      2. Impute missing TPP from primaries.
      3. Compute house effects for each primary metric and TPP.
      4. Build weekly trend series with 95% CIs.
      5. Compute current (most-recent-window) aggregate.
      6. Write output JSON.
    """
    if verbose:
        logging.basicConfig(level=logging.DEBUG)
    else:
        logging.basicConfig(level=logging.INFO)

    with open(input_path, encoding="utf-8") as f:
        raw = json.load(f)

    polls = raw["polls"]
    logger.info("Loaded %d polls from %s", len(polls), input_path)

    # Step 1: Impute TPP where missing
    n_imputed = 0
    for p in polls:
        if p.get("tpp") is None:
            imputed = _impute_tpp(p)
            if imputed is not None:
                p["tpp_imputed"] = imputed
                n_imputed += 1
        else:
            p["tpp_imputed"] = None  # use actual
    logger.info("Imputed TPP for %d polls (of %d missing)", n_imputed,
                sum(1 for p in polls if p.get("tpp") is None))

    # Augment polls: create a "tpp_eff" field = tpp if reported, else tpp_imputed
    for p in polls:
        p["tpp_eff"] = p.get("tpp") if p.get("tpp") is not None else p.get("tpp_imputed")

    # Step 2: Compute house effects for each metric
    poll_dates = [date.fromisoformat(p["date"]) for p in polls]
    ref_date   = max(poll_dates)
    metrics    = ["alp", "coal", "grn", "on", "tpp_eff"]

    logger.info("Computing house effects (ref date: %s) ...", ref_date)
    house_effects: dict[str, dict[str, float]] = {}
    for metric in metrics:
        he = compute_house_effects(polls, metric, ref_date)
        house_effects[metric] = he
        if he:
            logger.debug("House effects for %s: %s", metric, he)

    # Step 3: Build weekly trend
    first_date = min(poll_dates)
    logger.info("Building trend from %s to %s (step=%d days, window=%d days) ...",
                first_date, ref_date, TREND_STEP_DAYS, SMOOTHING_WINDOW_DAYS)
    trend = build_trend(polls, house_effects, metrics, first_date, ref_date)
    logger.info("Built %d trend points", len(trend))

    # Step 4: Compute current aggregate (last 60 days)
    current_window = 60
    current: dict = {}
    for metric in metrics:
        he = house_effects.get(metric, {})
        result = aggregate_at_date(polls, ref_date, he, metric, window_days=current_window)
        current[metric] = result
    logger.info("Current aggregate (last %d days): TPP=%.1f%% [%.1f-%.1f]",
                current_window,
                current.get("tpp_eff", {}).get("mean", float("nan")),
                current.get("tpp_eff", {}).get("lo95", float("nan")),
                current.get("tpp_eff", {}).get("hi95", float("nan")))

    # Step 5: Summarise house effects for output
    he_summary: dict[str, dict] = {}
    for metric, he in house_effects.items():
        he_summary[metric] = {
            k: v for k, v in sorted(he.items(), key=lambda x: -abs(x[1]))
        }

    # Step 6: Assemble and write output
    output = {
        "generated": ref_date.isoformat(),
        "source": raw.get("source"),
        "methodology": {
            "half_life_days":            HALF_LIFE_DAYS,
            "house_effect_max_iter":     HOUSE_EFFECT_ITERATIONS,
            "house_effect_tolerance":    HOUSE_EFFECT_TOLERANCE,
            "min_polls_for_he":          MIN_POLLS_FOR_HE,
            "smoothing_window_days":     SMOOTHING_WINDOW_DAYS,
            "trend_step_days":           TREND_STEP_DAYS,
            "median_sample_size":        MEDIAN_SAMPLE_SIZE,
            "tpp_pref_flows":            DEFAULT_PREF_FLOWS,
        },
        "house_effects": he_summary,
        "current": current,
        "trend": trend,
        "polls_with_imputed_tpp": [
            {k: v for k, v in p.items() if k != "tpp_imputed" or p["tpp_imputed"] is not None}
            for p in polls
        ],
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    logger.info("Wrote aggregated polls → %s", output_path)

    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Aggregate Australian election polls")
    parser.add_argument("--input",  default=str(INPUT_FILE),  help="Input polls JSON")
    parser.add_argument("--output", default=str(OUTPUT_FILE), help="Output aggregated JSON")
    parser.add_argument("--plot",   action="store_true",      help="Print ASCII trend summary")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    result = run(Path(args.input), Path(args.output), verbose=args.verbose)

    if args.plot:
        print("\n=== Current Aggregate (house-effect corrected, last 60 days) ===")
        current = result["current"]
        for m in ["alp", "coal", "grn", "on", "tpp_eff"]:
            c = current.get(m)
            if c:
                label = m.upper().replace("_EFF", " TPP")
                print(f"  {label:12s}: {c['mean']:5.1f}%  "
                      f"[{c['lo95']:.1f}–{c['hi95']:.1f}]  "
                      f"n={c['n']} (n_eff={c['n_eff']:.1f})")

        print("\n=== Significant House Effects (TPP) ===")
        he_tpp = result["house_effects"].get("tpp_eff", {})
        for pollster, bias in list(he_tpp.items())[:8]:
            direction = "HIGH" if bias > 0 else "LOW"
            print(f"  {pollster:30s}: {bias:+.2f}pp ({direction})")
