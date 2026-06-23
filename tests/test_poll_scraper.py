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
    merge_into_file,
    normalise_pollster,
    parse_federal,
    parse_fieldwork_date,
    parse_vic,
    scrape_federal,
)

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def federal_html() -> str:
    return (FIXTURES / "wiki_federal.html").read_text(encoding="utf-8")


@pytest.fixture
def vic_html() -> str:
    return (FIXTURES / "wiki_vic.html").read_text(encoding="utf-8")


# ── Date parsing ──────────────────────────────────────────────────────────────
def test_parse_fieldwork_date_handles_range_with_endash():
    assert parse_fieldwork_date("15–17 Mar 2026") == "2026-03-17"


def test_parse_fieldwork_date_handles_single_day():
    assert parse_fieldwork_date("10 Mar 2026") == "2026-03-10"


def test_parse_fieldwork_date_strips_refs():
    assert parse_fieldwork_date("5 Apr 2026[1]") == "2026-04-05"


def test_parse_fieldwork_date_returns_none_on_garbage():
    assert parse_fieldwork_date("not a date") is None


# ── Pollster normalisation ────────────────────────────────────────────────────
def test_normalise_aliases_redbridge():
    assert normalise_pollster("RedBridge") == "RedBridge Group"


def test_normalise_aliases_yougov_partner():
    assert normalise_pollster("YouGov/Public First") == "YouGov"


def test_normalise_canonical_passthrough():
    assert normalise_pollster("Newspoll") == "Newspoll"


def test_normalise_unknown_returns_none():
    assert normalise_pollster("Foo Polling") is None


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
