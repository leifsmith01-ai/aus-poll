"""Tests for scripts/fetch_live_vec_web.py (VEC results WEBSITE scraper).

Fixtures in tests/fixtures/vec_web are trimmed copies of real VEC pages
(© Victorian Electoral Commission, CC BY 4.0):
  * nepean-2026.*  — the 2026 page template (Nepean by-election, 2026)
  * bass-2022.*    — the 2022 template, whose 2CP page has a different layout
  * index-2022     — the 2022 results index (district links)
"""

import importlib.util
import re
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(REPO_ROOT / "scripts"))
_spec = importlib.util.spec_from_file_location(
    "fetch_live_vec_web", REPO_ROOT / "scripts" / "fetch_live_vec_web.py")
web = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(web)
core = web.core

FIX = REPO_ROOT / "tests" / "fixtures" / "vec_web"
NOW = "2026-11-28T09:00:00+00:00"
SITE = "https://www.vec.vic.gov.au/results/x"


def page(name):
    return (FIX / name).read_text(encoding="utf-8")


def seat(name, **kw):
    return web.build_seat(page(f"{name}.vc.html"), page(f"{name}.2cp.html"), now_iso=NOW, **kw)


# ── Discovery ─────────────────────────────────────────────────────────────────

def test_index_lists_every_district_page():
    links = web.district_links(page("index-2022.html"), SITE)
    assert len(links) == 87                       # Narracan's 2022 result is published separately
    assert all(link.endswith("-district-results") for link in links)


def test_district_page_links_to_both_booth_tables():
    sub = web.subpage_links(page("nepean-2026.district.html"), SITE)
    assert sub["vc"].endswith("Nepean-District-results-by-voting-centre")
    assert sub["tcp"].endswith("Nepean-2CP-results-by-voting-centre")


# ── 2026 page template ────────────────────────────────────────────────────────

def test_2026_template_first_preferences_and_summary():
    s = seat("nepean-2026")
    assert s["seatId"] == "nepean" and s["name"] == "Nepean"
    assert s["enrolment"] == 50910
    assert s["votesCounted"] == 42586
    assert sum(r["votes"] for r in s["fp"]) == 40545          # formal votes on the page
    fp = {r["name"]: (r["party"], r["votes"]) for r in s["fp"]}
    assert fp["HERCUS, Darren"] == ("ON", 9941)
    assert fp["MARSH, Anthony"] == ("LP", 15682)
    assert fp["HUTCHISON, Tracee"] == ("IND", 8533)           # blank party cell -> independent
    assert s["status"] == "ec_called" and s["elected"] == "LP"


def test_2cp_candidates_take_their_party_from_the_first_preference_table():
    """The 2CP page labels the independent finalist 'Liberal'. Matching by name
    must keep her an independent, or the seat becomes a Liberal v Liberal race."""
    assert "HUTCHISON, Tracee" in page("nepean-2026.2cp.html")
    s = seat("nepean-2026")
    assert s["tcp"]["pair"] == ["LP", "IND"]
    assert s["tcp"]["votes"] == {"LP": 25842, "IND": 14810}
    assert s["tcpState"] == "published"
    flow = s["tcp"]["flow"]
    assert flow["tcp"]["LP"] > flow["fp"]["LP"] and flow["tcp"]["IND"] > flow["fp"]["IND"]


def test_early_votes_shown_only_as_a_section_total_are_kept():
    rows = web.parse_results_table(page("nepean-2026.vc.html"))["rows"]
    parcels, _, _, _ = web.classify_rows(rows)
    assert "vt:early" in parcels                    # from the "Early votes total" row
    assert sum(parcels["vt:early"][:8]) > 15000
    assert {"vt:postal", "vt:absent", "vt:provisional", "vt:marked"} <= set(parcels)
    assert sum(1 for k in parcels if k.startswith("pp:")) == 13


# ── 2022 page template ────────────────────────────────────────────────────────

def test_2022_template_with_two_independents():
    s = seat("bass-2022")
    parties = [r["party"] for r in s["fp"]]
    assert parties.count("IND") == 1 and "IND#2" in parties
    assert s["tcp"]["pair"] == ["ALP", "LP"]      # party names sit in a second header row
    assert s["tcp"]["votes"] == {"ALP": 20912, "LP": 20701}


def test_2022_pages_reproduce_the_2022_booth_baseline():
    """Fed the same election, booth matching must give zero swing."""
    m = seat("bass-2022")["matched"]
    assert m["coverage"] > 99
    for g, pct in m["base"].items():
        proj = pct + 100.0 * (m["now"].get(g, 0) - m["then"].get(g, 0)) / m["formal"]
        assert abs(proj - pct) < 0.1, g


# ── Election-night behaviour ─────────────────────────────────────────────────

def _blank_rows(html, labels):
    """Simulate booths that have not reported: their cells are empty."""
    for label in labels:
        html = re.sub(
            r"(<tr>\s*<td[^>]*>\s*" + re.escape(label) + r"\s*</td>)(.*?)(</tr>)",
            lambda m: m.group(1) + re.sub(r"<td>\s*[\d,]+\s*</td>", "<td></td>", m.group(2)) + m.group(3),
            html, count=1, flags=re.S)
    return html


def _election_night(html, labels):
    html = _blank_rows(html, labels)
    # No member declared yet; the grand-total row reflects only what is counted.
    html = html.replace("Elected member", "Votes counted so far")
    return re.sub(r"(<tr>\s*<td[^>]*>\s*Total first preference votes.*?</tr>)", "", html,
                  count=1, flags=re.S)


def test_partially_counted_page():
    full = seat("bass-2022")
    vc = _election_night(page("bass-2022.vc.html"),
                         ["Bass", "Bayles", "Koo Wee Rup", "Postal votes", "Absent votes"])
    s = web.build_seat(vc, None, now_iso=NOW)
    assert s["status"] == "in_progress" and s["elected"] is None
    assert s["votesCounted"] < full["votesCounted"]
    assert s["boothsReturned"] == full["boothsReturned"] - 5
    assert s["boothsExpected"] == full["boothsExpected"]
    assert s["matched"]["coverage"] < full["matched"]["coverage"]
    assert s["tcp"] is None and s["tcpState"] == "none"       # no 2CP page yet


def test_2cp_candidate_missing_from_first_preferences_is_no_data():
    tcp = page("bass-2022.2cp.html").replace("BROWN, Aaron", "SOMEONE, Else")
    s = web.build_seat(page("bass-2022.vc.html"), tcp, now_iso=NOW)
    assert s["tcp"] is None and s["tcpState"] == "none"


def test_reveal_rehearsal_grows_and_2cp_trails():
    prev = -1
    for f in (0.1, 0.3, 0.6, 1.0):
        s = seat("bass-2022", reveal=f, seed="t")
        assert s["status"] != "ec_called"           # a rehearsal never pre-declares
        assert s["votesCounted"] >= prev
        prev = s["votesCounted"]
        if s["tcp"]:
            assert s["tcp"]["countedPct"] <= s["countedPct"] + 0.01
    assert seat("bass-2022", reveal=0.0, seed="t")["votesCounted"] == 0


def test_assembled_feed_validates_and_carries_attribution():
    feed = web.assemble([seat("bass-2022"), seat("nepean-2026")], now_iso=NOW,
                        rehearsal=True, source="vec-website")
    assert core.validate(feed) == []
    assert feed["meta"]["test"] is True
    assert "Victorian Electoral Commission" in feed["meta"]["attribution"]
    assert feed["meta"]["boothLevel"] is True


def test_reveal_requires_rehearsal(monkeypatch, capsys):
    monkeypatch.setattr(sys, "argv", ["x", "--from-html", str(FIX), "--reveal", "0.5"])
    with pytest.raises(SystemExit):
        web.main()


def test_district_that_fails_to_load_keeps_its_previous_figures(tmp_path):
    import json
    from types import SimpleNamespace
    prev = web.assemble([seat("bass-2022"), seat("nepean-2026")], now_iso=NOW,
                        rehearsal=False, source="vec-website")
    path = tmp_path / "prev.json"
    path.write_text(json.dumps(prev))
    args = SimpleNamespace(previous=str(path), out="-", reveal=None)
    merged = web.carry_forward([seat("nepean-2026"), None], args)
    assert sorted(s["seatId"] for s in merged) == ["bass", "nepean"]
    # ...but a rehearsal replay never mixes in old figures.
    assert len(web.carry_forward([seat("nepean-2026")],
                                 SimpleNamespace(previous=str(path), out="-", reveal=0.5))) == 1
