"""
AEC Election Dashboard – Data Pipeline
=======================================

Orchestrates the full pipeline:
  1. Download CSV files from AEC (results.aec.gov.au)
  2. Parse into clean Python structures
  3. Load into SQLite database
  4. Export to JSON files for the frontend

Usage examples:
    # Full pipeline for 2022 (download → parse → load → export)
    python main.py --year 2022

    # Multiple years
    python main.py --year 2019 2022

    # Skip download (use existing files)
    python main.py --year 2022 --skip-download

    # Only export JSONs (database already populated)
    python main.py --year 2022 --export-only

    # Force re-download even if files exist
    python main.py --year 2022 --force-download

    # List locally available files
    python main.py --list-files

    # Verbose logging
    python main.py --year 2022 -v
"""

import argparse
import logging
import sys
from pathlib import Path

# ── Pipeline modules ─────────────────────────────────────────────────────────
from pipeline.config import ELECTIONS
from pipeline import download as dl
from pipeline import parse as ps
from pipeline import database as db
from pipeline import export as ex


# ── Logging setup ─────────────────────────────────────────────────────────────

def setup_logging(verbose: bool = False) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s  %(levelname)-8s  %(message)s",
        datefmt="%H:%M:%S",
        handlers=[
            logging.StreamHandler(sys.stdout),
            logging.FileHandler("pipeline.log", encoding="utf-8"),
        ],
    )


# ── Core pipeline ─────────────────────────────────────────────────────────────

def run_pipeline(
    years: list[int],
    skip_download: bool = False,
    force_download: bool = False,
    export_only: bool = False,
) -> None:
    """Run the full pipeline for the given election years."""

    logger = logging.getLogger(__name__)

    # 1. Initialise database
    logger.info("Initialising database...")
    db.init_db()

    for year in years:
        logger.info("")
        logger.info("━" * 60)
        logger.info("Processing election year: %d", year)
        logger.info("━" * 60)

        # ── Step 1: Download ──────────────────────────────────────────────────
        if export_only:
            logger.info("Export-only mode: skipping download and parse steps.")
            ex.export_election(year)
            continue

        if skip_download:
            logger.info("Skipping download (using existing files).")
            file_paths = dl.list_local_files(year)
            if not file_paths:
                logger.error(
                    "No local files found for %d. Run without --skip-download first.", year
                )
                continue
        else:
            logger.info("Step 1: Downloading AEC data files for %d...", year)
            file_paths = dl.download_election(year, force=force_download)

        if not file_paths:
            logger.error("No files available for %d. Cannot continue.", year)
            continue

        logger.info("  Available files: %s", list(file_paths.keys()))

        # ── Step 2: Parse ─────────────────────────────────────────────────────
        logger.info("Step 2: Parsing CSV files for %d...", year)
        parsed = ps.parse_all(file_paths, election_id=year)

        for key, records in parsed.items():
            logger.info("  %-25s %d records", key, len(records))

        # ── Step 3: Load into database ────────────────────────────────────────
        logger.info("Step 3: Loading into database for %d...", year)

        db.upsert_election(year)

        if "candidates" in parsed:
            db.load_candidates(parsed["candidates"])

        if "polling_places" in parsed:
            db.load_polling_places(parsed["polling_places"])

        if "first_preferences" in parsed:
            db.load_first_preferences(parsed["first_preferences"])

        if "tcp" in parsed:
            db.load_tcp(parsed["tcp"])

        if "dop" in parsed:
            db.load_dop(parsed["dop"])

        logger.info("Database load complete for %d.", year)

        # ── Step 4: Export to JSON ────────────────────────────────────────────
        logger.info("Step 4: Exporting JSON files for %d...", year)
        ex.export_election(year)

        logger.info("Pipeline complete for %d ✓", year)

    logger.info("")
    logger.info("All done.")


# ── CLI ───────────────────────────────────────────────────────────────────────

def _parse_args():
    parser = argparse.ArgumentParser(
        description="AEC Election Dashboard – Data Pipeline",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--year", "-y",
        nargs="+",
        type=int,
        default=[2022, 2019],
        help="Election year(s) to process. Default: 2022 2019",
    )
    parser.add_argument(
        "--skip-download",
        action="store_true",
        help="Skip downloading – use existing files in data/raw/",
    )
    parser.add_argument(
        "--force-download",
        action="store_true",
        help="Re-download all files even if they already exist",
    )
    parser.add_argument(
        "--export-only",
        action="store_true",
        help="Only regenerate JSON exports (database must be populated)",
    )
    parser.add_argument(
        "--list-files",
        action="store_true",
        help="List locally available raw files and exit",
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Enable verbose (DEBUG) logging",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    setup_logging(args.verbose)

    if args.list_files:
        for year in (args.year or list(ELECTIONS.keys())):
            files = dl.list_local_files(year)
            print(f"\n{year}: {len(files)}/{len(dl.FILE_TEMPLATES)} files available")
            for key, path in files.items():
                size_kb = Path(path).stat().st_size / 1024
                print(f"  {key:<28} {Path(path).name}  ({size_kb:.0f} KB)")
        sys.exit(0)

    run_pipeline(
        years=args.year,
        skip_download=args.skip_download,
        force_download=args.force_download,
        export_only=args.export_only,
    )
