#!/usr/bin/env python3
"""
download_state_data.py
======================
Standalone script to download all state election CSV files needed for the
metro/regional swing calibration.

Run this from your LOCAL terminal (NOT inside Cowork) so it can reach the
electoral commission websites without the proxy restriction:

    cd /path/to/aus-poll
    python scripts/download_state_data.py

    # Single state only:
    python scripts/download_state_data.py --state qld

    # Force re-download even if files already exist:
    python scripts/download_state_data.py --force

States and elections downloaded:
  NSW: 201503 (2015), 201903 (2019), 202303 (2023)
  QLD: 201711 (2017), 202010 (2020), 202410 (2024)
  WA:  201703 (2017), 202103 (2021), 202503 (2025)
  SA:  201403 (2014), 201803 (2018), 202203 (2022)
  NT:  201608 (2016), 202008 (2020), 202408 (2024)

Files are placed in data/raw/{state}/{election_id}/ so the pipeline can be
run afterwards with --skip-download:
    python main.py --state nsw --year 201503 201903 202303 --skip-download
"""

import argparse
import logging
import sys
from pathlib import Path

# Add repo root to path so we can import pipeline modules
ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

# ── Elections to download per state ──────────────────────────────────────────

TARGETS: dict[str, list[int]] = {
    "nsw": [201503, 201903, 202303],
    "qld": [201711, 202010, 202410],
    "wa":  [201703, 202103, 202503],
    "sa":  [201403, 201803, 202203],
    "nt":  [201608, 202008, 202408],
}

# ── Downloader dispatch ───────────────────────────────────────────────────────

def download_state(state: str, election_ids: list[int], force: bool = False) -> None:
    from pipeline.state_download import (
        download_nsw_election,
        download_qld_election,
        download_wa_election,
        download_sa_election,
        download_nt_election,
    )

    dispatchers = {
        "nsw": download_nsw_election,
        "qld": download_qld_election,
        "wa":  download_wa_election,
        "sa":  download_sa_election,
        "nt":  download_nt_election,
    }

    fn = dispatchers.get(state)
    if fn is None:
        logger.error("No downloader for state '%s'", state)
        return

    for eid in election_ids:
        logger.info("━" * 60)
        logger.info("Downloading %s %d ...", state.upper(), eid)
        try:
            files = fn(eid, force=force)
            if files:
                logger.info("  Got %d file(s):", len(files))
                for role, path in files.items():
                    logger.info("    [%s] %s", role, Path(path).name)
            else:
                logger.warning("  No files retrieved for %s %d", state.upper(), eid)
        except Exception as exc:
            logger.error("  Failed: %s", exc)

# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Download state election CSV files for swing calibration."
    )
    parser.add_argument(
        "--state", "-s",
        choices=list(TARGETS) + ["all"],
        default="all",
        help="State to download (default: all)",
    )
    parser.add_argument(
        "--force", "-f",
        action="store_true",
        help="Re-download even if files already exist",
    )
    args = parser.parse_args()

    states = list(TARGETS) if args.state == "all" else [args.state]

    logger.info("Downloading election data for: %s", ", ".join(s.upper() for s in states))
    logger.info("Output root: %s/data/raw/", ROOT)

    for state in states:
        download_state(state, TARGETS[state], force=args.force)

    logger.info("━" * 60)
    logger.info("Done. Now run the pipeline with --skip-download, e.g.:")
    for state in states:
        eids = " ".join(str(e) for e in TARGETS[state])
        logger.info("  python main.py --state %s --year %s --skip-download", state, eids)


if __name__ == "__main__":
    main()
