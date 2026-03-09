"""
Configuration for the AEC election data pipeline.

AEC results are published at results.aec.gov.au using event IDs.
Each election has a consistent set of CSV files following standard naming conventions.
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
DATA_RAW_DIR     = os.path.join(BASE_DIR, "data", "raw")
DATA_PROCESSED_DIR = os.path.join(BASE_DIR, "data", "processed")
DATA_EXPORTS_DIR = os.path.join(BASE_DIR, "data", "exports")
DB_PATH          = os.path.join(BASE_DIR, "data", "aec_elections.db")
