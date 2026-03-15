"""
Generate an updated _S25 JavaScript array from the AEC 2025 export data.

Usage:
    python scripts/update_s25_from_exports.py

Outputs the updated _S25 array to stdout, ready to paste into App.jsx.
Also outputs ON_FP_2025 (One Nation booth-level first prefs by seat).
"""

import json
import os
import sys
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent
DIVISIONS_FILE = BASE_DIR / "data" / "exports" / "2025" / "divisions.json"
DIVISIONS_DIR  = BASE_DIR / "data" / "exports" / "2025" / "divisions"


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


def main():
    with open(DIVISIONS_FILE, encoding="utf-8") as f:
        divisions = json.load(f)

    # Sort by state then division_name to match existing _S25 ordering
    divisions.sort(key=lambda d: (d["state_ab"], d["division_name"]))

    lines = []
    on_fp_lines = []

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
        on_fp = next((fp["pct"] for fp in fps if fp["party_ab"] == "ON"), None)
        if on_fp and on_fp > 0:
            on_fp_lines.append(f"  {div_id}: {round(on_fp, 1)},  // {name} ({state})")

    print("// ── 2025 seat data from AEC final results (event_id=31496) ─────────────────")
    print("const _S25=[")
    for line in lines:
        print(line)
    print("];")
    print()
    print("// ── 2025 seat-level ON first preferences from AEC ──────────────────────────")
    print("const ON_FP_2025 = {")
    for line in on_fp_lines:
        print(line)
    print("};")


if __name__ == "__main__":
    main()
