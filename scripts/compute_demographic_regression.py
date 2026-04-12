#!/usr/bin/env python3
"""
compute_demographic_regression.py
==================================
Fit a demographic swing-elasticity regression on historical seat-level swing
data to produce per-seat swing multipliers (SEAT_DEMO_MULT) for App.jsx.

Replaces the one-dimensional margin-based seatElasticityMult() logistic curve
with a multivariate regression using ABS Census demographic variables.

Methodology:
  1. Load seat-level ALP 2PP from multiple federal election pairs (division exports).
  2. Compute swing ratios: seat_swing / national_swing for each election pair.
  3. Join with demographic variables from demographics.js.
  4. Fit a ridge regression: swing_ratio ~ demographics + margin
  5. Validate via leave-one-election-out cross-validation.
  6. Output SEAT_DEMO_MULT constant for App.jsx.

Demographic predictors (from DEMOGRAPHICS in demographics.js):
  - bachelorsOrAbovePct   : education polarisation amplifies progressive swing
  - renterPct             : cost-of-living sensitivity
  - overseasBornPct       : multicultural seats have more stable ALP vote (dampens)
  - seniors65PlusPct      : older electorates more stable (dampens swing)
  - youth15to34Pct        : younger electorates more volatile (amplifies swing)
  - urbanClass            : categorical effect (partially replaces regional mult)

Usage:
    python scripts/compute_demographic_regression.py
    python scripts/compute_demographic_regression.py --validate   # print CV metrics
    python scripts/compute_demographic_regression.py --output-js  # write JS constant

Prerequisites:
    - Division exports must exist in data/exports/{year}/divisions.json
      for years: 2016, 2019, 2022, 2025
    - Demographic data in webapp/src/data/demographics.js
    Run: python main.py --year 2022 && python main.py --year 2019
"""

from __future__ import annotations

import argparse
import json
import math
import re
import statistics
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

EXPORTS_DIR  = ROOT / "data" / "exports"
DEMOG_FILE   = ROOT / "webapp" / "src" / "data" / "demographics.js"
APP_JSX      = ROOT / "webapp" / "src" / "App.jsx"
OUTPUT_FILE  = ROOT / "data" / "seat_demo_mult.json"

COALITION_PARTIES = {"LP", "LNP", "NP", "CLP"}

# Election pairs for regression training: (baseline_year, target_year)
ELECTION_PAIRS = [(2016, 2019), (2019, 2022), (2022, 2025)]

# Ridge regression regularisation strength. Higher = smoother multipliers.
RIDGE_ALPHA = 0.5


# ── Data loading ──────────────────────────────────────────────────────────────

def load_divisions(year: int) -> list[dict]:
    path = EXPORTS_DIR / str(year) / "divisions.json"
    if not path.exists():
        raise FileNotFoundError(
            f"No divisions export for {year}. "
            f"Run: python main.py --year {year}"
        )
    with open(path) as f:
        return json.load(f)


def extract_seat_results(divisions: list[dict]) -> dict[int, dict]:
    """Return {division_id: {name, state, alp_2pp, alp_fp, coal_fp, grn_fp, winner_party}}."""
    results = {}
    for div in divisions:
        tcp = div.get("tcp", [])
        if not tcp or len(tcp) < 2:
            continue
        parties = {t["party_ab"] for t in tcp}
        has_alp  = "ALP" in parties
        has_coal = bool(parties & COALITION_PARTIES)
        if not (has_alp and has_coal):
            continue  # Only model ALP vs Coalition seats

        alp_entry = next((t for t in tcp if t["party_ab"] == "ALP"), None)
        alp_2pp   = alp_entry["pct"] if alp_entry else None
        if alp_2pp is None:
            continue

        fp_data = div.get("first_preferences", {}) or {}
        results[div["division_id"]] = {
            "name":          div["name"],
            "state":         div.get("state", ""),
            "alp_2pp":       alp_2pp,
            "alp_fp":        fp_data.get("alp_pct"),
            "coal_fp":       fp_data.get("coal_pct"),
            "grn_fp":        fp_data.get("grn_pct"),
            "winner_party":  div.get("winner", {}).get("party_ab", ""),
            "enrolment":     div.get("enrolment") or 1,
        }
    return results


def national_avg_2pp(seats: dict[int, dict]) -> float:
    """Enrolment-weighted national average ALP 2PP."""
    total_weight = sum(s["enrolment"] for s in seats.values() if s["alp_2pp"] is not None)
    if total_weight <= 0:
        return 50.0
    return sum(
        s["alp_2pp"] * s["enrolment"]
        for s in seats.values()
        if s["alp_2pp"] is not None
    ) / total_weight


def load_demographics() -> dict[int, dict]:
    """Parse DEMOGRAPHICS constant from demographics.js. Returns {seat_id: {...}}."""
    src = DEMOG_FILE.read_text()
    # Find the block: const DEMOGRAPHICS = { ... };
    match = re.search(r"const DEMOGRAPHICS\s*=\s*\{(.*?)\};\s*$", src, re.DOTALL | re.MULTILINE)
    if not match:
        raise ValueError(f"DEMOGRAPHICS not found in {DEMOG_FILE}")

    block = match.group(1)
    data: dict[int, dict] = {}

    # Each entry: 101: { key: value, ... },
    entry_re = re.compile(r"(\d+):\s*\{([^}]+)\}")
    kv_re    = re.compile(r"(\w+):\s*(-?[\d.]+|null|\"[^\"]+\")")

    for m in entry_re.finditer(block):
        sid    = int(m.group(1))
        kv_str = m.group(2)
        entry: dict[str, object] = {}
        for kv in kv_re.finditer(kv_str):
            k, v = kv.group(1), kv.group(2)
            if v == "null":
                entry[k] = None
            elif v.startswith('"'):
                entry[k] = v.strip('"')
            else:
                try:
                    entry[k] = float(v)
                except ValueError:
                    entry[k] = v
        data[sid] = entry

    return data


# ── Feature engineering ───────────────────────────────────────────────────────

URBAN_CLASS_CODE = {
    "Inner Metropolitan": 0,
    "Outer Metropolitan": 1,
    "Provincial":         2,
    "Rural":              3,
}

def build_feature_vector(demog: dict) -> list[float] | None:
    """
    Build a normalised feature vector for one seat.
    Returns None if critical data is missing.
    """
    required = [
        "bachelorsOrAbovePct",
        "renterPct",
        "overseasBornPct",
        "seniors65PlusPct",
        "youth15to34Pct",
    ]
    for key in required:
        if demog.get(key) is None:
            return None

    urban_code = URBAN_CLASS_CODE.get(demog.get("urbanClass", ""), 1.0)

    return [
        demog["bachelorsOrAbovePct"] / 100.0,
        demog["renterPct"] / 100.0,
        demog["overseasBornPct"] / 100.0,
        demog["seniors65PlusPct"] / 100.0,
        demog["youth15to34Pct"] / 100.0,
        urban_code / 3.0,       # normalised 0–1
    ]

FEATURE_NAMES = [
    "bachelorsOrAbovePct",
    "renterPct",
    "overseasBornPct",
    "seniors65PlusPct",
    "youth15to34Pct",
    "urbanClass_code",
]


# ── Ridge regression (no external deps) ──────────────────────────────────────

def ridge_regression(
    X: list[list[float]],
    y: list[float],
    alpha: float = 0.5,
) -> list[float]:
    """
    Fit ridge regression: y = X @ beta  (no intercept).
    Returns beta coefficients.
    Uses normal equations: beta = (X^T X + alpha I)^{-1} X^T y
    """
    n, p = len(X), len(X[0])

    # X^T X
    XtX = [[0.0] * p for _ in range(p)]
    for row in X:
        for i in range(p):
            for j in range(p):
                XtX[i][j] += row[i] * row[j]

    # Add ridge penalty
    for i in range(p):
        XtX[i][i] += alpha

    # X^T y
    Xty = [0.0] * p
    for row, yi in zip(X, y):
        for i in range(p):
            Xty[i] += row[i] * yi

    # Solve (X^T X + alpha I) beta = X^T y using Cholesky / Gaussian elimination
    # Simple Gaussian elimination with partial pivoting
    A = [row[:] + [Xty[i]] for i, row in enumerate(XtX)]  # augmented matrix
    for col in range(p):
        # Find pivot
        max_row = max(range(col, p), key=lambda r: abs(A[r][col]))
        A[col], A[max_row] = A[max_row], A[col]
        pivot = A[col][col]
        if abs(pivot) < 1e-12:
            continue
        for row in range(p):
            if row == col:
                continue
            factor = A[row][col] / pivot
            for k in range(col, p + 1):
                A[row][k] -= factor * A[col][k]
    beta = [A[i][p] / A[i][i] if abs(A[i][i]) > 1e-12 else 0.0 for i in range(p)]
    return beta


def predict(x: list[float], beta: list[float]) -> float:
    return sum(xi * bi for xi, bi in zip(x, beta))


# ── Training data builder ─────────────────────────────────────────────────────

def build_training_data(
    demographics: dict[int, dict],
) -> tuple[list[dict], list[list[float]], list[float]]:
    """
    Build (observations, feature_matrix, swing_ratio_targets).
    Each observation is a dict with metadata.
    Swing ratio = seat_swing / national_swing (training target).
    """
    observations = []
    feature_matrix = []
    targets = []

    for base_year, target_year in ELECTION_PAIRS:
        try:
            base_divs    = extract_seat_results(load_divisions(base_year))
            target_divs  = extract_seat_results(load_divisions(target_year))
        except FileNotFoundError as e:
            print(f"  [SKIP] {base_year}→{target_year}: {e}", file=sys.stderr)
            continue

        nat_base   = national_avg_2pp(base_divs)
        nat_target = national_avg_2pp(target_divs)
        nat_swing  = nat_target - nat_base
        if abs(nat_swing) < 0.1:
            print(f"  [SKIP] {base_year}→{target_year}: national swing too small ({nat_swing:.2f}pp)", file=sys.stderr)
            continue

        matched = 0
        for seat_id, base in base_divs.items():
            target = target_divs.get(seat_id)
            if target is None:
                continue  # Seat doesn't exist in target year (redistribution)

            seat_swing  = target["alp_2pp"] - base["alp_2pp"]
            swing_ratio = seat_swing / nat_swing

            # Clip extreme ratios (outliers from candidate effects etc.)
            swing_ratio = max(-2.0, min(4.0, swing_ratio))

            # Get demographics
            demog = demographics.get(seat_id)
            if demog is None:
                continue

            features = build_feature_vector(demog)
            if features is None:
                continue

            observations.append({
                "seat_id":    seat_id,
                "name":       base["name"],
                "state":      base["state"],
                "base_year":  base_year,
                "target_year": target_year,
                "nat_swing":  nat_swing,
                "seat_swing": seat_swing,
                "swing_ratio": swing_ratio,
                "alp_2pp_base": base["alp_2pp"],
            })
            feature_matrix.append(features)
            targets.append(swing_ratio)
            matched += 1

        print(f"  {base_year}→{target_year}: {matched} seats, national swing {nat_swing:+.2f}pp", file=sys.stderr)

    return observations, feature_matrix, targets


# ── Evaluation ────────────────────────────────────────────────────────────────

def compute_rmse(predicted: list[float], actual: list[float]) -> float:
    if not predicted:
        return float("nan")
    return math.sqrt(sum((p - a) ** 2 for p, a in zip(predicted, actual)) / len(predicted))


def leave_one_pair_out_cv(
    observations: list[dict],
    feature_matrix: list[list[float]],
    targets: list[float],
    alpha: float,
) -> dict:
    """
    Leave-one-election-pair-out cross-validation.
    For each held-out election pair, train on all other pairs.
    """
    pairs = list({(o["base_year"], o["target_year"]) for o in observations})
    results = []

    for held_out in pairs:
        # Build train / test splits
        train_X, train_y, test_X, test_y = [], [], [], []
        for obs, x, y in zip(observations, feature_matrix, targets):
            pair = (obs["base_year"], obs["target_year"])
            if pair == held_out:
                test_X.append(x)
                test_y.append(y)
            else:
                train_X.append(x)
                train_y.append(y)

        if len(train_X) < 5 or not test_X:
            continue

        beta = ridge_regression(train_X, train_y, alpha)
        preds = [predict(x, beta) for x in test_X]
        rmse  = compute_rmse(preds, test_y)
        mae   = sum(abs(p - a) for p, a in zip(preds, test_y)) / len(preds)
        results.append({
            "held_out": f"{held_out[0]}→{held_out[1]}",
            "n_test":   len(test_X),
            "rmse":     rmse,
            "mae":      mae,
        })

    # Baseline: always predict 1.0 (uniform swing)
    baseline_rmse = compute_rmse([1.0] * len(targets), targets)

    return {
        "cv_results": results,
        "baseline_rmse": baseline_rmse,
        "mean_cv_rmse": statistics.mean(r["rmse"] for r in results) if results else float("nan"),
    }


# ── Output ────────────────────────────────────────────────────────────────────

def format_js_constant(
    seat_mults: dict[int, float],
    demographics: dict[int, dict],
    beta: list[float],
) -> str:
    """Format SEAT_DEMO_MULT constant for App.jsx."""
    lines = [
        "// Per-seat swing elasticity multipliers from demographic regression.",
        "// Generated by scripts/compute_demographic_regression.py",
        "// Features: bachelorsOrAbovePct, renterPct, overseasBornPct,",
        "//           seniors65PlusPct, youth15to34Pct, urbanClass_code",
        f"// Ridge alpha = {RIDGE_ALPHA}. Coefficients: {[round(b, 4) for b in beta]}",
        "//",
        "// Usage in App.jsx (replace seatElasticityMult for ALP/Coal seats):",
        "//   const elastMult = SEAT_DEMO_MULT[seat.id] ?? seatElasticityMult(alp2pp);",
        "const SEAT_DEMO_MULT = {",
    ]
    for seat_id, mult in sorted(seat_mults.items()):
        demog = demographics.get(seat_id, {})
        name = demog.get("name", f"Seat {seat_id}")
        lines.append(f"  {seat_id}: {mult:.3f},  // {name}")
    lines.append("};")
    return "\n".join(lines)


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Fit demographic swing regression and output SEAT_DEMO_MULT."
    )
    parser.add_argument(
        "--validate",
        action="store_true",
        help="Print leave-one-election-pair-out cross-validation metrics.",
    )
    parser.add_argument(
        "--output-js",
        action="store_true",
        help="Write SEAT_DEMO_MULT constant to stdout (ready to paste into App.jsx).",
    )
    parser.add_argument(
        "--alpha",
        type=float,
        default=RIDGE_ALPHA,
        help=f"Ridge regularisation strength (default {RIDGE_ALPHA}).",
    )
    args = parser.parse_args()

    print("Loading demographics...", file=sys.stderr)
    try:
        demographics = load_demographics()
        print(f"  {len(demographics)} electorates loaded from demographics.js", file=sys.stderr)
    except (FileNotFoundError, ValueError) as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)

    print("\nBuilding training data from election pairs:", file=sys.stderr)
    observations, feature_matrix, targets = build_training_data(demographics)

    if len(observations) < 20:
        print(
            f"\nERROR: Only {len(observations)} training observations. "
            "Need division exports for at least 2 election years.\n"
            "Run: python main.py --year 2022 && python main.py --year 2019",
            file=sys.stderr,
        )
        sys.exit(1)

    print(f"\nTotal observations: {len(observations)}", file=sys.stderr)

    if args.validate:
        print("\nRunning leave-one-election-pair-out cross-validation...", file=sys.stderr)
        cv = leave_one_pair_out_cv(observations, feature_matrix, targets, args.alpha)
        print(f"\nBaseline RMSE (always predict 1.0): {cv['baseline_rmse']:.4f}")
        print(f"Mean CV RMSE (demographic model):   {cv['mean_cv_rmse']:.4f}")
        print(f"Improvement: {cv['baseline_rmse'] - cv['mean_cv_rmse']:.4f}")
        for r in cv["cv_results"]:
            print(f"  Hold-out {r['held_out']}: RMSE={r['rmse']:.4f}, MAE={r['mae']:.4f} (n={r['n_test']})")
        print()

    # Fit on all data
    print("Fitting ridge regression on all data...", file=sys.stderr)
    beta = ridge_regression(feature_matrix, targets, args.alpha)

    print("\nCoefficients:", file=sys.stderr)
    for name, coef in zip(FEATURE_NAMES, beta):
        print(f"  {name:35s}: {coef:+.4f}", file=sys.stderr)

    in_sample_preds = [predict(x, beta) for x in feature_matrix]
    in_sample_rmse  = compute_rmse(in_sample_preds, targets)
    baseline_rmse   = compute_rmse([1.0] * len(targets), targets)
    print(f"\nIn-sample RMSE:  {in_sample_rmse:.4f}  (baseline: {baseline_rmse:.4f})", file=sys.stderr)

    # Compute per-seat multipliers for all electorates in demographics
    seat_mults: dict[int, float] = {}
    for seat_id, demog in demographics.items():
        features = build_feature_vector(demog)
        if features is None:
            continue
        raw = predict(features, beta)
        # Clip to [0.70, 1.50] — prevents extreme multipliers from extrapolation
        seat_mults[seat_id] = round(max(0.70, min(1.50, raw)), 3)

    print(f"\nGenerated multipliers for {len(seat_mults)} seats.", file=sys.stderr)
    print(f"  Range: [{min(seat_mults.values()):.3f}, {max(seat_mults.values()):.3f}]", file=sys.stderr)
    print(f"  Mean:  {statistics.mean(seat_mults.values()):.3f}", file=sys.stderr)

    # Save JSON for reference
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_FILE, "w") as f:
        json.dump({
            "beta": beta,
            "feature_names": FEATURE_NAMES,
            "alpha": args.alpha,
            "n_observations": len(observations),
            "seat_mults": {str(k): v for k, v in seat_mults.items()},
        }, f, indent=2)
    print(f"\nSaved to {OUTPUT_FILE}", file=sys.stderr)

    if args.output_js:
        print("\n" + "─" * 72)
        print(format_js_constant(seat_mults, demographics, beta))
        print("─" * 72)
    else:
        print("\nRun with --output-js to print the SEAT_DEMO_MULT constant.", file=sys.stderr)
        print("Run with --validate to see cross-validation metrics.", file=sys.stderr)


if __name__ == "__main__":
    main()
