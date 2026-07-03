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
