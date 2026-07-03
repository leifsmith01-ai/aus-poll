"""Tests for scripts/fetch_live_vec.py (election-night VEC feed normalizer)."""

import importlib.util
import json
import re
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent
_spec = importlib.util.spec_from_file_location(
    "fetch_live_vec", REPO_ROOT / "scripts" / "fetch_live_vec.py")
flv = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(flv)

NOW = "2026-11-28T09:00:00+00:00"


def generic_payload():
    return {"districts": [
        {"districtName": "Albert Park", "percentCounted": "42.5",
         "electorsEnrolled": 45000,
         "candidates": [
             {"ballotName": "TAYLOR, Nina", "partyCode": "ALP", "voteCount": "9,120"},
             {"ballotName": "SMITH, Jo", "partyCode": "LIB", "voteCount": 8100},
             {"ballotName": "GREEN, Sam", "partyCode": "AGV", "voteCount": 3300}],
         "twoCandidatePreferred": [
             {"ballotName": "TAYLOR, Nina", "partyCode": "ALP", "voteCount": 11500},
             {"ballotName": "SMITH, Jo", "partyCode": "LIB", "voteCount": 9020}]},
        {"districtName": "Mildura", "percentCounted": 0,
         "candidates": [], "twoCandidatePreferred": []},
    ]}


def test_slugify_matches_contract_js():
    """The seatId join key must be produced identically to contract.js."""
    contract = (REPO_ROOT / "webapp" / "src" / "live" / "contract.js").read_text()
    assert 'replace(/\\(.*?\\)/g, "")' in contract   # same paren-stripping step
    assert flv.slugify("Albert Park") == "albert_park"
    assert flv.slugify("Narracan (Alp V Nat)") == "narracan"
    assert flv.slugify("  Mount Waverley ") == "mount_waverley"


def test_normalize_generic_district_shape():
    feed = flv.normalize(generic_payload(), NOW)
    assert feed["contractVersion"] == 1
    assert feed["meta"]["jurisdiction"] == "vic"
    ap, mildura = feed["seats"]
    assert ap["seatId"] == "albert_park"
    assert ap["countedPct"] == 42.5
    # Party codes mapped to dashboard codes; comma-separated votes parsed.
    assert [(r["party"], r["votes"]) for r in ap["fp"]] == \
        [("ALP", 9120), ("LP", 8100), ("GRN", 3300)]
    # 2CP pct computed from votes when absent.
    assert ap["tcp"]["pair"] == ["ALP", "LP"]
    assert abs(ap["tcp"]["pct"]["ALP"] - 56.04) < 0.01
    assert mildura["status"] == "not_started"


def test_normalize_contract_shape_passthrough():
    contract = {"contractVersion": 1, "meta": {"jurisdiction": "vic"},
                "seats": [{"seatId": "x", "countedPct": 1, "fp": []}]}
    assert flv.normalize(contract, NOW) is contract


def test_normalize_rejects_unknown_shape():
    import pytest
    with pytest.raises(SystemExit):
        flv.normalize({"foo": "bar"}, NOW)


def test_degenerate_tcp_is_dropped_not_fatal():
    payload = generic_payload()
    payload["districts"][0]["twoCandidatePreferred"] = [
        {"partyCode": "ALP", "voteCount": 10},
        {"partyCode": "ALP", "voteCount": 5},      # same party twice
    ]
    feed = flv.normalize(payload, NOW)
    assert feed["seats"][0]["tcp"] is None
    assert flv.validate(feed) == []


def test_validate_flags_bad_feed():
    bad = {"contractVersion": 1, "meta": {},
           "seats": [{"seatId": "a", "countedPct": 250, "fp": []},
                     {"seatId": "a", "countedPct": 10, "fp": []}]}
    errors = flv.validate(bad)
    assert any("bad countedPct" in e for e in errors)
    assert any("duplicate seatId" in e for e in errors)


def test_replay_snapshots_are_valid_and_seatids_match_baseline():
    baseline = json.loads(
        (REPO_ROOT / "webapp" / "public" / "live" / "baseline-vic-2026.json").read_text())
    for name in flv.REPLAY_SEQUENCE:
        feed = json.loads((flv.SAMPLE_DIR / name).read_text())
        assert flv.validate(feed) == [], name
        ids = {s["seatId"] for s in feed["seats"]}
        assert ids == set(baseline["seats"]), name


def test_party_map_covers_vec_codes():
    for raw, mapped in [("LIB", "LP"), ("NAT", "NP"), ("AGV", "GRN"),
                        ("ONP", "ON"), ("IND", "IND"), ("ALP", "ALP")]:
        assert flv.map_party(raw) == mapped
    # Unknown codes pass through (truncated) rather than crashing.
    assert flv.map_party("SFF") == "SFF"
    assert re.match(r"^[A-Z]", flv.map_party("weird party"))
