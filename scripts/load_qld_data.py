#!/usr/bin/env python3
"""
load_qld_data.py
================
Directly populate QLD election data scraped from ECQ into the SQLite DB.

Elections: 201711 (2017), 202010 (2020), 202410 (2024)

Data sources:
  2017: results.ecq.qld.gov.au/elections/state/State2017/results/summary.html
        table[7] — TCP results for all 93 seats
  2020: resultsdata.elections.qld.gov.au/state2020-preference-count-district-{stub}.json
  2024: resultsdata.elections.qld.gov.au/SGE2024-preference-count-district-{stub}.json

Only ALP vs LNP/other seats included (non-ALP TCP matchups excluded).
2017 non-ALP (13): Callide, Condamine, Gregory, Gympie, Hill, Hinchinbrook,
                   Lockyer, Maiwar, Nanango, Noosa, Scenic Rim, Southern Downs, Warrego
2020 non-ALP (3):  Hinchinbrook, Maiwar, Noosa
2024 non-ALP (7):  Hill, Hinchinbrook, Maiwar, Mirani, Noosa, Southern Downs, Traeger
"""

import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))
from pipeline.config import DB_PATH

# ── 2CP data: {election_id: {district_name: (alp_votes, opp_votes, opp_party)}} ─

QLD_TCP = {
    201711: {
        # 2017 QLD State Election — 25 November 2017
        # Source: results.ecq.qld.gov.au/elections/state/State2017/results/summary.html
        # table[7] TCP results; ALP vs LNP/ONP/GRN/KAP where ALP is one of the two
        # Non-ALP TCP: Callide, Condamine, Gregory, Gympie, Hill, Hinchinbrook,
        #              Lockyer, Maiwar, Nanango, Noosa, Scenic Rim, Southern Downs, Warrego
        "Algester":        (17898,  9883, "LNP"),
        "Aspley":          (16430, 15678, "LNP"),
        "Bancroft":        (16029, 12489, "LNP"),
        "Barron River":    (14707, 13652, "LNP"),
        "Bonney":          (12560, 13439, "LNP"),
        "Broadwater":      ( 8915, 18928, "LNP"),
        "Buderim":         (11419, 18169, "LNP"),
        "Bulimba":         (19499, 12583, "LNP"),
        "Bundaberg":       (13641, 16142, "LNP"),
        "Bundamba":        (18621,  7403, "LNP"),
        "Burdekin":        (14399, 14866, "LNP"),
        "Burleigh":        (12454, 15132, "LNP"),
        "Burnett":         (11652, 17962, "LNP"),
        "Cairns":          (15167, 13240, "LNP"),
        "Caloundra":       (13554, 15536, "LNP"),
        "Capalaba":        (17948, 13073, "LNP"),
        "Chatsworth":      (14172, 15918, "LNP"),
        "Clayfield":       (15279, 16829, "LNP"),
        "Cook":            (14071, 11129, "ONP"),
        "Coomera":         (13638, 15673, "LNP"),
        "Cooper":          (19614, 12727, "LNP"),
        "Currumbin":       (12938, 14775, "LNP"),
        "Everton":         (14585, 17784, "LNP"),
        "Ferny Grove":     (16971, 14093, "LNP"),
        "Gaven":           (13430, 13052, "LNP"),
        "Gladstone":       (19028,  7887, "ONP"),
        "Glass House":     (13400, 15373, "LNP"),
        "Greenslopes":     (18364, 12174, "LNP"),
        "Hervey Bay":      (13066, 18880, "LNP"),
        "Inala":           (20778,  6528, "LNP"),
        "Ipswich":         (16262, 10447, "ONP"),
        "Ipswich West":    (16844, 11843, "ONP"),
        "Jordan":          (16669, 11156, "ONP"),
        "Kawana":          (10746, 18354, "LNP"),
        "Keppel":          (16419, 14480, "ONP"),
        "Kurwongbah":      (16874, 12733, "LNP"),
        "Logan":           (15426, 11720, "ONP"),
        "Lytton":          (19541, 11965, "LNP"),
        "Macalister":      (15999, 11850, "LNP"),
        "Mackay":          (18054, 12894, "LNP"),
        "Mansfield":       (14908, 13971, "LNP"),
        "Maroochydore":    (11759, 16587, "LNP"),
        "Maryborough":     (16497, 14949, "ONP"),
        "McConnel":        (15874, 11559, "LNP"),
        "Mermaid Beach":   (11747, 15110, "LNP"),
        "Miller":          (17439, 12533, "LNP"),
        "Mirani":          (13025, 15801, "ONP"),
        "Moggill":         (13936, 17055, "LNP"),
        "Morayfield":      (16814, 11818, "ONP"),
        "Mount Ommaney":   (17255, 13691, "LNP"),
        "Mudgeeraba":      (11938, 17795, "LNP"),
        "Mulgrave":        (16789, 10769, "LNP"),
        "Mundingburra":    (14268, 13639, "LNP"),
        "Murrumba":        (18396, 12511, "LNP"),
        "Nicklin":         (12319, 15227, "LNP"),
        "Ninderry":        (12335, 17301, "LNP"),
        "Nudgee":          (19940, 11059, "LNP"),
        "Oodgeroo":        (11867, 15883, "LNP"),
        "Pine Rivers":     (18255, 14234, "LNP"),
        "Pumicestone":     (14520, 15015, "LNP"),
        "Redcliffe":       (16811, 13835, "LNP"),
        "Redlands":        (15760, 13944, "LNP"),
        "Rockhampton":     (16825, 13661, "ONP"),
        "Sandgate":        (19969, 11487, "LNP"),
        "South Brisbane":  (14887, 12912, "GRN"),
        "Southport":       (11351, 15197, "LNP"),
        "Springwood":      (16125, 13963, "LNP"),
        "Stafford":        (19830, 12101, "LNP"),
        "Stretton":        (16640, 11146, "LNP"),
        "Surfers Paradise":( 7707, 17799, "LNP"),
        "Theodore":        (12443, 14445, "LNP"),
        "Thuringowa":      (15795, 13374, "ONP"),
        "Toohey":          (16526, 11011, "LNP"),
        "Toowoomba North": (13777, 17337, "LNP"),
        "Toowoomba South": (12815, 19208, "LNP"),
        "Townsville":      (14189, 13975, "LNP"),
        "Traeger":         ( 4430, 16163, "KAP"),
        "Waterford":       (15918, 10285, "ONP"),
        "Whitsunday":      (13457, 13829, "LNP"),
        "Woodridge":       (20937,  6479, "LNP"),
    },
    202010: {
        # 2020 QLD State Election — 31 October 2020
        # Source: resultsdata.elections.qld.gov.au/state2020-preference-count-district-{stub}.json
        # Non-ALP TCP: Hinchinbrook (LNP vs KAP), Maiwar (GRN vs LNP), Noosa (IND vs LNP)
        "Algester":        (20073,  9545, "LNP"),
        "Aspley":          (18494, 15036, "LNP"),
        "Bancroft":        (19100, 11314, "LNP"),
        "Barron River":    (16653, 14730, "LNP"),
        "Bonney":          (11487, 17283, "LNP"),
        "Broadwater":      (10132, 20174, "LNP"),
        "Buderim":         (14135, 17478, "LNP"),
        "Bulimba":         (21336, 13420, "LNP"),
        "Bundaberg":       (15141, 15132, "LNP"),
        "Bundamba":        (21507,  8922, "ONP"),
        "Burdekin":        (12758, 16944, "LNP"),
        "Burleigh":        (14430, 15143, "LNP"),
        "Burnett":         (12365, 19172, "LNP"),
        "Cairns":          (16006, 12788, "LNP"),
        "Callide":         ( 9921, 19112, "LNP"),
        "Caloundra":       (17040, 15409, "LNP"),
        "Capalaba":        (18807, 12640, "LNP"),
        "Chatsworth":      (15379, 16191, "LNP"),
        "Clayfield":       (16868, 17949, "LNP"),
        "Condamine":       (10405, 23376, "LNP"),
        "Cook":            (14567, 11326, "LNP"),
        "Coomera":         (17938, 18727, "LNP"),
        "Cooper":          (20414, 13333, "LNP"),
        "Currumbin":       (14703, 15013, "LNP"),
        "Everton":         (16121, 17630, "LNP"),
        "Ferny Grove":     (19710, 12615, "LNP"),
        "Gaven":           (15734, 11510, "LNP"),
        "Gladstone":       (21030,  7588, "LNP"),
        "Glass House":     (14741, 15706, "LNP"),
        "Greenslopes":     (20529, 11952, "LNP"),
        "Gregory":         ( 6771, 13902, "LNP"),
        "Gympie":          (13770, 19402, "LNP"),
        "Hervey Bay":      (17625, 16253, "LNP"),
        "Hill":            ( 8853, 23398, "KAP"),
        "Inala":           (23057,  6440, "LNP"),
        "Ipswich":         (18876,  9500, "LNP"),
        "Ipswich West":    (19289, 10688, "LNP"),
        "Jordan":          (22356, 10959, "LNP"),
        "Kawana":          (12925, 18840, "LNP"),
        "Keppel":          (18018, 14371, "LNP"),
        "Kurwongbah":      (19804, 11558, "LNP"),
        "Lockyer":         (11642, 18616, "LNP"),
        "Logan":           (19663, 11356, "LNP"),
        "Lytton":          (20708, 11980, "LNP"),
        "Macalister":      (17381, 11810, "LNP"),
        "Mackay":          (17862, 13627, "LNP"),
        "Mansfield":       (17551, 13347, "LNP"),
        "Maroochydore":    (12318, 17814, "LNP"),
        "Maryborough":     (20624, 12701, "LNP"),
        "McConnel":        (20096, 12815, "LNP"),
        "Mermaid Beach":   (13044, 15558, "LNP"),
        "Miller":          (20376, 11551, "LNP"),
        "Mirani":          (12078, 17363, "ONP"),
        "Moggill":         (14737, 17016, "LNP"),
        "Morayfield":      (20109, 10026, "LNP"),
        "Mount Ommaney":   (20012, 11951, "LNP"),
        "Mudgeeraba":      (12750, 19196, "LNP"),
        "Mulgrave":        (17793, 10794, "LNP"),
        "Mundingburra":    (15295, 13065, "LNP"),
        "Murrumba":        (21153, 13335, "LNP"),
        "Nanango":         (12177, 20049, "LNP"),
        "Nicklin":         (14866, 14782, "LNP"),
        "Ninderry":        (15206, 17927, "LNP"),
        "Nudgee":          (21292, 11422, "LNP"),
        "Oodgeroo":        (13458, 16105, "LNP"),
        "Pine Rivers":     (19063, 14555, "LNP"),
        "Pumicestone":     (18480, 14956, "LNP"),
        "Redcliffe":       (18377, 14376, "LNP"),
        "Redlands":        (17606, 15059, "LNP"),
        "Rockhampton":     (17579, 12407, "LNP"),
        "Sandgate":        (21916, 10649, "LNP"),
        "Scenic Rim":      (12662, 20182, "LNP"),
        "South Brisbane":  (14886, 18450, "GRN"),
        "Southern Downs":  (11332, 20229, "LNP"),
        "Southport":       (12457, 15482, "LNP"),
        "Springwood":      (18005, 12877, "LNP"),
        "Stafford":        (21012, 12942, "LNP"),
        "Stretton":        (18473, 10027, "LNP"),
        "Surfers Paradise":( 9638, 18890, "LNP"),
        "Theodore":        (14061, 16066, "LNP"),
        "Thuringowa":      (15790, 13864, "LNP"),
        "Toohey":          (18674, 10270, "LNP"),
        "Toowoomba North": (13757, 18479, "LNP"),
        "Toowoomba South": (12932, 19579, "LNP"),
        "Townsville":      (15099, 13326, "LNP"),
        "Traeger":         ( 5174, 15295, "KAP"),
        "Warrego":         ( 6764, 18424, "LNP"),
        "Waterford":       (17873,  9200, "LNP"),
        "Whitsunday":      (13649, 15552, "LNP"),
        "Woodridge":       (21558,  6716, "LNP"),
    },
    202410: {
        # 2024 QLD State Election — 26 October 2024
        # Source: resultsdata.elections.qld.gov.au/SGE2024-preference-count-district-{stub}.json
        # Non-ALP TCP: Hill (LNP vs KAP), Hinchinbrook (LNP vs KAP), Maiwar (LNP vs GRN),
        #              Mirani (KAP vs LNP), Noosa (IND vs LNP), Southern Downs (ONP vs LNP),
        #              Traeger (LNP vs KAP)
        "Algester":        (19398, 14353, "LNP"),
        "Aspley":          (17889, 17858, "LNP"),
        "Bancroft":        (19289, 15152, "LNP"),
        "Barron River":    (15864, 18403, "LNP"),
        "Bonney":          (11076, 19409, "LNP"),
        "Broadwater":      ( 9375, 23311, "LNP"),
        "Buderim":         (14722, 21436, "LNP"),
        "Bulimba":         (21486, 15462, "LNP"),
        "Bundaberg":       (16460, 15497, "LNP"),
        "Bundamba":        (22396, 12708, "LNP"),
        "Burdekin":        (10546, 20293, "LNP"),
        "Burleigh":        (11219, 18902, "LNP"),
        "Burnett":         (12603, 23843, "LNP"),
        "Cairns":          (15860, 14362, "LNP"),
        "Callide":         ( 8448, 23053, "LNP"),
        "Caloundra":       (18748, 20159, "LNP"),
        "Capalaba":        (15875, 17159, "LNP"),
        "Chatsworth":      (13682, 19264, "LNP"),
        "Clayfield":       (17250, 19881, "LNP"),
        "Condamine":       ( 9909, 27620, "LNP"),
        "Cook":            (11808, 14419, "LNP"),
        "Coomera":         (17221, 25866, "LNP"),
        "Cooper":          (21296, 13519, "LNP"),
        "Currumbin":       (11281, 18657, "LNP"),
        "Everton":         (16028, 19801, "LNP"),
        "Ferny Grove":     (19834, 14430, "LNP"),
        "Gaven":           (14780, 14388, "LNP"),
        "Gladstone":       (18554, 12780, "LNP"),
        "Glass House":     (13282, 20074, "LNP"),
        "Greenslopes":     (20534, 13801, "LNP"),
        "Gregory":         ( 6182, 15167, "LNP"),
        "Gympie":          (13307, 24448, "LNP"),
        "Hervey Bay":      (15892, 22306, "LNP"),
        "Inala":           (20235, 12070, "LNP"),
        "Ipswich":         (19435, 13563, "LNP"),
        "Ipswich West":    (17672, 15099, "LNP"),
        "Jordan":          (23729, 15853, "LNP"),
        "Kawana":          (12774, 21489, "LNP"),
        "Keppel":          (13891, 21254, "LNP"),
        "Kurwongbah":      (20103, 15869, "LNP"),
        "Lockyer":         (10472, 23488, "LNP"),
        "Logan":           (21304, 17957, "LNP"),
        "Lytton":          (18470, 16376, "LNP"),
        "Macalister":      (17342, 16051, "LNP"),
        "Mackay":          (13114, 19839, "LNP"),
        "Mansfield":       (17620, 14481, "LNP"),
        "Maroochydore":    (12494, 19479, "LNP"),
        "Maryborough":     (17499, 19609, "LNP"),
        "McConnel":        (20458, 14363, "LNP"),
        "Mermaid Beach":   (11284, 19331, "LNP"),
        "Miller":          (19828, 12885, "LNP"),
        "Moggill":         (14638, 18350, "LNP"),
        "Morayfield":      (19520, 14688, "LNP"),
        "Mount Ommaney":   (18929, 14079, "LNP"),
        "Mudgeeraba":      (12467, 22053, "LNP"),
        "Mulgrave":        (14431, 16066, "LNP"),
        "Mundingburra":    (11972, 17380, "LNP"),
        "Murrumba":        (23922, 16097, "LNP"),
        "Nanango":         ( 9464, 25488, "LNP"),
        "Nicklin":         (15477, 17240, "LNP"),
        "Ninderry":        (14656, 22411, "LNP"),
        "Nudgee":          (21686, 13290, "LNP"),
        "Oodgeroo":        (11915, 19257, "LNP"),
        "Pine Rivers":     (18533, 18025, "LNP"),
        "Pumicestone":     (18348, 18640, "LNP"),
        "Redcliffe":       (16798, 18879, "LNP"),
        "Redlands":        (17618, 19005, "LNP"),
        "Rockhampton":     (15598, 16772, "LNP"),
        "Sandgate":        (20372, 13806, "LNP"),
        "Scenic Rim":      (12296, 23987, "LNP"),
        "South Brisbane":  (19613, 15376, "GRN"),
        "Southport":       (11475, 18060, "LNP"),
        "Springwood":      (16677, 15329, "LNP"),
        "Stafford":        (19774, 15969, "LNP"),
        "Stretton":        (17434, 11848, "LNP"),
        "Surfers Paradise":( 8129, 22119, "LNP"),
        "Theodore":        (11843, 20137, "LNP"),
        "Thuringowa":      (12432, 18592, "LNP"),
        "Toohey":          (17408, 12082, "LNP"),
        "Toowoomba North": (11672, 23193, "LNP"),
        "Toowoomba South": (12762, 21723, "LNP"),
        "Townsville":      (13292, 16644, "LNP"),
        "Warrego":         ( 5845, 20542, "LNP"),
        "Waterford":       (19002, 12021, "LNP"),
        "Whitsunday":      (10125, 21992, "LNP"),
        "Woodridge":       (20510,  9505, "LNP"),
    },
}

# ── Enrolment proxies (TCP totals as proxy) ───────────────────────────────────
QLD_ENROLMENT = {}
for eid, districts in QLD_TCP.items():
    QLD_ENROLMENT[eid] = {}
    for dname, (alp, opp, _) in districts.items():
        QLD_ENROLMENT[eid][dname] = alp + opp

ELECTIONS = [
    (201711, "2017 QLD State Election", "2017-11-25"),
    (202010, "2020 QLD State Election", "2020-10-31"),
    (202410, "2024 QLD State Election", "2024-10-26"),
]


def main() -> None:
    print(f"Connecting to {DB_PATH}")
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = OFF")

    # Apply QLD schema
    qld_schema_path = ROOT / "qld_schema.sql"
    print(f"Applying schema from {qld_schema_path.name} ...")
    conn.executescript(qld_schema_path.read_text())

    c = conn.cursor()

    # ── Elections ──────────────────────────────────────────────────────────────
    for eid, name, date in ELECTIONS:
        c.execute(
            "INSERT OR REPLACE INTO qld_elections(election_id, name, election_date) VALUES(?,?,?)",
            (eid, name, date),
        )
    print(f"  Inserted {len(ELECTIONS)} elections.")

    # ── Districts ─────────────────────────────────────────────────────────────
    district_id_map: dict[tuple[int, str], int] = {}
    for eid, _, _ in ELECTIONS:
        names = sorted(QLD_TCP[eid].keys())
        for i, name in enumerate(names, 1):
            district_id_map[(eid, name)] = i
            enrol = QLD_ENROLMENT.get(eid, {}).get(name, 0)
            c.execute(
                "INSERT OR REPLACE INTO qld_districts"
                "(district_id, election_id, district_name, enrolment) VALUES(?,?,?,?)",
                (i, eid, name, enrol),
            )
    print("  Inserted districts for all elections.")

    # ── Candidates + 2CP ──────────────────────────────────────────────────────
    total_seats = 0
    for eid, districts in QLD_TCP.items():
        for dname, (alp_v, opp_v, opp_party) in districts.items():
            did = district_id_map[(eid, dname)]
            alp_cid = did * 10 + 1
            opp_cid = did * 10 + 2
            total = alp_v + opp_v
            alp_pct = round(alp_v / total * 100, 4) if total else 0.0
            opp_pct = round(opp_v / total * 100, 4) if total else 0.0

            opp_party_name = {
                "LNP": "Liberal National Party of Queensland",
                "ONP": "Pauline Hanson's One Nation (Qld)",
                "KAP": "Katter's Australian Party",
                "GRN": "The Greens (Queensland)",
                "IND": "Independent",
            }.get(opp_party, opp_party)

            for cid, party_ab, party_name, votes, pct in [
                (alp_cid, "ALP", "Australian Labor Party (State of Queensland)", alp_v, alp_pct),
                (opp_cid, opp_party, opp_party_name, opp_v, opp_pct),
            ]:
                elected = 1 if votes > (total - votes) else 0
                c.execute(
                    "INSERT OR REPLACE INTO qld_candidates"
                    "(candidate_id, election_id, district_id, surname, party_ab, party_name, elected)"
                    " VALUES(?,?,?,?,?,?,?)",
                    (cid, eid, did, f"{party_ab} Candidate", party_ab, party_name, elected),
                )
                c.execute(
                    "INSERT OR REPLACE INTO qld_district_2cp"
                    "(election_id, district_id, candidate_id, total_votes, vote_pct, elected)"
                    " VALUES(?,?,?,?,?,?)",
                    (eid, did, cid, votes, pct, elected),
                )
            total_seats += 1

    print(f"  Inserted candidates and 2CP data for {total_seats} district-elections.")

    conn.commit()
    conn.close()
    print("Done. QLD data loaded successfully.")

    # ── Verify ────────────────────────────────────────────────────────────────
    print("\n── Verification ─────────────────────────────────────────────────────")
    conn = sqlite3.connect(DB_PATH)
    for eid, _, date in ELECTIONS:
        rows = conn.execute(
            """
            SELECT d.district_name, t.vote_pct
            FROM qld_district_2cp t
            JOIN qld_candidates c ON c.candidate_id = t.candidate_id
                                 AND c.election_id  = t.election_id
            JOIN qld_districts  d ON d.district_id   = t.district_id
                                 AND d.election_id   = t.election_id
            WHERE t.election_id = ? AND c.party_ab = 'ALP'
            ORDER BY d.district_name
            """,
            (eid,),
        ).fetchall()
        print(f"\n{eid} ({date[:4]}) — {len(rows)} ALP districts:")
        for dname, pct in rows:
            print(f"  {dname:<22} {pct:>6.2f}% ALP")
    conn.close()


if __name__ == "__main__":
    main()
