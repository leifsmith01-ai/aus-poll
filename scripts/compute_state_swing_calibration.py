#!/usr/bin/env python3
"""
compute_state_swing_calibration.py
===================================
Compute empirical metro/regional swing multipliers for each Australian state
election model by analysing district-level 2CP swing ratios across historical
election pairs.

Algorithm (per election pair):
  1. Load district-level ALP 2CP % for both elections from the SQLite DB.
  2. Compute per-district swing: alp_2cp_later - alp_2cp_earlier.
  3. Compute enrolment-weighted statewide swing.
  4. Compute swing_ratio = district_swing / statewide_swing per district.
  5. Average swing_ratios by metro/regional classification.
  6. Average those group means across all election pairs → recommended multiplier.

Only ALP-vs-Coalition TCP seats are analysed (Greens/IND matchups excluded).

Usage:
  python scripts/compute_state_swing_calibration.py --state nsw
  python scripts/compute_state_swing_calibration.py --state all
  python scripts/compute_state_swing_calibration.py --state qld --elections 202010 202410

Prerequisites — populate the DB first:
  python main.py --state nsw --year 201503 201903 202303
  python main.py --state qld --year 201711 202010 202410
  python main.py --state wa  --year 201703 202103 202503
  python main.py --state sa  --year 201403 201803 202203
  python main.py --state nt  --year 201608 202008 202408
"""

import argparse
import json
import sqlite3
import statistics
import sys
from pathlib import Path

# ── Path setup ────────────────────────────────────────────────────────────────
ROOT = Path(__file__).parent.parent
# DB filename must match pipeline/config.py (DB_PATH = data/aec_elections.db).
DB_PATH = ROOT / "data" / "aec_elections.db"
CALIB_DIR = ROOT / "data" / "calibration"

# ── Coalition parties per state (mirrors App.jsx model constants) ──────────────
COALITION_PARTIES: dict[str, set[str]] = {
    "nsw": {"LIB", "NAT"},
    "qld": {"LNP"},
    "wa":  {"LIB", "NAT"},
    "sa":  {"LIB"},
    "nt":  {"CLP"},
}

# ── Metro/regional district classifications (mirrors App.jsx constants) ────────
# IMPORTANT: Keep these in sync with the *_DISTRICT_REGION constants in
# webapp/src/App.jsx. When boundaries change, update both files.

NSW_DISTRICT_REGION: dict[str, str] = {
    # inner_metro — dense inner Sydney, GRN-competitive or safe ALP
    "Newtown": "inner_metro", "Balmain": "inner_metro", "Summer Hill": "inner_metro",
    "Maroubra": "inner_metro", "Heffron": "inner_metro", "Kogarah": "inner_metro",
    "Rockdale": "inner_metro", "Strathfield": "inner_metro", "Auburn": "inner_metro",
    "Lakemba": "inner_metro", "Smithfield": "inner_metro",
    # outer_metro — Sydney suburbs + Hunter cities + Illawarra coast
    "Penrith": "outer_metro", "East Hills": "outer_metro", "Ryde": "outer_metro",
    "Coogee": "outer_metro", "Drummoyne": "outer_metro", "Holsworthy": "outer_metro",
    "Heathcote": "outer_metro", "Gosford": "outer_metro", "Terrigal": "outer_metro",
    "Wakehurst": "outer_metro", "Davidson": "outer_metro", "Pittwater": "outer_metro",
    "Epping": "outer_metro", "Lane Cove": "outer_metro", "Willoughby": "outer_metro",
    "Manly": "outer_metro", "Castle Hill": "outer_metro", "Hornsby": "outer_metro",
    "Blue Mountains": "outer_metro", "Liverpool": "outer_metro", "Campbelltown": "outer_metro",
    "Bankstown": "outer_metro", "Swansea": "outer_metro", "Lake Macquarie": "outer_metro",
    "Kotara": "outer_metro", "Charlestown": "outer_metro", "Wallsend": "outer_metro",
    "Newcastle": "outer_metro", "Maitland": "outer_metro",
    "Kiama": "outer_metro", "Keira": "outer_metro", "Wollongong": "outer_metro",
    "Shellharbour": "outer_metro",
    # regional — NP heartland, mining belt
    "Cessnock": "regional", "Monaro": "regional", "Oxley": "regional",
    "Upper Hunter": "regional", "Port Macquarie": "regional", "Tamworth": "regional",
    "Orange": "regional", "Dubbo": "regional", "Murray": "regional",
    "Bathurst": "regional", "Barwon": "regional",
}
NSW_REGION_DEFAULT = "outer_metro"

QLD_DISTRICT_REGION: dict[str, str] = {
    # inner_metro — inner Brisbane (GRN-competitive + safe ALP)
    "South Brisbane": "inner_metro", "Maiwar": "inner_metro", "Cooper": "inner_metro",
    "McConnel": "inner_metro", "Greenslopes": "inner_metro",
    "Inala": "inner_metro", "Toohey": "inner_metro", "Miller": "inner_metro",
    # outer_metro — outer Brisbane + Gold Coast + Sunshine Coast + Townsville
    "Mount Ommaney": "outer_metro", "Oodgeroo": "outer_metro", "Macalister": "outer_metro",
    "Everton": "outer_metro", "Macgregor": "outer_metro", "Stretton": "outer_metro",
    "Waterford": "outer_metro", "Rochedale": "outer_metro",
    "Currumbin": "outer_metro", "Burleigh": "outer_metro",
    "Buderim": "outer_metro", "Caloundra": "outer_metro",
    "Mundingburra": "outer_metro",
    # regional — rural QLD + ON-contested + regional cities
    "Nanango": "regional", "Warrego": "regional", "Gympie": "regional",
    "Mirani": "regional", "Condamine": "regional", "Callide": "regional",
    "Hinchinbrook": "regional", "Southern Downs": "regional",
    "Bundaberg": "regional", "Rockhampton": "regional", "Mulgrave": "regional",
}
QLD_REGION_DEFAULT = "outer_metro"

WA_DISTRICT_REGION: dict[str, str] = {
    # metro — Perth metro belt
    "Carine": "metro", "Bateman": "metro", "Churchlands": "metro", "Moore": "metro",
    "Bicton": "metro", "Dawesville": "metro", "Scarborough": "metro", "Hillarys": "metro",
    "Joondalup": "metro", "Balcatta": "metro", "Midland": "metro", "Armadale": "metro",
    "Mandurah": "metro", "Rockingham": "metro", "Kwinana": "metro",
    "Fremantle": "metro", "Maylands": "metro", "Kalamunda": "metro",
    # regional — South West / rural WA
    "Roe": "regional", "Vasse": "regional",
}
WA_REGION_DEFAULT = "metro"

SA_DISTRICT_REGION: dict[str, str] = {
    # inner_metro — Adelaide inner suburbs
    "Adelaide": "inner_metro", "Unley": "inner_metro",
    # outer_metro — Adelaide suburbs
    "King": "outer_metro", "Gibson": "outer_metro", "Newland": "outer_metro",
    "Florey": "outer_metro", "Kaurna": "outer_metro", "Playford": "outer_metro",
    "Heysen": "outer_metro", "Colton": "outer_metro", "Morialta": "outer_metro",
    "Waite": "outer_metro", "Flinders": "outer_metro", "Bragg": "outer_metro",
    "Hartley": "outer_metro", "Cheltenham": "outer_metro", "Croydon": "outer_metro",
    "Ramsay": "outer_metro", "Lee": "outer_metro",
    # regional — rural SA
    "Mount Gambier": "regional", "Frome": "regional",
}
SA_REGION_DEFAULT = "outer_metro"

NT_DISTRICT_REGION: dict[str, str] = {
    # metro — Darwin urban belt + Palmerston
    "Blain": "metro", "Casuarina": "metro", "Fannie Bay": "metro",
    "Johnston": "metro", "Karama": "metro", "Brennan": "metro",
    "Darwin": "metro", "Goyder": "metro", "Wanguri": "metro", "Drysdale": "metro",
    # regional — remote/bush electorates
    "Arafura": "regional", "Nhulunbuy": "regional",
    "Namatjira": "regional", "Barkly": "regional",
}
NT_REGION_DEFAULT = "metro"

STATE_CONFIG: dict[str, dict] = {
    "nsw": {
        "region_map": NSW_DISTRICT_REGION,
        "region_default": NSW_REGION_DEFAULT,
        "election_pairs": [(201503, 201903), (201903, 202303)],
    },
    "qld": {
        "region_map": QLD_DISTRICT_REGION,
        "region_default": QLD_REGION_DEFAULT,
        "election_pairs": [(201711, 202010), (202010, 202410)],
    },
    "wa": {
        "region_map": WA_DISTRICT_REGION,
        "region_default": WA_REGION_DEFAULT,
        "election_pairs": [(201703, 202103), (202103, 202503)],
    },
    "sa": {
        "region_map": SA_DISTRICT_REGION,
        "region_default": SA_REGION_DEFAULT,
        "election_pairs": [(201403, 201803), (201803, 202203)],
    },
    "nt": {
        "region_map": NT_DISTRICT_REGION,
        "region_default": NT_REGION_DEFAULT,
        "election_pairs": [(201608, 202008), (202008, 202408)],
    },
}

ALL_STATES = list(STATE_CONFIG.keys())


# ── Database helpers ───────────────────────────────────────────────────────────

def _check_table_exists(conn: sqlite3.Connection, table: str) -> bool:
    row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table,)
    ).fetchone()
    return row is not None


def _check_election_exists(conn: sqlite3.Connection, state: str, election_id: int) -> bool:
    table = f"{state}_elections"
    if not _check_table_exists(conn, table):
        return False
    row = conn.execute(
        f"SELECT election_id FROM {table} WHERE election_id = ?", (election_id,)
    ).fetchone()
    return row is not None


def get_district_2cp(conn: sqlite3.Connection, state: str, election_id: int,
                     coalition: set[str]) -> dict[str, float]:
    """Return {district_name: alp_2cp_pct} for ALP-vs-Coalition seats only."""
    table_2cp = f"{state}_district_2cp"
    table_cand = f"{state}_candidates"
    table_dist = f"{state}_districts"

    # Check tables exist
    for t in (table_2cp, table_cand, table_dist):
        if not _check_table_exists(conn, t):
            return {}

    placeholders = ",".join("?" * len(coalition))
    rows = conn.execute(
        f"""
        SELECT d.district_name, c.party_ab, t.vote_pct
        FROM {table_2cp} t
        JOIN {table_cand} c ON c.candidate_id = t.candidate_id
                            AND c.election_id  = t.election_id
        JOIN {table_dist} d ON d.district_id   = t.district_id
                            AND d.election_id   = t.election_id
        WHERE t.election_id = ?
          AND c.party_ab IN ('ALP', {placeholders})
        ORDER BY d.district_name, c.party_ab
        """,
        (election_id, *coalition),
    ).fetchall()

    # Build district → {party_ab: pct}
    by_district: dict[str, dict[str, float]] = {}
    for district_name, party_ab, vote_pct in rows:
        by_district.setdefault(district_name, {})[party_ab] = vote_pct or 0.0

    # Only seats where ALP is one of the final two
    result: dict[str, float] = {}
    for dname, parties in by_district.items():
        if "ALP" in parties:
            result[dname] = parties["ALP"]
    return result


def get_enrolments(conn: sqlite3.Connection, state: str, election_id: int) -> dict[str, int]:
    """Return {district_name: enrolment}."""
    table = f"{state}_districts"
    if not _check_table_exists(conn, table):
        return {}
    rows = conn.execute(
        f"SELECT district_name, enrolment FROM {table} WHERE election_id = ?",
        (election_id,),
    ).fetchall()
    return {r[0]: int(r[1]) if r[1] else 1 for r in rows}


# ── Core calibration ───────────────────────────────────────────────────────────

def calibrate_pair(
    state: str,
    baseline_id: int,
    election_id: int,
    region_map: dict[str, str],
    region_default: str,
) -> dict:
    """Compute swing ratios for one state and one election pair."""
    if not DB_PATH.exists():
        return {"error": f"Database not found at {DB_PATH}. Run the pipeline first."}

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        coalition = COALITION_PARTIES[state]

        # Check elections are populated
        for eid in (baseline_id, election_id):
            if not _check_election_exists(conn, state, eid):
                return {
                    "error": (
                        f"Election {eid} not found in DB for {state.upper()}. "
                        f"Run: python main.py --state {state} --year {eid}"
                    )
                }

        baseline_2cp  = get_district_2cp(conn, state, baseline_id,  coalition)
        election_2cp  = get_district_2cp(conn, state, election_id,   coalition)
        enrolments    = get_enrolments(conn, state, election_id)
    finally:
        conn.close()

    common = sorted(set(baseline_2cp) & set(election_2cp))
    if not common:
        return {"error": f"No common ALP-vs-Coalition districts for {state.upper()} {baseline_id}→{election_id}"}

    # Per-district swing
    districts = []
    for dname in common:
        swing  = election_2cp[dname] - baseline_2cp[dname]
        region = region_map.get(dname, region_default)
        enrol  = enrolments.get(dname, 1)
        districts.append({
            "name":      dname,
            "region":    region,
            "baseline":  round(baseline_2cp[dname], 3),
            "election":  round(election_2cp[dname],  3),
            "swing":     round(swing, 3),
            "enrolment": enrol,
        })

    # Enrolment-weighted statewide swing
    total_enrol = sum(d["enrolment"] for d in districts)
    statewide_swing = sum(d["swing"] * d["enrolment"] for d in districts) / total_enrol

    if abs(statewide_swing) < 0.1:
        return {
            "error": (
                f"Statewide swing ({statewide_swing:+.2f}pp) is too small to compute "
                "meaningful ratios. Election pair may be near-uniform."
            )
        }

    # Swing ratios
    for d in districts:
        d["ratio"] = round(d["swing"] / statewide_swing, 4)

    # Aggregate by region
    region_ratios: dict[str, list[float]] = {}
    for d in districts:
        region_ratios.setdefault(d["region"], []).append(d["ratio"])

    summary = {}
    for region in sorted(region_ratios):
        ratios = region_ratios[region]
        summary[region] = {
            "mean_ratio":   round(statistics.mean(ratios), 3),
            "median_ratio": round(statistics.median(ratios), 3),
            "stdev":        round(statistics.stdev(ratios), 3) if len(ratios) > 1 else 0.0,
            "n":            len(ratios),
        }

    return {
        "state":               state.upper(),
        "baseline_election":   baseline_id,
        "election":            election_id,
        "statewide_swing_pp":  round(statewide_swing, 3),
        "n_districts":         len(districts),
        "districts":           districts,
        "summary":             summary,
    }


def recommend_multipliers(results: list[dict]) -> dict[str, dict]:
    """Average mean_ratio across all valid election pairs per region."""
    all_ratios: dict[str, list[float]] = {}
    for r in results:
        if "error" in r:
            continue
        for region, stats in r["summary"].items():
            all_ratios.setdefault(region, []).append(stats["mean_ratio"])

    recommended: dict[str, dict] = {}
    for region in sorted(all_ratios):
        ratios = all_ratios[region]
        recommended[region] = {
            "recommended_multiplier": round(statistics.mean(ratios), 2),
            "n_election_pairs":       len(ratios),
            "values":                 [round(r, 3) for r in ratios],
        }
    return recommended


# ── Reporting ─────────────────────────────────────────────────────────────────

def _year_label(election_id: int) -> str:
    s = str(election_id)
    return f"{s[:4]}"


def print_pair_result(r: dict) -> None:
    if "error" in r:
        print(f"  ERROR: {r['error']}")
        return

    state        = r["state"]
    bl           = r["baseline_election"]
    el           = r["election"]
    swing        = r["statewide_swing_pp"]
    n            = r["n_districts"]
    direction    = "ALP" if swing > 0 else "Coal"
    print(f"\n  {state} {_year_label(bl)}→{_year_label(el)}  "
          f"(statewide swing: {swing:+.2f}pp {direction})")
    print(f"  Districts analysed: {n} (ALP-vs-Coalition TCP seats only)")

    # Table
    col_w = max(len(k) for k in r["summary"]) + 2
    header = f"  {'Region':<{col_w}}  {'Mean ×':>8}  {'Median':>8}  {'StDev':>6}  {'n':>4}"
    print(header)
    print("  " + "─" * (len(header) - 2))
    for region, s in r["summary"].items():
        print(
            f"  {region:<{col_w}}  {s['mean_ratio']:>8.3f}  "
            f"{s['median_ratio']:>8.3f}  {s['stdev']:>6.3f}  {s['n']:>4}"
        )


def print_recommendations(state: str, rec: dict[str, dict]) -> None:
    print(f"\n  Recommended multipliers for {state.upper()}:")
    parts = []
    for region, info in rec.items():
        mult = info["recommended_multiplier"]
        n    = info["n_election_pairs"]
        vals = ", ".join(str(v) for v in info["values"])
        parts.append(f"{region}: {mult:.2f} (from {n} pair(s): {vals})")
    print("    " + " · ".join(parts))

    # JS object literal for App.jsx
    js_entries = ", ".join(
        f'"{r}": {info["recommended_multiplier"]:.2f}'
        for r, info in rec.items()
    )
    print("\n  → Paste into App.jsx:")
    print(f"    const {state.upper()}_REGION_SWING_MULT = {{ {js_entries} }};")


# ── CLI entry point ────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Compute state metro/regional swing multipliers from historical election data."
    )
    parser.add_argument(
        "--state", required=True,
        help=f"State abbreviation or 'all'. Choices: {', '.join(ALL_STATES)}, all",
    )
    parser.add_argument(
        "--elections", nargs="+", type=int, metavar="YYYYMM",
        help=(
            "Override election IDs (space-separated, e.g. 201903 202303). "
            "Must be even count — paired as baseline/election pairs."
        ),
    )
    parser.add_argument(
        "--json-out", action="store_true",
        help="Write per-pair JSON files to data/calibration/",
    )
    args = parser.parse_args()

    states = ALL_STATES if args.state == "all" else [args.state.lower()]
    for st in states:
        if st not in STATE_CONFIG:
            parser.error(f"Unknown state '{st}'. Valid: {', '.join(ALL_STATES)}, all")

    print("=" * 62)
    print("  STATE SWING CALIBRATION REPORT")
    print("=" * 62)

    for state in states:
        cfg = STATE_CONFIG[state]
        region_map     = cfg["region_map"]
        region_default = cfg["region_default"]

        # Determine election pairs
        if args.elections:
            ids = args.elections
            if len(ids) % 2 != 0:
                sys.exit("--elections must have an even number of IDs (paired as baseline/election)")
            pairs = [(ids[i], ids[i + 1]) for i in range(0, len(ids), 2)]
        else:
            pairs = cfg["election_pairs"]

        print(f"\n{'─' * 62}")
        print(f"  {state.upper()}")
        print(f"{'─' * 62}")

        results = []
        for baseline_id, election_id in pairs:
            r = calibrate_pair(state, baseline_id, election_id, region_map, region_default)
            results.append(r)
            print_pair_result(r)

            if args.json_out and "error" not in r:
                CALIB_DIR.mkdir(parents=True, exist_ok=True)
                fname = CALIB_DIR / f"state_swing_{state}_{baseline_id}_{election_id}.json"
                fname.write_text(json.dumps(r, indent=2))
                print(f"  Saved: {fname}")

        valid = [r for r in results if "error" not in r]
        if valid:
            rec = recommend_multipliers(valid)
            print_recommendations(state, rec)
        else:
            print(f"\n  No valid results for {state.upper()} — run the pipeline first.")

    print(f"\n{'=' * 62}")
    print("  Done.")
    print("=" * 62)


if __name__ == "__main__":
    main()
