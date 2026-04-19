"""
AEC/VEC/State Election Dashboard – Data Pipeline
=================================================

Orchestrates the full pipeline for federal (AEC), Victorian (VEC), or any
other state/territory election:
  1. Download files from the relevant electoral commission
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

    # ── Other state/territory elections ───────────────────────
    # All other states follow the same pattern as VIC above.
    # Supported --state values: nsw, qld, wa, sa, tas, act, nt
    #
    # NSW 2023 election
    python main.py --state nsw --year 202303
    #
    # QLD 2024 election
    python main.py --state qld --year 202410
    #
    # WA 2025 election
    python main.py --state wa --year 202503
    #
    # SA 2022 election
    python main.py --state sa --year 202203
    #
    # TAS 2024 election (Hare-Clark)
    python main.py --state tas --year 202403
    #
    # ACT 2024 election (Hare-Clark)
    python main.py --state act --year 202410
    #
    # NT 2024 election
    python main.py --state nt --year 202408
    #
    # List locally available files for a state
    python main.py --state nsw --list-files
"""

import argparse
import logging
import subprocess
import sys
from pathlib import Path

# ── Pipeline modules ─────────────────────────────────────────────────────────
from pipeline.config import ELECTIONS, VIC_ELECTIONS, STATE_REGISTRY
from pipeline import download as dl
from pipeline import parse as ps
from pipeline import database as db
from pipeline import export as ex
from pipeline import vec_download as vdl
from pipeline import vec_parse as vps
from pipeline import state_download as sdl
from pipeline import state_parse as sps


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


# ── State FP module regeneration ──────────────────────────────────────────────

def regenerate_state_seat_fp_module() -> None:
    """Regenerate webapp/src/data/state_seat_fp.js after state DB changes.

    Called at the end of run_vic_pipeline() and run_state_pipeline() so the
    frontend's per-seat state FP constants always match the current DB. Failure
    here is non-fatal: the state pipeline already succeeded, and the webapp
    will keep using whatever module was last generated.
    """
    logger = logging.getLogger(__name__)
    script = Path(__file__).parent / "scripts" / "generate_state_seat_fp.py"
    out_path = Path(__file__).parent / "webapp" / "src" / "data" / "state_seat_fp.js"
    try:
        subprocess.run(
            [sys.executable, str(script), "--state", "all",
             "--output-module", str(out_path)],
            check=True,
        )
    except Exception as exc:
        logger.warning("Could not regenerate %s: %s", out_path, exc)


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

    logger.info("Regenerating webapp/src/data/state_seat_fp.js ...")
    regenerate_state_seat_fp_module()

    logger.info("")
    logger.info("All done.")


# ── Generic state/territory pipeline ─────────────────────────────────────────

def run_state_pipeline(
    state_ab: str,
    election_ids: list[int],
    skip_download: bool = False,
    force_download: bool = False,
    export_only: bool = False,
) -> None:
    """Run the full pipeline for a non-VIC state/territory election."""
    logger = logging.getLogger(__name__)
    state_ab = state_ab.lower()

    if state_ab not in STATE_REGISTRY:
        logger.error(
            "Unknown state '%s'. Supported states: %s",
            state_ab, list(STATE_REGISTRY)
        )
        sys.exit(1)

    cfg = STATE_REGISTRY[state_ab]
    elections = cfg["elections"]

    # Initialise both the base schema and the state-specific schema
    logger.info("Initialising database schemas...")
    db.init_db()
    db.init_state_schema(state_ab)

    for election_id in election_ids:
        if election_id not in elections:
            logger.error(
                "Unknown %s election_id %d. Valid IDs: %s",
                state_ab.upper(), election_id, list(elections)
            )
            logger.error(
                "%s election IDs use YYYYMM format, e.g. %d.",
                state_ab.upper(), next(iter(elections))
            )
            continue

        logger.info("")
        logger.info("━" * 60)
        logger.info("Processing %s election: %d (%s)",
                    state_ab.upper(), election_id, elections[election_id]["name"])
        logger.info("━" * 60)

        if export_only:
            logger.info("Export-only mode: skipping download and parse.")
            ex.export_state_election(state_ab, election_id)
            continue

        # ── Step 1: Download ──────────────────────────────────────────────────
        if skip_download:
            logger.info("Skipping download (using existing files).")
            file_paths = sdl.list_local_state_files(state_ab, election_id)
        else:
            logger.info("Step 1: Downloading %s data files for %d...",
                        state_ab.upper(), election_id)
            file_paths = sdl.download_state_election(
                state_ab, election_id, force=force_download
            )

        if not file_paths:
            file_paths = sdl.list_local_state_files(state_ab, election_id)

        if not file_paths:
            raw_dir = cfg["raw_dir"]
            logger.error(
                "No data files found for %s %d.\n"
                "  Options:\n"
                "  1. Run without --skip-download to attempt automatic download.\n"
                "  2. Manually download files from %s\n"
                "     and place them in: %s/%d/",
                state_ab.upper(), election_id,
                elections[election_id].get("results_page_url", "the electoral commission website"),
                raw_dir, election_id,
            )
            continue

        logger.info("  Available files: %s", list(file_paths.keys()))

        # ── Step 2: Parse ─────────────────────────────────────────────────────
        logger.info("Step 2: Parsing %s data files for %d...",
                    state_ab.upper(), election_id)
        parsed = sps.parse_state_election(state_ab, file_paths, election_id)

        for key, records in parsed.items():
            logger.info("  %-12s %d records", key, len(records))

        if not parsed["fp"] and not parsed["candidates"]:
            logger.error(
                "No usable data parsed for %s %d. "
                "Check that files are in the expected format.",
                state_ab.upper(), election_id
            )
            continue

        # ── Step 3: Load into database ────────────────────────────────────────
        logger.info("Step 3: Loading into database for %s %d...",
                    state_ab.upper(), election_id)

        db.upsert_state_election(state_ab, election_id)
        db.load_state_districts(state_ab, parsed["districts"] or parsed["fp"] or parsed["candidates"])
        db.load_state_candidates(state_ab, parsed["candidates"])

        if parsed["fp"]:
            db.load_state_fp(state_ab, parsed["fp"])

        hare_clark = cfg["system"] == "hare-clark"
        if hare_clark:
            if parsed["party_seats"]:
                db.load_state_party_seats(state_ab, parsed["party_seats"])
        else:
            if parsed["tcp"]:
                db.load_state_2cp(state_ab, parsed["tcp"])

        # ── Booth-level data (NSW, QLD, WA, SA, NT only) ──────────────────────
        if cfg.get("booth_level") and not hare_clark:
            booth_file_keys = {"polling_places", "booth_fp", "booth_tcp"}
            booth_files = {k: v for k, v in file_paths.items() if k in booth_file_keys}

            if booth_files:
                logger.info("Step 3b: Parsing booth-level data for %s %d...",
                            state_ab.upper(), election_id)
                booth_parsed = sps.parse_state_booths(
                    state_ab, booth_files, election_id,
                    parsed["districts"], parsed["candidates"]
                )

                if booth_parsed["polling_places"]:
                    db.load_state_polling_places(state_ab, booth_parsed["polling_places"])
                if booth_parsed["booth_fp"]:
                    db.load_state_booth_fp(state_ab, booth_parsed["booth_fp"])
                if booth_parsed["booth_2cp"]:
                    db.load_state_booth_2cp(state_ab, booth_parsed["booth_2cp"])
            else:
                logger.info(
                    "No booth-level files found for %s %d. "
                    "To add booth data, place CSV files named 'polling_places', "
                    "'booth_fp', and 'booth_tcp' in data/raw/%s/%d/",
                    state_ab.upper(), election_id, state_ab, election_id
                )

        logger.info("Database load complete for %s %d.", state_ab.upper(), election_id)

        # ── Step 4: Export to JSON ────────────────────────────────────────────
        logger.info("Step 4: Exporting JSON files for %s %d...",
                    state_ab.upper(), election_id)
        ex.export_state_election(state_ab, election_id)

        logger.info("%s pipeline complete for election %d ✓",
                    state_ab.upper(), election_id)

    # Regenerate the per-seat state FP JS module so App.jsx picks up any
    # newly-loaded data without a manual rerun of the generator script.
    logger.info("Regenerating webapp/src/data/state_seat_fp.js ...")
    regenerate_state_seat_fp_module()

    logger.info("")
    logger.info("All done.")


# ── CLI ───────────────────────────────────────────────────────────────────────

def _parse_args():
    parser = argparse.ArgumentParser(
        description="AEC/VEC Election Dashboard – Data Pipeline",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    _state_choices = ["federal", "vic"] + list(STATE_REGISTRY.keys())
    parser.add_argument(
        "--state", "-s",
        choices=_state_choices,
        default="federal",
        help=(
            "Which jurisdiction to process. "
            "'federal' uses AEC data (default). "
            "'vic' uses VEC data for the Victorian Legislative Assembly. "
            "Other supported states: nsw, qld, wa, sa, tas, act, nt. "
            "State election IDs use YYYYMM format (e.g. 202303 for NSW March 2023)."
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
        "--betting",
        action="store_true",
        help=(
            "Fetch/refresh betting odds after the main pipeline. "
            "Uses BETFAIR_APP_KEY/BETFAIR_SESSION_TOKEN if set, else ODDS_API_KEY, "
            "else loads the manual placeholder. "
            "Writes data/polls/betting_odds.json. "
            "Can also be run standalone: python pipeline/betting_odds.py"
        ),
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

    state = args.state.lower()
    is_vic = state == "vic"
    is_federal = state == "federal"
    is_other_state = state in STATE_REGISTRY

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
        elif is_other_state:
            scfg = STATE_REGISTRY[state]
            ids = args.year or list(scfg["elections"].keys())
            for eid in ids:
                files = sdl.list_local_state_files(state, eid)
                ecfg = scfg["elections"].get(eid, {})
                print(f"\n{eid} ({ecfg.get('name', '?')}): {len(files)} file(s)")
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

    if args.betting:
        logger = logging.getLogger(__name__)
        logger.info("Running betting odds fetch...")
        from pipeline.betting_odds import run as run_betting
        run_betting()
        logger.info("Betting odds fetch complete.")

    if is_vic:
        election_ids = args.year or [202211, 201811]
        run_vic_pipeline(
            election_ids=election_ids,
            skip_download=args.skip_download,
            force_download=args.force_download,
            export_only=args.export_only,
        )
    elif is_other_state:
        scfg = STATE_REGISTRY[state]
        default_ids = sorted(scfg["elections"].keys(), reverse=True)[:2]
        election_ids = args.year or default_ids
        run_state_pipeline(
            state_ab=state,
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
