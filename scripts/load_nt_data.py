#!/usr/bin/env python3
"""
load_nt_data.py
===============
Directly populate NT election data scraped from ntec.nt.gov.au into the SQLite DB.

Elections: 201608 (2016), 202008 (2020), 202408 (2024)

Data source: NTEC results pages
  https://ntec.nt.gov.au/elections/past-elections/legislative-assembly/
    {year}-territory-election/results/nt-summary-of-two-candidate-preferred-votes-by-division
"""

import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))
from pipeline.config import DB_PATH

# ── 2CP data: {election_id: {district_name: (alp_votes, clp_votes)}} ──────────
# Only ALP vs CLP seats included (GRN/IND matchups excluded).

NT_TCP = {
    201608: {
        # 2016 NT Territory Election — 27 August 2016
        # Source: ntec.nt.gov.au/elections/past-elections/legislative-assembly/
        #         2016-territory-election/results/nt-summary-of-two-candidate-preferred-votes-by-division
        "Arafura":    (1234, 1020),
        "Arnhem":     (1777,  985),
        "Braitling":  (2314, 2287),
        "Brennan":    (2077, 1869),
        "Casuarina":  (2688, 1694),
        "Daly":       (1617, 1772),
        "Drysdale":   (1971, 1597),
        "Fannie Bay": (2688, 1499),
        "Fong Lim":   (2171, 1588),
        "Johnston":   (2453, 1339),
        "Katherine":  (1843, 1810),
        "Namatjira":  (1742, 1235),
        "Nightcliff": (3049,  918),
        "Port Darwin":(1875, 1676),
        "Sanderson":  (2578, 1680),
        "Spillett":   (1428, 2438),
        "Stuart":     (2114,  690),
        "Wanguri":    (3026, 1302),
    },
    202008: {
        # 2020 NT Territory Election — 22 August 2020
        # Source: ntec.nt.gov.au/elections/past-elections/legislative-assembly/
        #         2020-territory-election/results/nt-summary-of-two-candidate-preferred-votes-by-division
        "Arafura":    (1388, 1203),
        "Barkly":     (1717, 1724),
        "Blain":      (2095, 2082),
        "Braitling":  (2141, 2254),
        "Brennan":    (2138, 2242),
        "Casuarina":  (3035, 1566),
        "Daly":       (1890, 1984),
        "Drysdale":   (2261, 1644),
        "Fannie Bay": (2588, 1757),
        "Fong Lim":   (2197, 1978),
        "Gwoja":      (1760,  898),
        "Johnston":   (2850, 1434),
        "Karama":     (2491, 1678),
        "Katherine":  (1853, 2033),
        "Namatjira":  (1792, 1814),
        "Nightcliff": (3286, 1139),
        "Port Darwin":(2241, 2060),
        "Sanderson":  (3044, 1351),
        "Spillett":   (1730, 3219),
        "Wanguri":    (3349, 1627),
    },
    202408: {
        # 2024 NT Territory Election — 24 August 2024
        # Source: ntec.nt.gov.au/elections/past-elections/legislative-assembly/
        #         2024-territory-election/results/nt-summary-of-two-candidate-preferred-votes-by-division
        "Araluen":    (1418, 2603),
        "Blain":      (2116, 1959),
        "Braitling":  (2261, 1937),
        "Casuarina":  (2299, 2365),
        "Drysdale":   (1473, 2731),
        "Fannie Bay": (2349, 2312),
        "Fong Lim":   (1797, 2428),
        "Goyder":     (3172, 1890),
        "Johnston":   (1782, 2425),
        "Karama":     (1599, 2537),
        "Katherine":  (2381, 1449),
        "Namatjira":  (1326, 2115),
        "Nightcliff": (2216, 2252),
        "Port Darwin":(1577, 2543),
        "Wanguri":    (1780, 2561),
    },
}

# ── Enrolment proxies ─────────────────────────────────────────────────────────
# 2024: roll numbers from FP summary page
# 2020: formal vote counts from FP summary page (proxy, close to ~85-90% of roll)
# 2016: 2CP totals as proxy (FP summary not available)

NT_ENROLMENT = {
    201608: {
        # 2CP totals as proxy
        "Arafura":    2254, "Arnhem":     2762, "Braitling":  4601,
        "Brennan":    3946, "Casuarina":  4382, "Daly":       3389,
        "Drysdale":   3568, "Fannie Bay": 4187, "Fong Lim":   3759,
        "Johnston":   3792, "Katherine":  3653, "Namatjira":  2977,
        "Nightcliff": 3967, "Port Darwin":3551, "Sanderson":  4258,
        "Spillett":   3866, "Stuart":     2804, "Wanguri":    4328,
        # non-ALP/CLP seats (approximate)
        "Araluen": 4000, "Barkly": 3500, "Blain": 3800, "Goyder": 4200,
        "Karama": 3400, "Nelson": 4400, "Nhulunbuy": 3300, "Gwoja": 2500,
    },
    202008: {
        # Formal votes from FP summary
        "Arafura":    2591, "Araluen":    4364, "Arnhem":     2924,
        "Barkly":     3441, "Blain":      4177, "Braitling":  4395,
        "Brennan":    4380, "Casuarina":  4601, "Daly":       3874,
        "Drysdale":   3905, "Fannie Bay": 4345, "Fong Lim":   4175,
        "Goyder":     4695, "Gwoja":      2658, "Johnston":   4284,
        "Karama":     4169, "Katherine":  3886, "Mulka":      4095,
        "Namatjira":  3606, "Nelson":     4561, "Nightcliff": 4425,
        "Port Darwin":4301, "Sanderson":  4395, "Spillett":   4949,
        "Wanguri":    4976,
    },
    202408: {
        # Roll numbers from FP summary
        "Arafura":    6199, "Araluen":    5891, "Arnhem":     6646,
        "Barkly":     6112, "Blain":      6435, "Braitling":  6117,
        "Brennan":    6239, "Casuarina":  5868, "Daly":       6194,
        "Drysdale":   6346, "Fannie Bay": 6148, "Fong Lim":   5676,
        "Goyder":     6312, "Gwoja":      6132, "Johnston":   5721,
        "Karama":     5983, "Katherine":  6173, "Mulka":      6844,
        "Namatjira":  6510, "Nelson":     6379, "Nightcliff": 5995,
        "Port Darwin":5730, "Sanderson":  5883, "Spillett":   6093,
        "Wanguri":    5622,
    },
}

ELECTIONS = [
    (201608, "2016 NT Territory Election", "2016-08-27"),
    (202008, "2020 NT Territory Election", "2020-08-22"),
    (202408, "2024 NT Territory Election", "2024-08-24"),
]


def main() -> None:
    print(f"Connecting to {DB_PATH}")
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = OFF")  # allow inserts without strict FK checks

    # Apply NT schema
    import sys
    sys.path.insert(0, str(ROOT))
    from pipeline.database import build_state_schema_sql
    print("Applying rendered nt schema (state_schema_template.sql) ...")
    conn.executescript(build_state_schema_sql("nt"))

    c = conn.cursor()

    # ── Elections ──────────────────────────────────────────────────────────────
    for eid, name, date in ELECTIONS:
        c.execute(
            "INSERT OR REPLACE INTO nt_elections(election_id, name, election_date) VALUES(?,?,?)",
            (eid, name, date),
        )
    print(f"  Inserted {len(ELECTIONS)} elections.")

    # ── Districts ─────────────────────────────────────────────────────────────
    # Build master set of all district names per election from both TCP and enrolment
    district_id_map: dict[tuple[int, str], int] = {}  # (election_id, name) → district_id
    for eid, _, _ in ELECTIONS:
        names = sorted(
            set(NT_TCP[eid].keys()) | set(NT_ENROLMENT.get(eid, {}).keys())
        )
        for i, name in enumerate(names, 1):
            district_id_map[(eid, name)] = i
            enrol = NT_ENROLMENT.get(eid, {}).get(name, 0)
            c.execute(
                "INSERT OR REPLACE INTO nt_districts"
                "(district_id, election_id, district_name, enrolment) VALUES(?,?,?,?)",
                (i, eid, name, enrol),
            )
    print("  Inserted districts for all elections.")

    # ── Candidates + 2CP ──────────────────────────────────────────────────────
    # candidate_id scheme: district_id * 10 + offset (ALP=1, CLP=2)
    total_seats = 0
    for eid, districts in NT_TCP.items():
        for dname, (alp_v, clp_v) in districts.items():
            did = district_id_map[(eid, dname)]
            alp_cid = did * 10 + 1
            clp_cid = did * 10 + 2
            total = alp_v + clp_v
            alp_pct = round(alp_v / total * 100, 4) if total else 0.0
            clp_pct = round(clp_v / total * 100, 4) if total else 0.0

            for cid, party_ab, party_name, votes, pct in [
                (alp_cid, "ALP", "Australian Labor Party NT Branch", alp_v, alp_pct),
                (clp_cid, "CLP", "Country Liberal Party of the NT",  clp_v, clp_pct),
            ]:
                elected = 1 if votes > (total - votes) else 0
                c.execute(
                    "INSERT OR REPLACE INTO nt_candidates"
                    "(candidate_id, election_id, district_id, surname, party_ab, party_name, elected)"
                    " VALUES(?,?,?,?,?,?,?)",
                    (cid, eid, did, f"{party_ab} Candidate", party_ab, party_name, elected),
                )
                c.execute(
                    "INSERT OR REPLACE INTO nt_district_2cp"
                    "(election_id, district_id, candidate_id, total_votes, vote_pct, elected)"
                    " VALUES(?,?,?,?,?,?)",
                    (eid, did, cid, votes, pct, elected),
                )
            total_seats += 1

    print(f"  Inserted candidates and 2CP data for {total_seats} district-elections.")

    conn.commit()
    conn.close()
    print("Done. NT data loaded successfully.")

    # ── Verify ────────────────────────────────────────────────────────────────
    print("\n── Verification ─────────────────────────────────────────────────────")
    conn = sqlite3.connect(DB_PATH)
    for eid, _, date in ELECTIONS:
        rows = conn.execute(
            """
            SELECT d.district_name, t.vote_pct
            FROM nt_district_2cp t
            JOIN nt_candidates c ON c.candidate_id = t.candidate_id
                                 AND c.election_id  = t.election_id
            JOIN nt_districts  d ON d.district_id   = t.district_id
                                 AND d.election_id   = t.election_id
            WHERE t.election_id = ? AND c.party_ab = 'ALP'
            ORDER BY d.district_name
            """,
            (eid,),
        ).fetchall()
        print(f"\n{eid} ({date[:4]}) — {len(rows)} ALP-vs-CLP districts:")
        for dname, pct in rows:
            print(f"  {dname:<20} {pct:>6.2f}% ALP")
    conn.close()


if __name__ == "__main__":
    main()
