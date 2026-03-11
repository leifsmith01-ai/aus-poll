"""
VEC (Victorian Electoral Commission) data downloader.

The VEC publishes election results at vec.vic.gov.au in Excel (.xlsx) format.
Unlike the AEC, the VEC does not have standardised file URLs or an event-ID system.
This module:
  1. Fetches the VEC results page for a given election year.
  2. Discovers Excel download links on that page.
  3. Downloads the Excel files into data/raw/vic/{election_id}/.

Manual fallback:
  If automatic discovery fails (e.g. VEC changes their page structure),
  place the .xlsx files manually in data/raw/vic/{election_id}/ and re-run
  with --skip-download.  The expected filenames are described below.

Expected files (at least one required):
  • *first*preference* or *fp*.xlsx  — First preferences by district × candidate
  • *two*candidate* or *tcp*.xlsx    — 2CP (two-candidate preferred) by district
  • *results*.xlsx                   — Combined results (first pref + 2CP in one file)

The Tally Room (tallyroom.com.au) also provides well-structured booth-level
data for VIC elections. The 2022 data is available free; earlier elections
require a Patreon subscription ($5/month as of 2026). If you have access,
place the Tally Room CSVs in data/raw/vic/{election_id}/ with filenames:
  • tally_room_candidates.csv
  • tally_room_polling_places.csv
  • tally_room_results.csv
"""

import logging
import time
from pathlib import Path

import requests

from .config import VIC_ELECTIONS, VIC_RAW_DIR

logger = logging.getLogger(__name__)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; aus-poll-bot/1.0; "
        "+https://github.com/leifsmith01-ai/aus-poll)"
    )
}

REQUEST_DELAY = 1.5  # seconds between requests (politeness)


# ── Directory helpers ─────────────────────────────────────────────────────────

def _raw_dir(election_id: int) -> Path:
    """Return (and create) the raw data directory for a VIC election."""
    d = Path(VIC_RAW_DIR) / str(election_id)
    d.mkdir(parents=True, exist_ok=True)
    return d


# ── Discover Excel links on VEC results page ──────────────────────────────────

def _fetch_excel_links(page_url: str) -> list[str]:
    """
    Fetch a VEC results page and extract any .xlsx/.xls download URLs.
    Returns a list of absolute URLs.
    """
    try:
        resp = requests.get(page_url, headers=HEADERS, timeout=30)
        resp.raise_for_status()
    except requests.RequestException as exc:
        logger.warning("Could not fetch VEC results page %s: %s", page_url, exc)
        return []

    html = resp.text
    links = []
    # Simple substring scan — avoids a BeautifulSoup dependency
    for token in html.split("href="):
        for quote in ('"', "'"):
            if token.startswith(quote):
                url = token[1:].split(quote)[0]
                if url.lower().endswith((".xlsx", ".xls")):
                    if url.startswith("http"):
                        links.append(url)
                    elif url.startswith("/"):
                        # Build absolute URL from root of vec.vic.gov.au
                        base = "https://www.vec.vic.gov.au"
                        links.append(base + url)
                break

    logger.debug("Discovered %d Excel link(s) on %s", len(links), page_url)
    return links


# ── Download a single file ────────────────────────────────────────────────────

def _download_file(url: str, dest: Path, force: bool = False) -> bool:
    """
    Download *url* to *dest*.  Returns True if file was downloaded or already exists.
    """
    if dest.exists() and not force:
        logger.debug("  Already exists: %s (%.0f KB)", dest.name, dest.stat().st_size / 1024)
        return True

    try:
        resp = requests.get(url, headers=HEADERS, timeout=120, stream=True)
        resp.raise_for_status()
    except requests.RequestException as exc:
        logger.error("  Failed to download %s: %s", url, exc)
        return False

    dest.write_bytes(resp.content)
    logger.info("  Downloaded %s → %s (%.0f KB)", url, dest.name, dest.stat().st_size / 1024)
    time.sleep(REQUEST_DELAY)
    return True


# ── Main download entry point ─────────────────────────────────────────────────

def download_vec_election(election_id: int, force: bool = False) -> dict[str, Path]:
    """
    Download VEC Excel result files for a given election.

    Returns a dict mapping file-type keys to local Path objects, e.g.:
        {"results_xlsx": Path(...), "fp_xlsx": Path(...)}

    If download fails, returns an empty dict — caller should check and
    fall back to listing locally available files.
    """
    if election_id not in VIC_ELECTIONS:
        raise ValueError(f"Unknown VIC election_id {election_id}. "
                         f"Valid IDs: {list(VIC_ELECTIONS.keys())}")

    cfg = VIC_ELECTIONS[election_id]
    raw_dir = _raw_dir(election_id)
    logger.info("VEC download: election %d (%s)", election_id, cfg["name"])
    logger.info("Target directory: %s", raw_dir)

    page_url = cfg["results_page_url"]
    links = _fetch_excel_links(page_url)

    downloaded: dict[str, Path] = {}

    if not links:
        logger.warning(
            "No Excel links found on %s.\n"
            "  Please download VEC result files manually and place them in:\n"
            "  %s\n"
            "  Then re-run with --skip-download.",
            page_url, raw_dir,
        )
        return downloaded

    for url in links:
        filename = url.split("/")[-1].split("?")[0]
        dest = raw_dir / filename

        ok = _download_file(url, dest, force=force)
        if not ok:
            continue

        key = _classify_file(filename)
        if key:
            downloaded[key] = dest
            logger.info("  Classified as: %s", key)

    return downloaded


def _classify_file(filename: str) -> str | None:
    """
    Heuristically classify a VEC Excel filename into a type key.
    Returns None for irrelevant files.
    """
    name = filename.lower()
    if any(t in name for t in ("two-candidate", "two_candidate", "tcp", "2cp")):
        return "tcp_xlsx"
    if any(t in name for t in ("first-preference", "first_preference", "fp", "first-pref")):
        return "fp_xlsx"
    if any(t in name for t in ("result", "district", "summary")):
        return "results_xlsx"
    if name.endswith((".xlsx", ".xls")):
        return "other_xlsx"
    return None


# ── List locally available files ──────────────────────────────────────────────

def list_local_vec_files(election_id: int) -> dict[str, Path]:
    """
    Return all Excel and CSV files already present in the raw directory.
    """
    raw_dir = _raw_dir(election_id)
    found: dict[str, Path] = {}

    for ext in ("*.xlsx", "*.xls", "*.csv"):
        for path in sorted(raw_dir.glob(ext)):
            key = _classify_file(path.name) or path.stem
            found[key] = path
            logger.debug("  Found local file: %s (%.0f KB)", path.name, path.stat().st_size / 1024)

    if not found:
        logger.info(
            "No local VEC files found for election %d in %s", election_id, raw_dir
        )
    else:
        logger.info(
            "Found %d local file(s) for election %d", len(found), election_id
        )

    return found
