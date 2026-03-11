"""
AEC/VEC Election Dashboard – Data Pipeline
===========================================

Orchestrates the full pipeline for federal (AEC) or Victorian state (VEC) elections:
  1. Download files from AEC/VEC
  2. Parse into clean Python structures
  3. Load into SQLite database
  4. Export to JSON files for the frontend

Usage examples:
    # Full federal pipeline for 2022 (download → parse → load → export)
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

    # ── Victorian state elections ──────────────────────────────
    # Run VEC pipeline for 2022 VIC state election
    python main.py --state vic --year 202211

    # Multiple VIC elections
    python main.py --state vic --year 202211 201811

    # Skip download (use manually placed VEC Excel files)
    python main.py --state vic --year 202211 --skip-download

    # Export only (database already populated with VEC data)
    python main.py --state vic --year 202211 --export-only
"""

import argparse
import logging
import sys
from pathlib import Path

# ── Pipeline modules ─────────────────────────────────────────────────────────
from pipeline.config import ELECTIONS, VIC_ELECTIONS
from pipeline import download as dl
from pipeline import parse as ps
from pipeline import database as db
from pipeline import export as ex
from pipeline import vec_download as vdl
from pipeline import vec_parse as vps


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


# ── VIC state pipeline ────────────────────────────────────────────────────────

def run_vic_pipeline(
    election_ids: list[int],
    skip_download: bool = False,
    force_download: bool = False,
    export_only: bool = False,
) -> None:
    """Run the full VIC state election pipeline for the given election IDs."""
    logger = logging.getLogger(__name__)

    # Initialise both schemas
    logger.info("Initialising database schemas...")
    db.init_db()
    db.init_vec_schema()

    for election_id in election_ids:
        if election_id not in VIC_ELECTIONS:
            logger.error(
                "Unknown VIC election_id %d. Valid IDs: %s",
                election_id, list(VIC_ELECTIONS.keys())
            )
            logger.error(
                "VIC election IDs use YYYYMM format, e.g. 202211 for November 2022."
            )
            continue

        logger.info("")
        logger.info("━" * 60)
        logger.info("Processing VIC election: %d (%s)",
                    election_id, VIC_ELECTIONS[election_id]["name"])
        logger.info("━" * 60)

        if export_only:
            logger.info("Export-only mode: skipping download and parse.")
            ex.export_vic_election(election_id)
            continue

        # ── Step 1: Download ──────────────────────────────────────────────────
        if skip_download:
            logger.info("Skipping download (using existing files).")
            file_paths = vdl.list_local_vec_files(election_id)
        else:
            logger.info("Step 1: Downloading VEC data files for %d...", election_id)
            file_paths = vdl.download_vec_election(election_id, force=force_download)

        if not file_paths:
            file_paths = vdl.list_local_vec_files(election_id)

        if not file_paths:
            logger.error(
                "No VEC data files found for election %d.\n"
                "  Download options:\n"
                "  1. Run without --skip-download to attempt automatic download.\n"
                "  2. Manually download Excel files from vec.vic.gov.au and place\n"
                "     them in: data/raw/vic/%d/\n"
                "  3. Use The Tally Room (tallyroom.com.au) CSV data — 2022 is free.\n"
                "     Place as: data/raw/vic/%d/tally_room_candidates.csv\n"
                "               data/raw/vic/%d/tally_room_fp.csv\n"
                "               data/raw/vic/%d/tally_room_tcp.csv",
                election_id, election_id, election_id, election_id, election_id
            )
            continue

        logger.info("  Available files: %s", list(file_paths.keys()))

        # ── Step 2: Parse ─────────────────────────────────────────────────────
        logger.info("Step 2: Parsing VEC data files for %d...", election_id)
        parsed = vps.parse_all_vec(file_paths, election_id)

        for key, records in parsed.items():
            logger.info("  %-12s %d records", key, len(records))

        if not parsed["fp"] and not parsed["tcp"]:
            logger.error(
                "No usable data parsed for election %d. "
                "Check that the VEC files are in the expected format.",
                election_id
            )
            continue

        # ── Step 3: Load into database ────────────────────────────────────────
        logger.info("Step 3: Loading into database for election %d...", election_id)

        db.upsert_vic_election(election_id)

        # Load districts (derived from FP or TCP records)
        all_records = parsed["fp"] or parsed["tcp"] or parsed["candidates"]
        db.load_vic_districts(all_records)

        # Load candidates
        cand_records = parsed.get("candidates") or parsed["fp"] or parsed["tcp"]
        db.load_vic_candidates(cand_records)

        if parsed["fp"]:
            db.load_vic_fp(parsed["fp"])
        if parsed["tcp"]:
            db.load_vic_2cp(parsed["tcp"])

        logger.info("Database load complete for election %d.", election_id)

        # ── Step 4: Export to JSON ────────────────────────────────────────────
        logger.info("Step 4: Exporting JSON files for election %d...", election_id)
        ex.export_vic_election(election_id)

        logger.info("VIC pipeline complete for election %d ✓", election_id)

    logger.info("")
    logger.info("All done.")


# ── CLI ───────────────────────────────────────────────────────────────────────

def _parse_args():
    parser = argparse.ArgumentParser(
        description="AEC/VEC Election Dashboard – Data Pipeline",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--state", "-s",
        choices=["federal", "vic"],
        default="federal",
        help=(
            "Which jurisdiction to process. "
            "'federal' uses AEC data (default). "
            "'vic' uses VEC data for the Victorian Legislative Assembly."
        ),
    )
    parser.add_argument(
        "--year", "-y",
        nargs="+",
        type=int,
        default=None,
        help=(
            "Election year(s) / IDs to process. "
            "Federal default: 2022 2019. "
            "VIC IDs use YYYYMM format, e.g. 202211 (Nov 2022). "
            "VIC default: 202211 201811."
        ),
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

    is_vic = args.state == "vic"

    if args.list_files:
        if is_vic:
            ids = args.year or list(VIC_ELECTIONS.keys())
            for eid in ids:
                files = vdl.list_local_vec_files(eid)
                cfg = VIC_ELECTIONS.get(eid, {})
                print(f"\n{eid} ({cfg.get('name', '?')}): {len(files)} file(s)")
                for key, path in files.items():
                    size_kb = Path(path).stat().st_size / 1024
                    print(f"  {key:<28} {Path(path).name}  ({size_kb:.0f} KB)")
        else:
            years = args.year or list(ELECTIONS.keys())
            for year in years:
                files = dl.list_local_files(year)
                print(f"\n{year}: {len(files)}/{len(dl.FILE_TEMPLATES)} files available")
                for key, path in files.items():
                    size_kb = Path(path).stat().st_size / 1024
                    print(f"  {key:<28} {Path(path).name}  ({size_kb:.0f} KB)")
        sys.exit(0)

    if is_vic:
        election_ids = args.year or [202211, 201811]
        run_vic_pipeline(
            election_ids=election_ids,
            skip_download=args.skip_download,
            force_download=args.force_download,
            export_only=args.export_only,
        )
    else:
        years = args.year or [2022, 2019]
        run_pipeline(
            years=years,
            skip_download=args.skip_download,
            force_download=args.force_download,
            export_only=args.export_only,
        )
