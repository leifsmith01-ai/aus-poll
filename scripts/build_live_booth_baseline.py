#!/usr/bin/env python3
"""Build the 2022 booth-level first-preference baseline for the Live tab.

Election-night figures are skewed by WHICH booths have reported. The fix is
"matched" swing: compare tonight's votes only with the SAME booths' 2022
votes, then apply that swing to the full 2022 district result. This script
produces the 2022 side of that comparison from the VEC's booth-level results
(data/raw/vic/202211/VIC-2022-LA-Primary-Pollingplace.xlsx, Git LFS).

Output: data/live/vic_2022_booths.json
  { seatId: { name, formal, groups: {group: votes},
              parcels: { key: { formal, groups: {group: votes} } } } }

A "parcel" is one election-day booth ("pp:<normalised name>") or one whole
vote-type lump ("vt:early", "vt:postal", "vt:absent", "vt:provisional",
"vt:marked"). The 2026 feed reports the same parcels (early voting is split by
centre in 2026; the reader sums it back into "vt:early").

Run:  git lfs pull --include "data/raw/vic/202211/*" && python scripts/build_live_booth_baseline.py
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
XLSX = REPO_ROOT / "data" / "raw" / "vic" / "202211" / "VIC-2022-LA-Primary-Pollingplace.xlsx"
OUT = REPO_ROOT / "data" / "live" / "vic_2022_booths.json"

# 2022 VEC party codes -> the Live tab's party groups (webapp/src/live/config.js).
GROUP_2022 = {"ALP": "alp", "LIB": "coalition", "NAT": "coalition", "GRN": "greens",
              "IND": "ind", "ONP": "one_nation", "PHON": "one_nation", "ON": "one_nation"}
NOT_VOTES = {"INF", "MIS"}          # informal / mis-sort rows are not candidate votes

VOTE_TYPE_KEYS = {"early vote": "vt:early", "postal vote": "vt:postal", "absent": "vt:absent",
                  "provisional": "vt:provisional", "marked as voted": "vt:marked"}


def slugify(name: str) -> str:
    name = re.sub(r"\(.*?\)", "", str(name or "")).strip().lower()
    return re.sub(r"[^a-z0-9]+", "_", name).strip("_")


def booth_key(name: str) -> str:
    """Normalised booth name: the join key between 2022 and 2026 booths."""
    low = str(name or "").strip().lower()
    if low in VOTE_TYPE_KEYS:
        return VOTE_TYPE_KEYS[low]
    return "pp:" + re.sub(r"[^a-z0-9]+", " ", low).strip()


def build() -> dict:
    import openpyxl
    wb = openpyxl.load_workbook(XLSX, read_only=True)
    rows = wb[wb.sheetnames[0]].iter_rows(values_only=True)
    header = [str(c) for c in next(rows)]
    ix = {n: header.index(n) for n in ("district_name", "pp_name", "party_code", "votes")}
    seats: dict[str, dict] = {}
    for row in rows:
        district, party = row[ix["district_name"]], row[ix["party_code"]]
        if district is None or party in NOT_VOTES:
            continue
        votes = int(row[ix["votes"]] or 0)
        group = GROUP_2022.get(str(party), "other")
        seat = seats.setdefault(slugify(district), {"name": district, "formal": 0, "groups": {}, "parcels": {}})
        parcel = seat["parcels"].setdefault(booth_key(row[ix["pp_name"]]), {"formal": 0, "groups": {}})
        for bucket in (seat, parcel):
            bucket["formal"] += votes
            bucket["groups"][group] = bucket["groups"].get(group, 0) + votes
    return seats


def main() -> int:
    if XLSX.stat().st_size < 10_000:
        print("The Excel file is a Git LFS pointer — run `git lfs pull` first.", file=sys.stderr)
        return 1
    seats = build()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(seats, separators=(",", ":"), sort_keys=True) + "\n")
    n = sum(len(s["parcels"]) for s in seats.values())
    print(f"wrote {OUT.relative_to(REPO_ROOT)}: {len(seats)} districts, {n} parcels, "
          f"{sum(s['formal'] for s in seats.values()):,} formal votes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
