"""
State/Territory Election Data Downloader
=========================================

Handles downloading election result files from each state and territory
electoral commission.  Follows the same pattern as vec_download.py.

Each electoral commission uses a different site structure and file format:

  NSW  — NSWEC (nswec.com.au / elections.nsw.gov.au)
           Publishes CSV result files.  Results are available via a
           structured URL pattern after the election.

  QLD  — ECQ (ecq.qld.gov.au / results.ecq.qld.gov.au)
           Publishes CSV and HTML result files.  Results portal uses a
           predictable base URL per election year.

  WA   — WAEC (elections.wa.gov.au)
           Publishes CSV and Excel result files per election.

  SA   — ECSA (ecsa.sa.gov.au)
           Publishes CSV result files, structured by election year.

  TAS  — TEC (tec.tas.gov.au)
           Publishes CSV result files for Hare-Clark counts.

  ACT  — ACT Electoral Commission (elections.act.gov.au)
           Publishes CSV result files for Hare-Clark counts.

  NT   — NTEC (ntec.nt.gov.au)
           Publishes Excel and CSV result files.

Manual fallback (all states):
  If automatic download fails, place the result files manually in
  data/raw/{state}/{election_id}/ and re-run with --skip-download.
  The parser (state_parse.py) will detect common filename patterns.
"""

import logging
import time
from pathlib import Path

import requests

from .config import STATE_REGISTRY

logger = logging.getLogger(__name__)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; aus-poll-bot/1.0; "
        "+https://github.com/leifsmith01-ai/aus-poll)"
    )
}

REQUEST_DELAY = 1.5  # seconds between requests (politeness)


# ── Directory helpers ─────────────────────────────────────────────────────────

def _raw_dir(state_ab: str, election_id: int) -> Path:
    """Return (and create) the raw data directory for a state election."""
    raw_dir = Path(STATE_REGISTRY[state_ab.lower()]["raw_dir"])
    d = raw_dir / str(election_id)
    d.mkdir(parents=True, exist_ok=True)
    return d


def _download_file(url: str, dest: Path, force: bool = False) -> bool:
    """
    Download a single file to dest.  Returns True on success.
    Skips download if dest already exists and force=False.
    """
    if dest.exists() and not force:
        logger.debug("  Already exists, skipping: %s", dest.name)
        return True

    logger.info("  Downloading %s → %s", url, dest.name)
    try:
        time.sleep(REQUEST_DELAY)
        resp = requests.get(url, headers=HEADERS, timeout=60, stream=True)
        resp.raise_for_status()
        with open(dest, "wb") as fh:
            for chunk in resp.iter_content(chunk_size=65536):
                fh.write(chunk)
        logger.info("  Saved %s (%.0f KB)", dest.name, dest.stat().st_size / 1024)
        return True
    except requests.RequestException as exc:
        logger.warning("  Failed to download %s: %s", url, exc)
        if dest.exists():
            dest.unlink()
        return False


def _fetch_links(page_url: str, extensions: tuple = (".csv", ".xlsx", ".xls")) -> list[str]:
    """
    Fetch a results page and return all download links matching given extensions.
    Simple href scan — avoids a BeautifulSoup dependency.
    """
    try:
        resp = requests.get(page_url, headers=HEADERS, timeout=30)
        resp.raise_for_status()
    except requests.RequestException as exc:
        logger.warning("Could not fetch page %s: %s", page_url, exc)
        return []

    links = []
    base = page_url.rsplit("/", 1)[0]
    for token in resp.text.split("href="):
        for quote in ('"', "'"):
            if token.startswith(quote):
                href = token[1:].split(quote)[0]
                if any(href.lower().endswith(ext) for ext in extensions):
                    if href.startswith("http"):
                        links.append(href)
                    elif href.startswith("/"):
                        from urllib.parse import urlparse
                        parsed = urlparse(page_url)
                        links.append(f"{parsed.scheme}://{parsed.netloc}{href}")
                    else:
                        links.append(f"{base}/{href}")
                break
    return links


# ── Shared local file listing ─────────────────────────────────────────────────

def list_local_state_files(state_ab: str, election_id: int) -> dict[str, str]:
    """
    Return a dict of {role: path} for any result files already present in
    data/raw/{state}/{election_id}/.

    Role keys follow the same convention as vec_download.list_local_vec_files:
      'candidates', 'fp', 'tcp', 'results'
    Additional files found are keyed as 'extra_0', 'extra_1', ...
    """
    d = _raw_dir(state_ab, election_id)
    if not d.exists():
        return {}

    found: dict[str, str] = {}
    extras = 0

    for p in sorted(d.iterdir()):
        if not p.is_file():
            continue
        name = p.name.lower()

        if any(kw in name for kw in ("candidate", "cand")):
            found["candidates"] = str(p)
        elif any(kw in name for kw in ("first_pref", "firstpref", "fp", "primary")):
            found.setdefault("fp", str(p))
        elif any(kw in name for kw in ("two_cand", "twocand", "tcp", "2cp", "2candidate")):
            found.setdefault("tcp", str(p))
        elif "result" in name:
            found.setdefault("results", str(p))
        else:
            found[f"extra_{extras}"] = str(p)
            extras += 1

    return found


# ── NSW downloader ────────────────────────────────────────────────────────────

def download_nsw_election(election_id: int, force: bool = False) -> dict[str, str]:
    """
    Download NSWEC result files for the given election_id (YYYYMM format).

    The NSWEC publishes a structured results portal after each election.
    This function attempts to discover download links from the configured
    results_page_url.  If discovery fails, check for manually placed files.

    Returns a dict of {role: local_path} for successfully downloaded files.
    """
    from .config import NSW_ELECTIONS
    if election_id not in NSW_ELECTIONS:
        raise ValueError(f"Unknown NSW election_id {election_id}. "
                         f"Valid: {list(NSW_ELECTIONS)}")

    cfg = NSW_ELECTIONS[election_id]
    dest_dir = _raw_dir("nsw", election_id)
    logger.info("Downloading NSW %d (%s)...", election_id, cfg["name"])

    links = _fetch_links(cfg["results_page_url"])
    if not links:
        logger.warning(
            "No download links found on NSWEC results page.\n"
            "  Manually download CSV files from %s\n"
            "  and place them in: %s",
            cfg["results_page_url"], dest_dir
        )
        return list_local_state_files("nsw", election_id)

    downloaded: dict[str, str] = {}
    for url in links:
        fname = url.split("/")[-1].split("?")[0] or "download.csv"
        dest = dest_dir / fname
        if _download_file(url, dest, force=force):
            downloaded[fname] = str(dest)

    files = list_local_state_files("nsw", election_id)
    if not files:
        logger.warning("No usable files found for NSW %d after download.", election_id)
    return files


# ── QLD downloader ────────────────────────────────────────────────────────────

def download_qld_election(election_id: int, force: bool = False) -> dict[str, str]:
    """
    Download ECQ result files for the given election_id (YYYYMM format).

    The ECQ publishes results at results.ecq.qld.gov.au with a predictable
    directory structure per election year.

    Returns a dict of {role: local_path} for successfully downloaded files.
    """
    from .config import QLD_ELECTIONS
    if election_id not in QLD_ELECTIONS:
        raise ValueError(f"Unknown QLD election_id {election_id}. "
                         f"Valid: {list(QLD_ELECTIONS)}")

    cfg = QLD_ELECTIONS[election_id]
    dest_dir = _raw_dir("qld", election_id)
    logger.info("Downloading QLD %d (%s)...", election_id, cfg["name"])

    links = _fetch_links(cfg["results_page_url"])
    if not links:
        logger.warning(
            "No download links found on ECQ results page.\n"
            "  Manually download CSV files from %s\n"
            "  and place them in: %s",
            cfg["results_page_url"], dest_dir
        )
        return list_local_state_files("qld", election_id)

    for url in links:
        fname = url.split("/")[-1].split("?")[0] or "download.csv"
        _download_file(url, dest_dir / fname, force=force)

    return list_local_state_files("qld", election_id)


# ── WA downloader ─────────────────────────────────────────────────────────────

def download_wa_election(election_id: int, force: bool = False) -> dict[str, str]:
    """
    Download WAEC result files for the given election_id (YYYYMM format).

    The WAEC publishes CSV and Excel results at elections.wa.gov.au.

    Returns a dict of {role: local_path} for successfully downloaded files.
    """
    from .config import WA_ELECTIONS
    if election_id not in WA_ELECTIONS:
        raise ValueError(f"Unknown WA election_id {election_id}. "
                         f"Valid: {list(WA_ELECTIONS)}")

    cfg = WA_ELECTIONS[election_id]
    dest_dir = _raw_dir("wa", election_id)
    logger.info("Downloading WA %d (%s)...", election_id, cfg["name"])

    links = _fetch_links(cfg["results_page_url"])
    if not links:
        logger.warning(
            "No download links found on WAEC results page.\n"
            "  Manually download files from %s\n"
            "  and place them in: %s",
            cfg["results_page_url"], dest_dir
        )
        return list_local_state_files("wa", election_id)

    for url in links:
        fname = url.split("/")[-1].split("?")[0] or "download.csv"
        _download_file(url, dest_dir / fname, force=force)

    return list_local_state_files("wa", election_id)


# ── SA downloader ─────────────────────────────────────────────────────────────

def download_sa_election(election_id: int, force: bool = False) -> dict[str, str]:
    """
    Download ECSA result files for the given election_id (YYYYMM format).

    The ECSA publishes CSV results at ecsa.sa.gov.au.

    Returns a dict of {role: local_path} for successfully downloaded files.
    """
    from .config import SA_ELECTIONS
    if election_id not in SA_ELECTIONS:
        raise ValueError(f"Unknown SA election_id {election_id}. "
                         f"Valid: {list(SA_ELECTIONS)}")

    cfg = SA_ELECTIONS[election_id]
    dest_dir = _raw_dir("sa", election_id)
    logger.info("Downloading SA %d (%s)...", election_id, cfg["name"])

    links = _fetch_links(cfg["results_page_url"])
    if not links:
        logger.warning(
            "No download links found on ECSA results page.\n"
            "  Manually download CSV files from %s\n"
            "  and place them in: %s",
            cfg["results_page_url"], dest_dir
        )
        return list_local_state_files("sa", election_id)

    for url in links:
        fname = url.split("/")[-1].split("?")[0] or "download.csv"
        _download_file(url, dest_dir / fname, force=force)

    return list_local_state_files("sa", election_id)


# ── TAS downloader ────────────────────────────────────────────────────────────

def download_tas_election(election_id: int, force: bool = False) -> dict[str, str]:
    """
    Download TEC result files for the given election_id (YYYYMM format).

    The TEC publishes CSV results for Hare-Clark counts at tec.tas.gov.au.
    Files typically include candidate lists and preference count data
    for each of the 5 electorates.

    Returns a dict of {role: local_path} for successfully downloaded files.
    """
    from .config import TAS_ELECTIONS
    if election_id not in TAS_ELECTIONS:
        raise ValueError(f"Unknown TAS election_id {election_id}. "
                         f"Valid: {list(TAS_ELECTIONS)}")

    cfg = TAS_ELECTIONS[election_id]
    dest_dir = _raw_dir("tas", election_id)
    logger.info("Downloading TAS %d (%s)...", election_id, cfg["name"])

    links = _fetch_links(cfg["results_page_url"])
    if not links:
        logger.warning(
            "No download links found on TEC results page.\n"
            "  Manually download CSV files from %s\n"
            "  and place them in: %s",
            cfg["results_page_url"], dest_dir
        )
        return list_local_state_files("tas", election_id)

    for url in links:
        fname = url.split("/")[-1].split("?")[0] or "download.csv"
        _download_file(url, dest_dir / fname, force=force)

    return list_local_state_files("tas", election_id)


# ── ACT downloader ────────────────────────────────────────────────────────────

def download_act_election(election_id: int, force: bool = False) -> dict[str, str]:
    """
    Download ACT Electoral Commission result files for the given election_id.

    The ACT EC publishes CSV results for Hare-Clark counts at elections.act.gov.au.
    Files include candidate lists and preference allocation data per electorate.

    Returns a dict of {role: local_path} for successfully downloaded files.
    """
    from .config import ACT_ELECTIONS
    if election_id not in ACT_ELECTIONS:
        raise ValueError(f"Unknown ACT election_id {election_id}. "
                         f"Valid: {list(ACT_ELECTIONS)}")

    cfg = ACT_ELECTIONS[election_id]
    dest_dir = _raw_dir("act", election_id)
    logger.info("Downloading ACT %d (%s)...", election_id, cfg["name"])

    links = _fetch_links(cfg["results_page_url"])
    if not links:
        logger.warning(
            "No download links found on ACT EC results page.\n"
            "  Manually download CSV files from %s\n"
            "  and place them in: %s",
            cfg["results_page_url"], dest_dir
        )
        return list_local_state_files("act", election_id)

    for url in links:
        fname = url.split("/")[-1].split("?")[0] or "download.csv"
        _download_file(url, dest_dir / fname, force=force)

    return list_local_state_files("act", election_id)


# ── NT downloader ─────────────────────────────────────────────────────────────

def download_nt_election(election_id: int, force: bool = False) -> dict[str, str]:
    """
    Download NTEC result files for the given election_id (YYYYMM format).

    The NTEC publishes Excel and CSV results at ntec.nt.gov.au.
    Note: NT uses optional preferential voting.

    Returns a dict of {role: local_path} for successfully downloaded files.
    """
    from .config import NT_ELECTIONS
    if election_id not in NT_ELECTIONS:
        raise ValueError(f"Unknown NT election_id {election_id}. "
                         f"Valid: {list(NT_ELECTIONS)}")

    cfg = NT_ELECTIONS[election_id]
    dest_dir = _raw_dir("nt", election_id)
    logger.info("Downloading NT %d (%s)...", election_id, cfg["name"])

    links = _fetch_links(cfg["results_page_url"], extensions=(".csv", ".xlsx", ".xls"))
    if not links:
        logger.warning(
            "No download links found on NTEC results page.\n"
            "  Manually download files from %s\n"
            "  and place them in: %s",
            cfg["results_page_url"], dest_dir
        )
        return list_local_state_files("nt", election_id)

    for url in links:
        fname = url.split("/")[-1].split("?")[0] or "download"
        _download_file(url, dest_dir / fname, force=force)

    return list_local_state_files("nt", election_id)


# ── Unified dispatcher ────────────────────────────────────────────────────────

_DOWNLOADERS = {
    "nsw": download_nsw_election,
    "qld": download_qld_election,
    "wa":  download_wa_election,
    "sa":  download_sa_election,
    "tas": download_tas_election,
    "act": download_act_election,
    "nt":  download_nt_election,
}


def download_state_election(state_ab: str, election_id: int,
                             force: bool = False) -> dict[str, str]:
    """
    Download election result files for any supported state/territory.

    Args:
        state_ab:    State abbreviation: 'nsw', 'qld', 'wa', 'sa', 'tas', 'act', 'nt'
        election_id: YYYYMM election identifier (e.g. 202303 for NSW March 2023)
        force:       Re-download even if files already exist locally

    Returns:
        dict of {role: local_file_path} for discovered files.
    """
    key = state_ab.lower()
    if key not in _DOWNLOADERS:
        raise ValueError(
            f"Unknown state '{state_ab}'. Supported: {list(_DOWNLOADERS)}"
        )
    return _DOWNLOADERS[key](election_id, force=force)
