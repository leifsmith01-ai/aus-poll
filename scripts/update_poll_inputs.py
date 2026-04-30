#!/usr/bin/env python3
"""
Thin orchestrator invoked by .github/workflows/update-polls.yml.

Runs the Wikipedia scrapers in pipeline.poll_scraper and merges any new entries
into data/polls/bludgertrack.json and data/polls/vic_polls.json. Always exits 0
on soft scrape failure so the downstream aggregator step can still run on the
existing curated data.

Usage:
    python scripts/update_poll_inputs.py             # both jurisdictions
    python scripts/update_poll_inputs.py --dry-run   # print, do not write
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from pipeline import poll_scraper                                  # noqa: E402


if __name__ == "__main__":
    sys.exit(poll_scraper._main(sys.argv[1:]))
