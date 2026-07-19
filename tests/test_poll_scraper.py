"""
Tests for pipeline/poll_scraper.py.

Uses saved Wikipedia HTML fixtures so no network is touched.
"""

import json
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pipeline import poll_scraper
from pipeline.poll_scraper import (
    STATE_SCRAPER_REGISTRY,
    merge_into_file,
    normalise_pollster,
    parse_federal,
    parse_fieldwork_date,
    parse_state,
    parse_vic,
    scrape_federal,
    scrape_state,
)

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def federal_html() -> str:
    return (FIXTURES / "wiki_federal.html").read_text(encoding="utf-8")


@pytest.fixture
def vic_html() -> str:
    return (FIXTURES / "wiki_vic.html").read_text(encoding="utf-8")


@pytest.fixture
def qld_html() -> str:
    return (FIXTURES / "wiki_qld.html").read_text(encoding="utf-8")


# ── Date parsing ──────────────────────────────────────────────────────────────
def test_parse_fieldwork_date_handles_range_with_endash():
    assert parse_fieldwork_date("15–17 Mar 2026") == "2026-03-17"


def test_parse_fieldwork_date_handles_single_day():
    assert parse_fieldwork_date("10 Mar 2026") == "2026-03-10"


def test_parse_fieldwork_date_strips_refs():
    assert parse_fieldwork_date("5 Apr 2026[1]") == "2026-04-05"


def test_parse_fieldwork_date_returns_none_on_garbage():
    assert parse_fieldwork_date("not a date") is None


# Year-less forms — the current election-year table on Wikipedia omits the
# year from date cells; it is supplied from the section heading.
def test_parse_fieldwork_date_yearless_range_uses_default_year():
    assert parse_fieldwork_date("17–28 June", default_year=2026) == "2026-06-28"


def test_parse_fieldwork_date_yearless_single_day():
    assert parse_fieldwork_date("2 May", default_year=2026) == "2026-05-02"


def test_parse_fieldwork_date_yearless_cross_month_range_uses_end():
    assert parse_fieldwork_date("28 Feb – 3 Mar", default_year=2026) == "2026-03-03"


def test_parse_fieldwork_date_month_only_range_uses_mid_final_month():
    assert parse_fieldwork_date("May – Jun", default_year=2026) == "2026-06-15"


def test_parse_fieldwork_date_yearless_without_default_year_is_none():
    assert parse_fieldwork_date("17–28 June") is None


def test_parse_fieldwork_date_explicit_year_beats_default_year():
    assert parse_fieldwork_date("15–17 Mar 2025", default_year=2026) == "2025-03-17"


# Month-only ranges WITH an explicit year ("May – June 2026") appear on pages
# with no year section headings (QLD 2028 layout) — they must resolve to
# mid-month of the final month without a default_year.
def test_parse_fieldwork_date_month_only_with_year_no_default():
    assert parse_fieldwork_date("May – June 2026") == "2026-06-15"


def test_parse_fieldwork_date_month_only_with_year_cross_year_style():
    assert parse_fieldwork_date("Nov – Dec 2025") == "2025-12-15"


# ── Pollster normalisation ────────────────────────────────────────────────────
def test_normalise_aliases_redbridge():
    assert normalise_pollster("RedBridge") == "RedBridge Group"


def test_normalise_aliases_yougov_partner():
    assert normalise_pollster("YouGov/Public First") == "YouGov"


def test_normalise_canonical_passthrough():
    assert normalise_pollster("Newspoll") == "Newspoll"


def test_normalise_unknown_returns_none():
    assert normalise_pollster("Foo Polling") is None


def test_normalise_joint_badged_redbridge_accent():
    assert normalise_pollster("Redbridge/Accent") == "RedBridge Group"
    assert normalise_pollster("Redbridge/Accent [ 1 ]") == "RedBridge Group"


def test_normalise_joint_badge_with_unknown_partner():
    # Generic slash-split fallback: any single known component matches.
    assert normalise_pollster("Freshwater/AFR") == "Freshwater Strategy"


def test_normalise_event_row_text_is_not_a_pollster():
    assert normalise_pollster(
        "The Liberals retain Nepean in the 2026 Nepean state by-election"
    ) is None


def test_normalise_strips_refs():
    assert normalise_pollster("Newspoll[1]") == "Newspoll"


# ── Federal parser ────────────────────────────────────────────────────────────
def test_parse_federal_extracts_known_pollsters(federal_html):
    records = parse_federal(federal_html)
    pollsters = {r["pollster"] for r in records}
    assert "Newspoll" in pollsters
    assert "RedBridge Group" in pollsters
    assert "YouGov" in pollsters
    assert "Roy Morgan" in pollsters


def test_parse_federal_skips_unknown_pollsters(federal_html):
    records = parse_federal(federal_html)
    pollsters = {r["pollster"] for r in records}
    assert "Foo Polling" not in pollsters
    assert all(p is not None for p in pollsters)


def test_parse_federal_record_shape(federal_html):
    records = parse_federal(federal_html)
    newspoll = next(r for r in records if r["pollster"] == "Newspoll")
    assert newspoll["scope"] == "NAT"
    assert newspoll["date"] == "2026-03-17"
    assert newspoll["alp"] == 36
    assert newspoll["coal"] == 32
    assert newspoll["grn"] == 12
    assert newspoll["on"] == 8
    assert newspoll["tpp"] == 54
    assert newspoll["n"] == 1500
    assert "teal" in newspoll


# ── VIC parser ────────────────────────────────────────────────────────────────
def test_parse_vic_uses_lp_field(vic_html):
    records = parse_vic(vic_html)
    assert records, "expected at least one VIC record"
    sample = records[0]
    assert "lp" in sample
    assert "coal" not in sample
    assert sample["scope"] == "VIC"


def test_parse_vic_extracts_known_pollsters(vic_html):
    records = parse_vic(vic_html)
    pollsters = {r["pollster"] for r in records}
    assert "Newspoll" in pollsters
    assert "Resolve Strategic" in pollsters


def test_parse_vic_yearless_dates_resolve_from_section_heading(vic_html):
    records = parse_vic(vic_html)
    redbridge = next(r for r in records if r["pollster"] == "RedBridge Group")
    assert redbridge["date"] == "2026-06-28"      # "17–28 June" under <h2>2026</h2>
    assert redbridge["alp"] == 26
    assert redbridge["on"] == 27
    assert redbridge["tpp"] == 46


def test_parse_vic_month_only_fieldwork_range(vic_html):
    resolve = [r for r in records_by(vic_html, "Resolve Strategic") if r["date"] == "2026-06-15"]
    assert resolve, "expected Resolve May – Jun poll dated mid-June"
    assert resolve[0]["tpp"] is None              # em-dash 2PP cell → None


def test_parse_vic_cross_month_range(vic_html):
    demos = records_by(vic_html, "DemosAU")
    assert demos[0]["date"] == "2026-03-03"       # "28 Feb – 3 Mar" → end of fieldwork


def test_parse_vic_excludes_breakout_tables(vic_html):
    # The 'Inner Melbourne' regional table carries a poison alp=99 row that
    # must not surface as a statewide poll.
    records = parse_vic(vic_html)
    assert all(r["alp"] != 99 for r in records)
    assert not any(r["pollster"] == "Newspoll" and r["date"] == "2026-06-01"
                   for r in records)


def records_by(html: str, pollster: str) -> list[dict]:
    return [r for r in parse_vic(html) if r["pollster"] == pollster]


# ── QLD parser (section-heading layout, dual 2PP columns) ─────────────────────
def parse_qld(html: str) -> list[dict]:
    return parse_state(html, STATE_SCRAPER_REGISTRY["qld"])


def test_parse_qld_extracts_known_pollsters(qld_html):
    pollsters = {r["pollster"] for r in parse_qld(qld_html)}
    assert "Resolve Strategic" in pollsters
    assert "DemosAU" in pollsters
    assert "RedBridge Group" in pollsters


def test_parse_qld_maps_lnp_field(qld_html):
    records = parse_qld(qld_html)
    assert records
    sample = records[0]
    assert sample["scope"] == "QLD"
    assert "lnp" in sample
    assert "coal" not in sample and "lp" not in sample


def test_parse_qld_prefers_direct_alp_2pp_column(qld_html):
    # The table carries BOTH "2PP vote LNP" (56) and "2PP vote ALP" (44)
    # columns; the ALP figure must be read directly, not inverted from LNP.
    resolve = next(r for r in parse_qld(qld_html) if r["pollster"] == "Resolve Strategic")
    assert resolve["tpp"] == 44.0


def test_parse_qld_month_only_date_with_year(qld_html):
    # "May – June 2026" with no year section heading → mid-June.
    resolve = next(r for r in parse_qld(qld_html) if r["pollster"] == "Resolve Strategic")
    assert resolve["date"] == "2026-06-15"
    assert resolve["on"] == 24.0
    assert resolve["n"] == 868


def test_parse_qld_skips_event_and_election_rows(qld_html):
    records = parse_qld(qld_html)
    # By-election event rows and the "2024 election" baseline row are not polls.
    assert not any(r["date"] == "2026-05-16" for r in records)
    assert not any(r["date"] == "2024-10-26" for r in records)


def test_parse_qld_excludes_substate_and_leadership_tables(qld_html):
    # The 'Inner Brisbane' breakout shares the statewide layout with plausible
    # figures — only the section-heading filter keeps it out.
    records = parse_qld(qld_html)
    assert not any(r["pollster"] == "Newspoll" and r["date"] == "2026-06-01"
                   for r in records)
    assert len(records) == 3


def test_parse_qld_missing_minor_columns_default_to_zero(qld_html):
    demos = next(r for r in parse_qld(qld_html) if r["pollster"] == "DemosAU")
    assert demos["ind"] == 0.0          # "— N/a" cell
    assert demos["tpp"] == 42.0
    assert "kap" not in demos           # KAP intentionally unmapped → residual


# ── State scraper registry / scrape_state ─────────────────────────────────────
def test_registry_covers_all_five_states():
    assert set(STATE_SCRAPER_REGISTRY) == {"vic", "nsw", "qld", "wa", "sa"}
    for state, cfg in STATE_SCRAPER_REGISTRY.items():
        for key in ("urls", "json_path", "scope", "schema", "out_fields", "table_filter"):
            assert key in cfg, f"{state} registry entry missing {key}"
        assert cfg["urls"], f"{state} has no URL candidates"
        assert cfg["scope"] == state.upper()


def test_registry_coalition_fields_per_state():
    assert "np" in STATE_SCRAPER_REGISTRY["nsw"]["out_fields"]
    assert "nat" in STATE_SCRAPER_REGISTRY["wa"]["out_fields"]
    assert "lnp" in STATE_SCRAPER_REGISTRY["qld"]["out_fields"]


def test_scrape_state_missing_page_soft_skips(monkeypatch):
    monkeypatch.setattr(poll_scraper, "fetch_html", lambda *a, **kw: None)
    records, page_found = scrape_state("nsw")
    assert records == []
    assert page_found is False


def test_scrape_state_tries_fallback_urls(monkeypatch, qld_html):
    tried = []

    def fake_fetch(url, *a, **kw):
        tried.append(url)
        return qld_html if len(tried) > 1 else None    # first candidate 404s

    monkeypatch.setattr(poll_scraper, "fetch_html", fake_fetch)
    records, page_found = scrape_state("qld")
    assert page_found is True
    assert len(records) == 3
    assert tried == STATE_SCRAPER_REGISTRY["qld"]["urls"]


def test_parse_vic_via_registry_matches_wrapper(vic_html):
    assert parse_state(vic_html, STATE_SCRAPER_REGISTRY["vic"]) == parse_vic(vic_html)


# ── CLI ───────────────────────────────────────────────────────────────────────
def test_cli_rejects_unknown_state(monkeypatch, capsys):
    with pytest.raises(SystemExit):
        poll_scraper._main(["--states", "tas"])


def test_cli_vic_only_alias_scrapes_only_vic(monkeypatch, tmp_path):
    scraped = []

    def fake_scrape_state(state):
        scraped.append(state)
        return [], True

    monkeypatch.setattr(poll_scraper, "scrape_state", fake_scrape_state)
    monkeypatch.setattr(poll_scraper, "scrape_federal",
                        lambda: pytest.fail("federal must not be scraped"))
    poll_scraper._main(["--vic-only", "--dry-run"])
    assert scraped == ["vic"]


def test_cli_states_all_missing_pages_exits_zero(monkeypatch):
    monkeypatch.setattr(poll_scraper, "scrape_state", lambda s: ([], False))
    assert poll_scraper._main(["--states", "nsw,wa,sa", "--dry-run"]) == 0


def test_cli_default_scrapes_federal_plus_all_states(monkeypatch):
    scraped = []
    monkeypatch.setattr(poll_scraper, "scrape_bludgertrack",
                        lambda: scraped.append("federal") or [{"pollster": "Newspoll"}])
    monkeypatch.setattr(poll_scraper, "scrape_federal",
                        lambda: pytest.fail("Wikipedia fallback must not run when the feed yields records"))
    monkeypatch.setattr(poll_scraper, "scrape_state",
                        lambda s: (scraped.append(s), ([], False))[1])
    assert poll_scraper._main(["--dry-run"]) == 0
    assert scraped == ["federal", "vic", "nsw", "qld", "wa", "sa"]


def test_cli_federal_falls_back_to_wikipedia_when_feed_empty(monkeypatch):
    scraped = []
    monkeypatch.setattr(poll_scraper, "scrape_bludgertrack",
                        lambda: scraped.append("feed") or [])
    monkeypatch.setattr(poll_scraper, "scrape_federal",
                        lambda: scraped.append("wiki") or [{"pollster": "Newspoll"}])
    assert poll_scraper._main(["--federal-only", "--dry-run"]) == 0
    assert scraped == ["feed", "wiki"]


# ── Merge: append-only, dedup by (pollster, date) ─────────────────────────────
def _seed_federal(tmp_path: Path) -> Path:
    path = tmp_path / "bludgertrack.json"
    path.write_text(json.dumps({
        "source": "test",
        "retrieved": "2026-01-01",
        "polls": [
            {
                "scope": "NAT",
                "pollster": "Newspoll",
                "date": "2026-03-17",
                "alp": 99.0,
                "coal": 99.0,
                "grn": 99.0,
                "on": 99.0,
                "teal": 0.0,
                "tpp": 99.0,
                "n": 1,
            }
        ],
    }), encoding="utf-8")
    return path


def test_merge_dedupes_and_preserves_curated(tmp_path):
    path = _seed_federal(tmp_path)
    new_records = [{
        "scope": "NAT",
        "pollster": "Newspoll",
        "date": "2026-03-17",       # SAME key as curated row → must be ignored
        "alp": 36, "coal": 32, "grn": 12, "on": 8, "teal": 0,
        "tpp": 54, "n": 1500,
    }]
    appended = merge_into_file(path, new_records)
    assert appended == 0
    data = json.loads(path.read_text())
    assert len(data["polls"]) == 1
    assert data["polls"][0]["alp"] == 99.0      # untouched, NOT overwritten
    assert data["polls"][0]["tpp"] == 99.0
    # A successful scrape with no new rows still refreshes 'retrieved' so the
    # Data Health Check sees the scrape is alive during quiet polling weeks.
    assert data["retrieved"] != "2026-01-01"


def test_merge_appends_new_records_and_sorts(tmp_path):
    path = _seed_federal(tmp_path)
    new_records = [
        {"scope": "NAT", "pollster": "Roy Morgan", "date": "2026-02-20",
         "alp": 37.5, "coal": 30.5, "grn": 12, "on": 6, "teal": 0,
         "tpp": 56.5, "n": 2500},
        {"scope": "NAT", "pollster": "RedBridge Group", "date": "2026-04-10",
         "alp": 37, "coal": 31, "grn": 11, "on": 9, "teal": 0,
         "tpp": 55.5, "n": 1000},
    ]
    appended = merge_into_file(path, new_records)
    assert appended == 2
    data = json.loads(path.read_text())
    assert len(data["polls"]) == 3
    assert [p["date"] for p in data["polls"]] == sorted(p["date"] for p in data["polls"])
    assert data["retrieved"] != "2026-01-01"    # header refreshed


def test_merge_empty_input_is_noop(tmp_path):
    path = _seed_federal(tmp_path)
    before = path.read_text()
    appended = merge_into_file(path, [])
    assert appended == 0
    assert path.read_text() == before


# ── Soft-fail on network error ────────────────────────────────────────────────
def test_scrape_federal_returns_empty_on_network_error(monkeypatch):
    monkeypatch.setattr(poll_scraper, "fetch_html", lambda *a, **kw: None)
    assert scrape_federal() == []


# ── BludgerTrack XML feed ─────────────────────────────────────────────────────
BLUDGERTRACK_XML = """<?xml version="1.0"?>
<root date="2026-07-14 16:07:59+00:00">
  <leaders>
    <table>
      <point Id="1" start="14/07/2026" end="17/07/2026" median="16/07/2026"
             pollster="Newspoll" mode="Online" scope="NAT" sample="1264">
        <pmSAT>47</pmSAT><pmDIS>47</pmDIS>
      </point>
    </table>
    <table>
      <point Id="1" start="03/05/2025" end="03/05/2025" median="03/05/2025"
             pollster="Election" mode="" scope="NAT" sample="">
        <ALP>34.6</ALP><LNC>31.8</LNC><GRN>12.2</GRN><PHON>6.4</PHON>
        <ALP2>55.2</ALP2><LNC2>44.8</LNC2>
      </point>
      <point Id="2" start="06/07/2026" end="12/07/2026" median="09/07/2026"
             pollster="Roy Morgan" mode="SMS" scope="NAT" sample="1,612">
        <ALP>27.5</ALP><LNC>20</LNC><GRN>12.5</GRN><PHON>28</PHON>
        <ALP2>52.5</ALP2><LNC2>47.5</LNC2>
      </point>
      <point Id="3" start="03/07/2026" end="10/07/2026" median="10/07/2026"
             pollster="YouGov" mode="Online" scope="NAT" sample="1468">
        <ALP>28</ALP><LNC>20</LNC><GRN>12</GRN><PHON>26</PHON>
        <ALP2 /><LNC2 />
      </point>
      <point Id="4" start="03/07/2026" end="10/07/2026" median="10/07/2026"
             pollster="YouGov" mode="Online" scope="Rent" sample="">
        <ALP>30</ALP><LNC>10</LNC><GRN>18</GRN><PHON>22</PHON>
        <ALP2 /><LNC2 />
      </point>
      <point Id="5" start="03/07/2026" end="10/07/2026" median="10/07/2026"
             pollster="YouGov" mode="Online" scope="VIC" sample="">
        <ALP>30</ALP><LNC>22</LNC><GRN>12</GRN><PHON>24</PHON>
        <ALP2 /><LNC2 />
      </point>
    </table>
  </leaders>
</root>
"""


def test_parse_bludgertrack_xml_nat_records():
    records = poll_scraper.parse_bludgertrack_xml(BLUDGERTRACK_XML)
    # NAT voting-intention points only: Election anchor, demographic ("Rent")
    # and state ("VIC") crosstabs are all dropped.
    # Dates are the fieldwork END attribute (the file's keying convention),
    # not the median.
    assert [(r["pollster"], r["date"]) for r in records] == [
        ("Roy Morgan", "2026-07-12"),
        ("YouGov", "2026-07-10"),
    ]
    rm = records[0]
    assert rm["alp"] == 27.5 and rm["coal"] == 20.0 and rm["grn"] == 12.5
    assert rm["on"] == 28.0 and rm["tpp"] == 52.5
    assert rm["n"] == 1612                 # comma-grouped sample parsed
    assert rm["scope"] == "NAT" and rm["teal"] == 0.0


def test_parse_bludgertrack_xml_empty_tpp_is_none():
    records = poll_scraper.parse_bludgertrack_xml(BLUDGERTRACK_XML)
    yg = records[1]
    assert yg["tpp"] is None               # <ALP2 /> empty element
    assert yg["n"] == 1468


def test_parse_bludgertrack_xml_ignores_leadership_table():
    # The leadership table's Newspoll point has no <ALP> children and must not
    # surface as a voting-intention record.
    records = poll_scraper.parse_bludgertrack_xml(BLUDGERTRACK_XML)
    assert all(r["date"] != "2026-07-16" for r in records)


def test_scrape_bludgertrack_returns_empty_on_network_error(monkeypatch):
    monkeypatch.setattr(poll_scraper, "fetch_html", lambda *a, **kw: None)
    assert poll_scraper.scrape_bludgertrack() == []


def test_scrape_bludgertrack_returns_empty_on_bad_xml(monkeypatch):
    monkeypatch.setattr(poll_scraper, "fetch_html", lambda *a, **kw: "<not-xml")
    assert poll_scraper.scrape_bludgertrack() == []


def test_merge_near_days_skips_redated_twin(tmp_path):
    # Existing Newspoll is dated 2026-03-17; the same poll arriving from the
    # feed dated two days earlier must be treated as a duplicate, while a
    # different-pollster record on the same day must not be.
    path = _seed_federal(tmp_path)
    new_records = [
        {"scope": "NAT", "pollster": "Newspoll", "date": "2026-03-15",
         "alp": 34, "coal": 30, "grn": 12, "on": 8, "teal": 0,
         "tpp": 54.0, "n": 1200},
        {"scope": "NAT", "pollster": "Roy Morgan", "date": "2026-03-15",
         "alp": 35, "coal": 30, "grn": 12, "on": 7, "teal": 0,
         "tpp": 55.0, "n": 1500},
    ]
    appended = merge_into_file(path, new_records, near_days=3)
    assert appended == 1
    data = json.loads(path.read_text())
    assert [(p["pollster"], p["date"]) for p in data["polls"]] == [
        ("Roy Morgan", "2026-03-15"),
        ("Newspoll", "2026-03-17"),
    ]


def test_merge_near_days_zero_keeps_old_behaviour(tmp_path):
    path = _seed_federal(tmp_path)
    new_records = [
        {"scope": "NAT", "pollster": "Newspoll", "date": "2026-03-15",
         "alp": 34, "coal": 30, "grn": 12, "on": 8, "teal": 0,
         "tpp": 54.0, "n": 1200},
    ]
    assert merge_into_file(path, new_records) == 1
