"""
Download AEC election data files.

AEC CSV files live at:
  https://results.aec.gov.au/{event_id}/Website/Downloads/{filename}

Each file starts with a metadata row (GeneratedDate), then a blank row,
then the actual column headers, then data rows.

Usage:
    python -m pipeline.download --year 2022
    python -m pipeline.download --year 2019 2022
"""

import os
import time
import logging
import argparse
import requests
from pathlib import Path
from typing import Optional

from .config import ELECTIONS, FILE_TEMPLATES, DATA_RAW_DIR

logger = logging.getLogger(__name__)

# How long to pause between requests to be polite to AEC servers
REQUEST_DELAY_SECONDS = 1.0

# Timeout for HTTP requests
REQUEST_TIMEOUT = 60


def get_raw_dir(year: int) -> Path:
    """Return (and create) the raw data directory for a given election year."""
    path = Path(DATA_RAW_DIR) / str(year)
    path.mkdir(parents=True, exist_ok=True)
    return path


def download_file(
    url: str,
    dest_path: Path,
    force: bool = False,
    session: Optional[requests.Session] = None,
) -> bool:
    """
    Download a single file from ``url`` to ``dest_path``.

    Returns True on success, False on failure.
    Skips the download if the file already exists and force=False.
    """
    if dest_path.exists() and not force:
        logger.info("  ✓ Already downloaded: %s", dest_path.name)
        return True

    requester = session or requests
    try:
        logger.info("  ↓ Downloading: %s", url)
        response = requester.get(url, timeout=REQUEST_TIMEOUT, stream=True)
        response.raise_for_status()

        with open(dest_path, "wb") as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)

        size_kb = dest_path.stat().st_size / 1024
        logger.info("    → Saved %s (%.1f KB)", dest_path.name, size_kb)
        return True

    except requests.HTTPError as e:
        logger.warning("    ✗ HTTP error for %s: %s", url, e)
        # Clean up partial download
        if dest_path.exists():
            dest_path.unlink()
        return False

    except requests.RequestException as e:
        logger.warning("    ✗ Request failed for %s: %s", url, e)
        if dest_path.exists():
            dest_path.unlink()
        return False


def download_election(year: int, force: bool = False) -> dict:
    """
    Download all standard CSV files for an election year.

    Returns a dict of {file_key: local_path} for successfully downloaded files.
    """
    if year not in ELECTIONS:
        raise ValueError(
            f"Year {year} not configured. Available: {list(ELECTIONS.keys())}"
        )

    election = ELECTIONS[year]
    event_id = election["event_id"]
    base_url = election["results_base_url"]
    dest_dir = get_raw_dir(year)

    logger.info("=" * 60)
    logger.info("Downloading %s (event_id=%s)", election["name"], event_id)
    logger.info("Destination: %s", dest_dir)
    logger.info("=" * 60)

    downloaded = {}
    session = requests.Session()
    session.headers.update({
        "User-Agent": "AEC-Election-Dashboard/1.0 (research; contact via GitHub)"
    })

    for file_key, template in FILE_TEMPLATES.items():
        filename = template.format(event_id=event_id)
        url = f"{base_url}/{filename}"
        dest_path = dest_dir / filename

        success = download_file(url, dest_path, force=force, session=session)
        if success:
            downloaded[file_key] = str(dest_path)

        # Be polite to AEC servers
        time.sleep(REQUEST_DELAY_SECONDS)

    logger.info(
        "Downloaded %d/%d files for %d", len(downloaded), len(FILE_TEMPLATES), year
    )
    return downloaded


def download_all(years: list[int] = None, force: bool = False) -> dict:
    """
    Download data for all configured elections (or a subset).

    Returns nested dict: {year: {file_key: local_path}}
    """
    if years is None:
        years = list(ELECTIONS.keys())

    results = {}
    for year in years:
        results[year] = download_election(year, force=force)

    return results


def list_local_files(year: int) -> dict:
    """Return a dict of {file_key: path} for all locally-present files."""
    if year not in ELECTIONS:
        return {}

    event_id = ELECTIONS[year]["event_id"]
    dest_dir = get_raw_dir(year)
    found = {}

    for file_key, template in FILE_TEMPLATES.items():
        filename = template.format(event_id=event_id)
        path = dest_dir / filename
        if path.exists():
            found[file_key] = str(path)

    return found


# ── CLI entry point ───────────────────────────────────────────────────────────

def _parse_args():
    parser = argparse.ArgumentParser(
        description="Download AEC election CSV files"
    )
    parser.add_argument(
        "--year",
        nargs="+",
        type=int,
        default=list(ELECTIONS.keys()),
        help=f"Election year(s) to download. Default: all ({list(ELECTIONS.keys())})",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-download files even if they already exist locally",
    )
    parser.add_argument(
        "--list",
        action="store_true",
        help="List locally available files without downloading",
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Enable verbose logging",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )

    if args.list:
        for year in args.year:
            files = list_local_files(year)
            print(f"\n{year}: {len(files)}/{len(FILE_TEMPLATES)} files present")
            for key, path in files.items():
                size_kb = Path(path).stat().st_size / 1024
                print(f"  {key:25s} {Path(path).name} ({size_kb:.0f} KB)")
    else:
        download_all(years=args.year, force=args.force)
