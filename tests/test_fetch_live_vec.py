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


# ── Real VEC feed format (EML XML, verbose Lower House) ───────────────────────
# Fixtures are the VEC's published SE2026 sample snapshots (fictitious data,
# 6 districts, 23 snapshots) — the same files the user guide documents.

VEC_DIR = REPO_ROOT / "tests" / "fixtures" / "vec_sample"


def _snap(stamp):
    path = next(p for p in flv.list_vec_snapshots(VEC_DIR) if stamp in p.name)
    return flv.parse_bytes(path.read_bytes(), NOW, "vec-sample")


def _seat(feed, seat_id):
    return next(s for s in feed["seats"] if s["seatId"] == seat_id)


def test_vec_snapshots_listed_oldest_first():
    snaps = flv.list_vec_snapshots(VEC_DIR)
    assert len(snaps) == 23
    assert snaps[0].name.endswith("20260921_090801.zip")
    assert snaps[-1].name.endswith("20261002_175814.zip")


def test_every_vec_snapshot_parses_and_validates():
    baseline = flv.baseline_seat_ids()
    for path in flv.list_vec_snapshots(VEC_DIR):
        feed = flv.parse_bytes(path.read_bytes(), NOW, "vec-sample")
        assert flv.validate(feed) == [], path.name
        assert len(feed["seats"]) == 6
        # District names join to the 2022 baseline once " District" is stripped.
        assert {s["seatId"] for s in feed["seats"]} <= baseline, path.name
        assert feed["meta"]["test"] is True          # "Test State Election 2026"
        for s in feed["seats"]:
            assert sum(r["votes"] for r in s["fp"]) <= s["votesCounted"]


def test_vec_first_preferences_and_party_mapping():
    bass = _seat(_snap("20260926_142544"), "bass")
    assert [(r["party"], r["votes"]) for r in bass["fp"]] == \
        [("IND", 58), ("LP", 51), ("ON", 43), ("ALP", 38)]
    assert bass["enrolment"] == 5000 and bass["votesCounted"] == 206
    # Progress is measured against EXPECTED votes (enrolment x turnout).
    assert bass["countedPct"] == round(100 * 206 / (5000 * flv.EXPECTED_TURNOUT), 2)
    assert bass["boothsReturned"] == 9 and bass["boothsExpected"] == 9


def test_vec_2cp_is_the_vec_pair_with_its_own_progress():
    bass = _seat(_snap("20260926_142544"), "bass")
    assert bass["tcpState"] == "published"
    assert bass["tcp"]["pair"] == ["IND", "ON"]       # not the FP top two (IND, LP)
    assert bass["tcp"]["votes"] == {"IND": 108, "ON": 81}
    assert abs(sum(bass["tcp"]["pct"].values()) - 100) < 0.05
    assert 0 < bass["tcp"]["countedPct"] <= bass["countedPct"]


def test_vec_2cp_absent_withheld_and_empty_are_no_data_not_zero():
    # Not yet entered: element missing.
    assert _seat(_snap("20260921_110713"), "evelyn")["tcp"] is None
    # Maverick="true": VEC is withholding the pair.
    ev = _seat(_snap("20260923_103451"), "evelyn")
    assert ev["tcp"] is None and ev["tcpState"] == "withheld"
    # New pair selected but no votes counted for it yet (0 / 0).
    ev = _seat(_snap("20260926_142544"), "evelyn")
    assert ev["tcp"] is None and ev["tcpState"] == "none"
    # ...and once counted, the recheck pair replaces the old one.
    ev = _seat(_snap("20260926_161339"), "evelyn")
    assert ev["tcp"]["pair"] == ["FFV", "VS"]


def test_vec_counts_may_decrease_and_declared_maps_to_called():
    a = _seat(_snap("20260926_142544"), "evelyn")["votesCounted"]
    b = _seat(_snap("20260927_090112"), "evelyn")["votesCounted"]
    assert b < a                                       # recheck correction
    final = _snap("20261002_175814")
    assert all(s["status"] == "ec_called" for s in final["seats"])
    assert all(s["status"] != "ec_called" for s in _snap("20260930_123510")["seats"])


def test_vec_duplicate_party_codes_stay_unique():
    xml = b"""<MediaFeed xmlns="http://www.vec.vic.gov.au"
      xmlns:eml="urn:oasis:names:tc:evs:schema:eml" Verbose="true" Created="2026-11-28T19:00:00">
     <eml:EventIdentifier Id="1"><eml:EventName>State Election 2026</eml:EventName></eml:EventIdentifier>
     <Election><eml:ElectionIdentifier Id="L"><eml:ElectionCategory>LowerHouse</eml:ElectionCategory>
     </eml:ElectionIdentifier><House><Contests><Contest Updated="2026-11-28T19:00:00+11:00">
      <eml:ContestIdentifier Id="9"><eml:ContestName>Mildura District</eml:ContestName></eml:ContestIdentifier>
      <Declared>false</Declared><Enrolment>1000</Enrolment>
      <FirstPreferences PollingPlacesReturned="1" PollingPlacesExpected="2" Updated="x">
       <Candidate Independent="yes"><eml:CandidateIdentifier Id="1"><eml:CandidateName>A</eml:CandidateName></eml:CandidateIdentifier><Votes>40</Votes></Candidate>
       <Candidate Independent="yes"><eml:CandidateIdentifier Id="2"><eml:CandidateName>B</eml:CandidateName></eml:CandidateIdentifier><Votes>35</Votes></Candidate>
       <Candidate Independent="no"><eml:CandidateIdentifier Id="3"/><Affiliation><eml:AffiliationIdentifier Id="7">
         <eml:RegisteredName>National Party of Australia - Victoria</eml:RegisteredName></eml:AffiliationIdentifier></Affiliation><Votes>25</Votes></Candidate>
       <Formal><Votes>100</Votes></Formal><Informal><Votes>0</Votes></Informal><Total><Votes>100</Votes></Total>
      </FirstPreferences>
      <TwoCandidatePreferred PollingPlacesReturned="1" PollingPlacesExpected="2" Updated="x">
       <Candidate><eml:CandidateIdentifier Id="1"/><Votes>55</Votes></Candidate>
       <Candidate><eml:CandidateIdentifier Id="2"/><Votes>45</Votes></Candidate>
      </TwoCandidatePreferred>
     </Contest></Contests></House></Election></MediaFeed>"""
    feed = flv.normalize_vec_xml(xml, NOW)
    seat = feed["seats"][0]
    assert seat["seatId"] == "mildura"
    assert [r["party"] for r in seat["fp"]] == ["IND", "IND#2", "NP"]
    assert seat["tcp"]["pair"] == ["IND", "IND#2"]     # two independents, still distinct
    assert feed["meta"]["test"] is False
    assert flv.validate(feed) == []


def test_vec_party_codes():
    for name, code in [
        ("Australian Labor Party - Victorian Branch", "ALP"),
        ("Liberal Party of Australia - Victorian Division", "LP"),
        ("National Party of Australia - Victoria", "NP"),
        ("The Australian Greens - Victoria", "GRN"),
        ("Pauline Hanson's One Nation", "ON"),
        ("Liberal Democrats", "LDP"),
        ("Transport Matters Party", "TMP"),
    ]:
        assert flv.party_code(name, False) == code, name
    assert flv.party_code(None, True) == "IND"


def test_partial_feed_fails_coverage_check():
    """A real feed missing districts must not be published as if complete."""
    problems = flv.check_coverage(_snap("20260926_142544"))
    assert any("82 baseline seats missing" in p for p in problems)


def test_lite_file_is_rejected_with_a_clear_message():
    import pytest
    with pytest.raises(SystemExit, match="verboselhv2"):
        flv.normalize_vec_xml(
            b'<MediaFeed xmlns="http://www.vec.vic.gov.au" Verbose="false"/>', NOW)
