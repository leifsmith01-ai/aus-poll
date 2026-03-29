"""
Compute SEAT_CALIB_2025 calibration offsets and SEAT_FP_2025 update script.

For each ALP vs Coalition seat that has SEAT_FP_2025 primary data, computes the
difference between:
  - The model's primary-based 2PP prediction at zero swing (using per-seat DOP
    flows from SEAT_PREF_FLOWS_2025 where available, national average otherwise)
  - The model's TCP-based 2025 baseline (50 ± margin/2 as stored in _S25)

This offset is stored in SEAT_CALIB_2025 and blended into the model to ensure that
resetting all swings to zero exactly reproduces the 2025 AEC election result.

Usage:
    python scripts/compute_calibration.py

Outputs SEAT_CALIB_2025 JavaScript constant to stdout, ready to paste into App.jsx.

Also writes a calibration report to data/calibration_report.txt.
"""

from __future__ import annotations

import math
import re
import sys
from pathlib import Path

APP_JSX = Path(__file__).parent.parent / "webapp" / "src" / "App.jsx"

# ── Default preference flows (2025 AEC national) ────────────────────────────
PREF_FLOWS = {
    "grn_alp":   0.810,
    "teal_alp":  0.620,
    "on_alp":    0.430,
    "other_alp": 0.500,
}

COALITION_PARTIES = {"LP", "LNP", "NP", "CLP"}


def parse_seat_fp_2025(src: str) -> dict[int, dict]:
    """Extract SEAT_FP_2025 constant from App.jsx source."""
    # Find the block between "const SEAT_FP_2025 = {" and "};"
    match = re.search(
        r"const SEAT_FP_2025\s*=\s*\{(.*?)\};",
        src,
        re.DOTALL,
    )
    if not match:
        raise ValueError("SEAT_FP_2025 not found in App.jsx")

    block = match.group(1)
    seats: dict[int, dict] = {}

    # Match entries like: 318: { alp: 40.0, coal: 10.5, grn: 16.0, teal: 28.0, on: 2.5, other: 3.0 }
    entry_re = re.compile(
        r"(\d+):\s*\{[^}]*alp:\s*([\d.]+)[^}]*coal:\s*([\d.]+)[^}]*grn:\s*([\d.]+)"
        r"[^}]*teal:\s*([\d.]+)[^}]*on:\s*([\d.]+)[^}]*other:\s*([\d.]+)[^}]*\}"
    )
    for m in entry_re.finditer(block):
        sid = int(m.group(1))
        seats[sid] = {
            "alp":   float(m.group(2)),
            "coal":  float(m.group(3)),
            "grn":   float(m.group(4)),
            "teal":  float(m.group(5)),
            "on":    float(m.group(6)),
            "other": float(m.group(7)),
        }
    return seats


def parse_seat_pref_flows_2025(src: str) -> dict[int, dict]:
    """Extract SEAT_PREF_FLOWS_2025 constant from App.jsx source.

    Returns a dict mapping seat_id -> {grn_alp, teal_alp, on_alp, other_alp}.
    Empty dict if the constant is not found or is empty.
    """
    match = re.search(
        r"const SEAT_PREF_FLOWS_2025\s*=\s*\{(.*?)\};",
        src,
        re.DOTALL,
    )
    if not match:
        return {}

    block = match.group(1)
    flows: dict[int, dict] = {}

    # Match entries like:
    # 101: { grn_alp: 0.8100, teal_alp: 0.6231, on_alp: 0.4300, other_alp: 0.7074 },
    entry_re = re.compile(
        r"(\d+):\s*\{[^}]*grn_alp:\s*([\d.]+)[^}]*teal_alp:\s*([\d.]+)"
        r"[^}]*on_alp:\s*([\d.]+)[^}]*other_alp:\s*([\d.]+)[^}]*\}"
    )
    for m in entry_re.finditer(block):
        sid = int(m.group(1))
        flows[sid] = {
            "grn_alp":   float(m.group(2)),
            "teal_alp":  float(m.group(3)),
            "on_alp":    float(m.group(4)),
            "other_alp": float(m.group(5)),
        }
    return flows


def parse_s25(src: str) -> list[dict]:
    """Extract _S25 array from App.jsx source."""
    match = re.search(
        r"const _S25\s*=\s*\[(.*?)\];",
        src,
        re.DOTALL,
    )
    if not match:
        raise ValueError("_S25 not found in App.jsx")

    block = match.group(1)
    seats = []

    # Match entries like: [318,"Bean","ACT","ALP","David Smith","ALP","IND",0.68],
    entry_re = re.compile(
        r'\[(\d+),\s*"([^"]+)",\s*"([^"]+)",\s*"([^"]+)",\s*"([^"]+)"'
        r',\s*"([^"]+)",\s*"([^"]*)",\s*([\d.]+)\]'
    )
    for m in entry_re.finditer(block):
        margin = float(m.group(8))
        t1 = m.group(6)
        t2 = m.group(7)
        # tcp[0].pct = 50 + margin/2 (winner), tcp[1].pct = 50 - margin/2 (loser)
        seats.append({
            "id":     int(m.group(1)),
            "name":   m.group(2),
            "state":  m.group(3),
            "winner": m.group(4),
            "t1":     t1,
            "t2":     t2,
            "margin": margin,
            # This is how App.jsx stores the TCP pct (line 678)
            "t1_pct": round(50 + margin / 2, 2),
            "t2_pct": round(50 - margin / 2, 2),
        })
    return seats


def compute_primary_2pp(fp: dict, pref_overrides: dict | None = None) -> float:
    """Compute ALP 2PP from first preferences.

    Uses per-seat DOP flows from pref_overrides when provided (keys: grn_alp,
    teal_alp, on_alp, other_alp), falling back to national PREF_FLOWS for any
    missing key or when pref_overrides is None.
    """
    def flow(key: str) -> float:
        if pref_overrides and key in pref_overrides:
            return pref_overrides[key]
        return PREF_FLOWS[key]

    grn_alp   = flow("grn_alp")
    teal_alp  = flow("teal_alp")
    on_alp    = flow("on_alp")
    other_alp = flow("other_alp")

    a2 = (fp["alp"]
          + fp["grn"]   * grn_alp
          + fp["teal"]  * teal_alp
          + fp["on"]    * on_alp
          + fp["other"] * other_alp)
    c2 = (fp["coal"]
          + fp["grn"]   * (1 - grn_alp)
          + fp["teal"]  * (1 - teal_alp)
          + fp["on"]    * (1 - on_alp)
          + fp["other"] * (1 - other_alp))
    if (a2 + c2) == 0:
        return 50.0
    return a2 / (a2 + c2) * 100


def main() -> None:
    src = APP_JSX.read_text(encoding="utf-8")

    seat_fp = parse_seat_fp_2025(src)
    seat_pref_flows = parse_seat_pref_flows_2025(src)
    s25 = parse_s25(src)

    # Build lookup: seat_id -> S25 data
    s25_map = {s["id"]: s for s in s25}

    print(f"Parsed {len(seat_fp)} seats from SEAT_FP_2025")
    print(f"Parsed {len(seat_pref_flows)} seats from SEAT_PREF_FLOWS_2025")
    print(f"Parsed {len(s25)} seats from _S25")

    offsets: dict[int, float] = {}
    report_lines = []
    report_lines.append(
        f"{'ID':>5}  {'Name':<18} {'TCP':>3}  {'Model2PP':>8}  {'Actual2PP':>9}  {'Offset':>7}  Note"
    )
    report_lines.append("-" * 75)

    # Tally stats
    n_alp_coal = 0
    n_dop = 0
    n_skipped = 0
    total_abs_error_before = 0.0
    total_abs_error_after = 0.0

    for sid, fp in sorted(seat_fp.items()):
        seat = s25_map.get(sid)
        if not seat:
            n_skipped += 1
            continue

        t1, t2 = seat["t1"], seat["t2"]
        t1_is_alp = t1 == "ALP"
        t2_is_alp = t2 == "ALP"
        t1_is_coal = t1 in COALITION_PARTIES
        t2_is_coal = t2 in COALITION_PARTIES

        is_alp_coal = (t1_is_alp and t2_is_coal) or (t1_is_coal and t2_is_alp)

        if not is_alp_coal:
            note = f"skip ({t1}/{t2} not ALP/Coal)"
            report_lines.append(
                f"{sid:>5}  {seat['name']:<18} {t1}/{t2}  {'--':>8}  {'--':>9}  {'--':>7}  {note}"
            )
            n_skipped += 1
            continue

        n_alp_coal += 1

        # Actual ALP 2PP as stored in the model (App.jsx tcp pct)
        if t1_is_alp:
            actual_alp2pp = seat["t1_pct"]
        else:
            actual_alp2pp = seat["t2_pct"]

        # Model-predicted 2PP from primaries at zero swing.
        # Use per-seat DOP flows if available, else national average.
        pref_overrides = seat_pref_flows.get(sid)
        model_alp2pp = compute_primary_2pp(fp, pref_overrides)
        if pref_overrides:
            n_dop += 1

        offset = actual_alp2pp - model_alp2pp
        # Round to 2 dp for storage
        offset_r = round(offset, 2)

        offsets[sid] = offset_r

        abs_err = abs(offset)
        total_abs_error_before += abs_err
        # After calibration at zero swing, error = 0
        # But we'll note the residual from rounding
        total_abs_error_after += abs(offset - offset_r)

        dop_note = " [DOP]" if pref_overrides else ""
        flag = " *** LARGE" if abs_err > 3.0 else ""
        report_lines.append(
            f"{sid:>5}  {seat['name']:<18} {t1}/{t2}  "
            f"{model_alp2pp:>8.2f}  {actual_alp2pp:>9.2f}  {offset_r:>+7.2f}  {dop_note}{flag}"
        )

    report_lines.append("-" * 75)
    report_lines.append(
        f"ALP/Coal seats with SEAT_FP_2025: {n_alp_coal} "
        f"({n_dop} using DOP flows), skipped: {n_skipped}"
    )
    if n_alp_coal > 0:
        mae_before = total_abs_error_before / n_alp_coal
        mae_after = total_abs_error_after / n_alp_coal
        report_lines.append(
            f"MAE before calibration: {mae_before:.3f}pp  |  "
            f"MAE after calibration (rounding only): {mae_after:.4f}pp"
        )

    # Write report
    report_path = Path(__file__).parent.parent / "data" / "calibration_report.txt"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text("\n".join(report_lines) + "\n", encoding="utf-8")
    print(f"\nCalibration report written to {report_path}")

    # Output JavaScript constant
    print("\n" + "=" * 60)
    print("// Copy the constant below into App.jsx, replacing SEAT_CALIB_2025")
    print("=" * 60)
    print()
    print("// ── 2025 primary-model calibration offsets ────────────────────────────────────")
    print("// Offset = (actual 2025 ALP 2PP TCP) − (primary-model-predicted 2PP at zero swing)")
    print("// Uses per-seat DOP preference flows (SEAT_PREF_FLOWS_2025) where available,")
    print("// falling back to national average flows for seats without DOP data.")
    print("// Applied with linear blend: offset × max(0, 1 − |nat2ppSwing| / 5)")
    print("// so the offset vanishes at ±5pp swing, leaving the primary model unaffected")
    print("// at larger swings. Recompute via: python scripts/compute_calibration.py")
    print("const SEAT_CALIB_2025 = {")

    # Group by state for readability
    state_groups: dict[str, list[tuple[int, float]]] = {}
    for sid, off in sorted(offsets.items()):
        seat = s25_map.get(sid)
        state = seat["state"] if seat else "??"
        state_groups.setdefault(state, []).append((sid, off, seat["name"] if seat else ""))

    for state in ["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"]:
        entries = state_groups.get(state, [])
        if not entries:
            continue
        print(f"  // ── {state} ──")
        for sid, off, name in entries:
            print(f"  {sid}: {off:+.2f},  // {name}")

    print("};")
    print()
    print(f"// Total ALP/Coal seats calibrated: {n_alp_coal} ({n_dop} using DOP flows)")
    if n_alp_coal > 0:
        print(f"// Mean calibration offset: {sum(abs(v) for v in offsets.values()) / len(offsets):.3f}pp")


if __name__ == "__main__":
    main()
