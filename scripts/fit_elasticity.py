"""
Fit the seat-elasticity logistic curve against actual 2022→2025 seat swings.

The dashboard scales the national 2PP swing by a margin-dependent multiplier
before applying it to each seat (see `seatElasticityMult` in webapp/src/App.jsx
and `apply_swing_with_elasticity` in pipeline/backtest.py). The curve is:

    mult(m) = L + (H - L) / (1 + exp(k * (m - m0)))

where m is |alp_2pp - 50| (seat margin). L is the asymptote for very safe
seats, H the asymptote for knife-edge seats, m0 the midpoint, k the steepness.

Current hand-tuned values: L=0.80, H=1.30, k=0.20, m0=8.

This script refits (L, H, k, m0) against the actual per-seat 2PP swing from
2022→2025 regressed on the national swing. It is read-only: it prints the
fitted coefficients and a per-margin-bucket comparison so the values can be
inspected before being pasted into App.jsx:1768-1773 and
pipeline/backtest.py:210-212.

Requires:
    - data/elections.db populated for 2022 (event_id=27966) and 2025 (31496)
    - scipy (already in requirements.txt)

Usage:
    python scripts/fit_elasticity.py
"""

from __future__ import annotations

import math
import sqlite3
import sys
from pathlib import Path
from typing import Iterable

ROOT = Path(__file__).parent.parent
DB_PATH = ROOT / "data" / "elections.db"

ELECTION_2022 = 2022
ELECTION_2025 = 2025
COALITION = {"LP", "LNP", "NP", "CLP"}


def connect() -> sqlite3.Connection:
    if not DB_PATH.exists():
        sys.exit(
            f"Error: {DB_PATH} not found. Run `python main.py --year 2019 2022 "
            "&& python main.py --year 2025` first to populate the database."
        )
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def division_alp_tcp(conn: sqlite3.Connection, election_id: int) -> dict[int, dict]:
    """Return {division_id: {alp_votes, other_votes, other_party, division_name}} for ALP/Coal seats."""
    # Sum tcp_votes across booths for each (division, candidate), identify the
    # ALP candidate and the Coalition candidate. Skip divisions where neither is
    # in the final two (Green/Teal/Independent races).
    rows = conn.execute(
        """
        SELECT t.division_id,
               d.division_name,
               c.party_ab,
               SUM(t.total_votes) AS votes
        FROM tcp_votes t
        JOIN candidates c ON c.candidate_id = t.candidate_id
                          AND c.election_id = t.election_id
        JOIN divisions d  ON d.division_id  = t.division_id
                          AND d.election_id = t.election_id
        WHERE t.election_id = ?
        GROUP BY t.division_id, c.party_ab
        """,
        (election_id,),
    ).fetchall()

    by_div: dict[int, dict] = {}
    for r in rows:
        d = by_div.setdefault(r["division_id"], {"name": r["division_name"], "parties": {}})
        d["parties"][r["party_ab"]] = r["votes"]

    out: dict[int, dict] = {}
    for div_id, d in by_div.items():
        alp = d["parties"].get("ALP")
        coal_party = next((p for p in COALITION if p in d["parties"]), None)
        if alp is None or coal_party is None:
            continue
        coal_votes = d["parties"][coal_party]
        total = alp + coal_votes
        if total <= 0:
            continue
        out[div_id] = {
            "name":      d["name"],
            "alp_votes": alp,
            "coal_votes": coal_votes,
            "alp_2pp":   alp / total * 100,
        }
    return out


def fit_logistic(xs: list[float], ys: list[float]) -> dict[str, float]:
    """Nonlinear least-squares fit of mult(m) = L + (H - L) / (1 + exp(k * (m - m0)))."""
    import numpy as np
    from scipy.optimize import curve_fit

    xa = np.asarray(xs, dtype=float)
    ya = np.asarray(ys, dtype=float)

    def model(m, L, H, k, m0):
        z = np.clip(k * (m - m0), -50, 50)
        return L + (H - L) / (1 + np.exp(z))

    # Initial guess from the hand-tuned values; bounds keep L, H in plausible
    # ranges, k strictly positive, and m0 non-negative.
    p0 = [0.80, 1.30, 0.20, 8.0]
    bounds = ([0.3, 0.8, 0.01, 0.0], [1.2, 2.5, 2.0, 30.0])
    popt, _ = curve_fit(model, xa, ya, p0=p0, bounds=bounds, maxfev=5000)
    L, H, k, m0 = popt
    pred = model(xa, *popt)
    mae = float(np.mean(np.abs(ya - pred)))
    return {"L": float(L), "H": float(H), "k": float(k), "m0": float(m0), "mae": mae}


def main() -> None:
    conn = connect()
    try:
        d22 = division_alp_tcp(conn, ELECTION_2022)
        d25 = division_alp_tcp(conn, ELECTION_2025)
    finally:
        conn.close()

    # Pair divisions that appear in both elections. Division IDs are stable for
    # seats not involved in a redistribution; redistributed seats will either
    # appear only in one election or carry a different ID. Skip unpaired seats.
    paired: list[tuple[int, dict, dict]] = []
    for div_id, d22_row in d22.items():
        d25_row = d25.get(div_id)
        if d25_row is not None:
            paired.append((div_id, d22_row, d25_row))

    if not paired:
        sys.exit("No ALP/Coal seats paired across 2022 and 2025. Database missing data.")

    # National swing: vote-weighted mean of the seat-level ALP 2PP shifts.
    total_votes22 = sum(p[1]["alp_votes"] + p[1]["coal_votes"] for p in paired)
    total_votes25 = sum(p[2]["alp_votes"] + p[2]["coal_votes"] for p in paired)
    nat_2pp_22 = sum(p[1]["alp_votes"] for p in paired) / total_votes22 * 100
    nat_2pp_25 = sum(p[2]["alp_votes"] for p in paired) / total_votes25 * 100
    nat_swing = nat_2pp_25 - nat_2pp_22

    print(f"Paired ALP/Coal seats: {len(paired)}")
    print(f"National ALP 2PP 2022 (paired subset): {nat_2pp_22:.2f}%")
    print(f"National ALP 2PP 2025 (paired subset): {nat_2pp_25:.2f}%")
    print(f"National swing: {nat_swing:+.2f}pp")
    print()

    if abs(nat_swing) < 0.5:
        print(
            "WARNING: national swing is small, so per-seat multipliers are noisy. "
            "Fit will still run but coefficients may be poorly constrained."
        )

    # For each paired seat, compute the observed multiplier.
    margins: list[float] = []
    mults: list[float] = []
    for _div_id, d22_row, d25_row in paired:
        seat_swing = d25_row["alp_2pp"] - d22_row["alp_2pp"]
        margin = abs(d22_row["alp_2pp"] - 50)
        mult = seat_swing / nat_swing
        margins.append(margin)
        mults.append(mult)

    # Summary by margin bucket before fitting.
    buckets = [
        ("<2pp",      0.0,  2.0),
        ("2-5pp",     2.0,  5.0),
        ("5-10pp",    5.0, 10.0),
        ("10-15pp",  10.0, 15.0),
        ("15pp+",    15.0, 1e9),
    ]
    print(f"{'Margin':<10} {'n':>4} {'mean mult':>10} {'stdev':>8}")
    for label, lo, hi in buckets:
        bucket = [mults[i] for i, m in enumerate(margins) if lo <= m < hi]
        if not bucket:
            continue
        mean = sum(bucket) / len(bucket)
        var = sum((x - mean) ** 2 for x in bucket) / max(1, len(bucket) - 1)
        stdev = math.sqrt(var)
        print(f"{label:<10} {len(bucket):>4} {mean:>10.3f} {stdev:>8.3f}")
    print()

    try:
        fit = fit_logistic(margins, mults)
    except Exception as exc:
        sys.exit(f"Fit failed: {exc}")

    print("Fitted logistic: mult(m) = L + (H - L) / (1 + exp(k * (m - m0)))")
    print(f"  L (safe-seat asymptote):    {fit['L']:.3f}")
    print(f"  H (knife-edge asymptote):   {fit['H']:.3f}")
    print(f"  k (steepness):              {fit['k']:.3f}")
    print(f"  m0 (midpoint, pp):          {fit['m0']:.3f}")
    print(f"  MAE of mult on fitted data: {fit['mae']:.3f}")
    print()
    print("JS (webapp/src/App.jsx:1768):")
    print(f"  return {fit['L']:.3f} + {fit['H'] - fit['L']:.3f} / "
          f"(1 + Math.exp({fit['k']:.3f} * (m - {fit['m0']:.3f})));")
    print()
    print("Python (pipeline/backtest.py:212):")
    print(f"  multiplier = {fit['L']:.3f} + {fit['H'] - fit['L']:.3f} / "
          f"(1 + math.exp({fit['k']:.3f} * (marginality - {fit['m0']:.3f})))")


if __name__ == "__main__":
    main()
