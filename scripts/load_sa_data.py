#!/usr/bin/env python3
"""
load_sa_data.py
===============
Directly populate SA election data scraped from ecsa.sa.gov.au into the SQLite DB.

Elections: 201403 (2014), 201803 (2018), 202203 (2022)

Data sources:
  2014: https://ecsa.sa.gov.au/elections/past-state-election-results-2009-2015
        (Joomla CMS article pages, IDs 662-753)
  2018: https://ecsa.sa.gov.au/html/results/2018/{District}.html
  2022: https://apim-ecsa-production.azure-api.net/results-display/
        HAStatic/2022-03-19 + HAChange/2022-03-19/0

Only ALP vs LIB/other seats included (IND/SAB matchups excluded).
"""

import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))
from pipeline.config import DB_PATH

# ── 2CP data: {election_id: {district_name: (alp_votes, opp_votes, opp_party)}} ─

SA_TCP = {
    201403: {
        # 2014 SA State Election — 15 March 2014
        # Source: ecsa.sa.gov.au/elections/past-state-election-results-2009-2015
        # (Joomla articles IDs 662-753; only ALP vs LIB seats included)
        "Adelaide":     (10313, 11341, "LIB"),
        "Ashford":      (11247, 10427, "LIB"),
        "Bragg":        ( 7171, 15711, "LIB"),
        "Bright":       (10375, 11829, "LIB"),
        "Chaffey":      ( 5447, 16454, "LIB"),
        "Cheltenham":   (13993,  7782, "LIB"),
        "Colton":       (11938, 11262, "LIB"),
        "Croydon":      (14156,  6386, "LIB"),
        "Davenport":    ( 9731, 11021, "LIB"),
        "Dunstan":      (10292, 11656, "LIB"),
        "Elder":        (10945, 10168, "LIB"),
        "Enfield":      (11550,  8327, "LIB"),
        "Finniss":      ( 7998, 14086, "LIB"),
        "Fisher":       (10284, 10275, "LIB"),
        "Flinders":     ( 4340, 16480, "LIB"),
        "Florey":       (10755,  9739, "LIB"),
        "Goyder":       ( 8259, 14022, "LIB"),
        "Hammond":      ( 7363, 13444, "LIB"),
        "Hartley":      (10183, 11217, "LIB"),
        "Heysen":       ( 8395, 14619, "LIB"),
        "Kaurna":       (11740,  8624, "LIB"),
        "Kavel":        ( 8031, 14258, "LIB"),
        "Lee":          (12530, 10466, "LIB"),
        "Light":        (11334, 10144, "LIB"),
        "Little Para":  (12573,  9338, "LIB"),
        "MacKillop":    ( 4939, 16280, "LIB"),
        "Mawson":       (11925,  9540, "LIB"),
        "Mitchell":     (10656, 11161, "LIB"),
        "Morialta":     ( 9178, 13793, "LIB"),
        "Morphett":     ( 7809, 13264, "LIB"),
        "Napier":       (12024,  8334, "LIB"),
        "Newland":      (11394, 10763, "LIB"),
        "Playford":     (13533,  8076, "LIB"),
        "Port Adelaide":(13745,  8943, "LIB"),
        "Ramsay":       (13742,  6359, "LIB"),
        "Reynell":      (12600,  8401, "LIB"),
        "Schubert":     ( 7799, 14237, "LIB"),
        "Taylor":       (12940,  8082, "LIB"),
        "Torrens":      (10958,  9517, "LIB"),
        "Unley":        ( 8881, 13195, "LIB"),
        "Waite":        ( 8877, 14106, "LIB"),
        "West Torrens": (12716,  8188, "LIB"),
        "Wright":       (11965, 10599, "LIB"),
    },
    201803: {
        # 2018 SA State Election — 17 March 2018
        # Source: ecsa.sa.gov.au/html/results/2018/{District}.html
        # Non-ALP TCP: Chaffey/SAB, Finniss/SAB, Frome/IND, Hammond/SAB,
        #              Heysen/SAB, Kavel/SAB, MacKillop/SAB, Mount Gambier/IND,
        #              Narungga/SAB  (9 seats excluded)
        "Adelaide":     (10618, 11043, "LIB"),
        "Badcoe":       (11867,  9519, "LIB"),
        "Black":        (10245, 14546, "LIB"),
        "Bragg":        ( 7513, 15566, "LIB"),
        "Cheltenham":   (14662,  7599, "LIB"),
        "Colton":       (10341, 14211, "LIB"),
        "Croydon":      (15044,  5186, "LIB"),
        "Davenport":    ( 9110, 12992, "LIB"),
        "Dunstan":      ( 9829, 12566, "LIB"),
        "Elder":        (10588, 12609, "LIB"),
        "Elizabeth":    (15686,  7499, "LIB"),
        "Enfield":      (12554,  9139, "LIB"),
        "Flinders":     ( 4716, 15176, "LIB"),
        "Florey":       ( 9971, 12746, "IND"),
        "Gibson":       ( 9274, 13537, "LIB"),
        "Giles":        (11222,  8320, "SAB"),
        "Hartley":      ( 9007, 12316, "LIB"),
        "Hurtle Vale":  (12726, 10283, "LIB"),
        "Kaurna":       (14843,  8019, "LIB"),
        "King":         (11971, 12328, "LIB"),
        "Lee":          (12485, 10701, "LIB"),
        "Light":        (13516,  9048, "LIB"),
        "Mawson":       (11149, 11034, "LIB"),
        "Morialta":     ( 9151, 14151, "LIB"),
        "Morphett":     ( 9151, 13998, "LIB"),
        "Newland":      (10993, 11888, "LIB"),
        "Playford":     (14827,  7529, "LIB"),
        "Port Adelaide":(15895,  7908, "LIB"),
        "Ramsay":       (15374,  6933, "LIB"),
        "Reynell":      (13427,  7387, "LIB"),
        "Schubert":     ( 8342, 15042, "LIB"),
        "Stuart":       ( 5468, 14847, "LIB"),
        "Taylor":       (12516,  9952, "SAB"),
        "Torrens":      (11872,  9883, "LIB"),
        "Unley":        ( 9072, 14355, "LIB"),
        "Waite":        (10374, 14211, "LIB"),
        "West Torrens": (14010,  8152, "LIB"),
        "Wright":       (12767, 11091, "LIB"),
    },
    202203: {
        # 2022 SA State Election — 19 March 2022
        # Source: ECSA API HAChange/2022-03-19/0 distributionVotes[-1]
        # Non-ALP TCP: Finniss/IND, Flinders/IND, Kavel/IND,
        #              Mount Gambier/IND, Narungga/IND, Stuart/IND (6 seats excluded)
        "Adelaide":     (13097, 10226, "LIB"),
        "Badcoe":       (15263,  8299, "LIB"),
        "Black":        (11191, 12493, "LIB"),
        "Bragg":        ( 9923, 13796, "LIB"),
        "Chaffey":      ( 7237, 14820, "LIB"),
        "Cheltenham":   (16194,  7254, "LIB"),
        "Colton":       (11391, 13816, "LIB"),
        "Croydon":      (17305,  5843, "LIB"),
        "Davenport":    (12870, 11222, "LIB"),
        "Dunstan":      (11875, 12135, "LIB"),
        "Elder":        (13552, 10828, "LIB"),
        "Elizabeth":    (15590,  6508, "LIB"),
        "Enfield":      (14972,  8230, "LIB"),
        "Florey":       (13955,  8257, "LIB"),
        "Frome":        ( 9837, 13644, "LIB"),
        "Gibson":       (12867, 11636, "LIB"),
        "Giles":        (13798,  5643, "LIB"),
        "Hammond":      (10117, 12431, "LIB"),
        "Hartley":      (10550, 12179, "LIB"),
        "Heysen":       (11473, 12377, "LIB"),
        "Hurtle Vale":  (14813,  7797, "LIB"),
        "Kaurna":       (17141,  7307, "LIB"),
        "King":         (12692, 11316, "LIB"),
        "Lee":          (13577,  8607, "LIB"),
        "Light":        (15873,  6971, "LIB"),
        "MacKillop":    ( 6418, 17048, "LIB"),
        "Mawson":       (15322,  8686, "LIB"),
        "Morialta":     (11519, 12165, "LIB"),
        "Morphett":     (10317, 12380, "LIB"),
        "Newland":      (12916, 10416, "LIB"),
        "Playford":     (14777,  7520, "LIB"),
        "Port Adelaide":(17335,  6807, "LIB"),
        "Ramsay":       (15620,  6715, "LIB"),
        "Reynell":      (15249,  7601, "LIB"),
        "Schubert":     ( 9327, 15124, "LIB"),
        "Taylor":       (15319,  6673, "LIB"),
        "Torrens":      (14475,  9667, "LIB"),
        "Unley":        (11684, 12737, "LIB"),
        "Waite":        (13597, 11578, "LIB"),
        "West Torrens": (15654,  7114, "LIB"),
        "Wright":       (14548,  8971, "LIB"),
    },
}

# ── Enrolment proxies (TCP totals as proxy) ───────────────────────────────────
SA_ENROLMENT = {}
for eid, districts in SA_TCP.items():
    SA_ENROLMENT[eid] = {}
    for dname, (alp, opp, _) in districts.items():
        SA_ENROLMENT[eid][dname] = alp + opp

ELECTIONS = [
    (201403, "2014 SA State Election", "2014-03-15"),
    (201803, "2018 SA State Election", "2018-03-17"),
    (202203, "2022 SA State Election", "2022-03-19"),
]


def main() -> None:
    print(f"Connecting to {DB_PATH}")
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = OFF")

    # Apply SA schema
    sa_schema_path = ROOT / "sa_schema.sql"
    print(f"Applying schema from {sa_schema_path.name} ...")
    conn.executescript(sa_schema_path.read_text())

    c = conn.cursor()

    # ── Elections ──────────────────────────────────────────────────────────────
    for eid, name, date in ELECTIONS:
        c.execute(
            "INSERT OR REPLACE INTO sa_elections(election_id, name, election_date) VALUES(?,?,?)",
            (eid, name, date),
        )
    print(f"  Inserted {len(ELECTIONS)} elections.")

    # ── Districts ─────────────────────────────────────────────────────────────
    district_id_map: dict[tuple[int, str], int] = {}
    for eid, _, _ in ELECTIONS:
        names = sorted(SA_TCP[eid].keys())
        for i, name in enumerate(names, 1):
            district_id_map[(eid, name)] = i
            enrol = SA_ENROLMENT.get(eid, {}).get(name, 0)
            c.execute(
                "INSERT OR REPLACE INTO sa_districts"
                "(district_id, election_id, district_name, enrolment) VALUES(?,?,?,?)",
                (i, eid, name, enrol),
            )
    print("  Inserted districts for all elections.")

    # ── Candidates + 2CP ──────────────────────────────────────────────────────
    total_seats = 0
    for eid, districts in SA_TCP.items():
        for dname, (alp_v, opp_v, opp_party) in districts.items():
            did = district_id_map[(eid, dname)]
            alp_cid = did * 10 + 1
            opp_cid = did * 10 + 2
            total = alp_v + opp_v
            alp_pct = round(alp_v / total * 100, 4) if total else 0.0
            opp_pct = round(opp_v / total * 100, 4) if total else 0.0

            opp_party_name = {
                "LIB": "Liberal Party of Australia (SA Branch)",
                "SAB": "SA-Best",
                "IND": "Independent",
                "NAT": "National Party of Australia - SA",
                "GRN": "The Greens (SA)",
            }.get(opp_party, opp_party)

            for cid, party_ab, party_name, votes, pct in [
                (alp_cid, "ALP", "Australian Labor Party (SA Branch)", alp_v, alp_pct),
                (opp_cid, opp_party, opp_party_name, opp_v, opp_pct),
            ]:
                elected = 1 if votes > (total - votes) else 0
                c.execute(
                    "INSERT OR REPLACE INTO sa_candidates"
                    "(candidate_id, election_id, district_id, surname, party_ab, party_name, elected)"
                    " VALUES(?,?,?,?,?,?,?)",
                    (cid, eid, did, f"{party_ab} Candidate", party_ab, party_name, elected),
                )
                c.execute(
                    "INSERT OR REPLACE INTO sa_district_2cp"
                    "(election_id, district_id, candidate_id, total_votes, vote_pct, elected)"
                    " VALUES(?,?,?,?,?,?)",
                    (eid, did, cid, votes, pct, elected),
                )
            total_seats += 1

    print(f"  Inserted candidates and 2CP data for {total_seats} district-elections.")

    conn.commit()
    conn.close()
    print("Done. SA data loaded successfully.")

    # ── Verify ────────────────────────────────────────────────────────────────
    print("\n── Verification ─────────────────────────────────────────────────────")
    conn = sqlite3.connect(DB_PATH)
    for eid, _, date in ELECTIONS:
        rows = conn.execute(
            """
            SELECT d.district_name, t.vote_pct
            FROM sa_district_2cp t
            JOIN sa_candidates c ON c.candidate_id = t.candidate_id
                                 AND c.election_id  = t.election_id
            JOIN sa_districts  d ON d.district_id   = t.district_id
                                 AND d.election_id   = t.election_id
            WHERE t.election_id = ? AND c.party_ab = 'ALP'
            ORDER BY d.district_name
            """,
            (eid,),
        ).fetchall()
        print(f"\n{eid} ({date[:4]}) — {len(rows)} ALP districts:")
        for dname, pct in rows:
            print(f"  {dname:<20} {pct:>6.2f}% ALP")
    conn.close()


if __name__ == "__main__":
    main()
