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
GREENS_PARTIES    = {"GRN", "GVIC"}
ON_PARTIES        = {"ON", "PHON"}

# ── Standard preference flows (for primary-based backtest) ─────────────────────
DEFAULT_PREF_FLOWS = {
    "grn_alp":   0.810,
    "teal_alp":  0.620,
    "on_alp":    0.255,   # 2025 AEC DOP (25.5% to ALP) — keep in sync with poll_aggregator
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
    on_fp:        Optional[float]
    oth_fp:       Optional[float]   # everything else (IND, UAP, micro parties)
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


def _group_fp_shares(party_votes: dict[str, float]) -> Optional[dict[str, float]]:
    """
    Collapse {party_ab: votes} into grouped FP percentage shares:
    {"alp", "coal", "grn", "on", "oth"} summing to ~100.
    Returns None if there are no votes.
    """
    total = sum(party_votes.values())
    if total <= 0:
        return None
    grouped = {"alp": 0.0, "coal": 0.0, "grn": 0.0, "on": 0.0, "oth": 0.0}
    for party, votes in party_votes.items():
        if party == "ALP":
            grouped["alp"] += votes
        elif party in COALITION_PARTIES:
            grouped["coal"] += votes
        elif party in GREENS_PARTIES:
            grouped["grn"] += votes
        elif party in ON_PARTIES:
            grouped["on"] += votes
        else:
            grouped["oth"] += votes
    return {k: v / total * 100.0 for k, v in grouped.items()}


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

        winner = div.get("winner") or {}
        # divisions.json carries first_prefs as a list of {party_ab, votes, pct}
        fp_list = div.get("first_prefs") or []
        fp_shares = _group_fp_shares({r["party_ab"]: r["votes"] for r in fp_list})

        results.append(SeatResult(
            division_id  = div["division_id"],
            name         = div["division_name"],
            state        = div["state_ab"],
            winner_party = winner.get("party_ab", ""),
            alp_2pp      = alp_2pp,
            alp_fp       = fp_shares["alp"] if fp_shares else None,
            coal_fp      = fp_shares["coal"] if fp_shares else None,
            grn_fp       = fp_shares["grn"] if fp_shares else None,
            on_fp        = fp_shares["on"] if fp_shares else None,
            oth_fp       = fp_shares["oth"] if fp_shares else None,
            enrolment    = div.get("enrolment"),
        ))
    return results


def _load_fp_from_db(year: int, db_path: str = None) -> dict[int, dict[str, float]]:
    """
    Load per-division grouped first-preference shares from the SQLite database.

    Uses the count-1 'Preference Count' rows of the distribution of preferences
    (which equal each candidate's first-preference total) so that all elections
    are covered even where booth-level first_preferences rows were not loaded.

    Returns {division_id: {"alp","coal","grn","on","oth"} pct shares}.
    """
    from pipeline.database import get_connection

    conn = get_connection(db_path)
    try:
        rows = conn.execute(
            """
            SELECT d.division_id, c.party_ab, SUM(d.calculation_value) AS votes
            FROM distribution_of_preferences d
            JOIN candidates c ON c.candidate_id = d.candidate_id
                              AND c.election_id = d.election_id
            WHERE d.election_id = ?
              AND d.calculation_type = 'Preference Count'
              AND d.count_number = 1
            GROUP BY d.division_id, c.party_ab
            """,
            (year,),
        ).fetchall()
    finally:
        conn.close()

    by_div: dict[int, dict[str, float]] = {}
    for r in rows:
        by_div.setdefault(r["division_id"], {})[r["party_ab"]] = r["votes"] or 0.0

    out = {}
    for div_id, party_votes in by_div.items():
        shares = _group_fp_shares(party_votes)
        if shares:
            out[div_id] = shares
    return out


def _national_fp_from_db(year: int, db_path: str = None) -> dict[str, float]:
    """Vote-weighted national grouped FP shares from the DB (DOP count 1)."""
    from pipeline.database import get_connection

    conn = get_connection(db_path)
    try:
        rows = conn.execute(
            """
            SELECT c.party_ab, SUM(d.calculation_value) AS votes
            FROM distribution_of_preferences d
            JOIN candidates c ON c.candidate_id = d.candidate_id
                              AND c.election_id = d.election_id
            WHERE d.election_id = ?
              AND d.calculation_type = 'Preference Count'
              AND d.count_number = 1
            GROUP BY c.party_ab
            """,
            (year,),
        ).fetchall()
    finally:
        conn.close()

    shares = _group_fp_shares({r["party_ab"]: r["votes"] or 0.0 for r in rows})
    if not shares:
        raise ValueError(f"No DOP first-preference data in DB for election {year}")
    return shares


def _load_division_flows(year: int) -> tuple[dict[int, dict], dict[str, float]]:
    """
    Load per-division ALP preference-flow shares from
    data/exports/{year}/preference_flows.json.

    Returns (by_division, national_avg) where by_division maps
    division_id -> {party_ab: alp_share} and national_avg maps each party_ab
    seen in the file to its simple mean alp_share across divisions (used as
    the fallback for divisions without their own DOP-derived flows).
    """
    path = DATA_EXPORTS_DIR / str(year) / "preference_flows.json"
    if not path.exists():
        logger.warning("No preference_flows.json for %d; using default flows", year)
        return {}, {}
    with open(path) as f:
        data = json.load(f)

    by_division = {
        int(div_id): {party: entry["alp_share"] for party, entry in flows.items()}
        for div_id, flows in data.get("by_division", {}).items()
    }

    sums: dict[str, list[float]] = {}
    for flows in by_division.values():
        for party, share in flows.items():
            sums.setdefault(party, []).append(share)
    national_avg = {p: sum(v) / len(v) for p, v in sums.items()}
    return by_division, national_avg


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
    winner = "ALP" if pred >= 50.0 else "LP"
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

    Marginal seats historically swing more than safe seats. The multiplier is
    a logistic in seat margin:

        mult(m) = L + (H - L) / (1 + exp(k * (m - m0)))

    where m = |alp_2pp - 50|. Parameters below are hand-tuned against
    2016→2019 and 2019→2022 swings; re-fit against the latest cycle via
    `python scripts/fit_elasticity.py` and paste the fitted values here and
    in webapp/src/App.jsx:seatElasticityMult.
    """
    if not elasticity_curve or baseline.alp_2pp is None:
        return apply_uniform_swing(baseline, nat_2pp_swing)

    marginality = abs(baseline.alp_2pp - 50)
    # fitted via scripts/fit_elasticity.py on 2022→2025 (k capped at 0.35;
    # shape weakly identified, MAE flat in k)
    multiplier = 0.593 + 0.856 / (1 + math.exp(0.350 * (marginality - 8.725)))

    adjusted_swing = nat_2pp_swing * multiplier
    pred = max(0.0, min(100.0, baseline.alp_2pp + adjusted_swing))
    winner = "ALP" if pred >= 50.0 else "LP"
    return {
        "pred_alp_2pp":      round(pred, 2),
        "pred_winner_party": winner,
        "changed":           (pred >= 50) != (baseline.alp_2pp >= 50),
        "elasticity_mult":   multiplier,
    }


def _flow_for(div_flows: dict[str, float], nat_flows: dict[str, float],
              keys: tuple[str, ...], default: float) -> float:
    """
    Resolve an ALP preference-flow share for a party group.

    Tries each party key against the division's own DOP-derived flows first,
    then the national-average flows, then falls back to `default`.
    """
    for k in keys:
        if k in div_flows:
            return div_flows[k]
    for k in keys:
        if k in nat_flows:
            return nat_flows[k]
    return default


def apply_primary_swing(
    baseline: SeatResult,
    baseline_fp: Optional[dict[str, float]],
    primary_swings: dict[str, float],
    div_flows: dict[str, float] | None = None,
    nat_flows: dict[str, float] | None = None,
) -> dict:
    """
    Primary-vote-based seat projection (mirrors the live App.jsx methodology).

    Takes the seat's grouped baseline FP shares ({"alp","coal","grn","on","oth"}),
    applies the national grouped primary swings, then converts the projected
    primaries to an ALP 2PP using the seat's own DOP-derived preference flows
    (data/exports/{baseline_year}/preference_flows.json) with national-average
    and DEFAULT_PREF_FLOWS fallbacks.
    """
    if baseline.alp_2pp is None or not baseline_fp:
        return apply_uniform_swing(baseline, primary_swings.get("alp_2pp", 0.0))

    div_flows = div_flows or {}
    nat_flows = nat_flows or {}

    proj = {
        grp: max(0.0, baseline_fp[grp] + primary_swings.get(grp, 0.0))
        for grp in ("alp", "coal", "grn", "on", "oth")
    }

    f_grn = _flow_for(div_flows, nat_flows, ("GRN", "GVIC"), DEFAULT_PREF_FLOWS["grn_alp"])
    f_on  = _flow_for(div_flows, nat_flows, ("ON", "PHON"), DEFAULT_PREF_FLOWS["on_alp"])
    f_oth = _flow_for(div_flows, nat_flows, ("OTHER", "IND"), DEFAULT_PREF_FLOWS["other_alp"])

    alp_tcp = (
        proj["alp"]
        + proj["grn"] * f_grn
        + proj["on"]  * f_on
        + proj["oth"] * f_oth
    )
    coal_tcp = (
        proj["coal"]
        + proj["grn"] * (1 - f_grn)
        + proj["on"]  * (1 - f_on)
        + proj["oth"] * (1 - f_oth)
    )
    total = alp_tcp + coal_tcp
    pred = round(alp_tcp / total * 100.0, 2) if total > 0 else 50.0

    winner = "ALP" if pred >= 50.0 else "LP"
    return {
        "pred_alp_2pp":      pred,
        "pred_winner_party": winner,
        "changed":           (pred >= 50) != (baseline.alp_2pp >= 50),
        "elasticity_mult":   1.0,
        "flows":             {"grn": f_grn, "on": f_on, "oth": f_oth},
    }


# ── Monte Carlo seat-count uncertainty ────────────────────────────────────────

def monte_carlo_seat_counts(
    baseline_seats: list[SeatResult],
    nat_2pp_swing: float,
    swing_std: float = 1.5,
    n_simulations: int = 5000,
    elasticity_curve: bool = True,
    state_swing_std: float = 0.3,
) -> dict:
    """
    Monte Carlo simulation of seat-count uncertainty.

    Draws `n_simulations` samples of the national 2PP swing from
    N(nat_2pp_swing, swing_std²), applies the swing model to all seats,
    and returns the distribution of ALP seat counts.

    `swing_std` defaults to 1.5pp, reflecting typical polling error
    at Australian federal elections (MAE ≈ 1–2pp nationally).

    `state_swing_std` adds a correlated per-state shock each simulation so
    seats in the same state move together (QLD all swings LNP, or all ALP,
    in the same draw). 0.3pp is a conservative default — large enough to
    widen the seat-count distribution noticeably without overwhelming the
    national swing. Set to 0 to reproduce the original independent-seats
    behaviour.

    Returns:
        alp_seats_mean, alp_seats_std,
        p_alp_majority (prob of ALP winning ≥76 seats),
        percentiles (5th, 25th, 50th, 75th, 95th),
        seat_win_probs: per-seat probability of ALP win.
    """
    import random

    # Per-seat ALP win probability (from simulations)
    seat_alp_wins = {s.division_id: 0 for s in baseline_seats}
    alp_seat_counts = []

    states = sorted({s.state for s in baseline_seats if s.state})

    for _ in range(n_simulations):
        sim_swing = random.gauss(nat_2pp_swing, swing_std)
        # One correlated state shock per state per simulation. Drawing here
        # (not per seat) is what produces within-state correlation.
        state_shocks = (
            {st: random.gauss(0.0, state_swing_std) for st in states}
            if state_swing_std > 0 else {}
        )
        alp_count = 0
        for seat in baseline_seats:
            if seat.alp_2pp is None:
                # Non ALP/Coal: hold 2022 winner (simplification)
                if seat.winner_party == "ALP":
                    alp_count += 1
                    seat_alp_wins[seat.division_id] += 1
            else:
                seat_swing = sim_swing + state_shocks.get(seat.state, 0.0)
                result = apply_swing_with_elasticity(seat, seat_swing, elasticity_curve)
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
        "state_swing_std":  state_swing_std,
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
    logger.info("National ALP 2PP: %s=%.2f%% → %s=%.2f%% (swing=%.2fpp)",
                baseline_year, baseline_nat["alp_2pp"],
                election_year, election_nat["alp_2pp"],
                nat_2pp_swing)

    # Primary-based model inputs: per-seat FP baselines + actual national
    # grouped primary swings (vote-weighted, from the DB) + per-division
    # DOP preference flows from the baseline election's exports.
    fp_by_div: dict[int, dict[str, float]] = {}
    flows_by_div: dict[int, dict] = {}
    nat_flows: dict[str, float] = {}
    primary_swings = {"alp_2pp": nat_2pp_swing}
    if primary_based:
        fp_by_div = _load_fp_from_db(baseline_year)
        base_nat_fp = _national_fp_from_db(baseline_year)
        elec_nat_fp = _national_fp_from_db(election_year)
        primary_swings.update({
            grp: elec_nat_fp[grp] - base_nat_fp[grp]
            for grp in ("alp", "coal", "grn", "on", "oth")
        })
        flows_by_div, nat_flows = _load_division_flows(baseline_year)
        logger.info(
            "National primary swings: ALP %+.2f  COAL %+.2f  GRN %+.2f  ON %+.2f  OTH %+.2f",
            primary_swings["alp"], primary_swings["coal"], primary_swings["grn"],
            primary_swings["on"], primary_swings["oth"],
        )

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
            pred = apply_primary_swing(
                base,
                fp_by_div.get(base.division_id),
                primary_swings,
                flows_by_div.get(base.division_id),
                nat_flows,
            )
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


def _stats_for(details: list[dict]) -> dict:
    """MAE / RMSE / winner accuracy over a list of seat-detail dicts."""
    n = len(details)
    if not n:
        return {"n": 0, "mae": float("nan"), "rmse": float("nan"), "acc": float("nan")}
    errs = [d["error"] for d in details]
    return {
        "n":    n,
        "mae":  sum(abs(e) for e in errs) / n,
        "rmse": math.sqrt(sum(e ** 2 for e in errs) / n),
        "acc":  sum(1 for d in details if d["correct"]) / n * 100,
    }


def state_breakdown(bt: BacktestResult) -> dict[str, dict]:
    """Per-state MAE/RMSE/winner accuracy from a backtest's seat details."""
    by_state: dict[str, list[dict]] = {}
    for d in bt.seat_details:
        by_state.setdefault(d["state"], []).append(d)
    return {st: _stats_for(details) for st, details in sorted(by_state.items())}


def print_comparison(pairs: list[tuple[int, int]], verbose: bool = False) -> None:
    """
    Run the primary-based and UNS(+elasticity) models side-by-side over the
    given (baseline, election) pairs and print MAE/RMSE/winner-accuracy
    per state and overall.
    """
    for baseline_yr, election_yr in pairs:
        try:
            bt_uns = run_backtest(baseline_yr, election_yr, elasticity_curve=True,
                                  primary_based=False, verbose=verbose)
            bt_pri = run_backtest(baseline_yr, election_yr, elasticity_curve=True,
                                  primary_based=True, verbose=verbose)
        except FileNotFoundError as e:
            logger.warning("Skipping comparison %d→%d: %s", baseline_yr, election_yr, e)
            continue

        line = "=" * 78
        print(f"\n{line}")
        print(f"  MODEL COMPARISON: {baseline_yr} → {election_yr}  "
              f"(national 2PP swing {bt_uns.national_swing:+.2f}pp, "
              f"{bt_uns.n_seats} classic seats)")
        print(line)
        print(f"  {'':6s}  {'──── UNS + elasticity ────':>30s}  {'──── primary-based ────':>30s}")
        print(f"  {'state':6s}  {'n':>4s} {'MAE':>7s} {'RMSE':>7s} {'win%':>8s}  "
              f"{'n':>4s} {'MAE':>7s} {'RMSE':>7s} {'win%':>8s}")

        states_u = state_breakdown(bt_uns)
        states_p = state_breakdown(bt_pri)
        for st in sorted(set(states_u) | set(states_p)):
            u = states_u.get(st, _stats_for([]))
            p = states_p.get(st, _stats_for([]))
            print(f"  {st:6s}  {u['n']:>4d} {u['mae']:>7.2f} {u['rmse']:>7.2f} {u['acc']:>7.1f}%  "
                  f"{p['n']:>4d} {p['mae']:>7.2f} {p['rmse']:>7.2f} {p['acc']:>7.1f}%")

        print("  " + "-" * 74)
        print(f"  {'ALL':6s}  {bt_uns.n_seats:>4d} {bt_uns.mae_2pp:>7.2f} "
              f"{bt_uns.rmse_2pp:>7.2f} {bt_uns.pct_correct_winner:>7.1f}%  "
              f"{bt_pri.n_seats:>4d} {bt_pri.mae_2pp:>7.2f} "
              f"{bt_pri.rmse_2pp:>7.2f} {bt_pri.pct_correct_winner:>7.1f}%")
        print(line)


# ── Probabilistic calibration of the Monte Carlo simulation ───────────────────

def run_calibration(
    pairs: list[tuple[int, int]],
    n_simulations: int = 5000,
    swing_std: float = 1.5,
    state_swing_std: float = 0.3,
    seed: Optional[int] = 42,
) -> dict:
    """
    Validate monte_carlo_seat_counts probabilities against actual outcomes.

    IMPORTANT — this is an IN-SAMPLE check, not out-of-sample validation: each
    election is simulated with that election's OBSERVED national swing as the
    central estimate, so the only uncertainty tested is the seat-level spread
    around a known-correct national number. Operational forecasts must also
    carry national-swing (polling) error, so real-world calibration will be
    worse than the figures reported here.

    For each (baseline, election) pair, simulates the election with the
    observed national swing as the central estimate, then evaluates:
      • Brier score of per-seat ALP win probabilities (classic seats only)
      • A calibration table (predicted probability buckets vs observed win rate)
      • Whether the actual ALP seat count fell inside the 50% (p25–p75) and
        90% (p5–p95) simulated seat-count intervals.
    """
    import random
    if seed is not None:
        random.seed(seed)

    probs_outcomes: list[tuple[float, float]] = []
    election_rows = []

    for baseline_yr, election_yr in pairs:
        try:
            baseline_seats = _extract_seat_results(_load_divisions(baseline_yr))
            election_seats = _extract_seat_results(_load_divisions(election_yr))
        except FileNotFoundError as e:
            logger.warning("Skipping calibration %d→%d: %s", baseline_yr, election_yr, e)
            continue

        election_by_id = {s.division_id: s for s in election_seats}
        # Restrict the simulated universe to divisions contested at both
        # elections so the actual seat count is comparable (redistributions
        # abolish/create seats between cycles).
        universe = [s for s in baseline_seats if s.division_id in election_by_id]

        nat_swing = (_national_primary(election_seats)["alp_2pp"]
                     - _national_primary(baseline_seats)["alp_2pp"])

        mc = monte_carlo_seat_counts(
            universe, nat_swing,
            swing_std=swing_std, n_simulations=n_simulations,
            state_swing_std=state_swing_std,
        )

        actual_alp = sum(
            1 for s in universe
            if election_by_id[s.division_id].winner_party == "ALP"
        )
        pct = mc["percentiles"]
        in50 = pct["p25"] <= actual_alp <= pct["p75"]
        in90 = pct["p5"] <= actual_alp <= pct["p95"]

        for s in universe:
            if s.alp_2pp is None:
                continue  # non-classic seats are deterministic holds in the sim
            p = mc["seat_win_probs"][s.division_id]
            o = 1.0 if election_by_id[s.division_id].winner_party == "ALP" else 0.0
            probs_outcomes.append((p, o))

        election_rows.append({
            "baseline": baseline_yr,
            "election": election_yr,
            "nat_swing": round(nat_swing, 2),
            "actual_alp_seats": actual_alp,
            "mean_alp_seats": mc["alp_mean_seats"],
            "p5": pct["p5"], "p25": pct["p25"], "p50": pct["p50"],
            "p75": pct["p75"], "p95": pct["p95"],
            "in_50pct_interval": in50,
            "in_90pct_interval": in90,
        })

    n = len(probs_outcomes)
    brier = sum((p - o) ** 2 for p, o in probs_outcomes) / n if n else float("nan")

    buckets = []
    for lo10 in range(10):
        lo, hi = lo10 / 10, (lo10 + 1) / 10
        members = [(p, o) for p, o in probs_outcomes
                   if (lo <= p < hi) or (hi == 1.0 and p == 1.0)]
        buckets.append({
            "bucket": f"{lo:.1f}–{hi:.1f}",
            "n": len(members),
            "mean_pred": (sum(p for p, _ in members) / len(members)) if members else None,
            "obs_rate": (sum(o for _, o in members) / len(members)) if members else None,
        })

    n_elec = len(election_rows)
    coverage_50 = (sum(1 for r in election_rows if r["in_50pct_interval"]) / n_elec
                   if n_elec else float("nan"))
    coverage_90 = (sum(1 for r in election_rows if r["in_90pct_interval"]) / n_elec
                   if n_elec else float("nan"))

    return {
        "n_seat_predictions": n,
        "brier_score": round(brier, 4),
        "buckets": buckets,
        "elections": election_rows,
        "coverage_50": coverage_50,
        "coverage_90": coverage_90,
        "swing_std": swing_std,
        "state_swing_std": state_swing_std,
        "n_simulations": n_simulations,
    }


def print_calibration(cal: dict) -> None:
    line = "=" * 70
    print(f"\n{line}")
    print(f"  MONTE CARLO CALIBRATION  "
          f"(swing_std={cal['swing_std']}, state_swing_std={cal['state_swing_std']}, "
          f"{cal['n_simulations']} sims/election)")
    print(line)
    print("  NOTE: in-sample — each election is simulated with its OBSERVED")
    print("  national swing, so operational (forecast) calibration will be worse.")
    print(f"  Seat-level predictions evaluated: {cal['n_seat_predictions']}")
    print(f"  Brier score (ALP win prob):       {cal['brier_score']:.4f}")
    print()
    print("  Calibration table:")
    print(f"  {'prob bucket':>12s} {'n':>6s} {'mean pred':>10s} {'obs ALP win rate':>17s}")
    for b in cal["buckets"]:
        mp = f"{b['mean_pred']:.3f}" if b["mean_pred"] is not None else "—"
        orate = f"{b['obs_rate']:.3f}" if b["obs_rate"] is not None else "—"
        print(f"  {b['bucket']:>12s} {b['n']:>6d} {mp:>10s} {orate:>17s}")
    print()
    print("  Seat-count intervals:")
    for r in cal["elections"]:
        f50 = "✓" if r["in_50pct_interval"] else "✗"
        f90 = "✓" if r["in_90pct_interval"] else "✗"
        print(f"  {r['baseline']}→{r['election']}: actual ALP {r['actual_alp_seats']:>3d}  "
              f"sim mean {r['mean_alp_seats']:>5.1f}  "
              f"50% [{r['p25']}–{r['p75']}] {f50}  "
              f"90% [{r['p5']}–{r['p95']}] {f90}")
    print(f"\n  50% interval coverage: {cal['coverage_50']:.0%} of elections")
    print(f"  90% interval coverage: {cal['coverage_90']:.0%} of elections")
    print(line)


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
    print("  Swing elasticity:")
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

ALL_BACKTEST_PAIRS = [(2016, 2019), (2019, 2022), (2022, 2025)]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Backtest the uniform swing election model")
    parser.add_argument(
        "--election", type=int, choices=[2019, 2022, 2025], default=None,
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
        "--compare", action="store_true",
        help="Report primary-based vs UNS side-by-side, per state and overall",
    )
    parser.add_argument(
        "--calibration", action="store_true",
        help="Validate Monte Carlo win probabilities: Brier score, "
             "calibration table, seat-count interval coverage",
    )
    parser.add_argument(
        "--report", action="store_true",
        help="Write JSON report to data/backtest/",
    )
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO)
    elasticity = not args.no_elasticity

    backtests = ALL_BACKTEST_PAIRS if args.election is None else {
        2019: [(2016, 2019)],
        2022: [(2019, 2022)],
        2025: [(2022, 2025)],
    }[args.election]

    if args.compare:
        print_comparison(backtests, verbose=args.verbose)
        raise SystemExit(0)

    if args.calibration:
        cal = run_calibration(backtests)
        print_calibration(cal)
        if args.report:
            BACKTEST_DIR.mkdir(parents=True, exist_ok=True)
            out = BACKTEST_DIR / "calibration_mc.json"
            with open(out, "w") as f:
                json.dump(cal, f, indent=2)
            logger.info("Wrote calibration report → %s", out)
        raise SystemExit(0)

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
