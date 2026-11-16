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

  --dir PATH       pick the NEWEST verbose Lower House snapshot ZIP in a folder
                   of downloaded VEC feed files (by the timestamp in the name)
  --replay-dir PATH --replay N
                   rehearsal against real VEC-format files: serve the Nth
                   snapshot (oldest first, clamped) from a folder of VEC ZIPs,
                   e.g. tests/fixtures/vec_sample (the VEC's published SE2026
                   test files)

Accepted input shapes:
  0. THE REAL VEC FEED: the "verbose" Lower House results file
     (<Election>mediafileverboselhv2_YYYYMMDD_HHMMSS.zip, or the .xml inside
     it), as specified in the VEC Results Data Feed User Guide (Sept 2026).
     See normalize_vec_xml() for the mapping and its rules.
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
import io
import json
import re
import sys
import xml.etree.ElementTree as ET
import zipfile
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


# ── The real VEC feed (EML-based XML, "verbose" Lower House file) ─────────────
# Source of truth: VEC Results Data Feed User Guide, September 2026, plus the
# VEC's published SE2026 sample files (tests/fixtures/vec_sample).

# Share of enrolled electors expected to end up in the count (VIC 2022 turnout
# was ~88%). The feed has no "% counted" field, and votes/enrolment would top
# out near 65% on the night, so progress is measured against EXPECTED votes.
EXPECTED_TURNOUT = 0.88

# Results ZIPs are named <Election>mediafile<type><lh|uh>v2_YYYYMMDD_HHMMSS.zip
VEC_ZIP_RE = re.compile(r"mediafile(lite|litepp|verbose)(lh|uh)v\d+_(\d{8}_\d{6})\.(zip|xml)$",
                        re.IGNORECASE)

# Registered party name -> dashboard code. Matched on keywords (first hit
# wins) because the feed carries full registered names, e.g.
# "Australian Labor Party - Victorian Branch". Order matters.
PARTY_KEYWORDS = [
    ("one nation", "ON"),
    ("labor", "ALP"),
    ("liberal democrat", "LDP"),
    ("libertarian", "LBT"),
    ("liberal", "LP"),
    ("national", "NP"),
    ("greens", "GRN"),
    ("family first", "FFV"),
    ("socialist", "VS"),
    ("shooters", "SFF"),
    ("animal justice", "AJP"),
    ("legalise cannabis", "LCV"),
    ("freedom", "FPV"),
    ("justice party", "DHJ"),
]


def party_code(registered_name, independent: bool) -> str:
    if independent or not registered_name:
        return "IND"
    low = registered_name.lower()
    for kw, code in PARTY_KEYWORDS:
        if kw in low:
            return code
    # Unknown minor party: initials of its capitalised words (max 5 chars).
    initials = "".join(w[0] for w in re.findall(r"[A-Za-z]+", registered_name) if w[0].isupper())
    return (initials[:5] or "OTH").upper()


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _child(el, name):
    for c in el:
        if _local(c.tag) == name:
            return c
    return None


def _children(el, name):
    return [c for c in el if _local(c.tag) == name]


def _int(el, name="Votes") -> int:
    c = _child(el, name) if el is not None else None
    try:
        return int((c.text or "0").strip()) if c is not None else 0
    except ValueError:
        return 0


def _cand_id(cand):
    for x in cand.iter():
        if _local(x.tag) == "CandidateIdentifier":
            return x.attrib.get("Id")
    return None


def _desc_text(el, name):
    for x in el.iter():
        if _local(x.tag) == name and (x.text or "").strip():
            return x.text.strip()
    return None


def is_vec_xml(data: bytes) -> bool:
    head = data[:600].lstrip(b"\xef\xbb\xbf \r\n\t")
    return head.startswith(b"<") and b"MediaFeed" in data[:600]


def normalize_vec_xml(data: bytes, now_iso: str, source: str = "vec") -> dict:
    """Map a VEC verbose Lower House results XML onto the live contract.

    Rules taken from the user guide (each is covered by a test):
      * A 2CP is "no data" — never zero — when the element is missing, carries
        Maverick="true" (VEC is withholding it), has an empty Updated, or has
        no votes yet. The pair is the VEC's choice, not the top two on FPs.
      * Counts can go DOWN between snapshots (rechecks/corrections).
      * During a recount, booth and vote-type breakdowns vanish; only the
        contest totals are read here, so that case needs no special handling.
      * Declared=true maps to status "ec_called".
    """
    root = ET.fromstring(data)
    if _local(root.tag) != "MediaFeed":
        raise SystemExit("XML is not a VEC MediaFeed document")
    category = _desc_text(root, "ElectionCategory")
    if category and category != "LowerHouse":
        raise SystemExit(f"Expected the Lower House file, got {category} — "
                         "use the ...verboselhv2... ZIP.")
    if root.attrib.get("Verbose", "").lower() != "true":
        raise SystemExit("This is a lite/litepp file with no party names — "
                         "use the ...verboselhv2... ZIP.")

    event_name = _desc_text(root, "EventName") or ""
    created = root.attrib.get("Created")          # local Melbourne time, no offset
    as_at = created + "+11:00" if created and "+" not in created and "Z" not in created else (created or now_iso)

    seats = []
    for contest in root.iter():
        if _local(contest.tag) != "Contest":
            continue
        raw_name = _desc_text(contest, "ContestName") or ""
        name = re.sub(r"\s+District$", "", raw_name).strip()
        if not name:
            continue
        district = _child(contest, "PollingDistrictIdentifier")
        enrolment = _int(contest, "Enrolment") or None
        declared = (_desc_text(contest, "Declared") or "false").lower() == "true"

        fp_el = _child(contest, "FirstPreferences")
        fp, by_id, counts = [], {}, {}
        formal = total = 0
        if fp_el is not None:
            formal = _int(_child(fp_el, "Formal"))
            total = _int(_child(fp_el, "Total"))
            for cand in _children(fp_el, "Candidate"):
                cid = _cand_id(cand)
                independent = cand.attrib.get("Independent", "").lower() == "yes"
                code = party_code(_desc_text(cand, "RegisteredName"), independent)
                # Two candidates can share a code (several independents). Keep
                # every code unique within the seat ("IND", "IND#2", ...) so the
                # 2CP pair stays unambiguous; groupOf() ignores the "#n" suffix.
                counts[code] = counts.get(code, 0) + 1
                key = code if counts[code] == 1 else f"{code}#{counts[code]}"
                row = {"party": key, "name": _desc_text(cand, "CandidateName") or "",
                       "candidateId": cid, "votes": _int(cand), "pct": None}
                fp.append(row)
                by_id[cid] = row

        expected = round(enrolment * EXPECTED_TURNOUT) if enrolment else None
        counted = min(100.0, round(100.0 * total / expected, 2)) if expected else 0.0

        tcp = None
        tcp_state = "none"
        tcp_el = _child(contest, "TwoCandidatePreferred")
        if tcp_el is not None:
            cands = _children(tcp_el, "Candidate")
            if tcp_el.attrib.get("Maverick", "").lower() == "true":
                tcp_state = "withheld"
            elif not tcp_el.attrib.get("Updated") or len(cands) != 2:
                tcp_state = "none"
            else:
                rows = [(by_id.get(_cand_id(c)), _int(c)) for c in cands]
                tot = sum(v for _, v in rows)
                if tot > 0 and all(r is not None for r, _ in rows):
                    pair = [r["party"] for r, _ in rows]
                    votes = {r["party"]: v for r, v in rows}
                    tcp = {
                        "pair": pair,
                        "names": {r["party"]: r["name"] for r, _ in rows},
                        "votes": votes,
                        "pct": {p: round(100.0 * v / tot, 2) for p, v in votes.items()},
                        # How much of the EXPECTED vote the 2CP count covers.
                        # It lags the FP count on the night, and the model's
                        # confidence must follow this, not the FP progress.
                        "countedPct": min(100.0, round(100.0 * tot / (expected * (formal / total if total else 1)), 2))
                                      if expected else 0.0,
                    }
                    tcp_state = "published"

        seats.append({
            "seatId": slugify(name),
            "name": name,
            "region": None,
            "districtId": district.attrib.get("Id") if district is not None else None,
            "countedPct": counted,
            "expectedTotal": expected,
            "enrolment": enrolment,
            "votesCounted": total,
            "boothsReturned": int(fp_el.attrib.get("PollingPlacesReturned") or 0) if fp_el is not None else 0,
            "boothsExpected": int(fp_el.attrib.get("PollingPlacesExpected") or 0) if fp_el is not None else 0,
            "lastUpdated": contest.attrib.get("Updated") or as_at,
            "fp": fp,
            "tcp": tcp,
            "tcpState": tcp_state,      # published | withheld | none
            "status": "ec_called" if declared else ("not_started" if total <= 0 else "in_progress"),
        })

    tot_expected = sum(s["expectedTotal"] or 0 for s in seats)
    tot_counted = sum(s["votesCounted"] for s in seats)
    return {
        "contractVersion": 1,
        "meta": {
            "jurisdiction": "vic",
            "electionId": "vic_2026",
            "chamber": "Legislative Assembly",
            "asAt": as_at,
            "totalSeats": TOTAL_SEATS,
            "majority": MAJORITY,
            "boothLevel": False,
            "source": source,
            "eventName": event_name,
            # VEC sample + election-night-trial files are fictitious; the page
            # must say so loudly (terms of use cl. 4.1 / 5.1).
            "test": event_name.lower().startswith("test"),
            "phase": root.attrib.get("Phase"),
            "baselineElectionId": "vic_2022",
            "countedPct": round(100.0 * tot_counted / tot_expected, 1) if tot_expected else 0,
        },
        "seats": seats,
    }


def read_vec_file(path: Path) -> bytes:
    """Return the XML bytes from a VEC results .zip (single XML inside) or .xml."""
    data = path.read_bytes()
    if data[:2] == b"PK":
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            names = [n for n in zf.namelist() if n.lower().endswith(".xml")]
            if not names:
                raise SystemExit(f"{path.name}: no XML inside the ZIP")
            return zf.read(names[0])
    return data


def list_vec_snapshots(folder: Path) -> list[Path]:
    """Verbose Lower House snapshots in a folder, OLDEST first (by the
    YYYYMMDD_HHMMSS stamp in the file name — the guide's rule for 'latest')."""
    found = []
    for p in folder.iterdir():
        m = VEC_ZIP_RE.search(p.name)
        if m and m.group(1).lower() == "verbose" and m.group(2).lower() == "lh":
            found.append((m.group(3), p))
    return [p for _, p in sorted(found)]


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

def baseline_seat_ids() -> set[str]:
    path = SAMPLE_DIR / "baseline-vic-2026.json"
    return set(json.loads(path.read_text())["seats"]) if path.exists() else set()


def check_coverage(feed: dict) -> list[str]:
    """Every feed seat must join to the baseline, and all 88 must be present.
    A renamed/misspelt district would otherwise silently drop off the page."""
    base = baseline_seat_ids()
    if not base:
        return []
    ids = {s.get("seatId") for s in feed.get("seats", [])}
    out = []
    if ids - base:
        out.append(f"seats not in baseline: {sorted(ids - base)}")
    if base - ids:
        out.append(f"{len(base - ids)} baseline seats missing from feed "
                   f"(e.g. {sorted(base - ids)[:5]})")
    return out


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

def fetch_url(url: str) -> bytes:
    import requests
    resp = requests.get(url, timeout=30, headers={
        "User-Agent": "aus-poll-live-proxy/1.0",
        "Accept": "application/zip, application/xml, application/json",
    })
    resp.raise_for_status()
    return resp.content


def parse_bytes(data: bytes, now_iso: str, source: str) -> dict:
    """Bytes from any supported source -> contract feed."""
    if data[:2] == b"PK":
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            names = [n for n in zf.namelist() if n.lower().endswith(".xml")]
            if not names:
                raise SystemExit("ZIP contains no XML")
            data = zf.read(names[0])
    if is_vec_xml(data):
        return normalize_vec_xml(data, now_iso, source)
    return normalize(json.loads(data), now_iso)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--url", help="direct URL of a VEC results ZIP/XML (or contract JSON)")
    src.add_argument("--file", help="local VEC .zip/.xml, or JSON file")
    src.add_argument("--dir", help="folder of downloaded VEC ZIPs: use the newest "
                                   "verbose Lower House snapshot")
    src.add_argument("--replay", type=int, metavar="N",
                     help="rehearsal: serve snapshot #N (0-based, clamped to the "
                          "last one) from the synthetic samples, or from "
                          "--replay-dir if given")
    ap.add_argument("--replay-dir", help="with --replay: folder of VEC ZIPs to step through")
    ap.add_argument("--allow-partial", action="store_true",
                    help="do not fail when the feed lacks some of the 88 districts "
                         "(needed for the VEC's 6-district sample files)")
    ap.add_argument("--out", default="-", help="output path, or - for stdout")
    args = ap.parse_args()

    now_iso = datetime.now(timezone.utc).isoformat(timespec="seconds")
    if args.replay is not None and args.replay_dir:
        snaps = list_vec_snapshots(Path(args.replay_dir))
        if not snaps:
            raise SystemExit(f"no verbose Lower House ZIPs in {args.replay_dir}")
        path = snaps[max(0, min(args.replay, len(snaps) - 1))]
        print(f"replay step {args.replay} -> {path.name}", file=sys.stderr)
        feed = parse_bytes(path.read_bytes(), now_iso, "vec-sample")
    elif args.replay is not None:
        idx = max(0, min(args.replay, len(REPLAY_SEQUENCE) - 1))
        path = SAMPLE_DIR / REPLAY_SEQUENCE[idx]
        print(f"replay step {args.replay} -> {path.name}", file=sys.stderr)
        feed = parse_bytes(path.read_bytes(), now_iso, "sample")
    elif args.dir:
        snaps = list_vec_snapshots(Path(args.dir))
        if not snaps:
            raise SystemExit(f"no verbose Lower House ZIPs in {args.dir}")
        print(f"newest snapshot -> {snaps[-1].name}", file=sys.stderr)
        feed = parse_bytes(snaps[-1].read_bytes(), now_iso, "vec")
    elif args.file:
        feed = parse_bytes(Path(args.file).read_bytes(), now_iso, "vec")
    else:
        feed = parse_bytes(fetch_url(args.url), now_iso, "vec")

    errors = validate(feed)
    coverage = check_coverage(feed)
    if args.allow_partial or feed.get("meta", {}).get("source") == "sample":
        for c in coverage:
            print(f"WARNING: {c}", file=sys.stderr)
    else:
        errors += coverage
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
