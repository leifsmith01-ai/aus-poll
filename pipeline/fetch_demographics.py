"""
Fetch 2021 Census demographic data for all 151 Australian electorates (CEDs)
from the ABS Census API and write webapp/src/data/demographics.js.

Data sources:
  - ABS 2021 Census API (api.data.abs.gov.au) — SDMX-JSON format
  - Tables: G02 (medians), G37 (tenure), G49 (qualifications), G09 (country of birth)
  - AEC urban/rural classification (hardcoded from AEC published divisions)
  - SEIFA, ATO data: set to null (not available at CED level via simple API)

Run: python pipeline/fetch_demographics.py
"""

import json
import os
import time
import requests

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTPUT_PATH = os.path.join(BASE_DIR, "webapp", "src", "data", "demographics.js")

ABS_BASE = "https://api.data.abs.gov.au/data"

# ─── AEC seat data: (aec_id, name) ───────────────────────────────────────────
# Maps our app's seat IDs to names for ABS lookup
SEATS = [
    (318,"Bean"), (101,"Canberra"), (102,"Fenner"),
    (103,"Banks"), (104,"Barton"), (105,"Bennelong"), (106,"Berowra"),
    (107,"Blaxland"), (108,"Bradfield"), (109,"Calare"), (111,"Chifley"),
    (112,"Cook"), (113,"Cowper"), (114,"Cunningham"), (115,"Dobell"),
    (117,"Eden-Monaro"), (118,"Farrer"), (119,"Fowler"), (120,"Gilmore"),
    (121,"Grayndler"), (122,"Greenway"), (124,"Hughes"), (125,"Hume"),
    (126,"Hunter"), (127,"Kingsford Smith"), (128,"Lindsay"), (130,"Lyne"),
    (131,"Macarthur"), (132,"Mackellar"), (133,"Macquarie"), (315,"McMahon"),
    (134,"Mitchell"), (135,"New England"), (136,"Newcastle"), (137,"North Sydney"),
    (138,"Page"), (139,"Parkes"), (140,"Parramatta"), (249,"Paterson"),
    (144,"Reid"), (145,"Richmond"), (250,"Riverina"), (146,"Robertson"),
    (148,"Shortland"), (149,"Sydney"), (151,"Warringah"), (251,"Watson"),
    (152,"Wentworth"), (153,"Werriwa"), (150,"Whitlam"),
    (306,"Lingiari"), (307,"Solomon"),
    (304,"Blair"), (310,"Bonner"), (155,"Bowman"), (156,"Brisbane"),
    (157,"Capricornia"), (158,"Dawson"), (252,"Dickson"), (159,"Fadden"),
    (160,"Fairfax"), (161,"Fisher"), (311,"Flynn"), (162,"Forde"),
    (163,"Griffith"), (164,"Groom"), (165,"Herbert"), (166,"Hinkler"),
    (167,"Kennedy"), (168,"Leichhardt"), (169,"Lilley"), (302,"Longman"),
    (170,"Maranoa"), (171,"McPherson"), (172,"Moncrieff"), (173,"Moreton"),
    (174,"Oxley"), (175,"Petrie"), (176,"Rankin"), (177,"Ryan"),
    (178,"Wide Bay"), (316,"Wright"),
    (179,"Adelaide"), (180,"Barker"), (182,"Boothby"), (183,"Grey"),
    (185,"Hindmarsh"), (186,"Kingston"), (187,"Makin"), (188,"Mayo"),
    (325,"Spence"), (190,"Sturt"),
    (192,"Bass"), (193,"Braddon"), (319,"Clark"), (195,"Franklin"), (196,"Lyons"),
    (197,"Aston"), (198,"Ballarat"), (200,"Bendigo"), (201,"Bruce"),
    (203,"Calwell"), (204,"Casey"), (205,"Chisholm"), (320,"Cooper"),
    (328,"Corangamite"), (208,"Corio"), (209,"Deakin"), (210,"Dunkley"),
    (211,"Flinders"), (321,"Fraser"), (212,"Gellibrand"), (213,"Gippsland"),
    (214,"Goldstein"), (309,"Gorton"), (326,"Hawke"), (215,"Higgins"),
    (216,"Holt"), (217,"Hotham"), (218,"Indi"), (219,"Isaacs"),
    (220,"Jagajaga"), (221,"Kooyong"), (223,"La Trobe"), (222,"Lalor"),
    (322,"Macnamara"), (224,"Mallee"), (225,"Maribyrnong"), (226,"McEwen"),
    (228,"Melbourne"), (229,"Menzies"), (323,"Monash"), (324,"Nicholls"),
    (232,"Scullin"), (233,"Wannon"), (234,"Wills"),
    (235,"Brand"), (317,"Burt"), (236,"Canning"), (237,"Cowan"),
    (238,"Curtin"), (312,"Durack"), (239,"Forrest"), (240,"Fremantle"),
    (305,"Hasluck"), (242,"Moore"), (243,"O'Connor"), (244,"Pearce"),
    (245,"Perth"), (247,"Swan"), (248,"Tangney"),
]
# Name → AEC id lookup
NAME_TO_AEC = {name.lower(): aec_id for aec_id, name in SEATS}

# ─── AEC Urban Classification ─────────────────────────────────────────────────
URBAN_CLASS = {
    318: "Outer Metropolitan",   # Bean
    101: "Inner Metropolitan",   # Canberra
    102: "Outer Metropolitan",   # Fenner
    103: "Outer Metropolitan",   # Banks
    104: "Inner Metropolitan",   # Barton
    105: "Outer Metropolitan",   # Bennelong
    106: "Outer Metropolitan",   # Berowra
    107: "Outer Metropolitan",   # Blaxland
    108: "Outer Metropolitan",   # Bradfield
    109: "Rural",                # Calare
    111: "Outer Metropolitan",   # Chifley
    112: "Outer Metropolitan",   # Cook
    113: "Rural",                # Cowper
    114: "Provincial",           # Cunningham
    115: "Outer Metropolitan",   # Dobell
    117: "Rural",                # Eden-Monaro
    118: "Rural",                # Farrer
    119: "Outer Metropolitan",   # Fowler
    120: "Provincial",           # Gilmore
    121: "Inner Metropolitan",   # Grayndler
    122: "Outer Metropolitan",   # Greenway
    124: "Outer Metropolitan",   # Hughes
    125: "Outer Metropolitan",   # Hume
    126: "Provincial",           # Hunter
    127: "Inner Metropolitan",   # Kingsford Smith
    128: "Outer Metropolitan",   # Lindsay
    130: "Rural",                # Lyne
    131: "Outer Metropolitan",   # Macarthur
    132: "Outer Metropolitan",   # Mackellar
    133: "Outer Metropolitan",   # Macquarie
    315: "Outer Metropolitan",   # McMahon
    134: "Outer Metropolitan",   # Mitchell
    135: "Rural",                # New England
    136: "Provincial",           # Newcastle
    137: "Outer Metropolitan",   # North Sydney
    138: "Rural",                # Page
    139: "Rural",                # Parkes
    140: "Outer Metropolitan",   # Parramatta
    249: "Outer Metropolitan",   # Paterson
    144: "Outer Metropolitan",   # Reid
    145: "Rural",                # Richmond
    250: "Rural",                # Riverina
    146: "Outer Metropolitan",   # Robertson
    148: "Provincial",           # Shortland
    149: "Inner Metropolitan",   # Sydney
    151: "Outer Metropolitan",   # Warringah
    251: "Inner Metropolitan",   # Watson
    152: "Outer Metropolitan",   # Wentworth
    153: "Outer Metropolitan",   # Werriwa
    150: "Provincial",           # Whitlam
    306: "Rural",                # Lingiari
    307: "Provincial",           # Solomon
    304: "Outer Metropolitan",   # Blair
    310: "Outer Metropolitan",   # Bonner
    155: "Outer Metropolitan",   # Bowman
    156: "Inner Metropolitan",   # Brisbane
    157: "Provincial",           # Capricornia
    158: "Rural",                # Dawson
    252: "Outer Metropolitan",   # Dickson
    159: "Outer Metropolitan",   # Fadden
    160: "Outer Metropolitan",   # Fairfax
    161: "Outer Metropolitan",   # Fisher
    311: "Rural",                # Flynn
    162: "Outer Metropolitan",   # Forde
    163: "Inner Metropolitan",   # Griffith
    164: "Provincial",           # Groom
    165: "Provincial",           # Herbert
    166: "Rural",                # Hinkler
    167: "Rural",                # Kennedy
    168: "Provincial",           # Leichhardt
    169: "Outer Metropolitan",   # Lilley
    302: "Outer Metropolitan",   # Longman
    170: "Rural",                # Maranoa
    171: "Outer Metropolitan",   # McPherson
    172: "Outer Metropolitan",   # Moncrieff
    173: "Outer Metropolitan",   # Moreton
    174: "Outer Metropolitan",   # Oxley
    175: "Outer Metropolitan",   # Petrie
    176: "Outer Metropolitan",   # Rankin
    177: "Outer Metropolitan",   # Ryan
    178: "Rural",                # Wide Bay
    316: "Outer Metropolitan",   # Wright
    179: "Inner Metropolitan",   # Adelaide
    180: "Rural",                # Barker
    182: "Outer Metropolitan",   # Boothby
    183: "Rural",                # Grey
    185: "Inner Metropolitan",   # Hindmarsh
    186: "Outer Metropolitan",   # Kingston
    187: "Outer Metropolitan",   # Makin
    188: "Provincial",           # Mayo
    325: "Outer Metropolitan",   # Spence
    190: "Outer Metropolitan",   # Sturt
    192: "Provincial",           # Bass
    193: "Rural",                # Braddon
    319: "Provincial",           # Clark
    195: "Provincial",           # Franklin
    196: "Rural",                # Lyons
    197: "Outer Metropolitan",   # Aston
    198: "Provincial",           # Ballarat
    200: "Provincial",           # Bendigo
    201: "Outer Metropolitan",   # Bruce
    203: "Outer Metropolitan",   # Calwell
    204: "Outer Metropolitan",   # Casey
    205: "Outer Metropolitan",   # Chisholm
    320: "Inner Metropolitan",   # Cooper
    328: "Outer Metropolitan",   # Corangamite
    208: "Provincial",           # Corio
    209: "Outer Metropolitan",   # Deakin
    210: "Outer Metropolitan",   # Dunkley
    211: "Outer Metropolitan",   # Flinders
    321: "Inner Metropolitan",   # Fraser
    212: "Inner Metropolitan",   # Gellibrand
    213: "Rural",                # Gippsland
    214: "Outer Metropolitan",   # Goldstein
    309: "Outer Metropolitan",   # Gorton
    326: "Outer Metropolitan",   # Hawke
    215: "Inner Metropolitan",   # Higgins
    216: "Outer Metropolitan",   # Holt
    217: "Inner Metropolitan",   # Hotham
    218: "Rural",                # Indi
    219: "Outer Metropolitan",   # Isaacs
    220: "Outer Metropolitan",   # Jagajaga
    221: "Outer Metropolitan",   # Kooyong
    223: "Outer Metropolitan",   # La Trobe
    222: "Outer Metropolitan",   # Lalor
    322: "Outer Metropolitan",   # Macnamara
    224: "Rural",                # Mallee
    225: "Inner Metropolitan",   # Maribyrnong
    226: "Outer Metropolitan",   # McEwen
    228: "Inner Metropolitan",   # Melbourne
    229: "Outer Metropolitan",   # Menzies
    323: "Outer Metropolitan",   # Monash
    324: "Provincial",           # Nicholls
    232: "Outer Metropolitan",   # Scullin
    233: "Rural",                # Wannon
    234: "Inner Metropolitan",   # Wills
    235: "Outer Metropolitan",   # Brand
    317: "Outer Metropolitan",   # Burt
    236: "Outer Metropolitan",   # Canning
    237: "Outer Metropolitan",   # Cowan
    238: "Outer Metropolitan",   # Curtin
    312: "Rural",                # Durack
    239: "Outer Metropolitan",   # Forrest
    240: "Inner Metropolitan",   # Fremantle
    305: "Outer Metropolitan",   # Hasluck
    242: "Outer Metropolitan",   # Moore
    243: "Rural",                # O'Connor
    244: "Outer Metropolitan",   # Pearce
    245: "Inner Metropolitan",   # Perth
    247: "Outer Metropolitan",   # Swan
    248: "Outer Metropolitan",   # Tangney
}


def fetch_json(url: str, retries: int = 4, backoff: float = 2.0) -> dict:
    """Fetch JSON from URL with retries and exponential backoff."""
    for attempt in range(retries):
        try:
            resp = requests.get(url, timeout=90, headers={"Accept": "application/json"})
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            if attempt < retries - 1:
                wait = backoff * (2 ** attempt)
                print(f"  Retry {attempt+1}/{retries-1} after {wait:.0f}s: {e}")
                time.sleep(wait)
            else:
                raise


def parse_sdmx(data: dict) -> tuple:
    """
    Parse SDMX-JSON response into usable structures.

    Returns:
        series_dims: list of {id, name, values: [{id, name}]}
        obs_dim: the observation dimension info
        series_data: dict keyed by tuple of series dim value IDs -> obs value
    """
    structure = data["structure"]
    series_dims_raw = structure["dimensions"]["series"]
    obs_dims_raw = structure["dimensions"].get("observation", [])

    # Build series dim value lookup: dim_id -> {value_id: index, index: value_id}
    series_dims = []
    for d in series_dims_raw:
        vals = d["values"]
        id_to_idx = {v["id"]: i for i, v in enumerate(vals)}
        idx_to_id = {i: v["id"] for i, v in enumerate(vals)}
        idx_to_name = {i: v.get("name", v["id"]) for i, v in enumerate(vals)}
        series_dims.append({
            "id": d["id"],
            "name": d.get("name", d["id"]),
            "values": vals,
            "id_to_idx": id_to_idx,
            "idx_to_id": idx_to_id,
            "idx_to_name": idx_to_name,
        })

    # The series keys in dataSets are "idx0:idx1:idx2:..."
    # Parse all series into a dict: (val_id_dim0, val_id_dim1, ...) -> obs_value
    series_data = {}
    for ds in data["dataSets"]:
        for key_str, series_obj in ds["series"].items():
            # Parse dim indices from key
            indices = [int(x) for x in key_str.split(":")]
            # Map indices to value IDs
            val_ids = tuple(
                series_dims[i]["idx_to_id"].get(idx, str(idx))
                for i, idx in enumerate(indices)
            )
            # Get the observation value (time period 0)
            obs = series_obj.get("observations", {})
            val = obs.get("0", [None])[0] if "0" in obs else None
            series_data[val_ids] = val

    return series_dims, series_data


def get_dim_by_id(series_dims: list, dim_id: str) -> dict | None:
    """Find a dimension by its ID."""
    for d in series_dims:
        if d["id"] == dim_id:
            return d
    return None


def fetch_all_ced(table: str) -> tuple:
    """Fetch all CED data for a given Census table, return (series_dims, series_data)."""
    url = f"{ABS_BASE}/C21_{table}_CED/all?format=jsonstat2"
    print(f"  Fetching {url}")
    data = fetch_json(url)
    return parse_sdmx(data)


# ─── Table-specific parsers ───────────────────────────────────────────────────

def parse_g02(series_dims: list, series_data: dict, region_id: str) -> dict:
    """
    G02: Medians and Averages.
    Returns dict with medianAge, medianPersonalIncomeWeekly, medianHouseholdIncomeWeekly,
    medianMonthlyMortgage, medianWeeklyRent.
    """
    # MEDAVG codes: 1=age, 2=personal income weekly, 3=family, 4=household, 5=mortgage monthly, 6=rent weekly
    result = {}
    region_type_id = "CED"
    state_id = None  # will match any state

    for key, val in series_data.items():
        # key = (medavg_id, region_id, region_type_id, state_id, ...)
        # We need to find entries matching our region
        if len(key) < 2:
            continue
        if key[1] == region_id and key[2] == "CED":
            medavg = key[0]
            result[medavg] = val

    return {
        "medianAge": result.get("1"),
        "medianPersonalIncomeWeekly": result.get("2"),
        "medianHouseholdIncomeWeekly": result.get("4"),
        "medianMonthlyMortgage": result.get("5"),
        "medianWeeklyRent": result.get("6"),
    }


def parse_g37(series_dims: list, series_data: dict, region_id: str) -> dict:
    """
    G37: Tenure Type and Landlord Type by Dwelling Structure.
    Returns owned_outright, owned_mortgage, rented, total counts.
    """
    # Dim order: TENLLD (tenure), STRD (structure), REGION, REGION_TYPE, STATE
    # We want STRD = total (_T) and all TENLLD values
    tenure_dim = get_dim_by_id(series_dims, "TENLLD")
    strd_dim = get_dim_by_id(series_dims, "STRD")

    if not tenure_dim:
        return {"owned_outright": None, "owned_mortgage": None, "rented": None, "total": None}

    # Find total structure code
    strd_total = "_T"
    if strd_dim:
        # Use the "_T" code if present, else last code
        strd_codes = [v["id"] for v in strd_dim["values"]]
        strd_total = "_T" if "_T" in strd_codes else strd_codes[-1]

    # Identify tenure codes by label
    owned_outright_code = None
    owned_mortgage_code = None
    rented_code = None
    total_code = None

    for v in tenure_dim["values"]:
        label = v.get("name", "").lower()
        code = v["id"]
        if "outright" in label:
            owned_outright_code = code
        elif "mortgage" in label and "total" not in label:
            owned_mortgage_code = code
        elif "rent" in label and "total" not in label:
            rented_code = code
        elif code == "_T" or label in ("total", "all"):
            total_code = code

    result = {}
    for code, key_name in [(owned_outright_code, "owned_outright"),
                            (owned_mortgage_code, "owned_mortgage"),
                            (rented_code, "rented"),
                            (total_code, "total")]:
        if code is None:
            result[key_name] = None
            continue
        # Build the key: (TENLLD_code, STRD_total, region_id, CED, ...)
        # The actual key format depends on dim order in this table
        # Search through series_data for matching entry
        val = None
        for key, v in series_data.items():
            if (key[0] == code and
                key[2] == region_id and
                key[3] == "CED"):
                # Check STRD if we have it
                if len(key) > 1 and strd_dim and key[1] != strd_total:
                    continue
                val = v
                break
        result[key_name] = val

    return result


def parse_g37_generic(series_dims: list, series_data: dict, region_id: str) -> dict:
    """
    Generic G37 parser — extracts owned outright, rented (total), total dwellings.
    Owned-with-mortgage is derived as: total - owned_outright - rented - other.

    G37 TENLLD codes: 1=Owned outright, R_T=Rented Total, 9=Other, _T=All tenures total.
    Note: 'Owned with mortgage' is not a separate TENLLD code in the CED-level table.
    """
    region_dim_pos = None
    for i, d in enumerate(series_dims):
        if d["id"] == "REGION":
            region_dim_pos = i
            break

    if region_dim_pos is None:
        return {"owned_outright": None, "owned_mortgage": None, "rented": None, "total": None}

    region_type_pos = None
    for i, d in enumerate(series_dims):
        if "REGION_TYPE" in d["id"]:
            region_type_pos = i
            break

    tenlld_pos = None
    tenlld_dim = None
    for i, d in enumerate(series_dims):
        if d["id"] == "TENLLD":
            tenlld_pos = i
            tenlld_dim = d
            break

    strd_pos = None
    strd_total_id = "_T"
    for i, d in enumerate(series_dims):
        if d["id"] == "STRD":
            strd_pos = i
            strd_codes = [v["id"] for v in d["values"]]
            strd_total_id = "_T" if "_T" in strd_codes else strd_codes[-1]
            break

    if tenlld_pos is None:
        return {"owned_outright": None, "owned_mortgage": None, "rented": None, "total": None}

    # Identify codes by label — specifically look for R_T as rented total
    owned_outright_code = None
    rented_total_code = None   # specifically "Rented: Total" (code R_T)
    other_code = None
    total_code = None

    for v in tenlld_dim["values"]:
        label = v.get("name", "").lower()
        code = v["id"]
        if "outright" in label:
            owned_outright_code = code
        elif ("rented: total" in label or "rented total" in label or
              code == "R_T"):
            rented_total_code = code
        elif "other tenure" in label or code == "9":
            other_code = code
        elif code == "_T" or label in ("total", "all"):
            total_code = code

    result = {"owned_outright": None, "owned_mortgage": None, "rented": None, "total": None,
              "other": None}

    for key, val in series_data.items():
        if key[region_dim_pos] != region_id:
            continue
        if region_type_pos is not None and key[region_type_pos] != "CED":
            continue
        if strd_pos is not None and key[strd_pos] != strd_total_id:
            continue

        tenlld_val = key[tenlld_pos]
        if tenlld_val == owned_outright_code:
            result["owned_outright"] = val
        elif tenlld_val == rented_total_code:
            result["rented"] = val
        elif tenlld_val == other_code:
            result["other"] = val
        elif tenlld_val == total_code:
            result["total"] = val

    # Derive owned-with-mortgage as total - owned_outright - rented - other
    if (result["total"] is not None and result["owned_outright"] is not None and
            result["rented"] is not None):
        other = result["other"] or 0
        result["owned_mortgage"] = max(0, result["total"] - result["owned_outright"] -
                                       result["rented"] - other)

    return result


def parse_g49(series_dims: list, series_data: dict, region_id: str) -> dict:
    """
    G49: Non-School Qualifications by Field of Study.
    Find bachelor+ percentage.
    """
    # Dims: SEXP (sex), QALLP (qual level), AGEP (age), REGION, REGION_TYPE, STATE

    region_dim_pos = None
    for i, d in enumerate(series_dims):
        if d["id"] == "REGION":
            region_dim_pos = i
            break

    region_type_pos = None
    for i, d in enumerate(series_dims):
        if "REGION_TYPE" in d["id"]:
            region_type_pos = i
            break

    qual_pos = None
    qual_dim = None
    for i, d in enumerate(series_dims):
        if "QALLP" in d["id"] or "QUAL" in d["id"]:
            # Verify by checking labels
            vals_lower = [v.get("name","").lower() for v in d["values"]]
            if any("bachelor" in l or "degree" in l or "qual" in l for l in vals_lower):
                qual_pos = i
                qual_dim = d
                break

    if region_dim_pos is None or qual_pos is None:
        return {"bachelors_plus": None, "total_qual": None}

    # Find codes for bachelor's and above
    bach_codes = set()
    total_code = None
    for v in qual_dim["values"]:
        label = v.get("name", "").lower()
        code = v["id"]
        if any(w in label for w in ["bachelor", "postgrad", "doctoral", "masters", "graduate diploma", "graduate certificate"]):
            bach_codes.add(code)
        elif code == "_T" or label in ("total", "all", "all non-school qualifications"):
            total_code = code

    # Find sex dim and get "Persons" total code
    sexp_pos = None
    sexp_total = None
    for i, d in enumerate(series_dims):
        if d["id"] in ("SEXP", "SEX"):
            sexp_pos = i
            for v in d["values"]:
                label = v.get("name", "").lower()
                if "person" in label or v["id"] == "_T" or label == "total":
                    sexp_total = v["id"]
                    break
            if sexp_total is None and d["values"]:
                sexp_total = d["values"][-1]["id"]  # assume last is total
            break

    # Find age dim and get "Total" code
    agep_pos = None
    agep_total = None
    for i, d in enumerate(series_dims):
        if d["id"] in ("AGEP", "AGE"):
            agep_pos = i
            for v in d["values"]:
                label = v.get("name", "").lower()
                if v["id"] == "_T" or label in ("total", "all ages"):
                    agep_total = v["id"]
                    break
            if agep_total is None and d["values"]:
                agep_total = d["values"][-1]["id"]
            break

    bach_total = 0
    total_qual = 0

    for key, val in series_data.items():
        if val is None:
            continue
        if key[region_dim_pos] != region_id:
            continue
        if region_type_pos is not None and key[region_type_pos] != "CED":
            continue
        if sexp_pos is not None and sexp_total and key[sexp_pos] != sexp_total:
            continue
        # Must use all-ages to get total qualification counts
        if agep_pos is not None and agep_total and key[agep_pos] != agep_total:
            continue

        qual_code = key[qual_pos]
        if qual_code in bach_codes:
            bach_total += val
        elif qual_code == total_code:
            total_qual = val

    return {"bachelors_plus": bach_total, "total_qual": total_qual}


def find_agep_total(series_dims: list) -> tuple:
    """Find AGEP dim position and its total code."""
    for i, d in enumerate(series_dims):
        if d["id"] in ("AGEP", "AGE"):
            for v in d["values"]:
                if v["id"] == "_T" or v.get("name", "").lower() in ("total", "all ages"):
                    return i, v["id"]
            if d["values"]:
                return i, d["values"][-1]["id"]
    return None, None


def parse_g09(series_dims: list, series_data: dict, region_id: str) -> float | None:
    """
    G09: Country of Birth of Person by Sex.
    Returns overseas-born percentage.
    """
    region_dim_pos = None
    for i, d in enumerate(series_dims):
        if d["id"] == "REGION":
            region_dim_pos = i
            break

    region_type_pos = None
    for i, d in enumerate(series_dims):
        if "REGION_TYPE" in d["id"]:
            region_type_pos = i
            break

    # Find country-of-birth dim
    cob_pos = None
    cob_dim = None
    for i, d in enumerate(series_dims):
        if "BPLP" in d["id"] or "BIRTH" in d["id"].upper() or "COUNTRY" in d["id"].upper():
            cob_pos = i
            cob_dim = d
            break

    # Find sex dim for Persons total
    sexp_pos = None
    sexp_total = None
    for i, d in enumerate(series_dims):
        if d["id"] in ("SEXP", "SEX"):
            sexp_pos = i
            for v in d["values"]:
                label = v.get("name", "").lower()
                if "person" in label or v["id"] == "_T" or label == "total":
                    sexp_total = v["id"]
                    break
            if sexp_total is None and d["values"]:
                sexp_total = d["values"][-1]["id"]
            break

    # Find age dim for Total
    agep_pos = None
    agep_total = None
    for i, d in enumerate(series_dims):
        if d["id"] in ("AGEP", "AGE"):
            agep_pos = i
            for v in d["values"]:
                code = v["id"]
                label = v.get("name", "").lower()
                if code == "_T" or label in ("total", "all ages"):
                    agep_total = code
                    break
            if agep_total is None and d["values"]:
                agep_total = d["values"][-1]["id"]
            break

    if region_dim_pos is None or cob_pos is None:
        return None

    # Find Australia and Total codes
    aus_code = None
    total_code = None
    for v in cob_dim["values"]:
        label = v.get("name", "").lower()
        code = v["id"]
        if "australia" in label and "not" not in label and aus_code is None:
            aus_code = code
        if code == "_T" or label in ("total", "total - country of birth"):
            total_code = code

    if not aus_code or not total_code:
        return None

    total_val = None
    aus_val = None

    for key, val in series_data.items():
        if val is None:
            continue
        if key[region_dim_pos] != region_id:
            continue
        if region_type_pos is not None and key[region_type_pos] != "CED":
            continue
        if sexp_pos is not None and sexp_total and key[sexp_pos] != sexp_total:
            continue
        # Must be all-ages total to get overall overseas born %
        if agep_pos is not None and agep_total and key[agep_pos] != agep_total:
            continue

        cob_code = key[cob_pos]
        if cob_code == total_code:
            total_val = val
        elif cob_code == aus_code:
            aus_val = val

    if total_val and aus_val and total_val > 0:
        return round((total_val - aus_val) / total_val * 100, 1)
    return None


def main():
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)

    print("=" * 60)
    print("Fetching ABS 2021 Census demographic data for 151 CEDs")
    print("=" * 60)

    # ── Fetch all tables ──────────────────────────────────────────────────────
    print("\nFetching G02 (medians)...")
    g02_dims, g02_data = fetch_all_ced("G02")

    print("\nFetching G37 (tenure)...")
    g37_dims, g37_data = fetch_all_ced("G37")

    print("\nFetching G49 (qualifications)...")
    g49_dims, g49_data = fetch_all_ced("G49")

    print("\nFetching G09 (country of birth)...")
    g09_dims, g09_data = fetch_all_ced("G09")

    # Print dim structure for debugging
    print("\nG02 dims:", [d["id"] for d in g02_dims])
    print("G37 dims:", [d["id"] for d in g37_dims])
    print("G49 dims:", [d["id"] for d in g49_dims])
    print("G09 dims:", [d["id"] for d in g09_dims])

    # ── Build ABS region_id -> name mapping from G02 ─────────────────────────
    region_dim_g02 = get_dim_by_id(g02_dims, "REGION")
    abs_name_to_id = {}
    if region_dim_g02:
        for v in region_dim_g02["values"]:
            abs_name_to_id[v["name"].lower()] = v["id"]

    # Build AEC seat id -> ABS region id mapping via name matching
    aec_to_abs = {}
    unmatched = []
    for aec_id, name in SEATS:
        name_lower = name.lower()
        abs_id = abs_name_to_id.get(name_lower)
        if abs_id:
            aec_to_abs[aec_id] = abs_id
        else:
            # Try apostrophe variants
            for variant in [name_lower.replace("'", "'"), name_lower.replace("'", "")]:
                abs_id = abs_name_to_id.get(variant)
                if abs_id:
                    aec_to_abs[aec_id] = abs_id
                    break
            if aec_id not in aec_to_abs:
                unmatched.append((aec_id, name))

    print(f"\nMatched {len(aec_to_abs)}/151 seats to ABS region codes")
    if unmatched:
        print(f"Unmatched seats: {unmatched}")
        print("Available ABS names (first 20):", list(abs_name_to_id.keys())[:20])

    # ── Also get G37/G49/G09 region dims for matching ──────────────────────────
    region_dim_g37 = get_dim_by_id(g37_dims, "REGION")
    region_dim_g49 = get_dim_by_id(g49_dims, "REGION")
    region_dim_g09 = get_dim_by_id(g09_dims, "REGION")

    # Debug: print G37 dim structure
    print("\nG37 dim details:")
    for d in g37_dims:
        vals = d["values"]
        print(f"  {d['id']}: {[v['id'] for v in vals[:8]]}")
        if d['id'] != 'REGION':
            print(f"    Labels: {[v.get('name','') for v in vals[:8]]}")

    print("\nG49 dim details:")
    for d in g49_dims:
        vals = d["values"]
        print(f"  {d['id']}: {[v['id'] for v in vals[:8]]}")
        if d['id'] not in ('REGION', 'STATE'):
            print(f"    Labels: {[v.get('name','') for v in vals[:8]]}")

    print("\nG09 dim details:")
    for d in g09_dims:
        vals = d["values"]
        print(f"  {d['id']}: {[v['id'] for v in vals[:8]]}")
        if d['id'] not in ('REGION', 'STATE'):
            print(f"    Labels: {[v.get('name','') for v in vals[:8]]}")

    # ── Assemble demographics for each seat ───────────────────────────────────
    print("\n" + "=" * 60)
    print("Assembling demographic records...")
    print("=" * 60)

    demographics = {}
    for aec_id, name in SEATS:
        abs_id = aec_to_abs.get(aec_id)

        if not abs_id:
            # Use nulls for unmatched seats
            demographics[aec_id] = {
                "medianAge": None, "medianPersonalIncome": None,
                "medianHouseholdIncome": None, "medianWeeklyRent": None,
                "medianMonthlyMortgage": None, "ownerOutrightPct": None,
                "ownerMortgagePct": None, "renterPct": None,
                "bachelorsOrAbovePct": None, "overseasBornPct": None,
                "seifaIRSD": None, "rentalStressPct": None,
                "mortgageStressPct": None, "avgTaxableIncome": None,
                "investPropertyPct": None, "avgNetRentalIncome": None,
                "urbanClass": URBAN_CLASS.get(aec_id, "Outer Metropolitan"),
            }
            continue

        # G02 medians
        g02 = parse_g02(g02_dims, g02_data, abs_id)
        age = g02["medianAge"]
        personal_weekly = g02["medianPersonalIncomeWeekly"]
        household_weekly = g02["medianHouseholdIncomeWeekly"]
        mortgage = g02["medianMonthlyMortgage"]
        rent = g02["medianWeeklyRent"]

        # G37 tenure
        g37 = parse_g37_generic(g37_dims, g37_data, abs_id)
        total_dwellings = g37["total"]
        owned_outright = g37["owned_outright"]
        owned_mortgage = g37["owned_mortgage"]
        rented = g37["rented"]

        owner_outright_pct = None
        owner_mortgage_pct = None
        renter_pct = None
        if total_dwellings and total_dwellings > 0:
            owner_outright_pct = round(owned_outright / total_dwellings * 100, 1) if owned_outright else None
            owner_mortgage_pct = round(owned_mortgage / total_dwellings * 100, 1) if owned_mortgage else None
            renter_pct = round(rented / total_dwellings * 100, 1) if rented else None

        # G49 qualifications
        g49 = parse_g49(g49_dims, g49_data, abs_id)
        bach_pct = None
        if g49["total_qual"] and g49["total_qual"] > 0 and g49["bachelors_plus"]:
            bach_pct = round(g49["bachelors_plus"] / g49["total_qual"] * 100, 1)

        # G09 overseas born
        overseas_pct = parse_g09(g09_dims, g09_data, abs_id)

        demographics[aec_id] = {
            "medianAge": int(age) if age is not None else None,
            "medianPersonalIncome": int(personal_weekly * 52) if personal_weekly else None,
            "medianHouseholdIncome": int(household_weekly * 52) if household_weekly else None,
            "medianWeeklyRent": int(rent) if rent else None,
            "medianMonthlyMortgage": int(mortgage) if mortgage else None,
            "ownerOutrightPct": owner_outright_pct,
            "ownerMortgagePct": owner_mortgage_pct,
            "renterPct": renter_pct,
            "bachelorsOrAbovePct": bach_pct,
            "overseasBornPct": overseas_pct,
            "seifaIRSD": None,
            "rentalStressPct": None,
            "mortgageStressPct": None,
            "avgTaxableIncome": None,
            "investPropertyPct": None,
            "avgNetRentalIncome": None,
            "urbanClass": URBAN_CLASS.get(aec_id, "Outer Metropolitan"),
        }

    # ── Write output file ─────────────────────────────────────────────────────
    print(f"\nWriting {len(demographics)} records to {OUTPUT_PATH}")

    non_null = sum(1 for d in demographics.values() if d.get("medianAge") is not None)
    print(f"Records with medianAge populated: {non_null}/{len(demographics)}")

    lines = [
        "// Auto-generated by pipeline/fetch_demographics.py",
        "// ABS 2021 Census data for all 151 Australian electorates (CEDs)",
        "// null = data not available at CED level via ABS API",
        "",
        "const DEMOGRAPHICS = {",
    ]

    for aec_id, d in sorted(demographics.items()):
        lines.append(f"  {aec_id}: {{")
        for k, v in d.items():
            if v is None:
                lines.append(f"    {k}: null,")
            elif isinstance(v, str):
                lines.append(f'    {k}: "{v}",')
            else:
                lines.append(f"    {k}: {v},")
        lines.append("  },")

    lines.append("};")
    lines.append("")
    lines.append("export default DEMOGRAPHICS;")
    lines.append("")

    with open(OUTPUT_PATH, "w") as f:
        f.write("\n".join(lines))

    print(f"Done! Written to {OUTPUT_PATH}")

    # Print sample
    sample_id = 101  # Canberra
    if sample_id in demographics:
        print(f"\nSample record (Canberra, AEC {sample_id}):")
        print(json.dumps(demographics[sample_id], indent=2))


if __name__ == "__main__":
    main()
