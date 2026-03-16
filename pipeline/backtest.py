"""
Backtesting framework for the uniform national swing model.

Evaluates how accurately the swing model would have predicted past elections
if run with the swing derived from polling averages at the time.

Currently implemented backtests:
  • 2019 federal election — using 2016 results as baseline, applying the
    observed 2019 national primary swing to each seat.
  • 2022 federal election — using 2019 results as baseline.

Metrics reported per backtest:
  • Seat-level ALP 2PP MAE (mean absolute error) and RMSE
  • % of seats with correct winner (ALP/Coalition)
  • Net seats won by each party (actual vs. predicted)
  • Marginal-seat accuracy (seats within 5% of 50/50)
  • Elasticity analysis: actual seat-level swing vs. national swing

Usage:
    python -m pipeline.backtest
    python -m pipeline.backtest --election 2019 --verbose
    python -m pipeline.backtest --report   # write report to data/backtest/
"""

from __future__ import annotations

import argparse
import json
import logging
import math
from pathlib import Path
from typing import NamedTuple, Optional

logger = logging.getLogger(__name__)

DATA_EXPORTS_DIR = Path(__file__).parent.parent / "data" / "exports"
BACKTEST_DIR     = Path(__file__).parent.parent / "data" / "backtest"

COALITION_PARTIES = {"LP", "LNP", "NP", "CLP"}

# ── Standard preference flows (for primary-based backtest) ─────────────────────
DEFAULT_PREF_FLOWS = {
    "grn_alp":   0.810,
    "teal_alp":  0.620,
    "on_alp":    0.430,
    "other_alp": 0.500,
}


# ── Data structures ────────────────────────────────────────────────────────────

class SeatResult(NamedTuple):
    division_id:  int
    name:         str
    state:        str
    winner_party: str
    alp_2pp:      Optional[float]   # ALP 2PP %, None if non-ALP/Coal seat
    alp_fp:       Optional[float]
    coal_fp:      Optional[float]
    grn_fp:       Optional[float]
    enrolment:    Optional[int]


class BacktestResult(NamedTuple):
    election_year:      int
    baseline_year:      int
    n_seats:            int
    n_alp_coal_seats:   int
    # Accuracy
    mae_2pp:            float
    rmse_2pp:           float
    pct_correct_winner: float
    # Seat counts
    actual_alp_seats:   int
    actual_coal_seats:  int
    pred_alp_seats:     int
    pred_coal_seats:    int
    # Marginal seats (≤5pp margin)
    n_marginal:         int
    n_marginal_correct: int
    pct_marginal_correct: float
    # Swing elasticity
    national_swing:     float        # observed national 2PP swing ALP
    mean_seat_swing:    float        # mean actual seat-level swing
    elasticity:         float        # mean_seat_swing / national_swing
    seat_details:       list[dict]   # per-seat breakdown


# ── Data loading ───────────────────────────────────────────────────────────────

def _load_divisions(year: int) -> list[dict]:
    """Load divisions.json for a given election year."""
    path = DATA_EXPORTS_DIR / str(year) / "divisions.json"
    if not path.exists():
        raise FileNotFoundError(
            f"No divisions data for {year} at {path}. "
            f"Run: python main.py --year {year}"
        )
    with open(path) as f:
        return json.load(f)


def _extract_seat_results(divisions: list[dict]) -> list[SeatResult]:
    """
    Extract the key fields needed for backtesting from the divisions export.
    Skips seats where TCP data is absent (e.g. multi-member Hare-Clark).
    """
    results = []
    for div in divisions:
        tcp = div.get("tcp", [])
        if not tcp or len(tcp) < 2:
            continue

        parties = {t["party_ab"] for t in tcp}
        has_alp  = "ALP" in parties
        has_coal = bool(parties & COALITION_PARTIES)

        alp_2pp = None
        if has_alp and has_coal:
            alp_entry = next((t for t in tcp if t["party_ab"] == "ALP"), None)
            alp_2pp   = alp_entry["pct"] if alp_entry else None

        winner = div.get("winner", {})
        fp_data = div.get("first_preferences", {})

        results.append(SeatResult(
            division_id  = div["division_id"],
            name         = div["name"],
            state        = div["state"],
            winner_party = winner.get("party_ab", ""),
            alp_2pp      = alp_2pp,
            alp_fp       = fp_data.get("alp_pct"),
            coal_fp      = fp_data.get("coal_pct"),
            grn_fp       = fp_data.get("grn_pct"),
            enrolment    = div.get("enrolment"),
        ))
    return results


def _national_primary(seats: list[SeatResult]) -> dict[str, float]:
    """
    Compute simple unweighted national average primary vote from seat-level data.
    (A proper calculation would weight by enrolment; this is an approximation.)
    """
    alp_vals  = [s.alp_fp  for s in seats if s.alp_fp  is not None]
    coal_vals = [s.coal_fp for s in seats if s.coal_fp is not None]
    grn_vals  = [s.grn_fp  for s in seats if s.grn_fp  is not None]
    alp_2pp_vals = [s.alp_2pp for s in seats if s.alp_2pp is not None]
    return {
        "alp":      sum(alp_vals)  / len(alp_vals)  if alp_vals  else 0,
        "coal":     sum(coal_vals) / len(coal_vals) if coal_vals else 0,
        "grn":      sum(grn_vals)  / len(grn_vals)  if grn_vals  else 0,
        "alp_2pp":  sum(alp_2pp_vals) / len(alp_2pp_vals) if alp_2pp_vals else 0,
    }


# ── Swing model ────────────────────────────────────────────────────────────────

def apply_uniform_swing(
    baseline: SeatResult,
    nat_2pp_swing: float,
) -> dict:
    """
    Apply uniform national 2PP swing to a single seat.
    Returns a dict with: pred_alp_2pp, pred_winner_party, changed.
    """
    if baseline.alp_2pp is None:
        # Non ALP/Coal seat — hold winner, no 2PP calculation
        return {
            "pred_alp_2pp":      None,
            "pred_winner_party": baseline.winner_party,
            "changed":           False,
        }

    pred = max(0.0, min(100.0, baseline.alp_2pp + nat_2pp_swing))
    winner = "ALP" if pred >= 50.0 else next(
        (p for p in COALITION_PARTIES if p != "NP"), "LP"
    )
    return {
        "pred_alp_2pp":      round(pred, 2),
        "pred_winner_party": winner,
        "changed":           (pred >= 50) != (baseline.alp_2pp >= 50),
    }


def apply_swing_with_elasticity(
    baseline: SeatResult,
    nat_2pp_swing: float,
    elasticity_curve: bool = True,
) -> dict:
    """
    Apply uniform swing with seat-level elasticity adjustment.

    Empirical finding (Mackerras/Antony Green): marginal seats typically
    swing more than safe seats. We model this with a simple elasticity
    multiplier based on the seat's marginality:

        multiplier = 1.0 + k * (50 - |alp_2pp - 50|) / 50

    where k=0.4 means the most marginal seats swing ~40% more than average.
    Safe seats (>15pp) swing ~20% less than average.

    This is a first-order correction; full seat-level modelling would use
    historical seat-by-seat swing regressions.
    """
    if not elasticity_curve or baseline.alp_2pp is None:
        return apply_uniform_swing(baseline, nat_2pp_swing)

    marginality = abs(baseline.alp_2pp - 50)   # 0 = knife-edge, 50 = very safe
    # Logistic curve: ranges from 0.80 (safe) to 1.30 (knife-edge)
    # Midpoint at ~8pp margin, steepness 0.20
    multiplier = 0.80 + 0.50 / (1 + math.exp(0.20 * (marginality - 8)))

    adjusted_swing = nat_2pp_swing * multiplier
    pred = max(0.0, min(100.0, baseline.alp_2pp + adjusted_swing))
    winner = "ALP" if pred >= 50.0 else "LP"
    return {
        "pred_alp_2pp":      round(pred, 2),
        "pred_winner_party": winner,
        "changed":           (pred >= 50) != (baseline.alp_2pp >= 50),
        "elasticity_mult":   multiplier,
    }


def apply_primary_swing(
    baseline: SeatResult,
    primary_swings: dict[str, float],
    flows: dict[str, float] = DEFAULT_PREF_FLOWS,
) -> dict:
    """
    Apply uniform primary swings to a seat, then convert to 2PP using preference flows.
    """
    if baseline.alp_2pp is None or baseline.alp_fp is None or baseline.coal_fp is None or baseline.grn_fp is None:
        return apply_uniform_swing(baseline, primary_swings.get("alp_2pp", 0.0))

    proj_fp = {
        "alp": max(0.0, baseline.alp_fp + primary_swings.get("alp", 0.0)),
        "coal": max(0.0, baseline.coal_fp + primary_swings.get("coal", 0.0)),
        "grn": max(0.0, baseline.grn_fp + primary_swings.get("grn", 0.0)),
    }
    # Assume teal and ON are negligible or rolled into 'other' if not in baseline
    proj_fp["other"] = max(0.0, 100.0 - proj_fp["alp"] - proj_fp["coal"] - proj_fp["grn"])

    alp_tcp = (
        proj_fp["alp"]
        + proj_fp["grn"] * flows["grn_alp"]
        + proj_fp["other"] * flows["other_alp"]
    )
    coal_tcp = (
        proj_fp["coal"]
        + proj_fp["grn"] * (1 - flows["grn_alp"])
        + proj_fp["other"] * (1 - flows["other_alp"])
    )
    total = alp_tcp + coal_tcp
    pred = round(alp_tcp / total * 100.0, 2) if total > 0 else 50.0
    
    winner = "ALP" if pred >= 50.0 else "LP"
    return {
        "pred_alp_2pp":      pred,
        "pred_winner_party": winner,
        "changed":           (pred >= 50) != (baseline.alp_2pp >= 50),
        "elasticity_mult":   1.0,
    }


# ── Monte Carlo seat-count uncertainty ────────────────────────────────────────

def monte_carlo_seat_counts(
    baseline_seats: list[SeatResult],
    nat_2pp_swing: float,
    swing_std: float = 1.5,
    n_simulations: int = 5000,
    elasticity_curve: bool = True,
) -> dict:
    """
    Monte Carlo simulation of seat-count uncertainty.

    Draws `n_simulations` samples of the national 2PP swing from
    N(nat_2pp_swing, swing_std²), applies the swing model to all seats,
    and returns the distribution of ALP seat counts.

    `swing_std` defaults to 1.5pp, reflecting typical polling error
    at Australian federal elections (MAE ≈ 1–2pp nationally).

    Returns:
        alp_seats_mean, alp_seats_std,
        p_alp_majority (prob of ALP winning ≥76 seats),
        percentiles (5th, 25th, 50th, 75th, 95th),
        seat_win_probs: per-seat probability of ALP win.
    """
    import random

    n_alp_coal = sum(1 for s in baseline_seats if s.alp_2pp is not None)
    n_non_alp_coal = len(baseline_seats) - n_alp_coal

    # Per-seat ALP win probability (from simulations)
    seat_alp_wins = {s.division_id: 0 for s in baseline_seats}
    alp_seat_counts = []

    for _ in range(n_simulations):
        sim_swing = random.gauss(nat_2pp_swing, swing_std)
        alp_count = 0
        for seat in baseline_seats:
            if seat.alp_2pp is None:
                # Non ALP/Coal: hold 2022 winner (simplification)
                if seat.winner_party == "ALP":
                    alp_count += 1
                    seat_alp_wins[seat.division_id] += 1
            else:
                result = apply_swing_with_elasticity(seat, sim_swing, elasticity_curve)
                if result["pred_winner_party"] == "ALP":
                    alp_count += 1
                    seat_alp_wins[seat.division_id] += 1
        alp_seat_counts.append(alp_count)

    alp_seat_counts.sort()
    n = len(alp_seat_counts)
    mean_seats = sum(alp_seat_counts) / n
    std_seats  = math.sqrt(sum((x - mean_seats) ** 2 for x in alp_seat_counts) / n)
    p_majority = sum(1 for x in alp_seat_counts if x >= 76) / n

    percentiles = {
        "p5":  alp_seat_counts[int(0.05 * n)],
        "p25": alp_seat_counts[int(0.25 * n)],
        "p50": alp_seat_counts[int(0.50 * n)],
        "p75": alp_seat_counts[int(0.75 * n)],
        "p95": alp_seat_counts[int(0.95 * n)],
    }

    seat_win_probs = {
        div_id: round(wins / n_simulations, 3)
        for div_id, wins in seat_alp_wins.items()
    }

    return {
        "n_simulations":    n_simulations,
        "swing_std":        swing_std,
        "alp_mean_seats":   round(mean_seats, 1),
        "alp_std_seats":    round(std_seats, 1),
        "p_alp_majority":   round(p_majority, 3),
        "percentiles":      percentiles,
        "seat_win_probs":   seat_win_probs,
    }


# ── Backtesting runner ─────────────────────────────────────────────────────────

def run_backtest(
    baseline_year: int,
    election_year: int,
    elasticity_curve: bool = True,
    primary_based: bool = False,
    verbose: bool = False,
) -> BacktestResult:
    """
    Backtest the swing model: use `baseline_year` results as the starting point
    and predict `election_year` results using the observed swing.

    Compares predicted vs. actual seat outcomes.
    """
    logger.info("Loading data for baseline=%d, election=%d", baseline_year, election_year)
    baseline_divs  = _load_divisions(baseline_year)
    election_divs  = _load_divisions(election_year)

    baseline_seats  = _extract_seat_results(baseline_divs)
    election_seats  = _extract_seat_results(election_divs)

    # Build lookup by division_id
    baseline_by_id = {s.division_id: s for s in baseline_seats}
    election_by_id = {s.division_id: s for s in election_seats}

    # Compute national 2PP swings
    baseline_nat = _national_primary(baseline_seats)
    election_nat = _national_primary(election_seats)
    nat_2pp_swing = election_nat["alp_2pp"] - baseline_nat["alp_2pp"]
    primary_swings = {
        "alp": election_nat["alp"] - baseline_nat["alp"],
        "coal": election_nat["coal"] - baseline_nat["coal"],
        "grn": election_nat["grn"] - baseline_nat["grn"],
        "alp_2pp": nat_2pp_swing,
    }
    logger.info("National ALP 2PP: %s=%.2f%% → %s=%.2f%% (swing=%.2fpp)",
                baseline_year, baseline_nat["alp_2pp"],
                election_year, election_nat["alp_2pp"],
                nat_2pp_swing)

    # Match seats (only seats present in both elections with ALP/Coal TCP)
    common_ids = set(baseline_by_id) & set(election_by_id)
    paired = [
        (baseline_by_id[did], election_by_id[did])
        for did in sorted(common_ids)
        if baseline_by_id[did].alp_2pp is not None
        and election_by_id[did].alp_2pp is not None
    ]
    logger.info("%d seats matched with ALP/Coal 2PP in both elections", len(paired))

    # Apply model and collect per-seat stats
    errors, seat_details = [], []
    correct_winners, marginal_correct, n_marginal = 0, 0, 0
    actual_alp, actual_coal, pred_alp, pred_coal = 0, 0, 0, 0
    seat_swings = []

    for base, actual in paired:
        if primary_based:
            pred = apply_primary_swing(base, primary_swings)
        else:
            pred = apply_swing_with_elasticity(base, nat_2pp_swing, elasticity_curve)

        err = pred["pred_alp_2pp"] - actual.alp_2pp
        errors.append(err)

        actual_swing = actual.alp_2pp - base.alp_2pp
        seat_swings.append(actual_swing)

        is_correct = (pred["pred_alp_2pp"] >= 50) == (actual.alp_2pp >= 50)
        if is_correct:
            correct_winners += 1

        is_marginal = abs(actual.alp_2pp - 50) <= 5
        if is_marginal:
            n_marginal += 1
            if is_correct:
                marginal_correct += 1

        actual_winner_alp = actual.winner_party == "ALP"
        if actual_winner_alp:
            actual_alp += 1
        else:
            actual_coal += 1
        if pred["pred_alp_2pp"] >= 50:
            pred_alp += 1
        else:
            pred_coal += 1

        detail = {
            "division_id":    base.division_id,
            "name":           base.name,
            "state":          base.state,
            "base_alp_2pp":   base.alp_2pp,
            "actual_alp_2pp": actual.alp_2pp,
            "pred_alp_2pp":   pred["pred_alp_2pp"],
            "actual_swing":   round(actual_swing, 2),
            "national_swing": round(nat_2pp_swing, 2),
            "error":          round(err, 2),
            "correct":        is_correct,
            "marginal":       is_marginal,
            "elasticity_mult": pred.get("elasticity_mult"),
        }
        seat_details.append(detail)

        if verbose and not is_correct:
            logger.debug(
                "WRONG  %-25s  base=%.1f  pred=%.1f  actual=%.1f  err=%+.1f",
                base.name, base.alp_2pp, pred["pred_alp_2pp"], actual.alp_2pp, err,
            )

    n = len(errors)
    mae  = sum(abs(e) for e in errors) / n if n else float("nan")
    rmse = math.sqrt(sum(e**2 for e in errors) / n) if n else float("nan")
    pct_correct = correct_winners / n * 100 if n else float("nan")
    pct_marginal_correct = marginal_correct / n_marginal * 100 if n_marginal else float("nan")
    mean_seat_swing = sum(seat_swings) / len(seat_swings) if seat_swings else float("nan")
    elasticity = mean_seat_swing / nat_2pp_swing if nat_2pp_swing else float("nan")

    return BacktestResult(
        election_year       = election_year,
        baseline_year       = baseline_year,
        n_seats             = n,
        n_alp_coal_seats    = n,
        mae_2pp             = round(mae, 3),
        rmse_2pp            = round(rmse, 3),
        pct_correct_winner  = round(pct_correct, 1),
        actual_alp_seats    = actual_alp,
        actual_coal_seats   = actual_coal,
        pred_alp_seats      = pred_alp,
        pred_coal_seats     = pred_coal,
        n_marginal          = n_marginal,
        n_marginal_correct  = marginal_correct,
        pct_marginal_correct= round(pct_marginal_correct, 1),
        national_swing      = round(nat_2pp_swing, 3),
        mean_seat_swing     = round(mean_seat_swing, 3),
        elasticity          = round(elasticity, 3),
        seat_details        = sorted(seat_details, key=lambda d: abs(d["error"]), reverse=True),
    )


def print_report(bt: BacktestResult) -> None:
    """Print a human-readable backtest summary."""
    line = "=" * 60
    print(f"\n{line}")
    print(f"  BACKTEST: {bt.baseline_year} → {bt.election_year}")
    print(f"  National ALP 2PP swing: {bt.national_swing:+.2f}pp")
    print(line)
    print(f"  Seats compared (ALP/Coal TCP):  {bt.n_seats}")
    print(f"  MAE (seat-level 2PP):           {bt.mae_2pp:.2f}pp")
    print(f"  RMSE (seat-level 2PP):          {bt.rmse_2pp:.2f}pp")
    print(f"  Correct winner (%):             {bt.pct_correct_winner:.1f}%")
    print()
    print(f"  Actual  ALP {bt.actual_alp_seats:3d}  Coal {bt.actual_coal_seats:3d}")
    print(f"  Pred    ALP {bt.pred_alp_seats:3d}  Coal {bt.pred_coal_seats:3d}")
    print()
    print(f"  Marginal seats (≤5pp):          {bt.n_marginal}")
    print(f"  Marginal correct (%):           {bt.pct_marginal_correct:.1f}%")
    print()
    print(f"  Swing elasticity:")
    print(f"    National swing:               {bt.national_swing:+.2f}pp")
    print(f"    Mean seat-level swing:        {bt.mean_seat_swing:+.2f}pp")
    print(f"    Elasticity (seat/national):   {bt.elasticity:.2f}x")
    print()
    print("  Top 10 most-wrong seats:")
    for d in bt.seat_details[:10]:
        flag = "✓" if d["correct"] else "✗"
        print(f"  {flag} {d['name']:<25s} {d['state']:4s}  "
              f"base={d['base_alp_2pp']:4.1f}  "
              f"pred={d['pred_alp_2pp']:4.1f}  "
              f"actual={d['actual_alp_2pp']:4.1f}  "
              f"err={d['error']:+.1f}pp")
    print(line)


# ── Entry point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Backtest the uniform swing election model")
    parser.add_argument(
        "--election", type=int, choices=[2019, 2022], default=None,
        help="Run one specific backtest (default: run all available)",
    )
    parser.add_argument(
        "--no-elasticity", action="store_true",
        help="Disable seat elasticity correction (use pure uniform swing)",
    )
    parser.add_argument(
        "--primary-based", action="store_true",
        help="Use primary-based swing model instead of uniform 2PP swing",
    )
    parser.add_argument(
        "--report", action="store_true",
        help="Write JSON report to data/backtest/",
    )
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO)
    elasticity = not args.no_elasticity

    backtests = [(2016, 2019), (2019, 2022)] if args.election is None else {
        2019: [(2016, 2019)],
        2022: [(2019, 2022)],
    }[args.election]

    for baseline_yr, election_yr in backtests:
        try:
            bt = run_backtest(baseline_yr, election_yr, elasticity_curve=elasticity,
                              primary_based=args.primary_based,
                              verbose=args.verbose)
            print_report(bt)

            if args.report:
                BACKTEST_DIR.mkdir(parents=True, exist_ok=True)
                report = {
                    "election_year":         bt.election_year,
                    "baseline_year":         bt.baseline_year,
                    "n_seats":               bt.n_seats,
                    "mae_2pp":               bt.mae_2pp,
                    "rmse_2pp":              bt.rmse_2pp,
                    "pct_correct_winner":    bt.pct_correct_winner,
                    "actual_alp_seats":      bt.actual_alp_seats,
                    "pred_alp_seats":        bt.pred_alp_seats,
                    "n_marginal":            bt.n_marginal,
                    "pct_marginal_correct":  bt.pct_marginal_correct,
                    "national_swing":        bt.national_swing,
                    "elasticity":            bt.elasticity,
                    "seat_details":          bt.seat_details,
                }
                out = BACKTEST_DIR / f"backtest_{baseline_yr}_{election_yr}.json"
                with open(out, "w") as f:
                    json.dump(report, f, indent=2)
                logger.info("Wrote report → %s", out)

        except FileNotFoundError as e:
            logger.warning("Skipping backtest %d→%d: %s", baseline_yr, election_yr, e)
