#!/usr/bin/env python3
"""Fetch + normalize the VEC election-night feed into the Live Results contract.

This is the pipeline half of the election-night CORS fallback documented in
webapp/src/live/README.md: the browser cannot fetch the VEC endpoint directly
if it lacks CORS headers, so the live-feed.yml workflow runs this script on a
loop, commits the normalized snapshot to the `live-feed` branch, and the
dashboard polls it from raw.githubusercontent.com (which serves CORS: *).

All jurisdiction-specific knowledge of the VEC payload lives HERE (the browser
adapter only passes through already-normalized contract JSON). Three input
modes:

  --url URL        fetch JSON from the (real or staging) VEC endpoint
  --file PATH      read a local JSON file (testing)
  --replay N       rehearsal: serve the committed sample snapshots in count
                   order (0% -> 35% -> 80% -> 100%, clamped at the end), so the
                   whole proxy -> branch -> dashboard path can be exercised
                   before the night without any VEC dependency.

Accepted input shapes:
  1. Already-normalized contract JSON (contractVersion + seats[]): validated
     and passed through. Use this if the VEC payload is hand-converted or the
     endpoint turns out to be contract-compatible.
  2. A generic district-results shape: {"districts": [{name, enrolment,
     countedPct, candidates: [{party, name, votes, pct}], twoCandidatePreferred:
     [{party, name, votes, pct}]}]}. Key aliases are matched defensively
     (districtName/district, percentCounted/counted_pct, tcp/2cp, ...) because
     the real 2026 endpoint shape must be confirmed on the night — adjust the
     ALIASES tables below if the VEC names differ.

Output is validated against the contract invariants before writing; a feed
that fails validation exits non-zero so the workflow loop keeps the previous
good snapshot on the branch instead of publishing a broken one.

Usage:
    python scripts/fetch_live_vec.py --url https://... --out live/vec-latest.json
    python scripts/fetch_live_vec.py --replay 3 --out live/vec-latest.json
    python scripts/fetch_live_vec.py --file sample.json --out -   # stdout
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SAMPLE_DIR = REPO_ROOT / "webapp" / "public" / "live"
REPLAY_SEQUENCE = [
    "sample-vic-2026-000.json",
    "sample-vic-2026-035.json",
    "sample-vic-2026-080.json",
    "sample-vic-2026-100.json",
]

TOTAL_SEATS = 88
MAJORITY = 45

# VEC party codes -> dashboard party codes (webapp/src/live/config.js groupOf).
PARTY_MAP = {
    "ALP": "ALP", "AUSTRALIAN LABOR PARTY": "ALP",
    "LIB": "LP", "LP": "LP", "LIBERAL": "LP",
    "NAT": "NP", "NP": "NP", "THE NATIONALS": "NP", "NATIONALS": "NP",
    "GRN": "GRN", "AGV": "GRN", "AUSTRALIAN GREENS": "GRN", "GREENS": "GRN",
    "ONP": "ON", "ON": "ON", "PHON": "ON", "ONE NATION": "ON",
    "PAULINE HANSON'S ONE NATION": "ON",
    "IND": "IND", "INDEPENDENT": "IND",
}

# Key aliases for the generic district shape (first match wins).
DISTRICT_ALIASES = {
    "name":       ["name", "districtName", "district", "electorate"],
    "enrolment":  ["enrolment", "enrollment", "electorsEnrolled"],
    "countedPct": ["countedPct", "percentCounted", "counted_pct", "pctCounted",
                   "countProgress"],
    "candidates": ["candidates", "firstPreferences", "fp", "primaryVotes"],
    "tcp":        ["twoCandidatePreferred", "tcp", "2cp", "twoCandidate",
                   "tcpResults"],
    "updated":    ["lastUpdated", "updated", "asAt", "timestamp"],
}
CANDIDATE_ALIASES = {
    "party": ["party", "partyCode", "partyAbbreviation", "group"],
    "name":  ["name", "candidateName", "ballotName"],
    "votes": ["votes", "voteCount", "totalVotes"],
    "pct":   ["pct", "percentage", "percent", "votePct"],
}


def slugify(name: str) -> str:
    """MUST match webapp/src/live/contract.js slugify — it is the baseline join key."""
    name = re.sub(r"\(.*?\)", "", str(name or ""))
    name = name.strip().lower()
    name = re.sub(r"[^a-z0-9]+", "_", name)
    return name.strip("_")


def map_party(raw) -> str:
    code = str(raw or "").strip().upper()
    return PARTY_MAP.get(code, code[:8] or "OTH")


def pick(d: dict, aliases: list[str]):
    for k in aliases:
        if k in d and d[k] is not None:
            return d[k]
    return None


def to_num(v):
    if v is None:
        return None
    try:
        return float(str(v).replace("%", "").replace(",", ""))
    except ValueError:
        return None


# ── Normalization ─────────────────────────────────────────────────────────────

def normalize(raw: dict, now_iso: str) -> dict:
    if isinstance(raw, dict) and raw.get("contractVersion") and isinstance(raw.get("seats"), list):
        return raw                       # already contract-shaped

    districts = None
    if isinstance(raw, dict):
        for key in ("districts", "results", "electorates"):
            if isinstance(raw.get(key), list):
                districts = raw[key]
                break
    if districts is None:
        raise SystemExit(
            "Unrecognized feed shape: expected contract JSON or a "
            "{districts:[...]} payload. Inspect the VEC response and extend "
            "the alias tables / add a mapping in scripts/fetch_live_vec.py."
        )

    seats = []
    for d in districts:
        name = pick(d, DISTRICT_ALIASES["name"])
        if not name:
            continue
        counted = to_num(pick(d, DISTRICT_ALIASES["countedPct"])) or 0.0

        fp = []
        for c in pick(d, DISTRICT_ALIASES["candidates"]) or []:
            votes = to_num(pick(c, CANDIDATE_ALIASES["votes"])) or 0
            fp.append({
                "party": map_party(pick(c, CANDIDATE_ALIASES["party"])),
                "name": str(pick(c, CANDIDATE_ALIASES["name"]) or ""),
                "votes": int(votes),
                "pct": to_num(pick(c, CANDIDATE_ALIASES["pct"])),
            })

        tcp = None
        tcp_rows = pick(d, DISTRICT_ALIASES["tcp"]) or []
        if len(tcp_rows) == 2:
            pair, votes, pct = [], {}, {}
            for c in tcp_rows:
                party = map_party(pick(c, CANDIDATE_ALIASES["party"]))
                pair.append(party)
                votes[party] = int(to_num(pick(c, CANDIDATE_ALIASES["votes"])) or 0)
                p = to_num(pick(c, CANDIDATE_ALIASES["pct"]))
                if p is not None:
                    pct[party] = p
            tot = sum(votes.values())
            if not pct and tot > 0:
                pct = {p: round(100.0 * v / tot, 2) for p, v in votes.items()}
            if len(set(pair)) == 2 and pct:
                tcp = {"pair": pair, "votes": votes, "pct": pct,
                       "countedPct": counted}

        seats.append({
            "seatId": slugify(name),
            "name": str(name),
            "region": d.get("region"),
            "countedPct": counted,
            "expectedTotal": to_num(d.get("expectedTotal")),
            "enrolment": to_num(pick(d, DISTRICT_ALIASES["enrolment"])),
            "lastUpdated": pick(d, DISTRICT_ALIASES["updated"]) or now_iso,
            "fp": fp,
            "tcp": tcp,
            "status": "not_started" if counted <= 0 else "in_progress",
        })

    mean_counted = round(sum(s["countedPct"] for s in seats) / len(seats), 1) if seats else 0
    return {
        "contractVersion": 1,
        "meta": {
            "jurisdiction": "vic",
            "electionId": "vic_2026",
            "chamber": "Legislative Assembly",
            "asAt": now_iso,
            "totalSeats": TOTAL_SEATS,
            "majority": MAJORITY,
            "boothLevel": False,
            "source": "vec-proxy",
            "baselineElectionId": "vic_2022",
            "countedPct": mean_counted,
        },
        "seats": seats,
    }


# ── Validation (mirrors contract.js invariants) ───────────────────────────────

def validate(feed: dict) -> list[str]:
    errors = []
    if feed.get("contractVersion") != 1:
        errors.append("contractVersion != 1")
    seats = feed.get("seats")
    if not isinstance(seats, list) or not seats:
        return errors + ["seats missing/empty"]
    ids = set()
    for s in seats:
        sid = s.get("seatId")
        if not sid:
            errors.append(f"seat missing seatId: {s.get('name')}")
            continue
        if sid in ids:
            errors.append(f"duplicate seatId {sid}")
        ids.add(sid)
        c = s.get("countedPct")
        if not isinstance(c, (int, float)) or not (0 <= c <= 100):
            errors.append(f"{sid}: bad countedPct {c!r}")
        tcp = s.get("tcp")
        if tcp is not None:
            if len(tcp.get("pair") or []) != 2:
                errors.append(f"{sid}: tcp.pair must have 2 parties")
            elif tcp.get("pct"):
                tot = sum(float(v) for v in tcp["pct"].values())
                if not (95 <= tot <= 105):
                    errors.append(f"{sid}: tcp pct sums to {tot:.1f}")
    return errors


# ── IO ────────────────────────────────────────────────────────────────────────

def fetch_url(url: str) -> dict:
    import requests
    resp = requests.get(url, timeout=30, headers={
        "User-Agent": "aus-poll-live-proxy/1.0 (+https://github.com/leifsmith01-ai/aus-poll)",
        "Accept": "application/json",
    })
    resp.raise_for_status()
    return resp.json()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--url", help="VEC live feed URL")
    src.add_argument("--file", help="local JSON file (testing)")
    src.add_argument("--replay", type=int, metavar="N",
                     help="rehearsal: serve committed sample snapshot #N "
                          "(0-based, clamped to the last snapshot)")
    ap.add_argument("--out", default="-", help="output path, or - for stdout")
    args = ap.parse_args()

    now_iso = datetime.now(timezone.utc).isoformat(timespec="seconds")
    if args.replay is not None:
        idx = max(0, min(args.replay, len(REPLAY_SEQUENCE) - 1))
        path = SAMPLE_DIR / REPLAY_SEQUENCE[idx]
        raw = json.loads(path.read_text())
        print(f"replay step {args.replay} -> {path.name}", file=sys.stderr)
    elif args.file:
        raw = json.loads(Path(args.file).read_text())
    else:
        raw = fetch_url(args.url)

    feed = normalize(raw, now_iso)
    errors = validate(feed)
    if errors:
        for e in errors:
            print(f"VALIDATION: {e}", file=sys.stderr)
        return 1

    out = json.dumps(feed, indent=1, ensure_ascii=False)
    if args.out == "-":
        print(out)
    else:
        dest = Path(args.out)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(out + "\n")
        print(f"wrote {dest} ({len(feed['seats'])} seats, "
              f"{feed['meta']['countedPct']}% counted)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
