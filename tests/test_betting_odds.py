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

from pipeline.betting_odds import _select_federal_sport_keys, remove_overround


SPORTS_NO_AU = [
    {"key": "politics_us_presidential_election_winner", "group": "Politics",
     "title": "US Presidential Election Winner"},
    {"key": "soccer_australia_aleague", "group": "Soccer", "title": "A-League"},
    {"key": "aussierules_afl", "group": "Aussie Rules", "title": "AFL"},
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
