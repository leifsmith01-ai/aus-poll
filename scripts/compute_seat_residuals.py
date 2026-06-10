#!/usr/bin/env python3
"""
compute_seat_residuals.py
==========================
Compute per-seat swing residual standard deviations from historical backtest
data and demographic characteristics.

The current model uses a uniform SEAT_RESIDUAL_STD = 1.0pp for all seats.
In reality, volatile outer-suburban seats have higher residuals than stable
safe seats. This script estimates per-seat σ from:

  1. Historical backtest residuals: actual seat swing − model-predicted swing
     for each ALP/Coalition seat across 2016→2019, 2019→2022, 2022→2025 pairs.
  2. Demographic correlation: renterPct, medianAge, urbanClass etc. are
     correlated with residual variance (volatile vs stable electorates).
  3. The output SEAT_RESIDUAL_MAP constant can be used in computeUncertainty()
     to replace the uniform 1.0pp constant.

Usage:
    python scripts/compute_seat_residuals.py
    python scripts/compute_seat_residuals.py --output-js

Output:
    const SEAT_RESIDUAL_MAP = {
      101: 0.8,  // Canberra (stable inner metro)
      123: 1.4,  // Paterson (volatile outer Hunter)
      ...
    };

    Usage in App.jsx:
      const indepSigma = Math.sqrt(
        (SEAT_RESIDUAL_MAP[seat.id] ?? SEAT_RESIDUAL_STD) ** 2 + PREF_FLOW_IND_STD ** 2
      );

Prerequisites:
    Division exports for: 2016, 2019, 2022, 2025
    Demographics: webapp/src/data/demographics.js
    Run pipeline first: python main.py --year 2022 && python main.py --year 2019
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

EXPORTS_DIR = ROOT / "data" / "exports"
DEMOG_FILE  = ROOT / "webapp" / "src" / "data" / "demographics.js"
OUTPUT_FILE = ROOT / "data" / "seat_residuals.json"

COALITION_PARTIES = {"LP", "LNP", "NP", "CLP"}
ELECTION_PAIRS    = [(2016, 2019), (2019, 2022), (2022, 2025)]

# Bounds for per-seat σ output
SIGMA_MIN     = 0.5   # Very stable seats (safe inner metro)
SIGMA_MAX     = 2.0   # Very volatile seats (outer suburban, mining belt)
SIGMA_DEFAULT = 1.0   # Default when no data


# ── Data loading ──────────────────────────────────────────────────────────────

def load_divisions(year: int) -> dict[int, dict]:
    path = EXPORTS_DIR / str(year) / "divisions.json"
    if not path.exists():
        raise FileNotFoundError(
            f"No divisions export for {year}. "
            f"Run: python main.py --year {year}"
        )
    with open(path) as f:
        divs = json.load(f)

    results = {}
    for div in divs:
        tcp = div.get("tcp", [])
        if not tcp or len(tcp) < 2:
            continue
        parties = {t["party_ab"] for t in tcp}
        if "ALP" not in parties or not bool(parties & COALITION_PARTIES):
            continue
        alp_entry = next((t for t in tcp if t["party_ab"] == "ALP"), None)
        if alp_entry is None:
            continue
        # Export schema uses division_name / state_ab; enrolment is often null,
        # so fall back to total TCP votes as the seat weight.
        tcp_total = sum(t.get("votes") or 0 for t in tcp)
        results[div["division_id"]] = {
            "name":      div.get("division_name") or div.get("name", ""),
            "state":     div.get("state_ab") or div.get("state", ""),
            "alp_2pp":   alp_entry["pct"],
            "enrolment": div.get("enrolment") or tcp_total or 1,
        }
    return results


def national_avg_2pp(seats: dict[int, dict]) -> float:
    total_weight = sum(s["enrolment"] for s in seats.values())
    if total_weight <= 0:
        return 50.0
    return sum(s["alp_2pp"] * s["enrolment"] for s in seats.values()) / total_weight


def load_demographics() -> dict[int, dict]:
    src = DEMOG_FILE.read_text()
    match = re.search(r"const DEMOGRAPHICS\s*=\s*\{(.*?)\};\s*$", src, re.DOTALL | re.MULTILINE)
    if not match:
        raise ValueError(f"DEMOGRAPHICS not found in {DEMOG_FILE}")
    block = match.group(1)
    data: dict[int, dict] = {}
    entry_re = re.compile(r"(\d+):\s*\{([^}]+)\}")
    kv_re    = re.compile(r"(\w+):\s*(-?[\d.]+|null|\"[^\"]+\")")
    for m in entry_re.finditer(block):
        sid    = int(m.group(1))
        kv_str = m.group(2)
        entry: dict = {}
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


# ── Residual computation ──────────────────────────────────────────────────────

def compute_residuals(
    demographics: dict[int, dict],
) -> dict[int, list[float]]:
    """
    Compute swing model residuals per seat per election pair.
    Returns {seat_id: [residual1, residual2, ...]}.
    Residual = actual seat swing − (national swing applied uniformly).
    """
    seat_residuals: dict[int, list[float]] = {}

    for base_year, target_year in ELECTION_PAIRS:
        try:
            base_divs   = load_divisions(base_year)
            target_divs = load_divisions(target_year)
        except FileNotFoundError as e:
            print(f"  [SKIP] {base_year}→{target_year}: {e}", file=sys.stderr)
            continue

        nat_base   = national_avg_2pp(base_divs)
        nat_target = national_avg_2pp(target_divs)
        nat_swing  = nat_target - nat_base

        if abs(nat_swing) < 0.1:
            continue

        matched = 0
        for seat_id, base in base_divs.items():
            target = target_divs.get(seat_id)
            if target is None:
                continue

            actual_swing    = target["alp_2pp"] - base["alp_2pp"]
            predicted_swing = nat_swing          # pure UNS
            residual        = actual_swing - predicted_swing

            if seat_id not in seat_residuals:
                seat_residuals[seat_id] = []
            seat_residuals[seat_id].append(residual)
            matched += 1

        print(f"  {base_year}→{target_year}: {matched} seats, natSwing {nat_swing:+.2f}pp", file=sys.stderr)

    return seat_residuals


def estimate_sigma(residuals: list[float]) -> float:
    """Estimate std deviation of residuals for a seat."""
    if len(residuals) == 1:
        return abs(residuals[0]) * 1.5  # Conservative single-observation estimate
    if len(residuals) < 1:
        return SIGMA_DEFAULT
    mean = statistics.mean(residuals)
    variance = sum((r - mean) ** 2 for r in residuals) / len(residuals)
    return math.sqrt(variance)


def demographic_sigma_adjustment(demog: dict) -> float:
    """
    Compute a demographic-based adjustment to σ.
    Returns a value near 1.0 that scales the empirical sigma estimate.

    High renter% + young median age → more volatile → σ multiplier > 1.0
    High owner-outright% + old median age → more stable → σ multiplier < 1.0
    """
    adj = 0.0
    count = 0

    if demog.get("renterPct") is not None:
        # National average renter% ~35%; each 10pp above → +0.1 volatility
        adj += (demog["renterPct"] - 35.0) / 100.0
        count += 1

    if demog.get("ownerOutrightPct") is not None:
        # High outright ownership → stability; national average ~32%
        adj -= (demog["ownerOutrightPct"] - 32.0) / 150.0
        count += 1

    if demog.get("medianAge") is not None:
        # Older median age → stability; national average ~38
        adj -= (demog["medianAge"] - 38.0) / 200.0
        count += 1

    if demog.get("youth15to34Pct") is not None:
        # High youth% → volatility; national average ~35%
        adj += (demog["youth15to34Pct"] - 35.0) / 200.0
        count += 1

    if count == 0:
        return 1.0
    return max(0.7, min(1.4, 1.0 + adj / count * count))  # Blend adj across all factors


# ── Main ──────────────────────────────────────────────────────────────────────

def format_js_constant(seat_sigmas: dict[int, float], demographics: dict[int, dict]) -> str:
    lines = [
        "// Per-seat swing residual standard deviations.",
        "// Generated by scripts/compute_seat_residuals.py",
        "//",
        "// Usage in computeUncertainty() (replace uniform SEAT_RESIDUAL_STD):",
        "//   const seatResidualSigma = SEAT_RESIDUAL_MAP[seat.id] ?? SEAT_RESIDUAL_STD;",
        "//   const seatSigma = Math.sqrt(",
        "//     eps*eps*swingStd*swingStd + eps*eps*PREF_FLOW_CORR_STD**2 +",
        "//     seatResidualSigma**2 + PREF_FLOW_IND_STD**2",
        "//   );",
        "const SEAT_RESIDUAL_MAP = {",
    ]
    for seat_id, sigma in sorted(seat_sigmas.items()):
        demog = demographics.get(seat_id, {})
        name  = demog.get("name", f"Seat {seat_id}")
        uc    = demog.get("urbanClass", "")
        lines.append(f"  {seat_id}: {sigma:.2f},  // {name} ({uc})")
    lines.append("};")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Compute per-seat residual σ from historical backtests."
    )
    parser.add_argument(
        "--output-js",
        action="store_true",
        help="Print SEAT_RESIDUAL_MAP constant for App.jsx.",
    )
    parser.add_argument(
        "--no-demog-adjust",
        action="store_true",
        help="Disable demographic adjustment (use empirical σ only).",
    )
    args = parser.parse_args()

    print("Loading demographics...", file=sys.stderr)
    try:
        demographics = load_demographics()
        print(f"  {len(demographics)} electorates loaded.", file=sys.stderr)
    except (FileNotFoundError, ValueError) as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)

    print("\nComputing residuals from election pairs:", file=sys.stderr)
    seat_residuals = compute_residuals(demographics)

    if not seat_residuals:
        print(
            "\nERROR: No residuals computed. Run the pipeline for at least 2 election years:\n"
            "  python main.py --year 2022 && python main.py --year 2019",
            file=sys.stderr,
        )
        sys.exit(1)

    print(f"\nSeats with residual data: {len(seat_residuals)}", file=sys.stderr)

    # Build per-seat σ estimates
    seat_sigmas: dict[int, float] = {}
    for seat_id, residuals in seat_residuals.items():
        emp_sigma = estimate_sigma(residuals)

        # Blend empirical sigma with demographic adjustment
        if not args.no_demog_adjust:
            demog = demographics.get(seat_id, {})
            adj   = demographic_sigma_adjustment(demog)
            sigma = emp_sigma * adj
        else:
            sigma = emp_sigma

        # Clip to reasonable bounds
        sigma = max(SIGMA_MIN, min(SIGMA_MAX, sigma))
        seat_sigmas[seat_id] = round(sigma, 2)

    # Fill in seats without empirical data using demographics only
    for seat_id, demog in demographics.items():
        if seat_id in seat_sigmas:
            continue
        if not args.no_demog_adjust:
            adj   = demographic_sigma_adjustment(demog)
            sigma = SIGMA_DEFAULT * adj
        else:
            sigma = SIGMA_DEFAULT
        seat_sigmas[seat_id] = round(max(SIGMA_MIN, min(SIGMA_MAX, sigma)), 2)

    print(
        f"Total σ estimates: {len(seat_sigmas)}  "
        f"[min={min(seat_sigmas.values()):.2f}, "
        f"mean={statistics.mean(seat_sigmas.values()):.2f}, "
        f"max={max(seat_sigmas.values()):.2f}]",
        file=sys.stderr,
    )

    # Save JSON
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_FILE, "w") as f:
        json.dump({s: v for s, v in sorted(seat_sigmas.items())}, f, indent=2)
    print(f"Saved to {OUTPUT_FILE}", file=sys.stderr)

    if args.output_js:
        print("\n" + "─" * 72)
        print(format_js_constant(seat_sigmas, demographics))
        print("─" * 72)
    else:
        print("\nRun with --output-js to print the SEAT_RESIDUAL_MAP constant.", file=sys.stderr)


if __name__ == "__main__":
    main()
