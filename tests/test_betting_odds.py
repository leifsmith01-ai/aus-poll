"""
Tests for pipeline/betting_odds.py market selection and fallback handling.

Regression: with no Australian market listed on The Odds API, the federal
market selection fell back to "anything in the politics group" and picked
politics_us_presidential_election_winner, whose odds request then failed with
a 422 and aborted the whole fetch (including Australian state markets).
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest

from pipeline.betting_odds import (
    _classify_party,
    _parse_smarkets_market,
    _select_federal_sport_keys,
    _smarkets_mid_prob,
    remove_overround,
)


SPORTS_NO_AU = [
    {"key": "politics_us_presidential_election_winner", "group": "Politics",
     "title": "US Presidential Election Winner"},
    {"key": "soccer_australia_aleague", "group": "Soccer", "title": "A-League"},
    {"key": "aussierules_afl", "group": "Aussie Rules", "title": "AFL"},
    # Regression: the Australian Open matched an "any Australian sport" fallback
    # and got selected as the federal election market.
    {"key": "tennis_atp_aus_open_singles", "group": "Tennis",
     "title": "Australian Open"},
]

SPORTS_WITH_AU = SPORTS_NO_AU + [
    {"key": "politics_au_federal_election", "group": "Politics",
     "title": "Australian Federal Election"},
]


class TestSelectFederalSportKeys:
    def test_never_selects_foreign_politics_markets(self):
        # The exact failure mode that hit CI: US presidential market selected
        # when no Australian election market was listed.
        keys = _select_federal_sport_keys(SPORTS_NO_AU)
        assert "politics_us_presidential_election_winner" not in keys

    def test_never_selects_australian_open_tennis(self):
        # Second failure mode: with no AU election market listed, the broad
        # Australia-only fallback picked Australian Open tennis every day.
        assert _select_federal_sport_keys(SPORTS_NO_AU) == []

    def test_selects_australian_election_market(self):
        keys = _select_federal_sport_keys(SPORTS_WITH_AU)
        assert keys[0] == "politics_au_federal_election"

    def test_empty_sports_list(self):
        assert _select_federal_sport_keys([]) == []


class TestRemoveOverround:
    def test_probabilities_sum_to_one(self):
        probs = remove_overround({"ALP": 1.60, "Coalition": 2.60})
        assert abs(sum(probs.values()) - 1.0) < 1e-9
        assert probs["ALP"] > probs["Coalition"]


class TestSmarketsMidProb:
    def test_two_sided_book_uses_midpoint(self):
        # Smarkets prices are basis points of probability: 10000 = 100%
        quote = {"bids": [{"price": 5495}], "offers": [{"price": 6329}]}
        assert _smarkets_mid_prob(quote) == pytest.approx(0.5912)

    def test_one_sided_book_uses_available_side(self):
        assert _smarkets_mid_prob({"bids": [{"price": 2500}], "offers": []}) == pytest.approx(0.25)
        assert _smarkets_mid_prob({"bids": [], "offers": [{"price": 4237}]}) == pytest.approx(0.4237)

    def test_empty_book_returns_none(self):
        assert _smarkets_mid_prob({"bids": [], "offers": []}) is None
        assert _smarkets_mid_prob({}) is None


class TestParseSmarketsMarket:
    # Shape taken from the live VIC 2026 "Winning Party" market
    CONTRACTS = [
        {"id": 1, "name": "Labor"},
        {"id": 2, "name": "Coalition"},
        {"id": 3, "name": "Any Other"},
    ]
    QUOTES = {
        "1": {"bids": [{"price": 2500}], "offers": [{"price": 4237}]},
        "2": {"bids": [{"price": 5495}], "offers": [{"price": 6329}]},
        "3": {"bids": [{"price": 370}], "offers": [{"price": 2128}]},
    }

    def test_probabilities_normalised(self):
        parsed = _parse_smarkets_market(self.CONTRACTS, self.QUOTES)
        assert parsed is not None
        assert sum(v["implied_prob"] for v in parsed.values()) == pytest.approx(1.0, abs=1e-3)
        assert parsed["Coalition"]["implied_prob"] > parsed["Labor"]["implied_prob"]

    def test_decimal_odds_are_inverse_probability(self):
        parsed = _parse_smarkets_market(self.CONTRACTS, self.QUOTES)
        for v in parsed.values():
            assert v["decimal_odds"] == pytest.approx(1 / v["implied_prob"], rel=0.01)

    def test_unquoted_contracts_skipped_and_single_contract_rejected(self):
        quotes = {"1": {"bids": [{"price": 5000}], "offers": []}}
        assert _parse_smarkets_market(self.CONTRACTS, quotes) is None


class TestClassifyParty:
    def test_party_groups(self):
        assert _classify_party("Labor") == "alp"
        assert _classify_party("Coalition") == "coalition"
        assert _classify_party("Liberal/National Coalition") == "coalition"
        assert _classify_party("The Greens") == "greens"
        assert _classify_party("Any Other Result") == "other"


# ── Seat-level odds CSV ───────────────────────────────────────────────────────

from pipeline.betting_odds import (  # noqa: E402
    VIC_SEAT_ODDS_CSV,
    classify_seat_party,
    load_seat_odds,
)
from pipeline.config import VIC_DISTRICTS  # noqa: E402

SEAT_CSV_HEADER = "district,party,candidate,decimal_odds,bookmaker,as_of\n"


def _write(tmp_path, body):
    p = tmp_path / "seat_odds.csv"
    p.write_text("# a comment line\n" + SEAT_CSV_HEADER + body, encoding="utf-8")
    return p


def test_classify_seat_party():
    assert classify_seat_party("Labor") == "alp"
    assert classify_seat_party("Liberal Party") == "coalition"
    assert classify_seat_party("The Nationals") == "coalition"
    # "One Nation" must not be read as the Nationals.
    assert classify_seat_party("One Nation") == "one_nation"
    assert classify_seat_party("Greens") == "greens"
    assert classify_seat_party("Independent") == "ind"
    assert classify_seat_party("Legalise Cannabis") == "crossbench"


def test_seat_odds_remove_overround(tmp_path):
    p = _write(tmp_path, "Bass,Liberal,A,1.50,BookA,2026-11-10\nBass,Labor,B,2.50,BookA,2026-11-10\n")
    seats, problems = load_seat_odds(p, ["Bass"])
    assert problems == []
    runners = seats["Bass"]["runners"]
    assert sum(r["implied_prob"] for r in runners) == pytest.approx(1.0, abs=1e-3)
    # 1/1.5 = 0.667, 1/2.5 = 0.400 → 0.625 / 0.375 once the 6.7% margin is removed.
    assert runners[0]["group"] == "coalition"
    assert runners[0]["implied_prob"] == pytest.approx(0.625, abs=1e-3)
    assert seats["Bass"]["favourite_group"] == "coalition"


def test_seat_odds_average_bookmakers_and_keep_best_price(tmp_path):
    p = _write(tmp_path, (
        "Bass,Liberal,A,1.50,BookA,2026-11-10\nBass,Labor,B,2.50,BookA,2026-11-10\n"
        "Bass,Liberal,A,2.00,BookB,2026-11-12\nBass,Labor,B,2.00,BookB,2026-11-12\n"
    ))
    seats, _ = load_seat_odds(p, ["Bass"])
    lib = next(r for r in seats["Bass"]["runners"] if r["group"] == "coalition")
    assert lib["implied_prob"] == pytest.approx((0.625 + 0.5) / 2, abs=1e-3)
    assert lib["decimal_odds"] == 2.0
    assert seats["Bass"]["bookmakers"] == ["BookA", "BookB"]
    assert seats["Bass"]["as_of"] == "2026-11-12"


def test_seat_odds_report_bad_rows(tmp_path):
    p = _write(tmp_path, (
        "Bas,Liberal,A,1.50,BookA,2026-11-10\n"        # misspelt district
        "Bass,Liberal,A,abc,BookA,2026-11-10\n"        # not a price
        "Kew,Liberal,A,1.04,BookA,2026-11-10\n"        # only one runner
    ))
    seats, problems = load_seat_odds(p, ["Bass", "Kew"])
    assert seats == {}
    assert len(problems) == 3


def test_config_lists_88_vic_districts():
    assert len(VIC_DISTRICTS) == 88 == len(set(VIC_DISTRICTS))


def test_committed_vic_seat_odds_are_clean():
    """The CSV in the repo must load without a single skipped row."""
    seats, problems = load_seat_odds(VIC_SEAT_ODDS_CSV, VIC_DISTRICTS)
    assert problems == []
    for market in seats.values():
        assert sum(r["implied_prob"] for r in market["runners"]) == pytest.approx(1.0, abs=2e-3)
