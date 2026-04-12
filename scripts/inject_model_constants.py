#!/usr/bin/env python3
"""
inject_model_constants.py
=========================
Reads data/seat_residuals.json and data/seat_demo_mult.json produced by
compute_seat_residuals.py and compute_demographic_regression.py, then
patches the placeholder constants in webapp/src/App.jsx in place.

Used automatically by the update-model-constants GitHub Actions workflow.
Can also be run manually after the compute_* scripts have been executed.

Usage:
    python scripts/inject_model_constants.py
    python scripts/inject_model_constants.py --dry-run

Output:
    webapp/src/App.jsx updated with populated SEAT_RESIDUAL_MAP and
    SEAT_DEMO_MULT constants (replaces the empty {} placeholders).
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


def inject_constant(
    content: str,
    const_name: str,
    js_object: str,
    trailing_comment: str = "",
) -> tuple[str, bool]:
    """
    Replace `const NAME = { ... };  // any trailing comment` in content.

    The regex matches from the opening `{` to the first closing `}`, which is
    safe because the constant values are plain numbers (no nested objects).
    Works whether the constant is currently empty `{}` or already populated.

    Returns (new_content, changed).
    """
    replacement = f"const {const_name} = {js_object};"
    if trailing_comment:
        replacement += f"  // {trailing_comment}"

    # Match: const NAME = { ...anything not containing }... }; <optional rest of line>
    pattern = rf"const {re.escape(const_name)} = \{{[^}}]*\}}[^\n]*"
    new_content, n = re.subn(pattern, replacement, content, flags=re.DOTALL)

    if n == 0:
        print(
            f"  [WARN] Pattern for {const_name!r} not found in App.jsx — "
            "check the constant name matches exactly.",
            file=sys.stderr,
        )
        return content, False

    if n > 1:
        print(
            f"  [WARN] {n} occurrences of {const_name!r} matched — "
            "only the first was replaced. Verify App.jsx.",
            file=sys.stderr,
        )

    return new_content, new_content != content


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Inject SEAT_RESIDUAL_MAP and SEAT_DEMO_MULT from JSON outputs "
            "into webapp/src/App.jsx."
        )
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the unified diff without writing any files.",
    )
    args = parser.parse_args()

    # Load JSON data produced by the compute_* scripts
    residuals = load_json(RESIDUALS)
    demo_mult = load_json(DEMO_MULT)

    if residuals is None and demo_mult is None:
        print(
            "ERROR: Neither seat_residuals.json nor seat_demo_mult.json found.\n"
            "Run first:\n"
            "  python scripts/compute_seat_residuals.py\n"
            "  python scripts/compute_demographic_regression.py",
            file=sys.stderr,
        )
        sys.exit(1)

    original = APP_JSX.read_text()
    content  = original
    any_changed = False

    if residuals is not None:
        js_obj = format_js_object(residuals)
        content, changed = inject_constant(
            content,
            "SEAT_RESIDUAL_MAP",
            js_obj,
            "auto-injected by inject_model_constants.py",
        )
        if changed:
            print(f"  SEAT_RESIDUAL_MAP updated ({len(residuals)} seats).", file=sys.stderr)
            any_changed = True
        else:
            print(f"  SEAT_RESIDUAL_MAP unchanged ({len(residuals)} seats).", file=sys.stderr)

    if demo_mult is not None:
        js_obj = format_js_object(demo_mult)
        content, changed = inject_constant(
            content,
            "SEAT_DEMO_MULT",
            js_obj,
            "auto-injected by inject_model_constants.py",
        )
        if changed:
            print(f"  SEAT_DEMO_MULT updated ({len(demo_mult)} seats).", file=sys.stderr)
            any_changed = True
        else:
            print(f"  SEAT_DEMO_MULT unchanged ({len(demo_mult)} seats).", file=sys.stderr)

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
        APP_JSX.write_text(content, encoding="utf-8")
        print(f"Wrote updated {APP_JSX}.", file=sys.stderr)


if __name__ == "__main__":
    main()
