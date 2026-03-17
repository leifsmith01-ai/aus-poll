"""
Generate updated JavaScript constants from the AEC 2025 export data.

Usage:
    python scripts/update_s25_from_exports.py

Outputs to stdout (ready to paste into App.jsx):
  - _S25              seat-level 2025 election results
  - ON_FP_2025        One Nation first-preference % by seat
  - SEAT_FP_2025      All-party first-preference % by seat (Phase 2 calibration)
  - SEAT_PREF_FLOWS_2025  Per-seat preference flows from AEC DOP data (Phase 3 calibration)

Requires:
  - data/exports/2025/divisions.json     (from: python main.py --year 2025)
  - data/exports/2025/preference_flows.json  (from: python main.py --year 2025)
"""

import json
import os
import sys
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent
DIVISIONS_FILE    = BASE_DIR / "data" / "exports" / "2025" / "divisions.json"
DIVISIONS_DIR     = BASE_DIR / "data" / "exports" / "2025" / "divisions"
PREF_FLOWS_FILE   = BASE_DIR / "data" / "exports" / "2025" / "preference_flows.json"


# Map AEC party_ab → canonical abbreviation used in App.jsx
PARTY_MAP = {
    "ALP":  "ALP",
    "LP":   "LP",
    "NP":   "NP",
    "LNP":  "LNP",
    "CLP":  "CLP",
    "GRN":  "GRN",
    "GVIC": "GRN",
    "IND":  "IND",
    "XEN":  "IND",   # Centre Alliance (Rebekha Sharkie)
    "KAP":  "KAP",
}

# State ordering (to match existing array order)
STATE_ORDER = ["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"]


def canonical_party(party_ab: str) -> str:
    return PARTY_MAP.get(party_ab, party_ab)


def title_name(name: str) -> str:
    """Convert 'SMITH David' or 'David SMITH' to 'David Smith'."""
    parts = name.strip().split()
    return " ".join(p.capitalize() for p in parts)


def compute_margin(tcp: list) -> float:
    """Return two-candidate margin as absolute percentage difference / 2."""
    if len(tcp) != 2:
        return 0.0
    pct1 = tcp[0]["pct"]
    pct2 = tcp[1]["pct"]
    return round(abs(pct1 - pct2) / 2, 2)


COALITION_PARTIES = {"LP", "LNP", "NP", "CLP"}

# AEC party_ab values that map to App.jsx teal/IND category
TEAL_PARTIES = {"IND", "XEN", "CA"}

# AEC party_ab values for Greens
GRN_PARTIES = {"GRN", "GVIC"}

# AEC party_ab values for One Nation
ON_PARTIES = {"ON", "PHON"}


def _party_group(party_ab: str) -> str:
    """Map raw AEC party_ab to one of: alp, coal, grn, teal, on, other."""
    if party_ab == "ALP":
        return "alp"
    if party_ab in COALITION_PARTIES:
        return "coal"
    if party_ab in GRN_PARTIES:
        return "grn"
    if party_ab in TEAL_PARTIES:
        return "teal"
    if party_ab in ON_PARTIES:
        return "on"
    return "other"


def _build_seat_fp(fps: list) -> dict | None:
    """
    Aggregate AEC first-preference rows into {alp, coal, grn, teal, on, other} %.
    Returns None if no data.
    """
    if not fps:
        return None
    totals: dict[str, float] = {"alp": 0, "coal": 0, "grn": 0, "teal": 0, "on": 0, "other": 0}
    total_pct = 0.0
    for fp in fps:
        grp = _party_group(fp.get("party_ab", ""))
        pct = fp.get("pct") or 0.0
        totals[grp] += pct
        total_pct += pct
    if total_pct == 0:
        return None
    # Normalise to sum to 100 (rounding artefacts)
    scale = 100 / total_pct if total_pct > 0 else 1.0
    return {k: round(v * scale, 2) for k, v in totals.items()}


def _build_pref_flows(pref_data: dict, div_id: int) -> dict | None:
    """
    Extract seat-level preference flow rates from the preference_flows export.
    Returns {grn_alp, teal_alp, on_alp, other_alp} or None if insufficient data.

    The preference_flows.json format (from pipeline/export.py) is expected to be:
      { "by_division": { "<div_id>": { "<from_party>": { "alp_share": <float 0-1> } } } }
    """
    if not pref_data:
        return None
    by_div = pref_data.get("by_division") or {}
    seat_flows = by_div.get(str(div_id)) or {}
    if not seat_flows:
        return None

    result: dict[str, float] = {}
    key_map = {
        "grn_alp":   GRN_PARTIES | {"GRN"},
        "teal_alp":  TEAL_PARTIES,
        "on_alp":    ON_PARTIES | {"ON"},
        "other_alp": {"OTHER"},
    }
    for flow_key, from_parties in key_map.items():
        shares = []
        for from_party in from_parties:
            entry = seat_flows.get(from_party)
            if entry and entry.get("alp_share") is not None:
                shares.append(float(entry["alp_share"]))
        if shares:
            result[flow_key] = round(sum(shares) / len(shares), 4)

    return result if len(result) == 4 else None


def main():
    if not DIVISIONS_FILE.exists():
        print(
            f"ERROR: {DIVISIONS_FILE} not found.\n"
            "Run: python main.py --year 2025  (to download and export AEC 2025 data)",
            file=sys.stderr,
        )
        sys.exit(1)

    with open(DIVISIONS_FILE, encoding="utf-8") as f:
        divisions = json.load(f)

    # Load preference flows if available (Phase 3)
    pref_data: dict = {}
    if PREF_FLOWS_FILE.exists():
        with open(PREF_FLOWS_FILE, encoding="utf-8") as f:
            pref_data = json.load(f)
    else:
        print(
            f"Note: {PREF_FLOWS_FILE} not found — SEAT_PREF_FLOWS_2025 will be empty.\n"
            "Run: python main.py --year 2025  to generate preference flow data.",
            file=sys.stderr,
        )

    # Sort by state then division_name to match existing _S25 ordering
    divisions.sort(key=lambda d: (d["state_ab"], d["division_name"]))

    lines = []
    on_fp_lines = []
    seat_fp_lines_by_state: dict[str, list[str]] = {}
    pref_flow_lines_by_state: dict[str, list[str]] = {}

    for d in divisions:
        div_id   = d["division_id"]
        name     = d["division_name"]
        state    = d["state_ab"]
        winner   = d.get("winner") or {}
        tcp      = d.get("tcp") or []
        fps      = d.get("first_prefs") or []

        winner_party = canonical_party(winner.get("party_ab", ""))
        winner_name  = title_name(winner.get("name", ""))

        # TCP parties
        if len(tcp) == 2:
            tcp1 = canonical_party(tcp[0]["party_ab"])
            tcp2 = canonical_party(tcp[1]["party_ab"])
            # Ensure winner is first tcp party
            if canonical_party(tcp[0]["party_ab"]) != winner_party:
                tcp1, tcp2 = tcp2, tcp1
        else:
            tcp1 = winner_party
            tcp2 = ""

        margin = round(d.get("margin_pct") or 0.0, 2)

        lines.append(
            f'  [{div_id},"{name}","{state}","{winner_party}","{winner_name}",'
            f'"{tcp1}","{tcp2}",{margin}],'
        )

        # ON first preferences for this seat
        on_fp = next((fp["pct"] for fp in fps if fp["party_ab"] in ("ON", "PHON")), None)
        if on_fp and on_fp > 0:
            on_fp_lines.append(f"  {div_id}: {round(on_fp, 1)},  // {name} ({state})")

        # Phase 2: All-party first preferences (SEAT_FP_2025)
        seat_fp = _build_seat_fp(fps)
        if seat_fp:
            fp_str = (
                f"  {div_id}: {{ alp: {seat_fp['alp']:.1f}, coal: {seat_fp['coal']:.1f}, "
                f"grn: {seat_fp['grn']:.1f}, teal: {seat_fp['teal']:.1f}, "
                f"on: {seat_fp['on']:.1f}, other: {seat_fp['other']:.1f} }},  // {name}"
            )
            seat_fp_lines_by_state.setdefault(state, []).append(fp_str)

        # Phase 3: Per-seat preference flows (SEAT_PREF_FLOWS_2025)
        pref_flows = _build_pref_flows(pref_data, div_id)
        if pref_flows:
            pf_str = (
                f"  {div_id}: {{ grn_alp: {pref_flows.get('grn_alp', 0.81):.4f}, "
                f"teal_alp: {pref_flows.get('teal_alp', 0.62):.4f}, "
                f"on_alp: {pref_flows.get('on_alp', 0.43):.4f}, "
                f"other_alp: {pref_flows.get('other_alp', 0.50):.4f} }},  // {name}"
            )
            pref_flow_lines_by_state.setdefault(state, []).append(pf_str)

    # ── Output _S25 ───────────────────────────────────────────────────────────
    print("// ── 2025 seat data from AEC final results (event_id=31496) ─────────────────")
    print("const _S25=[")
    for line in lines:
        print(line)
    print("];")
    print()

    # ── Output ON_FP_2025 ─────────────────────────────────────────────────────
    print("// ── 2025 seat-level ON first preferences from AEC ──────────────────────────")
    print("const ON_FP_2025 = {")
    for line in on_fp_lines:
        print(line)
    print("};")
    print()

    # ── Output SEAT_FP_2025 (Phase 2) ────────────────────────────────────────
    print("// ── 2025 seat-level first preferences (all parties) — Phase 2 calibration ──")
    print("// Source: AEC 2025 election results, event_id=31496")
    print("// Replace the hand-entered SEAT_FP_2025 constant in App.jsx with this output.")
    print("const SEAT_FP_2025 = {")
    for state in ["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"]:
        entries = seat_fp_lines_by_state.get(state, [])
        if entries:
            print(f"  // ── {state} ──")
            for line in entries:
                print(line)
    print("};")
    print()

    # ── Output SEAT_PREF_FLOWS_2025 (Phase 3) ────────────────────────────────
    print("// ── 2025 per-seat preference flows from AEC DOP — Phase 3 calibration ──────")
    print("// Source: AEC 2025 Distribution of Preferences data")
    print("// Replace SEAT_PREF_FLOWS_2025 = {} in App.jsx with this output.")
    print("const SEAT_PREF_FLOWS_2025 = {")
    if pref_flow_lines_by_state:
        for state in ["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"]:
            entries = pref_flow_lines_by_state.get(state, [])
            if entries:
                print(f"  // ── {state} ──")
                for line in entries:
                    print(line)
    else:
        print("  // No per-seat preference flow data available yet.")
        print("  // Run: python main.py --year 2025  then re-run this script.")
    print("};")


if __name__ == "__main__":
    main()
