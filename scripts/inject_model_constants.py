#!/usr/bin/env python3
"""
inject_model_constants.py
=========================
Reads the JSON model-constant files produced by the compute_*/update_*
scripts and patches the corresponding constants in webapp/src/App.jsx
in place:

  data/seat_residuals.json                        → SEAT_RESIDUAL_MAP
  data/seat_demo_mult.json                        → SEAT_DEMO_MULT
  data/model_constants/s25.json                   → _S25
  data/model_constants/seat_fp_2025.json          → SEAT_FP_2025
  data/model_constants/seat_fp_2022.json          → SEAT_FP_2022
  data/model_constants/seat_pref_flows_2025.json  → SEAT_PREF_FLOWS_2025
  data/model_constants/seat_calib_2025.json       → SEAT_CALIB_2025

The regexes handle both empty placeholders (`const SEAT_FP_2022 = {};`)
and large multi-line populated objects ending in `};`.

Used automatically by the update-model-constants GitHub Actions workflow.
Can also be run manually after the compute_* scripts have been executed.

Usage:
    python scripts/inject_model_constants.py
    python scripts/inject_model_constants.py --dry-run
    python scripts/inject_model_constants.py --app-jsx /tmp/App.jsx --dry-run

Output:
    webapp/src/App.jsx updated with populated constants (replaces the
    empty {} placeholders or stale populated objects).
"""

from __future__ import annotations

import argparse
import difflib
import json
import re
import sys
from pathlib import Path

ROOT      = Path(__file__).parent.parent
APP_JSX   = ROOT / "webapp" / "src" / "App.jsx"
RESIDUALS = ROOT / "data" / "seat_residuals.json"
DEMO_MULT = ROOT / "data" / "seat_demo_mult.json"
MODEL_CONSTANTS_DIR = ROOT / "data" / "model_constants"


def load_json(path: Path) -> dict | None:
    if not path.exists():
        print(f"  [SKIP] {path.name} not found — skipping that constant.", file=sys.stderr)
        return None
    with open(path) as f:
        data = json.load(f)
    print(f"  Loaded {path.name}: {len(data)} entries.", file=sys.stderr)
    return data


def format_js_object(data: dict) -> str:
    """
    Format {str_key: float_val} as a compact multi-line JS object literal.
    Keys are cast to int for sorting (AEC division IDs are integers).
    """
    if not data:
        return "{}"
    items = sorted(data.items(), key=lambda x: int(x[0]))
    lines = []
    for i, (k, v) in enumerate(items):
        comma = "," if i < len(items) - 1 else ""
        lines.append(f"  {k}: {v}{comma}")
    return "{\n" + "\n".join(lines) + "\n}"


def format_seat_fp_object(data: dict) -> str:
    """
    Format {sid: {alp, coal, grn, teal, on, other, name?, state?}} in the
    SEAT_FP_2025/SEAT_FP_2022 style used in App.jsx.
    """
    if not data:
        return "{}"
    lines = []
    for sid, e in sorted(data.items(), key=lambda x: int(x[0])):
        comment = f"  // {e['name']}" if e.get("name") else ""
        lines.append(
            f"  {sid}: {{ alp: {e['alp']:.1f}, coal: {e['coal']:.1f}, "
            f"grn: {e['grn']:.1f}, teal: {e['teal']:.1f}, "
            f"on: {e['on']:.1f}, other: {e['other']:.1f} }},{comment}"
        )
    return "{\n" + "\n".join(lines) + "\n}"


def format_pref_flows_object(data: dict) -> str:
    """Format {sid: {grn_alp, teal_alp, on_alp, other_alp, name?}} as JS."""
    if not data:
        return "{}"
    lines = []
    for sid, e in sorted(data.items(), key=lambda x: int(x[0])):
        comment = f"  // {e['name']}" if e.get("name") else ""
        lines.append(
            f"  {sid}: {{ grn_alp: {e['grn_alp']:.4f}, teal_alp: {e['teal_alp']:.4f}, "
            f"on_alp: {e['on_alp']:.4f}, other_alp: {e['other_alp']:.4f} }},{comment}"
        )
    return "{\n" + "\n".join(lines) + "\n}"


def format_calib_object(data: dict) -> str:
    """Format {sid: {offset, name?}} as the SEAT_CALIB_2025 JS object."""
    if not data:
        return "{}"
    lines = []
    for sid, e in sorted(data.items(), key=lambda x: int(x[0])):
        comment = f"  // {e['name']}" if e.get("name") else ""
        lines.append(f"  {sid}: {e['offset']:+.2f},{comment}")
    return "{\n" + "\n".join(lines) + "\n}"


def format_s25_array(rows: list) -> str:
    """Format the _S25 rows as the JS array literal used in App.jsx."""
    if not rows:
        return "[]"
    lines = []
    for div_id, name, state, winner, wname, t1, t2, margin in rows:
        lines.append(
            f'  [{div_id},"{name}","{state}","{winner}","{wname}",'
            f'"{t1}","{t2}",{margin}],'
        )
    return "[\n" + "\n".join(lines) + "\n]"


def inject_constant(
    content: str,
    const_name: str,
    js_object: str,
    trailing_comment: str = "",
    array: bool = False,
) -> tuple[str, bool]:
    """
    Replace `const NAME = { ... };  // any trailing comment` in content
    (or `const NAME = [ ... ];` when array=True).

    The regex matches non-greedily from the opening brace/bracket to the first
    `};` (or `];`). This handles both single-line empty placeholders
    (`const SEAT_FP_2022 = {};`) and large multi-line populated objects,
    because nested per-seat entries end in `},` — only the closing line of the
    whole literal ends in `};`.

    Returns (new_content, changed).
    """
    open_ch, close_ch = ("\\[", "\\]") if array else ("\\{", "\\}")
    replacement = f"const {const_name} = {js_object};"
    if trailing_comment:
        replacement += f"  // {trailing_comment}"

    # Match: const NAME = {...};   non-greedy to the first "};" then the rest
    # of that line (trailing comments).
    pattern = rf"const {re.escape(const_name)}\s*=\s*{open_ch}.*?{close_ch};[^\n]*"
    new_content, n = re.subn(
        pattern, lambda _m: replacement, content, count=1, flags=re.DOTALL
    )

    if n == 0:
        print(
            f"  [WARN] Pattern for {const_name!r} not found in App.jsx — "
            "check the constant name matches exactly.",
            file=sys.stderr,
        )
        return content, False

    return new_content, new_content != content


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Inject model constants (SEAT_RESIDUAL_MAP, SEAT_DEMO_MULT, _S25, "
            "SEAT_FP_2025, SEAT_FP_2022, SEAT_PREF_FLOWS_2025, SEAT_CALIB_2025) "
            "from their JSON outputs into webapp/src/App.jsx."
        )
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the unified diff without writing any files.",
    )
    parser.add_argument(
        "--app-jsx",
        type=Path,
        default=APP_JSX,
        help="Path to the App.jsx to patch (default: webapp/src/App.jsx). "
             "Useful for testing against a copy.",
    )
    args = parser.parse_args()

    # Load JSON data produced by the compute_*/update_* scripts
    residuals = load_json(RESIDUALS)
    demo_mult = load_json(DEMO_MULT)
    if demo_mult is not None and "seat_mults" in demo_mult:
        # compute_demographic_regression.py wraps the per-seat multipliers in
        # metadata (beta, feature_names, ...): only the seat map is injected.
        demo_mult = demo_mult["seat_mults"]
    s25_rows        = load_json(MODEL_CONSTANTS_DIR / "s25.json")
    seat_fp_2025    = load_json(MODEL_CONSTANTS_DIR / "seat_fp_2025.json")
    seat_fp_2022    = load_json(MODEL_CONSTANTS_DIR / "seat_fp_2022.json")
    seat_pref_flows = load_json(MODEL_CONSTANTS_DIR / "seat_pref_flows_2025.json")
    seat_calib      = load_json(MODEL_CONSTANTS_DIR / "seat_calib_2025.json")

    jobs = [
        # (constant name, data, formatter, array?)
        ("SEAT_RESIDUAL_MAP",     residuals,       format_js_object,         False),
        ("SEAT_DEMO_MULT",        demo_mult,       format_js_object,         False),
        ("_S25",                  s25_rows,        format_s25_array,         True),
        ("SEAT_FP_2025",          seat_fp_2025,    format_seat_fp_object,    False),
        ("SEAT_FP_2022",          seat_fp_2022,    format_seat_fp_object,    False),
        ("SEAT_PREF_FLOWS_2025",  seat_pref_flows, format_pref_flows_object, False),
        ("SEAT_CALIB_2025",       seat_calib,      format_calib_object,      False),
    ]

    if all(data is None for _, data, _f, _a in jobs):
        print(
            "ERROR: No model-constant JSON files found.\n"
            "Run first:\n"
            "  python scripts/compute_seat_residuals.py\n"
            "  python scripts/compute_demographic_regression.py\n"
            "  python scripts/update_s25_from_exports.py\n"
            "  python scripts/compute_calibration.py",
            file=sys.stderr,
        )
        sys.exit(1)

    original = args.app_jsx.read_text()
    content  = original
    any_changed = False

    for const_name, data, formatter, is_array in jobs:
        if data is None:
            continue
        js_obj = formatter(data)
        content, changed = inject_constant(
            content,
            const_name,
            js_obj,
            "auto-injected by inject_model_constants.py",
            array=is_array,
        )
        status = "updated" if changed else "unchanged"
        print(f"  {const_name} {status} ({len(data)} entries).", file=sys.stderr)
        any_changed = any_changed or changed

    if not any_changed:
        print("No changes to App.jsx — already up to date.", file=sys.stderr)
        return

    if args.dry_run:
        diff = difflib.unified_diff(
            original.splitlines(keepends=True),
            content.splitlines(keepends=True),
            fromfile="App.jsx (before)",
            tofile="App.jsx (after)",
            n=3,
        )
        sys.stdout.writelines(diff)
        print("\n[DRY RUN] No files written.", file=sys.stderr)
    else:
        args.app_jsx.write_text(content, encoding="utf-8")
        print(f"Wrote updated {args.app_jsx}.", file=sys.stderr)


if __name__ == "__main__":
    main()
