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

Inputs are read from data/model_constants/ (s25.json, seat_fp_2025.json,
seat_pref_flows_2025.json — produced by scripts/update_s25_from_exports.py)
when present, falling back to parsing the constants out of App.jsx.

Also writes a calibration report to data/calibration_report.txt and the
machine-readable offsets to data/model_constants/seat_calib_2025.json
(consumed by scripts/inject_model_constants.py).
"""

from __future__ import annotations

import json
import re
from pathlib import Path

APP_JSX = Path(__file__).parent.parent / "webapp" / "src" / "App.jsx"
MODEL_CONSTANTS_DIR = Path(__file__).parent.parent / "data" / "model_constants"

# ── Default preference flows (2025 AEC national) ────────────────────────────
PREF_FLOWS = {
    "grn_alp":   0.810,
    "teal_alp":  0.620,
    "on_alp":    0.255,   # 2025 AEC DOP (25.5% to ALP) — keep in sync with poll_aggregator
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


def _load_model_constant(filename: str):
    path = MODEL_CONSTANTS_DIR / filename
    if not path.exists():
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def load_inputs() -> tuple[dict[int, dict], dict[int, dict], list[dict]]:
    """
    Load SEAT_FP_2025, SEAT_PREF_FLOWS_2025 and _S25 from
    data/model_constants/*.json when available (the canonical pipeline
    outputs), otherwise parse them out of App.jsx.
    """
    fp_json = _load_model_constant("seat_fp_2025.json")
    flows_json = _load_model_constant("seat_pref_flows_2025.json")
    s25_json = _load_model_constant("s25.json")

    src = None
    if fp_json is None or flows_json is None or s25_json is None:
        src = APP_JSX.read_text(encoding="utf-8")

    if fp_json is not None:
        seat_fp = {
            int(sid): {k: v for k, v in entry.items() if k not in ("name", "state")}
            for sid, entry in fp_json.items()
        }
        print("Loaded SEAT_FP_2025 from data/model_constants/seat_fp_2025.json")
    else:
        seat_fp = parse_seat_fp_2025(src)

    if flows_json is not None:
        seat_pref_flows = {
            int(sid): {k: v for k, v in entry.items() if k not in ("name", "state")}
            for sid, entry in flows_json.items()
        }
        print("Loaded SEAT_PREF_FLOWS_2025 from data/model_constants/seat_pref_flows_2025.json")
    else:
        seat_pref_flows = parse_seat_pref_flows_2025(src)

    if s25_json is not None:
        s25 = []
        for row in s25_json:
            div_id, name, state, winner, _wname, t1, t2, margin = row
            s25.append({
                "id": div_id, "name": name, "state": state, "winner": winner,
                "t1": t1, "t2": t2, "margin": margin,
                "t1_pct": round(50 + margin / 2, 2),
                "t2_pct": round(50 - margin / 2, 2),
            })
        print("Loaded _S25 from data/model_constants/s25.json")
    else:
        s25 = parse_s25(src)

    return seat_fp, seat_pref_flows, s25


def main() -> None:
    seat_fp, seat_pref_flows, s25 = load_inputs()

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
            f"Fitted MAE (calibration applied, rounding residual only): {mae_after:.4f}pp"
        )
        report_lines.append(
            f"Leave-one-out MAE (generalisation estimate): {mae_before:.3f}pp"
        )
        report_lines.append(
            "Note: SEAT_CALIB_2025 has one offset per seat fitted to that seat's actual,"
        )
        report_lines.append(
            "so holding out a seat's offset collapses the model to its uncalibrated"
        )
        report_lines.append(
            "primary-based prediction. The LOO MAE above is therefore the honest"
        )
        report_lines.append(
            "out-of-sample error of the primary model before per-seat calibration."
        )

        # Per-state breakdown of the pre-calibration (LOO) error.
        state_errors: dict[str, list[float]] = {}
        # Per-margin-bucket breakdown: <2pp, 2-5pp, 5-10pp, 10pp+.
        margin_buckets = [
            ("<2pp (marginal)", 0.0, 2.0, []),
            ("2-5pp (fairly safe)", 2.0, 5.0, []),
            ("5-10pp (safe)", 5.0, 10.0, []),
            ("10pp+ (very safe)", 10.0, 1e9, []),
        ]
        for sid, off in offsets.items():
            seat = s25_map.get(sid)
            if not seat:
                continue
            state_errors.setdefault(seat["state"], []).append(abs(off))
            for _, lo, hi, bucket in margin_buckets:
                if lo <= seat["margin"] < hi:
                    bucket.append(abs(off))
                    break

        report_lines.append("")
        report_lines.append("Per-state LOO MAE (pre-calibration residual):")
        for state in sorted(state_errors):
            errs = state_errors[state]
            mae = sum(errs) / len(errs)
            mx = max(errs)
            report_lines.append(
                f"  {state:>4}  n={len(errs):>3}  MAE={mae:>6.3f}pp  max={mx:>5.2f}pp"
            )

        report_lines.append("")
        report_lines.append("Per-margin LOO MAE (pre-calibration residual):")
        for label, _, _, errs in margin_buckets:
            if not errs:
                continue
            mae = sum(errs) / len(errs)
            mx = max(errs)
            report_lines.append(
                f"  {label:<22} n={len(errs):>3}  MAE={mae:>6.3f}pp  max={mx:>5.2f}pp"
            )

    # Write report
    report_path = Path(__file__).parent.parent / "data" / "calibration_report.txt"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text("\n".join(report_lines) + "\n", encoding="utf-8")
    print(f"\nCalibration report written to {report_path}")

    # Write machine-readable offsets for inject_model_constants.py
    MODEL_CONSTANTS_DIR.mkdir(parents=True, exist_ok=True)
    calib_path = MODEL_CONSTANTS_DIR / "seat_calib_2025.json"
    calib_json = {
        str(sid): {
            "offset": off,
            "name":  s25_map[sid]["name"] if sid in s25_map else "",
            "state": s25_map[sid]["state"] if sid in s25_map else "",
        }
        for sid, off in sorted(offsets.items())
    }
    with open(calib_path, "w", encoding="utf-8") as f:
        json.dump(calib_json, f, indent=1)
        f.write("\n")
    print(f"Calibration offsets written to {calib_path}")

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
