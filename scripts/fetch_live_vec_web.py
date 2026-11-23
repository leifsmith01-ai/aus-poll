#!/usr/bin/env python3
"""Scrape the VEC results WEBSITE into the Live Results contract.

The VEC's machine-readable data feed is only for approved media/stakeholders.
The public results website carries the same numbers (the VEC says both are
generated from one source) and is licensed CC BY 4.0 — "We encourage the
dissemination and re-use of information provided on this website"
(vec.vic.gov.au/legal). Attribution: "© Victorian Electoral Commission".

Per district the site publishes:
  * <district>-results-by-voting-centre       first preferences, every booth
                                               and vote type, plus enrolment
  * <district>-2cp-results-by-voting-centre   two-candidate-preferred, same rows
This script reads both, for every district linked from the election's
results index, and emits the same contract JSON as scripts/fetch_live_vec.py
(including the booth-matched sums and observed preference flows), so the
dashboard needs no changes to use it.

Layouts differ between elections (the 2022 2CP page lists vote types inline
and puts party names in a second header row; the 2026 template groups rows
into Ordinary / Early / Declaration sections and sometimes shows early votes
only as a section total), so rows are classified by their LABELS, never by
position. The 2CP page has been seen labelling an independent with the other
finalist's party, so 2CP candidates are matched to first-preference columns
by NAME and take their party from there.

Usage
  # election night (index URL is confirmed when the VEC publishes it)
  python scripts/fetch_live_vec_web.py --index URL --cache work/urls.json --out live/vec-latest.json
  # rehearsal against the real 2022 site: fetch once, then replay offline
  python scripts/fetch_live_vec_web.py --index <2022 URL> --save-html work/html --rehearsal --out -
  python scripts/fetch_live_vec_web.py --from-html work/html --rehearsal --reveal 0.3 --out -

Be polite: one run is ~2 requests per district (176 for the state) with a
small worker pool; run it every few minutes, not every few seconds.
"""
from __future__ import annotations

import argparse
import hashlib
import html as htmllib
import json
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetch_live_vec as core  # noqa: E402  (shared contract, party codes, booth matching)

SITE = "https://www.vec.vic.gov.au"
STATE_RESULTS = SITE + "/results/state-election-results"
DEFAULT_INDEX = STATE_RESULTS + "/2026-state-election-results"
USER_AGENT = "aus-poll-live/1.0 (election results dashboard)"
ATTRIBUTION = "© Victorian Electoral Commission, CC BY 4.0"

# Row labels (lower-case) -> what they are.
SECTION_HEADERS = {
    "ordinary votes": "ordinary", "voting centres": "ordinary",
    "early votes": "early", "early voting centres": "early",
    "mobile voting": "early", "mobile voting centres": "early",
    "declaration votes": "declaration",
}
VOTE_TYPE_ROWS = {
    "absent votes": "vt:absent",
    "marked as voted votes": "vt:marked",
    "postal votes": "vt:postal",
    "provisional votes": "vt:provisional",
    "early votes": "vt:early",
    "other early votes": "vt:early",
}
NON_CANDIDATE_COLUMNS = {"informal votes", "total votes polled", "mis-sorts", "miss-sorts", "missorts", ""}


# ── HTML parsing ──────────────────────────────────────────────────────────────

class _TableParser(HTMLParser):
    """Collects every <table> as rows of cells; each cell is a list of text
    chunks (split at <hr>/<div>/<br>, which separate name from party)."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tables, self._rows, self._cell, self._depth = [], None, None, 0

    def handle_starttag(self, tag, attrs):
        if tag == "table":
            self._depth += 1
            if self._depth == 1:
                self._rows = []
        elif self._depth == 1 and tag == "tr":
            self._rows.append([])
        elif self._depth == 1 and tag in ("td", "th") and self._rows is not None:
            self._cell = [""]
            self._rows[-1].append(self._cell)
        elif self._cell is not None and tag in ("hr", "div", "br"):
            self._cell.append("")

    def handle_endtag(self, tag):
        if tag == "table":
            if self._depth == 1 and self._rows is not None:
                self.tables.append(self._rows)
                self._rows = None
            self._depth = max(0, self._depth - 1)
        elif tag in ("td", "th"):
            self._cell = None

    def handle_data(self, data):
        if self._cell is not None:
            self._cell[-1] += data


def _clean(chunks):
    parts = [re.sub(r"\s+", " ", c).strip() for c in chunks]
    return [p for p in parts if p]


def _num(text):
    t = (text or "").replace(",", "").replace("%", "").strip()
    if not t:
        return None
    try:
        return int(float(t))
    except ValueError:
        return None


def parse_results_table(page: str):
    """-> {"columns": [{"name", "party", "kind"}], "rows": [(label, [int|None, ...])]}
    for the first results table on a by-voting-centre page (or None)."""
    p = _TableParser()
    p.feed(page)
    for rows in p.tables:
        if not rows:
            continue
        # Header rows: those whose first data cells hold no numbers.
        header_rows = []
        for r in rows:
            vals = [_clean(c) for c in r[1:]]
            if any(_num(" ".join(v)) is not None for v in vals if v):
                break
            header_rows.append(r)
        if not header_rows:
            continue
        width = max(len(r) for r in rows)
        columns = []
        for j in range(1, width):
            chunks = []
            for r in header_rows:
                if j < len(r):
                    chunks.extend(_clean(r[j]))
            name = chunks[0] if chunks else ""
            party = " ".join(chunks[1:])
            low = name.lower()
            kind = ("informal" if low == "informal votes" else
                    "total" if low == "total votes polled" else
                    "missort" if low in ("mis-sorts", "miss-sorts", "missorts") else
                    "other" if low in NON_CANDIDATE_COLUMNS else "cand")
            if kind == "other" and party.lower() in NON_CANDIDATE_COLUMNS - {""}:
                # 2022 2CP layout: the label sits in the second header row.
                low = party.lower()
                kind = ("informal" if low == "informal votes" else
                        "total" if low == "total votes polled" else "missort")
            columns.append({"name": name, "party": party if kind == "cand" else "", "kind": kind})
        if not any(c["kind"] == "cand" for c in columns):
            continue
        body = []
        for r in rows[len(header_rows):]:
            if not r:
                continue
            label = " ".join(_clean(r[0]))
            vals = [_num(" ".join(_clean(c))) for c in r[1:]]
            vals += [None] * (len(columns) - len(vals))
            body.append((label, vals[:len(columns)]))
        return {"columns": columns, "rows": body}
    return None


def page_text_lines(page: str) -> list[str]:
    i = page.find('id="main"')
    s = page[i:] if i >= 0 else page
    s = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", s)
    s = htmllib.unescape(re.sub(r"<[^>]+>", "\n", s))
    return [re.sub(r"\s+", " ", ln).strip() for ln in s.split("\n") if ln.strip()]


def parse_summary(page: str) -> dict:
    lines = page_text_lines(page)
    out = {"title": lines[1] if len(lines) > 1 else "", "enrolment": None, "elected": None}
    for k, ln in enumerate(lines):
        low = ln.lower()
        if low.startswith("total enrolled voters") or low.startswith("total enrolment"):
            for nxt in lines[k + 1:k + 3]:
                if _num(nxt) is not None:
                    out["enrolment"] = _num(nxt)
                    break
        if low == "elected member" and k + 1 < len(lines):
            nxt = lines[k + 1]
            if "," in nxt and not nxt.lower().startswith(("votes counted", "total")):
                out["elected"] = nxt
    return out


def district_name(page: str, url: str = "") -> str:
    for ln in page_text_lines(page)[:6]:
        m = re.match(r"^(.*?) District\b", ln)
        if m and "results" in ln.lower():
            return m.group(1).strip()
    slug = url.rstrip("/").split("/")[-1]
    slug = re.sub(r"-?district-?(by-election-)?results.*$", "", slug, flags=re.I)
    return slug.replace("-", " ").title()


# ── Rows -> parcels ───────────────────────────────────────────────────────────

def classify_rows(rows):
    """Group data rows into parcels keyed like the 2022 booth baseline:
    'pp:<booth>' for election-day booths, 'vt:<type>' for vote-type lumps
    (every early-voting/mobile row is summed into 'vt:early').
    -> (parcels {key: [values]}, unassigned [values], grand_total [values]|None,
        expected_parcels int)"""
    parcels, unassigned = {}, []
    section, grand, early_total, expected = None, None, None, 0

    def add(key, vals):
        cur = parcels.get(key)
        parcels[key] = [(a or 0) + (b or 0) for a, b in zip(cur, vals)] if cur else [v or 0 for v in vals]

    for label, vals in rows:
        low = label.lower().strip()
        blank = all(v is None for v in vals)
        if not low or low.startswith("percentage"):
            continue
        if low == "total" or low.startswith("total "):
            grand = vals
            continue
        if low.endswith(" total"):
            if low.startswith("early"):
                early_total = vals
            continue
        if blank and low in SECTION_HEADERS:
            section = SECTION_HEADERS[low]
            continue
        expected += 1
        if blank:
            continue                                   # not counted yet
        if low in VOTE_TYPE_ROWS:
            key = VOTE_TYPE_ROWS[low]
        elif section == "early":
            key = "vt:early"
        elif section == "declaration":
            unassigned.append(vals)
            continue
        else:
            key = core.booth_key(label)
        add(key, vals)
    # 2026 template: early votes are sometimes shown only as the section total.
    if "vt:early" not in parcels and early_total and any(v for v in early_total if v):
        add("vt:early", early_total)
        expected += 1
    return parcels, unassigned, grand, expected


def _keep(seed: str, *parts) -> float:
    h = hashlib.sha256("|".join((seed,) + parts).encode()).hexdigest()
    return int(h[:8], 16) / 0xFFFFFFFF


def reveal_filter(parcels: dict, seat: str, frac: float, seed: str, lag: float = 1.0) -> dict:
    """Rehearsal only: keep the parcels that would plausibly be counted when
    `frac` of the night has passed. Booths report in random order; early
    votes land part-way through; postal/absent/etc. only near the end.
    `lag` < 1 delays the 2CP count relative to first preferences."""
    f = max(0.0, min(1.0, frac * lag))
    out = {}
    for key, vals in parcels.items():
        if key.startswith("pp:"):
            ok = _keep(seed, seat, key) < f
        elif key == "vt:early":
            ok = f >= 0.45
        else:
            ok = f >= 0.95
        if ok:
            out[key] = vals
    return out


# ── Seat assembly ─────────────────────────────────────────────────────────────

def build_seat(vc_html: str, tcp_html: str | None, url: str = "", *, now_iso: str,
               reveal: float | None = None, seed: str = "2026") -> dict | None:
    table = parse_results_table(vc_html)
    if not table:
        return None
    name = district_name(vc_html, url)
    summary = parse_summary(vc_html)
    cols = table["columns"]
    cand_ix = [k for k, c in enumerate(cols) if c["kind"] == "cand"]
    inf_ix = next((k for k, c in enumerate(cols) if c["kind"] == "informal"), None)
    tot_ix = next((k for k, c in enumerate(cols) if c["kind"] == "total"), None)

    parcels, unassigned, grand, expected = classify_rows(table["rows"])
    if reveal is not None:
        parcels = reveal_filter(parcels, name, reveal, seed)
        unassigned, grand = [], None

    def column_sum(k):
        if grand is not None and grand[k] is not None:
            return grand[k]
        return sum((v[k] or 0) for v in list(parcels.values()) + unassigned)

    # Candidates, with unique party codes within the seat (IND, IND#2, ...).
    fp, counts, by_name = [], {}, {}
    for k in cand_ix:
        c = cols[k]
        code = core.party_code(c["party"] or None, not c["party"])
        counts[code] = counts.get(code, 0) + 1
        key = code if counts[code] == 1 else f"{code}#{counts[code]}"
        row = {"party": key, "name": c["name"], "candidateId": c["name"],
               "votes": column_sum(k), "pct": None}
        fp.append(row)
        by_name[_norm_name(c["name"])] = (k, row)
    formal = sum(r["votes"] for r in fp)
    informal = column_sum(inf_ix) if inf_ix is not None else 0
    total = column_sum(tot_ix) if tot_ix is not None else formal + informal

    # Booth-matched sums against the 2022 booths.
    parcels_fp = {}
    for key, vals in parcels.items():
        groups = {}
        for k, row in zip(cand_ix, fp):
            v = vals[k] or 0
            if v > 0:
                g = core.group_of(row["party"])
                groups[g] = groups.get(g, 0) + v
        if groups:
            parcels_fp[key] = groups
    matched = core.matched_block(parcels_fp, core.booth_baseline().get(core.slugify(name)))

    enrolment = summary["enrolment"]
    exp_total = round(enrolment * core.EXPECTED_TURNOUT) if enrolment else None
    counted = min(100.0, round(100.0 * total / exp_total, 2)) if exp_total else 0.0

    tcp, tcp_state = None, "none"
    if tcp_html:
        tcp, tcp_state = build_tcp(tcp_html, by_name, parcels, cand_ix, exp_total, formal, total,
                                   name=name, reveal=reveal, seed=seed)

    elected = None
    if summary["elected"] and reveal is None:
        hit = by_name.get(_norm_name(summary["elected"]))
        elected = hit[1]["party"] if hit else None

    return {
        "seatId": core.slugify(name),
        "name": name,
        "region": None,
        "districtId": None,
        "elected": elected,             # party code of the declared member (or None)
        "countedPct": counted,
        "expectedTotal": exp_total,
        "enrolment": enrolment,
        "votesCounted": total,
        "boothsReturned": len(parcels),
        "boothsExpected": expected,
        "lastUpdated": now_iso,
        "fp": fp,
        "tcp": tcp,
        "tcpState": tcp_state,
        "matched": matched,
        "status": ("ec_called" if summary["elected"] and reveal is None
                   else "not_started" if total <= 0 else "in_progress"),
    }


def _norm_name(n: str) -> str:
    return re.sub(r"[^a-z]", "", (n or "").lower())


def build_tcp(tcp_html, fp_by_name, fp_parcels, fp_cand_ix, exp_total, formal, total,
              *, name, reveal, seed):
    table = parse_results_table(tcp_html)
    if not table:
        text = " ".join(page_text_lines(tcp_html)).lower()
        return None, ("withheld" if "withheld" in text or "not available" in text else "none")
    cols = table["columns"]
    cand = [(k, c) for k, c in enumerate(cols) if c["kind"] == "cand"]
    if len(cand) != 2:
        return None, "none"
    rows_fp = [fp_by_name.get(_norm_name(c["name"])) for _, c in cand]
    if any(r is None for r in rows_fp):
        return None, "none"                         # 2CP candidate not on the FP page
    pair = [r[1]["party"] for r in rows_fp]
    if len(set(pair)) != 2:
        return None, "none"

    parcels, unassigned, grand, _ = classify_rows(table["rows"])
    if reveal is not None:
        # The 2CP count trails first preferences, and only for booths whose FPs are in.
        parcels = {k: v for k, v in reveal_filter(parcels, name, reveal, seed + "2cp", lag=0.8).items()
                   if k in fp_parcels}
        unassigned, grand = [], None

    votes = {}
    for (k, _), party in zip(cand, pair):
        if grand is not None and grand[k] is not None:
            votes[party] = grand[k]
        else:
            votes[party] = sum((v[k] or 0) for v in list(parcels.values()) + unassigned)
    tot = sum(votes.values())
    if tot <= 0:
        return None, "none"

    # Observed preference flow, in parcels counted on both pages.
    f_fp, f_tcp, f_formal = {p: 0 for p in pair}, {p: 0 for p in pair}, 0
    for key, tv in parcels.items():
        fv = fp_parcels.get(key)
        if not fv or sum((tv[k] or 0) for k, _ in cand) <= 0:
            continue
        f_formal += sum((fv[k] or 0) for k in fp_cand_ix)
        for (k, _), (fk, _row), party in zip(cand, rows_fp, pair):
            f_fp[party] += fv[fk] or 0
            f_tcp[party] += tv[k] or 0

    tcp = {
        "pair": pair,
        "names": {p: r[1]["name"] for p, r in zip(pair, rows_fp)},
        "votes": votes,
        "pct": {p: round(100.0 * v / tot, 2) for p, v in votes.items()},
        "countedPct": (min(100.0, round(100.0 * tot / (exp_total * (formal / total if total else 1)), 2))
                       if exp_total else 0.0),
    }
    if f_formal > 0:
        tcp["flow"] = {"formal": f_formal, "fp": f_fp, "tcp": f_tcp}
    return tcp, "published"


def assemble(seats: list[dict], *, now_iso: str, rehearsal: bool, source: str) -> dict:
    seats = [s for s in seats if s]
    tot_exp = sum(s["expectedTotal"] or 0 for s in seats)
    tot_cnt = sum(s["votesCounted"] for s in seats)
    return {
        "contractVersion": 1,
        "meta": {
            "jurisdiction": "vic",
            "electionId": "vic_2026",
            "chamber": "Legislative Assembly",
            "asAt": now_iso,
            "totalSeats": core.TOTAL_SEATS,
            "majority": core.MAJORITY,
            "boothLevel": any(s["matched"] for s in seats),
            "source": source,
            "eventName": ("Rehearsal: 2022 results replayed from the VEC website" if rehearsal
                          else "2026 Victorian State Election"),
            "test": rehearsal,
            "attribution": ATTRIBUTION,
            "baselineElectionId": "vic_2022",
            "countedPct": min(100.0, round(100.0 * tot_cnt / tot_exp, 1)) if tot_exp else 0,
        },
        "seats": sorted(seats, key=lambda s: s["seatId"]),
    }


# ── Fetching ──────────────────────────────────────────────────────────────────

def _session():
    import requests
    s = requests.Session()
    s.headers.update({"User-Agent": USER_AGENT, "Accept": "text/html"})
    return s


def fetch(session, url: str, tries: int = 3) -> str | None:
    for attempt in range(tries):
        try:
            r = session.get(url, timeout=30)
            if r.status_code == 404:
                return None
            r.raise_for_status()
            return r.text
        except Exception as exc:                     # network blip / 5xx under load
            if attempt == tries - 1:
                print(f"WARN fetch failed {url}: {exc}", file=sys.stderr)
                return None
            time.sleep(2 * (attempt + 1))
    return None


def district_links(index_html: str, base: str) -> list[str]:
    links = set()
    for href in re.findall(r'href="([^"#?]+)"', index_html):
        low = href.lower()
        if "/results-by-district/" in low and low.rstrip("/").endswith("-results"):
            links.add(urljoin(base, href))
    return sorted(links)


def subpage_links(district_html: str, base: str) -> dict:
    out = {}
    for href in re.findall(r'href="([^"#?]+)"', district_html):
        low = href.lower()
        if low.endswith("2cp-results-by-voting-centre"):
            out["tcp"] = urljoin(base, href)
        elif low.endswith("results-by-voting-centre"):
            out["vc"] = urljoin(base, href)
    return out


# Pages that will link to the election's results once the VEC publishes them.
LANDING_PAGES = [STATE_RESULTS, SITE + "/results", SITE + "/voting/{year}-state-election"]


def results_index_candidates(page: str, base: str, year: str) -> list[str]:
    """Links on a landing page that could be this election's results index: under
    /results/, naming the year, and not a by-election or council page."""
    out = []
    for href in re.findall(r'href="([^"#?]+)"', page):
        low = href.lower()
        if (year in low and "/results/" in low and "state-election" in low
                and "by-election" not in low and "council" not in low
                and "/results-by-district/" not in low):
            url = urljoin(base, href)
            if url not in out:
                out.append(url)
    return out


def discover(session, index_url: str) -> tuple[str, list[str]]:
    """Find the district pages. If the given index is missing or empty (e.g. the
    2026 address differs from the guess), look for the election's results index
    on the VEC's results and election landing pages."""
    page = fetch(session, index_url)
    links = district_links(page, index_url) if page else []
    if links:
        return index_url, links
    year = (re.search(r"(20\d\d)", index_url) or [None, "2026"])[1]
    tried = {index_url}
    for landing_url in (u.format(year=year) for u in LANDING_PAGES):
        landing = fetch(session, landing_url) or ""
        for cand in results_index_candidates(landing, landing_url, year):
            if cand in tried:
                continue
            tried.add(cand)
            page = fetch(session, cand)
            links = district_links(page, cand) if page else []
            if links:
                print(f"results index found at {cand}", file=sys.stderr)
                return cand, links
    return index_url, []


def collect(args) -> list[tuple[str, str, str | None]]:
    """-> [(district_url, vc_html, tcp_html)]"""
    if args.from_html:
        d = Path(args.from_html)
        urls = json.loads((d / "urls.json").read_text())
        out = []
        for url, sub in urls.items():
            slug = url.rstrip("/").split("/")[-1]
            vc, tc = d / f"{slug}.vc.html", d / f"{slug}.2cp.html"
            if vc.exists():
                out.append((url, vc.read_text(encoding="utf-8"),
                            tc.read_text(encoding="utf-8") if tc.exists() else None))
        return out

    session = _session()
    cache_path = Path(args.cache) if args.cache else None
    urls = json.loads(cache_path.read_text()) if cache_path and cache_path.exists() else {}
    if not urls:
        index_url, links = discover(session, args.index)
        if not links:
            raise SystemExit(f"No district results pages found at {args.index} — has the VEC "
                             "published the results index yet? Pass --index with the right URL.")
        print(f"index {index_url}: {len(links)} districts", file=sys.stderr)

        def find(u):
            page = fetch(session, u)
            return u, subpage_links(page, u) if page else {}
        with ThreadPoolExecutor(args.workers) as ex:
            urls = dict(ex.map(find, links))
    else:
        # Districts whose booth tables were not linked yet when first discovered.
        missing = [u for u, sub in urls.items() if not sub.get("vc")]
        for u in missing:
            got_page = fetch(session, u)
            if got_page:
                urls[u] = subpage_links(got_page, u)
    if cache_path:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(json.dumps(urls, indent=1))

    def grab(item):
        url, sub = item
        vc = fetch(session, sub["vc"]) if sub.get("vc") else None
        tc = fetch(session, sub["tcp"]) if sub.get("tcp") else None
        return url, vc, tc
    with ThreadPoolExecutor(args.workers) as ex:
        got = [g for g in ex.map(grab, urls.items()) if g[1]]

    if args.save_html:
        d = Path(args.save_html)
        d.mkdir(parents=True, exist_ok=True)
        (d / "urls.json").write_text(json.dumps(urls, indent=1))
        for url, vc, tc in got:
            slug = url.rstrip("/").split("/")[-1]
            (d / f"{slug}.vc.html").write_text(vc, encoding="utf-8")
            if tc:
                (d / f"{slug}.2cp.html").write_text(tc, encoding="utf-8")
    return got


def carry_forward(seats: list, args) -> list:
    """A district whose pages failed to load this run keeps its last good figures,
    so one timeout on a busy night does not blank a seat or reject the snapshot."""
    prev_path = Path(args.previous) if args.previous else (
        Path(args.out) if args.out != "-" else None)
    if args.reveal is not None or not prev_path or not prev_path.exists():
        return seats
    try:
        prev = json.loads(prev_path.read_text())
    except (OSError, ValueError):
        return seats
    have = {s["seatId"] for s in seats if s}
    kept = [s for s in prev.get("seats", []) if s.get("seatId") not in have]
    for s in kept:
        print(f"WARN {s['seatId']}: not loaded this run — keeping previous figures", file=sys.stderr)
    return [s for s in seats if s] + kept


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--index", default=DEFAULT_INDEX, help="election results index page")
    ap.add_argument("--from-html", help="replay pages saved with --save-html (no network)")
    ap.add_argument("--save-html", help="also save the fetched pages here")
    ap.add_argument("--cache", help="JSON file caching the discovered page URLs between runs")
    ap.add_argument("--workers", type=int, default=4, help="parallel requests (keep small)")
    ap.add_argument("--rehearsal", action="store_true",
                    help="label the output as test data (e.g. replaying 2022 pages)")
    ap.add_argument("--reveal", type=float,
                    help="rehearsal only: show the count as if this fraction (0-1) of the night had passed")
    ap.add_argument("--seed", default="2026", help="randomises which booths --reveal shows first")
    ap.add_argument("--previous",
                    help="last good output; districts that fail to load this run keep "
                         "their figures from it (defaults to --out when that file exists)")
    ap.add_argument("--allow-partial", action="store_true",
                    help="do not fail when districts are missing")
    ap.add_argument("--min-seats", type=int, default=80,
                    help="publish once at least this many districts loaded (the page "
                         "shows the rest as not started); fewer fails the pass")
    ap.add_argument("--out", default="-", help="output path, or - for stdout")
    args = ap.parse_args()
    if args.reveal is not None and not args.rehearsal:
        ap.error("--reveal is only for --rehearsal runs")

    now_iso = datetime.now(timezone.utc).isoformat(timespec="seconds")
    pages = collect(args)
    seats = [build_seat(vc, tc, url, now_iso=now_iso, reveal=args.reveal, seed=args.seed)
             for url, vc, tc in pages]
    seats = carry_forward(seats, args)
    feed = assemble(seats, now_iso=now_iso, rehearsal=args.rehearsal, source="vec-website")

    # A district name that does not join to the 2022 baseline is dropped (with a
    # warning) rather than sinking the whole snapshot; a renamed district needs a
    # baseline fix, but the other 87 should keep updating meanwhile.
    known = core.baseline_seat_ids()
    if known:
        unknown = [s["seatId"] for s in feed["seats"] if s["seatId"] not in known]
        for sid in unknown:
            print(f"WARNING: {sid} is not in the 2022 baseline — left out", file=sys.stderr)
        feed["seats"] = [s for s in feed["seats"] if s["seatId"] not in unknown]
    errors = core.validate(feed)
    for c in core.check_coverage(feed):
        print(f"WARNING: {c}", file=sys.stderr)
    if not (args.allow_partial or args.rehearsal) and len(feed["seats"]) < args.min_seats:
        errors.append(f"only {len(feed['seats'])} districts loaded (need {args.min_seats}) "
                      "— keeping the previous snapshot")
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
        print(f"wrote {dest} ({len(feed['seats'])} seats, {feed['meta']['countedPct']}% counted)",
              file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
