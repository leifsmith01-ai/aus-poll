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


def _run_main(monkeypatch, tmp_path, extra):
    out = tmp_path / "out.json"
    monkeypatch.setattr(sys, "argv", ["x", "--from-html", str(tmp_path / "html"), "--out", str(out)] + extra)
    return web.main(), out


def _html_dir(tmp_path, names):
    import json
    d = tmp_path / "html"
    d.mkdir()
    urls = {}
    for slug, fixture in names.items():
        url = f"{SITE}/{slug}"
        urls[url] = {"vc": url + "/vc", "tcp": url + "/2cp"}
        (d / f"{slug}.vc.html").write_text(page(f"{fixture}.vc.html"), encoding="utf-8")
        (d / f"{slug}.2cp.html").write_text(page(f"{fixture}.2cp.html"), encoding="utf-8")
    (d / "urls.json").write_text(json.dumps(urls))


def test_real_run_needs_most_districts_before_publishing(monkeypatch, tmp_path):
    _html_dir(tmp_path, {"bass-district-results": "bass-2022", "nepean-district-results": "nepean-2026"})
    code, out = _run_main(monkeypatch, tmp_path, [])
    assert code == 1 and not out.exists()               # 2 of 88: keep the previous snapshot
    code, out = _run_main(monkeypatch, tmp_path, ["--min-seats", "2"])
    assert code == 0 and out.exists()                   # threshold met: publish, rest not started


def test_unknown_district_is_dropped_not_fatal(monkeypatch, tmp_path, capsys):
    import json
    _html_dir(tmp_path, {"bass-district-results": "bass-2022"})
    renamed = page("nepean-2026.vc.html").replace("Nepean District", "Westernport District")
    (tmp_path / "html" / "x.vc.html").write_text(renamed, encoding="utf-8")
    (tmp_path / "html" / "x.2cp.html").write_text(page("nepean-2026.2cp.html"), encoding="utf-8")
    urls = json.loads((tmp_path / "html" / "urls.json").read_text())
    urls[f"{SITE}/x"] = {"vc": "v", "tcp": "t"}
    (tmp_path / "html" / "urls.json").write_text(json.dumps(urls))
    code, out = _run_main(monkeypatch, tmp_path, ["--min-seats", "1"])
    assert code == 0
    assert [s["seatId"] for s in json.loads(out.read_text())["seats"]] == ["bass"]
    assert "westernport is not in the 2022 baseline" in capsys.readouterr().err


def test_finds_the_results_index_when_the_guessed_address_is_wrong(monkeypatch):
    """Today the VEC's 2026 landing pages link only to voting information; on the
    night a results index appears somewhere under /results/. Discovery must ignore
    the former (no wasted requests) and find the latter wherever it is linked."""
    index = page("index-2022.html").replace("2022-state-election-results", "2026-results-state-election")
    pages = {
        web.STATE_RESULTS: '<a href="/voting/2026-state-election/postal-voting">x</a>'
                           '<a href="/results/state-election-results/state-by-elections-timeline/'
                           'nepean-2026-by-election-results">x</a>',
        web.SITE + "/results": '<a href="/results/state-election/2026-results-state-election">r</a>',
        web.SITE + "/results/state-election/2026-results-state-election": index,
    }
    fetched = []

    def fake_fetch(session, url, tries=3):
        fetched.append(url)
        return pages.get(url)
    monkeypatch.setattr(web, "fetch", fake_fetch)
    url, links = web.discover(None, web.DEFAULT_INDEX)
    assert url.endswith("/2026-results-state-election")
    assert len(links) == 87
    assert not any("/voting/" in u and u != web.SITE + "/voting/2026-state-election" for u in fetched)
    assert not any("by-election" in u for u in fetched)


def test_discovery_before_results_exist_is_cheap_and_empty(monkeypatch):
    calls = []
    monkeypatch.setattr(web, "fetch", lambda s, u, tries=3: calls.append(u) or
                        '<a href="/voting/2026-state-election/find-candidates">x</a>')
    url, links = web.discover(None, web.DEFAULT_INDEX)
    assert links == [] and len(calls) == 4             # the guess + three landing pages


def test_intermittent_page_failures_are_retried_not_dropped(monkeypatch, tmp_path, capsys):
    """GitHub's servers saw ~1 in 8 district pages fail intermittently (silently, as
    404s) in the first rehearsal. Every district must still load, and failures must
    show up in the log."""
    import json
    from types import SimpleNamespace
    district = page("nepean-2026.district.html")
    vc, tcp = page("nepean-2026.vc.html"), page("nepean-2026.2cp.html")
    sub = web.subpage_links(district, SITE)
    seen = {}

    class FlakySession:
        def get(self, url, timeout=30):
            seen[url] = seen.get(url, 0) + 1
            # The first two requests for every booth page fail; districts load.
            if url in (sub["vc"], sub["tcp"]) and seen[url] <= 2:
                return SimpleNamespace(status_code=404, text="",
                                       raise_for_status=lambda: (_ for _ in ()).throw(RuntimeError("404")))
            body = vc if url == sub["vc"] else tcp if url == sub["tcp"] else district
            return SimpleNamespace(status_code=200, text=body, raise_for_status=lambda: None)

    monkeypatch.setattr(web, "_session", lambda: FlakySession())
    monkeypatch.setattr(web.time, "sleep", lambda s: None)
    cache = tmp_path / "urls.json"
    cache.write_text(json.dumps({SITE + "/nepean-district-results": {}}))   # links not yet known
    args = SimpleNamespace(from_html=None, cache=str(cache), index="unused", workers=3, save_html=None)
    got = web.collect(args)
    assert len(got) == 1 and "HERCUS, Darren" in got[0][1]
    err = capsys.readouterr().err
    assert "loaded 1/1 districts" in err
    assert json.loads(cache.read_text())[SITE + "/nepean-district-results"]["vc"] == sub["vc"]


def test_finds_the_2026_style_results_address(monkeypatch):
    """On election night the VEC published at /results/2026-results/district-election-page,
    not the 2022 pattern. Discovery must follow that link from the landing pages and skip
    the Upper House (region) page."""
    index = page("index-2022.html").replace("/results/state-election-results/2022-state-election-results",
                                            "/results/2026-results/district-election-page")
    pages = {
        web.STATE_RESULTS: '<a href="/results/2026-results/region-election-page">u</a>'
                           '<a href="/results/2026-results/district-election-page">l</a>',
        web.SITE + "/results/2026-results/district-election-page": index,
    }
    monkeypatch.setattr(web, "fetch", lambda s, u, tries=3, missing_ok=True: pages.get(u))
    url, links = web.discover(None, web.STATE_RESULTS + "/2026-state-election-results")
    assert url.endswith("/2026-results/district-election-page")
    assert len(links) == 87


def test_successful_candidate_label_marks_a_declared_seat():
    """2026 pages label the winner "Successful candidate", with placeholder text until
    the seat is declared."""
    waiting = ('<div id="main"><h1>Bass District results</h1><p>Successful candidate</p>'
               "<p>The successful candidate's name will display here when we know the result for Bass District.</p>"
               "<p>Total enrolled voters:</p><p>57,998</p></div>")
    assert web.parse_summary(waiting)["elected"] is None
    assert web.parse_summary(waiting)["enrolment"] == 57998
    declared = waiting.replace("<p>The successful candidate's name will display here when we know the result for Bass District.</p>",
                               "<p>HALSTEAD, Rochelle</p>")
    assert web.parse_summary(declared)["elected"] == "HALSTEAD, Rochelle"
