.PHONY: help aggregate aggregate-vic aggregate-all odds update test clean

help:
	@echo "aus-poll pipeline targets:"
	@echo "  aggregate      Regenerate data/polls/aggregated.json"
	@echo "  aggregate-vic  Regenerate data/polls/vic_aggregated.json"
	@echo "  aggregate-all  Run both aggregators"
	@echo "  odds           Fetch betting odds (uses env vars or manual fallback)"
	@echo "  update         Full update: aggregate-all + odds"
	@echo "  test           Run Python test suite"
	@echo "  clean          Remove __pycache__ directories"

aggregate:
	python -m pipeline.poll_aggregator

aggregate-vic:
	python -m pipeline.poll_aggregator --state vic

aggregate-all: aggregate aggregate-vic

odds:
	python pipeline/betting_odds.py

update: aggregate-all odds

test:
	python -m pytest tests/ -v

clean:
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null; true
