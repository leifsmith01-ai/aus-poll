#!/usr/bin/env python3
"""Generate the Live Results sample feed + prior-election baseline for the frontend.

The Live Results page (webapp/src/live/) reads a *normalized* JSON feed and projects
final outcomes by comparing live two-candidate-preferred (2CP) counts against a prior
election baseline. On election night that feed comes from the Electoral Commission via a
per-jurisdiction adapter; until then we ship a committed *sample* feed so the whole page
and projection model are testable.

This script builds, for the Victorian 2026 state election:

  * baseline-vic-2026.json  — the 2022 result per seat (the swing baseline). Sourced from
                              the real `_VS` table embedded in webapp/src/App.jsx.
  * sample-vic-2026-{000,035,080,100}.json — synthetic live snapshots at 0/35/80/100 %
                              counted, built by applying a statewide swing + per-seat noise
                              to the 2022 baseline and then biasing/sampling the partial
                              count so that it converges exactly to the "true 2026 final"
                              at 100 % counted.
  * sample-vic-2026.json    — default snapshot (copy of the 35 % file).

VEC publishes district-level (not booth-level) live results, so `boothLevel` is false and
no per-booth arrays are emitted. Booth-matched swing remains available generically for
jurisdictions (e.g. federal) whose feeds carry booth detail.

Usage:
    python scripts/generate_live_sample.py            # writes into webapp/public/live/
    python scripts/generate_live_sample.py --out DIR
"""
from __future__ import annotations

import argparse
import json
import math
import random
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
APP_JSX = REPO_ROOT / "webapp" / "src" / "App.jsx"
DEFAULT_OUT = REPO_ROOT / "webapp" / "public" / "live"

# Statewide 2022 -> 2026 swing assumption baked into the sample (ALP 2CP loses ground after
# a long period in government). Per-seat noise + an early-count bias make the partial
# snapshots realistic without breaking 100%-counted convergence.
STATEWIDE_ALP_2CP_SWING = -3.5      # pp applied to every ALP-vs-Coalition seat's ALP 2CP
GREENS_SWING = 1.5                  # pp toward Greens in Greens-contested seats
SEED = 20261128

AEST = timezone(timedelta(hours=11))  # Melbourne daylight time in late November
ELECTION_NIGHT = datetime(2026, 11, 28, 18, 0, tzinfo=AEST)

COALITION = {"LP", "NP"}

# Melbourne metro vs regional grouping for a light "region" label + early-count bias.
# (Indicative only — real region mapping lives in App.jsx VIC_DISTRICT_REGION.)


def slugify(name: str) -> str:
    """Stable join key shared by the baseline and the feed."""
    name = re.sub(r"\(.*?\)", "", name)          # drop parenthetical notes e.g. "(Alp V Nat)"
    name = name.strip().lower()
    name = re.sub(r"[^a-z0-9]+", "_", name)
    return name.strip("_")


def parse_vs_table(app_jsx: Path) -> list[dict]:
    """Extract the `_VS` VIC seat rows from App.jsx.

    Row form: [9004, "Bass", "VIC", "ALP", "Jordan Crugnale", "ALP", "LP", 0.24],
              [ id ,  name ,  st  ,  wp  ,    winner name    ,  t1 ,  t2 , margin]
    """
    text = app_jsx.read_text(encoding="utf-8")
    block = re.search(r"const _VS = \[(.*?)\n\];", text, re.S)
    if not block:
        raise SystemExit("Could not locate `const _VS = [...]` in App.jsx")
    row_re = re.compile(
        r'\[\s*(\d+),\s*"([^"]+)",\s*"VIC",\s*"([^"]*)",\s*"([^"]*)",'
        r'\s*"([^"]+)",\s*"([^"]+)",\s*([\d.]+)\s*\]'
    )
    seats = []
    for m in row_re.finditer(block.group(1)):
        seat_id, name, wp, wn, t1, t2, margin = m.groups()
        seats.append({
            "id": int(seat_id),
            "name": name,
            "winnerParty": wp,
            "winnerName": wn,
            "pair": [t1, t2],
            "margin": float(margin),
        })
    if not seats:
        raise SystemExit("Parsed zero seats from _VS — regex may be out of date")
    return seats


def region_for(name: str, rng: random.Random) -> str:
    # Deterministic-ish coarse label; the early-count bias only needs metro vs regional.
    regional = {
        "bass", "bellarine", "benambra", "bendigo_east", "bendigo_west", "eildon",
        "euroa", "geelong", "gippsland_east", "gippsland_south", "lara", "lowan",
        "macedon", "mildura", "morwell", "murray_plains", "ovens_valley", "polwarth",
        "ripon", "shepparton", "south_barwon", "south_west_coast", "wendouree",
        "eureka", "nepean", "mornington",
    }
    return "Regional" if slugify(name) in regional else "Melbourne"


def alp_2cp_2022(seat: dict) -> float | None:
    """ALP's 2022 two-party-preferred % for ALP-vs-Coalition seats, else None."""
    t1, t2 = seat["pair"]
    if t1 == "ALP" and t2 in COALITION:
        return 50 + seat["margin"] / 2
    if t2 == "ALP" and t1 in COALITION:
        return 50 - seat["margin"] / 2
    return None


def build_baseline(seats: list[dict], rng: random.Random) -> dict:
    out_seats = {}
    for s in seats:
        sid = slugify(s["name"])
        leader_pct = 50 + s["margin"] / 2
        pair = s["pair"]
        # Synthesize a plausible first-preference split consistent with the 2CP leader.
        # FP is for display / early-count fallback only; projection prefers the 2CP swing.
        alp2 = alp_2cp_2022(s)
        fp = synth_fp(pair, leader_pct, alp2, rng)
        total = rng.randint(34000, 46000)
        out_seats[sid] = {
            "name": s["name"],
            "region": region_for(s["name"], rng),
            "winnerParty": s["winnerParty"],
            "fp": fp,
            "tcp": {"pair": pair, "pct": {pair[0]: round(leader_pct, 1),
                                          pair[1]: round(100 - leader_pct, 1)}},
            "totalVotes": total,
        }
    return {
        "electionId": "vic_2022",
        "jurisdiction": "vic",
        "asAt": "2022-11-26T18:00:00+11:00",
        "seats": out_seats,
    }


def synth_fp(pair: list[str], leader_pct: float, alp2: float | None,
             rng: random.Random) -> dict:
    """Rough first-preference shares summing to ~100, consistent with the 2CP leader."""
    grn = round(rng.uniform(8, 16), 1)
    ind = round(rng.uniform(2, 7), 1)
    on = round(rng.uniform(1, 5), 1)
    other = round(rng.uniform(2, 6), 1)
    minor = grn + ind + on + other
    if alp2 is not None:
        # ALP vs Coalition: split the major-party remainder by the 2CP, pulling some back
        # to reflect preferences flowing from minors.
        alp = round((alp2 / 100) * (100 - minor) - 3, 1)
        coal = round(100 - minor - alp, 1)
        return {"alp": max(0.0, alp), "coal": max(0.0, coal),
                "grn": grn, "ind": ind, "on": on, "other": other}
    # Non-ALP/Coalition final (Greens or Independent seat): give the two contesters the bulk.
    lead = round((leader_pct / 100) * (100 - other - on), 1)
    trail = round(100 - other - on - lead, 1)
    grp = {"ALP": "alp", "LP": "coal", "NP": "coal", "GRN": "grn", "IND": "ind"}
    fp = {"alp": 0.0, "coal": 0.0, "grn": 0.0, "ind": 0.0, "on": on, "other": other}
    fp[grp.get(pair[0], "other")] = max(0.0, lead)
    fp[grp.get(pair[1], "other")] = max(0.0, trail)
    return fp


def true_2026_final(seats: list[dict], rng: random.Random) -> dict:
    """The (hidden) true 2026 final per seat — partial snapshots converge to this."""
    finals = {}
    for s in seats:
        sid = slugify(s["name"])
        pair = list(s["pair"])
        alp2 = alp_2cp_2022(s)
        if alp2 is not None:
            new_alp2 = alp2 + STATEWIDE_ALP_2CP_SWING + rng.gauss(0, 1.5)
            new_alp2 = min(95.0, max(5.0, new_alp2))
            alp_party = "ALP"
            coal_party = pair[0] if pair[0] in COALITION else pair[1]
            leader = alp_party if new_alp2 >= 50 else coal_party
            leader_pct = new_alp2 if leader == "ALP" else 100 - new_alp2
            final_pair = [alp_party, coal_party] if pair[0] == "ALP" else [coal_party, alp_party]
        else:
            # Greens / Independent seat — small swing, rarely flips in the sample.
            base_leader_pct = 50 + s["margin"] / 2
            swing = GREENS_SWING if "GRN" in pair else rng.gauss(0, 1.2)
            leader_pct = min(92.0, max(50.5, base_leader_pct + swing + rng.gauss(0, 1.0)))
            leader = s["pair"][0]
            final_pair = list(s["pair"])
        finals[sid] = {
            "pair": final_pair,
            "leader": leader,
            "leaderPct": round(leader_pct, 2),
        }
    return finals


def make_snapshot(seats: list[dict], baseline: dict, finals: dict,
                  fraction: float, rng: random.Random) -> dict:
    """Build a normalized feed snapshot at `fraction` of the vote counted."""
    as_at = ELECTION_NIGHT + timedelta(hours=2 + 6 * fraction)
    feed_seats = []
    for s in seats:
        sid = slugify(s["name"])
        b = baseline["seats"][sid]
        f = finals[sid]
        total = b["totalVotes"]
        counted_votes = int(round(total * fraction))

        if fraction <= 0:
            feed_seats.append({
                "seatId": sid, "name": s["name"], "region": b["region"],
                "countedPct": 0.0, "expectedTotal": total, "enrolment": int(total / 0.9),
                "lastUpdated": as_at.isoformat(),
                "fp": [{"party": p, "name": "", "votes": 0, "pct": None}
                       for p in ("ALP", "LP", "GRN", "IND")],
                "tcp": None, "status": "not_started",
            })
            continue

        # Early-count bias toward the Coalition / away from leader, fading to 0 at 100%.
        bias = (2.5 if b["region"] == "Regional" else 1.2) * (1 - fraction)
        noise = rng.gauss(0, 2.0) * (1 - fraction)
        leader_party = f["leader"]
        live_leader_pct = f["leaderPct"] - bias + noise
        live_leader_pct = min(98.0, max(2.0, live_leader_pct))
        pair = f["pair"]
        # Orient live 2CP onto the final pair.
        pct = {pair[0]: 0.0, pair[1]: 0.0}
        if leader_party == pair[0]:
            pct[pair[0]] = round(live_leader_pct, 1)
            pct[pair[1]] = round(100 - live_leader_pct, 1)
        else:
            pct[pair[1]] = round(live_leader_pct, 1)
            pct[pair[0]] = round(100 - live_leader_pct, 1)

        tcp_counted_frac = max(0.0, fraction - 0.06)  # 2CP count lags FP slightly
        tcp_votes = {p: int(round(total * tcp_counted_frac * pct[p] / 100)) for p in pair}
        tcp = None
        if tcp_counted_frac > 0.02:
            tcp = {
                "pair": pair,
                "votes": tcp_votes,
                "pct": pct,
                "countedPct": round(tcp_counted_frac * 100, 1),
            }

        # First preferences: scale the baseline FP, nudged by the same live swing direction.
        fp_shares = scaled_fp(b["fp"], leader_party, bias + abs(noise), rng)
        fp = [{"party": party, "name": "",
               "votes": int(round(counted_votes * share / 100)),
               "pct": round(share, 1)}
              for party, share in fp_shares]

        status = "ec_called" if (fraction >= 0.999 or
                                 (fraction > 0.7 and abs(live_leader_pct - 50) > 8)) else "in_progress"
        feed_seats.append({
            "seatId": sid, "name": s["name"], "region": b["region"],
            "countedPct": round(fraction * 100, 1),
            "expectedTotal": total, "enrolment": int(total / 0.9),
            "lastUpdated": as_at.isoformat(),
            "fp": fp, "tcp": tcp, "status": status,
        })

    counted_pct = round(fraction * 100, 1)
    return {
        "contractVersion": 1,
        "meta": {
            "jurisdiction": "vic",
            "electionId": "vic_2026",
            "chamber": "Legislative Assembly",
            "asAt": as_at.isoformat(),
            "totalSeats": 88,
            "majority": 45,
            "boothLevel": False,
            "source": "sample",
            "baselineElectionId": "vic_2022",
            "countedPct": counted_pct,
        },
        "seats": feed_seats,
    }


def scaled_fp(baseline_fp: dict, leader_party: str, shift: float,
              rng: random.Random) -> list[tuple[str, float]]:
    grp_party = {"alp": "ALP", "coal": "LP", "grn": "GRN", "ind": "IND",
                 "on": "ON", "other": "OTH"}
    leader_group = {"ALP": "alp", "LP": "coal", "NP": "coal",
                    "GRN": "grn", "IND": "ind"}.get(leader_party)
    shares = []
    for grp, party in grp_party.items():
        base = baseline_fp.get(grp, 0.0)
        # Pull a little toward the live leader to mirror the 2CP bias direction.
        adj = -shift * 0.4 if grp == leader_group else shift * 0.1
        shares.append([party, max(0.0, base + adj + rng.gauss(0, 0.4))])
    tot = sum(v for _, v in shares) or 1.0
    return [(p, round(v / tot * 100, 1)) for p, v in shares]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT,
                    help="output directory (default: webapp/public/live)")
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    rng = random.Random(SEED)
    seats = parse_vs_table(APP_JSX)
    baseline = build_baseline(seats, rng)
    finals = true_2026_final(seats, rng)

    (args.out / "baseline-vic-2026.json").write_text(
        json.dumps(baseline, indent=2), encoding="utf-8")

    snapshots = {0: "000", 35: "035", 80: "080", 100: "100"}
    for pct, tag in snapshots.items():
        snap = make_snapshot(seats, baseline, finals, pct / 100, random.Random(SEED + pct))
        (args.out / f"sample-vic-2026-{tag}.json").write_text(
            json.dumps(snap, indent=2), encoding="utf-8")

    # Default snapshot mirrors the 35%-counted state.
    default = make_snapshot(seats, baseline, finals, 0.35, random.Random(SEED + 35))
    (args.out / "sample-vic-2026.json").write_text(
        json.dumps(default, indent=2), encoding="utf-8")

    print(f"Wrote baseline + 5 snapshots for {len(seats)} VIC seats to {args.out}")


if __name__ == "__main__":
    main()
