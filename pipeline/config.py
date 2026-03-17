"""
Configuration for the AEC/VEC election data pipeline.

AEC results are published at results.aec.gov.au using event IDs.
VEC (Victorian Electoral Commission) results are published at vec.vic.gov.au.
Each election has a consistent set of CSV/Excel files following standard naming conventions.
"""

# ─── Election event IDs ──────────────────────────────────────────────────────
# These are the AEC internal event IDs used in all file/URL naming.
ELECTIONS = {
    2025: {
        "event_id": 31496,
        "name": "2025 Australian Federal Election",
        "date": "2025-05-03",
        "results_base_url": "https://results.aec.gov.au/31496/Website/Downloads",
        # 2025 AEC renamed several files relative to the standard FILE_TEMPLATES.
        # Keys here override the FILE_TEMPLATES entry for this election year only.
        "file_overrides": {
            # Booth-level FP is now split per-state; list format triggers multi-download
            # and the results are merged into a single "first_preferences" parse output.
            "first_preferences": [
                "HouseStateFirstPrefsByPollingPlaceDownload-31496-NSW.csv",
                "HouseStateFirstPrefsByPollingPlaceDownload-31496-VIC.csv",
                "HouseStateFirstPrefsByPollingPlaceDownload-31496-QLD.csv",
                "HouseStateFirstPrefsByPollingPlaceDownload-31496-WA.csv",
                "HouseStateFirstPrefsByPollingPlaceDownload-31496-SA.csv",
                "HouseStateFirstPrefsByPollingPlaceDownload-31496-TAS.csv",
                "HouseStateFirstPrefsByPollingPlaceDownload-31496-ACT.csv",
                "HouseStateFirstPrefsByPollingPlaceDownload-31496-NT.csv",
            ],
            # Division-level files renamed in 2025
            "division_first_prefs": "HouseFirstPrefsByCandidateByVoteTypeDownload-31496.csv",
            "division_tcp":         "HouseTcpByCandidateByVoteTypeDownload-31496.csv",
            "enrolment":            "GeneralEnrolmentByDivisionDownload-31496.csv",
        },
    },
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
    202611: {
        "name": "2026 Victorian State Election",
        "date": "2026-11-28",  # exact date TBC — placeholder based on 4-year cycle
        "jurisdiction": "vic_state",
        "event_id": 990126,
        "results_page_url": "https://www.vec.vic.gov.au/results/state-election-results/2026-state-election-results",
    },
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

# VEC district name aliases for cross-election swing computation.
# Maps old/alternate name → canonical current name. Used when matching
# districts between elections where the VEC renamed a seat during a
# redistribution. The canonical name is the most recent known name.
VIC_DISTRICT_ALIASES: dict[str, str] = {
    # 2013 redistribution renames
    "Ballarat West":   "Wendouree",
    "Ballarat North":  "Macedon",
    "Seymour":         "Eildon",
    # Older alternate spellings / abbreviations sometimes seen in VEC files
    "Albert Park":     "Albert Park",  # no change — placeholder for documentation
}

# VEC party abbreviations (state-level parties differ slightly from federal)
VIC_PARTIES = {
    "ALP":    "Australian Labor Party",
    "LP":     "Liberal Party of Australia",
    "NP":     "The Nationals",
    "GRN":    "The Greens",
    "IND":    "Independent",
    "ON":     "Pauline Hanson's One Nation",
    "DLP":    "Democratic Labour Party",
    "DHJP":   "Derryn Hinch's Justice Party",
    "SAP":    "Sustainable Australia Party",
    # Minor parties active in Victorian state elections
    "VS":     "Victorian Socialists",
    "AJP":    "Animal Justice Party",
    "LDP":    "Liberal Democrats",
    "FF":     "Family First",
    "REASON": "Reason Australia",
    "TMP":    "Transport Matters Party",
    "UAP":    "United Australia Party",
    "SFF":    "Shooters, Fishers and Farmers",
}

# Coalition partners in VIC (Liberal + Nationals, no LNP/CLP in VIC)
VIC_COALITION_PARTIES = {"LP", "NP"}


# ─── NSW State Elections ──────────────────────────────────────────────────────
# Electoral commission: NSWEC — nswec.com.au
# Legislature: Legislative Assembly (93 seats), single-member preferential
NSW_ELECTIONS = {
    202303: {
        "name": "2023 NSW State Election",
        "date": "2023-03-25",
        "jurisdiction": "nsw_state",
        "event_id": 991323,
        "results_page_url": "https://www.elections.nsw.gov.au/elections/state-elections/2023-nsw-state-election/results",
    },
    201903: {
        "name": "2019 NSW State Election",
        "date": "2019-03-23",
        "jurisdiction": "nsw_state",
        "event_id": 991319,
        "results_page_url": "https://www.elections.nsw.gov.au/elections/state-elections/2019-nsw-state-election/results",
    },
    201503: {
        "name": "2015 NSW State Election",
        "date": "2015-03-28",
        "jurisdiction": "nsw_state",
        "event_id": 991315,
        "results_page_url": "https://www.elections.nsw.gov.au/elections/state-elections/2015-nsw-state-election/results",
    },
}

NSW_RAW_DIR     = os.path.join(BASE_DIR, "data", "raw", "nsw")
NSW_EXPORTS_DIR = os.path.join(DATA_EXPORTS_DIR, "nsw")

NSW_PARTIES = {
    "ALP":  "Australian Labor Party",
    "LIB":  "Liberal Party of Australia",
    "NAT":  "The Nationals",
    "GRN":  "The Greens",
    "IND":  "Independent",
    "ON":   "Pauline Hanson's One Nation",
    "TFF":  "Shooters, Fishers and Farmers",
    "CDP":  "Christian Democratic Party",
    "UAP":  "United Australia Party",
}

NSW_COALITION_PARTIES = {"LIB", "NAT"}


# ─── QLD State Elections ──────────────────────────────────────────────────────
# Electoral commission: ECQ — ecq.qld.gov.au
# Legislature: Legislative Assembly (93 seats), unicameral, single-member preferential
# Main conservative party: LNP (Liberal National Party, merged 2008)
QLD_ELECTIONS = {
    202410: {
        "name": "2024 Queensland State Election",
        "date": "2024-10-26",
        "jurisdiction": "qld_state",
        "event_id": 992424,
        "results_page_url": "https://results.ecq.qld.gov.au/elections/state/State2024/",
    },
    202010: {
        "name": "2020 Queensland State Election",
        "date": "2020-10-31",
        "jurisdiction": "qld_state",
        "event_id": 992420,
        "results_page_url": "https://results.ecq.qld.gov.au/elections/state/State2020/",
    },
    201711: {
        "name": "2017 Queensland State Election",
        "date": "2017-11-25",
        "jurisdiction": "qld_state",
        "event_id": 992417,
        "results_page_url": "https://results.ecq.qld.gov.au/elections/state/State2017/",
    },
}

QLD_RAW_DIR     = os.path.join(BASE_DIR, "data", "raw", "qld")
QLD_EXPORTS_DIR = os.path.join(DATA_EXPORTS_DIR, "qld")

QLD_PARTIES = {
    "ALP":  "Australian Labor Party",
    "LNP":  "Liberal National Party of Queensland",
    "GRN":  "The Greens",
    "IND":  "Independent",
    "ON":   "Pauline Hanson's One Nation",
    "KAP":  "Katter's Australian Party",
    "UAP":  "United Australia Party",
}

QLD_COALITION_PARTIES = {"LNP"}


# ─── WA State Elections ───────────────────────────────────────────────────────
# Electoral commission: WAEC — elections.wa.gov.au
# Legislature: Legislative Assembly (59 seats), single-member preferential
WA_ELECTIONS = {
    202503: {
        "name": "2025 Western Australian State Election",
        "date": "2025-03-08",
        "jurisdiction": "wa_state",
        "event_id": 993325,
        "results_page_url": "https://www.elections.wa.gov.au/elections/state/2025stateelection",
    },
    202103: {
        "name": "2021 Western Australian State Election",
        "date": "2021-03-13",
        "jurisdiction": "wa_state",
        "event_id": 993321,
        "results_page_url": "https://www.elections.wa.gov.au/elections/state/2021stateelection",
    },
    201703: {
        "name": "2017 Western Australian State Election",
        "date": "2017-03-11",
        "jurisdiction": "wa_state",
        "event_id": 993317,
        "results_page_url": "https://www.elections.wa.gov.au/elections/state/2017stateelection",
    },
}

WA_RAW_DIR     = os.path.join(BASE_DIR, "data", "raw", "wa")
WA_EXPORTS_DIR = os.path.join(DATA_EXPORTS_DIR, "wa")

WA_PARTIES = {
    "ALP":  "Australian Labor Party",
    "LIB":  "Liberal Party of Australia",
    "NAT":  "The Nationals WA",
    "GRN":  "The Greens (WA)",
    "IND":  "Independent",
    "ON":   "Pauline Hanson's One Nation",
    "UAP":  "United Australia Party",
}

WA_COALITION_PARTIES = {"LIB", "NAT"}


# ─── SA State Elections ───────────────────────────────────────────────────────
# Electoral commission: ECSA — ecsa.sa.gov.au
# Legislature: House of Assembly (47 seats), single-member preferential
SA_ELECTIONS = {
    202203: {
        "name": "2022 South Australian State Election",
        "date": "2022-03-19",
        "jurisdiction": "sa_state",
        "event_id": 994422,
        "results_page_url": "https://www.ecsa.sa.gov.au/elections/state-elections/2022-state-election",
    },
    201803: {
        "name": "2018 South Australian State Election",
        "date": "2018-03-17",
        "jurisdiction": "sa_state",
        "event_id": 994418,
        "results_page_url": "https://www.ecsa.sa.gov.au/elections/state-elections/2018-state-election",
    },
    201403: {
        "name": "2014 South Australian State Election",
        "date": "2014-03-15",
        "jurisdiction": "sa_state",
        "event_id": 994414,
        "results_page_url": "https://www.ecsa.sa.gov.au/elections/state-elections/2014-state-election",
    },
}

SA_RAW_DIR     = os.path.join(BASE_DIR, "data", "raw", "sa")
SA_EXPORTS_DIR = os.path.join(DATA_EXPORTS_DIR, "sa")

SA_PARTIES = {
    "ALP":    "Australian Labor Party",
    "LIB":    "Liberal Party of Australia",
    "GRN":    "The Greens (SA)",
    "IND":    "Independent",
    "ON":     "Pauline Hanson's One Nation",
    "SABEST": "SA Best",
    "SAPP":   "SA Prosperity Party",
    "FF":     "Family First",
}

SA_COALITION_PARTIES = {"LIB"}


# ─── TAS State Elections ──────────────────────────────────────────────────────
# Electoral commission: TEC — tec.tas.gov.au
# Legislature: House of Assembly (5 electorates × 5 members = 25 seats)
# Voting system: Hare-Clark proportional representation (multi-member)
TAS_ELECTIONS = {
    202403: {
        "name": "2024 Tasmanian State Election",
        "date": "2024-03-23",
        "jurisdiction": "tas_state",
        "event_id": 995524,
        "results_page_url": "https://www.tec.tas.gov.au/info/elections/2024StateElection/",
    },
    202105: {
        "name": "2021 Tasmanian State Election",
        "date": "2021-05-01",
        "jurisdiction": "tas_state",
        "event_id": 995521,
        "results_page_url": "https://www.tec.tas.gov.au/info/elections/2021StateElection/",
    },
    201803: {
        "name": "2018 Tasmanian State Election",
        "date": "2018-03-03",
        "jurisdiction": "tas_state",
        "event_id": 995518,
        "results_page_url": "https://www.tec.tas.gov.au/info/elections/2018StateElection/",
    },
}

TAS_RAW_DIR     = os.path.join(BASE_DIR, "data", "raw", "tas")
TAS_EXPORTS_DIR = os.path.join(DATA_EXPORTS_DIR, "tas")

TAS_PARTIES = {
    "ALP":  "Australian Labor Party",
    "LIB":  "Liberal Party of Australia",
    "GRN":  "The Greens (Tas)",
    "IND":  "Independent",
    "JLN":  "Jacqui Lambie Network",
}

TAS_COALITION_PARTIES = {"LIB"}


# ─── ACT Elections ────────────────────────────────────────────────────────────
# Electoral commission: ACT Electoral Commission — elections.act.gov.au
# Legislature: ACT Legislative Assembly (5 electorates × 5 members = 25 seats)
# Voting system: Hare-Clark proportional representation (multi-member)
# Note: ACT is unicameral; no upper house.
ACT_ELECTIONS = {
    202410: {
        "name": "2024 ACT Legislative Assembly Election",
        "date": "2024-10-19",
        "jurisdiction": "act_territory",
        "event_id": 996624,
        "results_page_url": "https://www.elections.act.gov.au/elections_and_voting/2024_legislative_assembly_election",
    },
    202010: {
        "name": "2020 ACT Legislative Assembly Election",
        "date": "2020-10-17",
        "jurisdiction": "act_territory",
        "event_id": 996620,
        "results_page_url": "https://www.elections.act.gov.au/elections_and_voting/2020_legislative_assembly_election",
    },
    201610: {
        "name": "2016 ACT Legislative Assembly Election",
        "date": "2016-10-15",
        "jurisdiction": "act_territory",
        "event_id": 996616,
        "results_page_url": "https://www.elections.act.gov.au/elections_and_voting/2016_legislative_assembly_election",
    },
}

ACT_RAW_DIR     = os.path.join(BASE_DIR, "data", "raw", "act")
ACT_EXPORTS_DIR = os.path.join(DATA_EXPORTS_DIR, "act")

ACT_PARTIES = {
    "ALP":  "Australian Labor Party",
    "LIB":  "Canberra Liberals",
    "GRN":  "ACT Greens",
    "IND":  "Independent",
}

ACT_COALITION_PARTIES = {"LIB"}


# ─── NT Elections ─────────────────────────────────────────────────────────────
# Electoral commission: NTEC — ntec.nt.gov.au
# Legislature: NT Legislative Assembly (25 seats), unicameral
# Voting system: Single-member electorates, optional preferential voting
# Main conservative party: CLP (Country Liberal Party)
NT_ELECTIONS = {
    202408: {
        "name": "2024 Northern Territory Election",
        "date": "2024-08-24",
        "jurisdiction": "nt_territory",
        "event_id": 997724,
        "results_page_url": "https://ntec.nt.gov.au/elections/2024-northern-territory-election",
    },
    202008: {
        "name": "2020 Northern Territory Election",
        "date": "2020-08-22",
        "jurisdiction": "nt_territory",
        "event_id": 997720,
        "results_page_url": "https://ntec.nt.gov.au/elections/2020-northern-territory-election",
    },
    201608: {
        "name": "2016 Northern Territory Election",
        "date": "2016-08-27",
        "jurisdiction": "nt_territory",
        "event_id": 997716,
        "results_page_url": "https://ntec.nt.gov.au/elections/2016-northern-territory-election",
    },
}

NT_RAW_DIR     = os.path.join(BASE_DIR, "data", "raw", "nt")
NT_EXPORTS_DIR = os.path.join(DATA_EXPORTS_DIR, "nt")

NT_PARTIES = {
    "ALP":  "Australian Labor Party",
    "CLP":  "Country Liberal Party",
    "GRN":  "The Greens",
    "IND":  "Independent",
    "TDU":  "Territory David Crisafulli",  # placeholder — minor NT parties vary
}

NT_COALITION_PARTIES = {"CLP"}


# ─── Unified state elections registry ────────────────────────────────────────
# Maps state abbreviation (lower-case) to its elections dict and config.
# Useful for generic pipeline dispatching (e.g. main.py --state vic).
STATE_REGISTRY = {
    "vic": {
        "elections":         VIC_ELECTIONS,
        "parties":           VIC_PARTIES,
        "coalition_parties": VIC_COALITION_PARTIES,
        "raw_dir":           VIC_RAW_DIR,
        "exports_dir":       VIC_EXPORTS_DIR,
        "schema_file":       "vec_schema.sql",
        "seats":             88,
        "system":            "preferential",
        # VEC does not publish booth-level results publicly.
        # Booth-level data is available via The Tally Room (tallyroom.com.au).
        "booth_level":       False,
    },
    "nsw": {
        "elections":         NSW_ELECTIONS,
        "parties":           NSW_PARTIES,
        "coalition_parties": NSW_COALITION_PARTIES,
        "raw_dir":           NSW_RAW_DIR,
        "exports_dir":       NSW_EXPORTS_DIR,
        "schema_file":       "nsw_schema.sql",
        "seats":             93,
        "system":            "preferential",
        "booth_level":       True,   # NSWEC publishes booth-level results
    },
    "qld": {
        "elections":         QLD_ELECTIONS,
        "parties":           QLD_PARTIES,
        "coalition_parties": QLD_COALITION_PARTIES,
        "raw_dir":           QLD_RAW_DIR,
        "exports_dir":       QLD_EXPORTS_DIR,
        "schema_file":       "qld_schema.sql",
        "seats":             93,
        "system":            "preferential",
        "booth_level":       True,   # ECQ publishes booth-level results
    },
    "wa": {
        "elections":         WA_ELECTIONS,
        "parties":           WA_PARTIES,
        "coalition_parties": WA_COALITION_PARTIES,
        "raw_dir":           WA_RAW_DIR,
        "exports_dir":       WA_EXPORTS_DIR,
        "schema_file":       "wa_schema.sql",
        "seats":             59,
        "system":            "preferential",
        "booth_level":       True,   # WAEC publishes booth-level results
    },
    "sa": {
        "elections":         SA_ELECTIONS,
        "parties":           SA_PARTIES,
        "coalition_parties": SA_COALITION_PARTIES,
        "raw_dir":           SA_RAW_DIR,
        "exports_dir":       SA_EXPORTS_DIR,
        "schema_file":       "sa_schema.sql",
        "seats":             47,
        "system":            "preferential",
        "booth_level":       True,   # ECSA publishes booth-level results
    },
    "tas": {
        "elections":         TAS_ELECTIONS,
        "parties":           TAS_PARTIES,
        "coalition_parties": TAS_COALITION_PARTIES,
        "raw_dir":           TAS_RAW_DIR,
        "exports_dir":       TAS_EXPORTS_DIR,
        "schema_file":       "tas_schema.sql",
        "seats":             25,
        "system":            "hare-clark",
        "booth_level":       False,  # Hare-Clark: no meaningful booth-level breakdown
    },
    "act": {
        "elections":         ACT_ELECTIONS,
        "parties":           ACT_PARTIES,
        "coalition_parties": ACT_COALITION_PARTIES,
        "raw_dir":           ACT_RAW_DIR,
        "exports_dir":       ACT_EXPORTS_DIR,
        "schema_file":       "act_schema.sql",
        "seats":             25,
        "system":            "hare-clark",
        "booth_level":       False,  # Hare-Clark: no meaningful booth-level breakdown
    },
    "nt": {
        "elections":         NT_ELECTIONS,
        "parties":           NT_PARTIES,
        "coalition_parties": NT_COALITION_PARTIES,
        "raw_dir":           NT_RAW_DIR,
        "exports_dir":       NT_EXPORTS_DIR,
        "schema_file":       "nt_schema.sql",
        "seats":             25,
        "system":            "optional-preferential",
        "booth_level":       True,   # NTEC publishes booth-level results
    },
}
