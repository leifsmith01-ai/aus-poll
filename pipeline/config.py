"""
Configuration for the AEC/VEC election data pipeline.

AEC results are published at results.aec.gov.au using event IDs.
VEC (Victorian Electoral Commission) results are published at vec.vic.gov.au.
Each election has a consistent set of CSV/Excel files following standard naming conventions.
"""

# ─── Election event IDs ──────────────────────────────────────────────────────
# These are the AEC internal event IDs used in all file/URL naming.
ELECTIONS = {
    2022: {
        "event_id": 27966,
        "name": "2022 Australian Federal Election",
        "date": "2022-05-21",
        "results_base_url": "https://results.aec.gov.au/27966/Website/Downloads",
    },
    2019: {
        "event_id": 24310,
        "name": "2019 Australian Federal Election",
        "date": "2019-05-18",
        "results_base_url": "https://results.aec.gov.au/24310/Website/Downloads",
    },
    2016: {
        "event_id": 20499,
        "name": "2016 Australian Federal Election",
        "date": "2016-07-02",
        "results_base_url": "https://results.aec.gov.au/20499/Website/Downloads",
    },
}

# ─── File templates ───────────────────────────────────────────────────────────
# Filenames follow the pattern <DescriptiveName>-<event_id>.csv
FILE_TEMPLATES = {
    # Candidate list for the election (name, party, division, elected status)
    "candidates": "HouseCandidatesDownload-{event_id}.csv",

    # All polling places with lat/lon, address, type
    "polling_places": "GeneralPollingPlacesDownload-{event_id}.csv",

    # First preference votes broken down by candidate × booth
    "first_preferences": "HouseFirstPrefsByPollingPlaceDownload-{event_id}.csv",

    # Two-candidate preferred (TCP) votes by candidate × booth
    "tcp": "HouseTcpByCandidateByPollingPlaceDownload-{event_id}.csv",

    # Full preference distribution (count-by-count) by division
    "dop": "HouseDopByDivisionDownload-{event_id}.csv",

    # Division-level first preferences broken out by vote type (ordinary, postal, etc.)
    "division_first_prefs": "HouseDivisionFirstPrefsByStateByVoteTypeDownload-{event_id}.csv",

    # Division-level TCP broken out by vote type
    "division_tcp": "HouseTcpByCandidateByDivisionDownload-{event_id}.csv",

    # Enrolment figures by division
    "enrolment": "HouseEnrolmentByDivisionDownload-{event_id}.csv",
}

# ─── State mappings ───────────────────────────────────────────────────────────
STATES = {
    "NSW": "New South Wales",
    "VIC": "Victoria",
    "QLD": "Queensland",
    "WA": "Western Australia",
    "SA": "South Australia",
    "TAS": "Tasmania",
    "ACT": "Australian Capital Territory",
    "NT":  "Northern Territory",
}

# ─── Major party abbreviations (for preference modelling) ────────────────────
MAJOR_PARTIES = {
    "ALP": "Australian Labor Party",
    "LP":  "Liberal Party of Australia",
    "NP":  "The Nationals",
    "LNP": "Liberal National Party of Queensland",
    "GRN": "The Greens",
    "UAP": "United Australia Party",
    "ON":  "Pauline Hanson's One Nation",
    "CA":  "Centre Alliance",
    "IND": "Independent",
}

# Coalition partners - treated as a single grouping in 2PP
COALITION_PARTIES = {"LP", "NP", "LNP", "CLP"}

# ─── Paths ────────────────────────────────────────────────────────────────────
import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_RAW_DIR       = os.path.join(BASE_DIR, "data", "raw")
DATA_PROCESSED_DIR = os.path.join(BASE_DIR, "data", "processed")
DATA_EXPORTS_DIR   = os.path.join(BASE_DIR, "data", "exports")
DB_PATH            = os.path.join(BASE_DIR, "data", "aec_elections.db")

# ─── Victorian State Elections ────────────────────────────────────────────────
# election_id uses YYYYMM format (e.g. 202211 = November 2022) to avoid
# clashing with federal election_ids which are plain years (2022, 2019, etc.).
# event_id uses synthetic values in the 990XXX range (VEC has no equivalent).
VIC_ELECTIONS = {
    202211: {
        "name": "2022 Victorian State Election",
        "date": "2022-11-26",
        "jurisdiction": "vic_state",
        "event_id": 990122,
        "results_page_url": "https://www.vec.vic.gov.au/results/state-election-results/2022-state-election-results",
    },
    201811: {
        "name": "2018 Victorian State Election",
        "date": "2018-11-24",
        "jurisdiction": "vic_state",
        "event_id": 990118,
        "results_page_url": "https://www.vec.vic.gov.au/results/state-election-results/2018-state-election-results",
    },
    201411: {
        "name": "2014 Victorian State Election",
        "date": "2014-11-29",
        "jurisdiction": "vic_state",
        "event_id": 990114,
        "results_page_url": "https://www.vec.vic.gov.au/results/state-election-results/2014-state-election-results",
    },
}

# VEC data directories
VIC_RAW_DIR     = os.path.join(BASE_DIR, "data", "raw", "vic")
VIC_EXPORTS_DIR = os.path.join(DATA_EXPORTS_DIR, "vic")

# VEC party abbreviations (state-level parties differ slightly from federal)
VIC_PARTIES = {
    "ALP":   "Australian Labor Party",
    "LP":    "Liberal Party of Australia",
    "NP":    "The Nationals",
    "GRN":   "The Greens",
    "IND":   "Independent",
    "ON":    "Pauline Hanson's One Nation",
    "DLP":   "Democratic Labour Party",
    "DHJP":  "Derryn Hinch's Justice Party",
    "SAP":   "Sustainable Australia Party",
}

# Coalition partners in VIC (Liberal + Nationals, no LNP/CLP in VIC)
VIC_COALITION_PARTIES = {"LP", "NP"}
