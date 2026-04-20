#!/usr/bin/env python3
"""
load_nsw_data.py
================
Directly populate NSW election data scraped from pastvtr.elections.nsw.gov.au
into the SQLite DB.

Elections: 201503 (2015), 201903 (2019), 202303 (2023)

Data sources:
  2015: pastvtr.elections.nsw.gov.au/SGE2015/LA/{district}/dop/dop/
  2019: pastvtr.elections.nsw.gov.au/SG1901/LA/{district}/dop/dop
  2023: pastvtr.elections.nsw.gov.au/SG2301/LA/{district}/dop/dop

Final 2CP extracted from Distribution of Preferences page (last two candidates
remaining after all others are excluded).

Party code notes:
  2015/2019: Labor runs as "LAB" (metro) or "CLP" (Country Labor Party, rural)
  2023:      Labor runs as "ALP"
  2015:      Nationals coded as "NP" on DoP page → normalised to "NAT"

Non-ALP TCP matchups excluded (GRN vs NAT, IND vs LIB, SFF vs NAT, etc.)
"""

import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))
from pipeline.config import DB_PATH

# ── 2CP data: {election_id: {district_name: (alp_votes, opp_votes, opp_party)}} ─

NSW_TCP = {
    201503: {
        # 2015 NSW State Election — 28 March 2015
        # Source: pastvtr.elections.nsw.gov.au/SGE2015/LA/{slug}/dop/dop/
        # ALP runs as "LAB" (metro) or "CLP" (Country Labor Party, rural)
        # Nationals coded "NP" on page → normalised to NAT
        # 11 non-ALP seats excluded (Ballina/GRN-NAT, Davidson/LIB-GRN,
        #   Lismore/GRN-NAT, Manly/LIB-GRN, Murray/SFF-NAT, North Shore/GRN-LIB,
        #   Pittwater/GRN-LIB, Sydney/IND-LIB, Tamworth/IND-NAT,
        #   Vaucluse/GRN-LIB, Willoughby/GRN-LIB)
        "Albury":            (16233, 27915, "LIB"),
        "Auburn":            (21343, 16816, "LIB"),
        "Balmain":           (16557, 20019, "GRN"),
        "Bankstown":         (25382, 14293, "LIB"),
        "Barwon":            (15065, 25524, "NAT"),
        "Bathurst":          (15704, 30241, "NAT"),
        "Baulkham Hills":    (12975, 33021, "LIB"),
        "Bega":              (18696, 26023, "LIB"),
        "Blacktown":         (26679, 15547, "LIB"),
        "Blue Mountains":    (25866, 18616, "LIB"),
        "Cabramatta":        (29745, 14519, "LIB"),
        "Camden":            (14258, 30693, "LIB"),
        "Campbelltown":      (24228, 18035, "LIB"),
        "Canterbury":        (27663, 14447, "LIB"),
        "Castle Hill":       ( 9224, 35544, "LIB"),
        "Cessnock":          (30057, 11685, "NAT"),
        "Charlestown":       (26976, 15912, "LIB"),
        "Clarence":          (16947, 25082, "NAT"),
        "Coffs Harbour":     (14537, 26184, "NAT"),
        "Coogee":            (20031, 22517, "LIB"),
        "Cootamundra":       (13400, 31896, "NAT"),
        "Cronulla":          (13436, 32788, "LIB"),
        "Drummoyne":         (13468, 29668, "LIB"),
        "Dubbo":             (13061, 26561, "NAT"),
        "East Hills":        (21174, 23609, "LIB"),
        "Epping":            (14712, 30395, "LIB"),
        "Fairfield":         (28337, 12499, "LIB"),
        "Gosford":           (23430, 20723, "LIB"),
        "Goulburn":          (17093, 22764, "LIB"),
        "Granville":         (23386, 17434, "LIB"),
        "Hawkesbury":        (11783, 26690, "LIB"),
        "Heathcote":         (19952, 26855, "LIB"),
        "Heffron":           (27282, 16376, "LIB"),
        "Holsworthy":        (17930, 24705, "LIB"),
        "Hornsby":           (13154, 28617, "LIB"),
        "Keira":             (32183, 14487, "LIB"),
        "Kiama":             (19432, 22736, "LIB"),
        "Kogarah":           (21082, 20985, "LIB"),
        "Ku-ring-gai":       (11665, 28990, "LIB"),
        "Lake Macquarie":    (26952, 18217, "LIB"),
        "Lakemba":           (25918, 14260, "LIB"),
        "Lane Cove":         (12059, 27975, "LIB"),
        "Liverpool":         (27202, 16023, "LIB"),
        "Londonderry":       (22104, 19537, "LIB"),
        "Macquarie Fields":  (26927, 14987, "LIB"),
        "Maitland":          (26150, 19066, "LIB"),
        "Maroubra":          (26316, 17119, "LIB"),
        "Miranda":           (16942, 29300, "LIB"),
        "Monaro":            (13710, 27028, "NAT"),
        "Mount Druitt":      (27987, 13061, "LIB"),
        "Mulgoa":            (16977, 26147, "LIB"),
        "Myall Lakes":       (14068, 26346, "NAT"),
        "Newcastle":         (27701, 16476, "LIB"),
        "Newtown":           (17660, 22116, "GRN"),
        "Northern Tablelands":(11774, 27459, "NAT"),
        "Oatley":            (16718, 27048, "LIB"),
        "Orange":            (13430, 28988, "NAT"),
        "Oxley":             (16052, 23965, "NAT"),
        "Parramatta":        (21660, 20477, "LIB"),
        "Penrith":           (24000, 20716, "LIB"),
        "Port Macquarie":    (12481, 27929, "NAT"),
        "Port Stephens":     (22310, 21945, "LIB"),
        "Prospect":          (24546, 16574, "LIB"),
        "Riverstone":        (23408, 17913, "LIB"),
        "Rockdale":          (22882, 18086, "LIB"),
        "Ryde":              (16099, 27869, "LIB"),
        "Seven Hills":       (21742, 21046, "LIB"),
        "Shellharbour":      (28885, 14619, "LIB"),
        "South Coast":       (18085, 24949, "LIB"),
        "Strathfield":       (21432, 18756, "LIB"),
        "Summer Hill":       (20100, 18688, "GRN"),
        "Swansea":           (25748, 18204, "LIB"),
        "Terrigal":          (16453, 28491, "LIB"),
        "The Entrance":      (20800, 21952, "LIB"),
        "Tweed":             (17024, 23905, "NAT"),
        "Upper Hunter":      (13437, 25671, "NAT"),
        "Wagga Wagga":       (17130, 25406, "LIB"),
        "Wakehurst":         (12282, 28729, "LIB"),
        "Wallsend":          (28862, 14869, "LIB"),
        "Wollondilly":       (12986, 26910, "LIB"),
        "Wollongong":        (29010, 15665, "LIB"),
        "Wyong":             (26000, 17765, "LIB"),
    },
    201903: {
        # 2019 NSW State Election — 23 March 2019
        # Source: pastvtr.elections.nsw.gov.au/SG1901/LA/{slug}/dop/dop
        # ALP runs as "LAB" (metro) or "CLP" (Country Labor Party, rural)
        # 15 non-ALP seats excluded (Ballina/GRN-NAT, Barwon/SFF-NAT,
        #   Coffs Harbour/IND-NAT, Davidson/LIB-GRN, Dubbo/IND-NAT,
        #   Manly/GRN-LIB, Murray/SFF-NAT, North Shore/IND-LIB, Orange/NAT-SFF,
        #   Pittwater/LIB-GRN, Sydney/IND-LIB, Tamworth/IND-NAT,
        #   Vaucluse/LIB-GRN, Wagga Wagga/IND-NAT, Wollondilly/IND-LIB)
        "Albury":            (14572, 28258, "LIB"),
        "Auburn":            (24419, 16876, "LIB"),
        "Balmain":           (16037, 24074, "GRN"),
        "Bankstown":         (25735, 14590, "LIB"),
        "Bathurst":          (14242, 30130, "NAT"),
        "Baulkham Hills":    (14434, 31658, "LIB"),
        "Bega":              (19830, 26210, "LIB"),
        "Blacktown":         (28020, 13348, "LIB"),
        "Blue Mountains":    (28834, 15620, "LIB"),
        "Cabramatta":        (25089, 14818, "IND"),
        "Camden":            (21796, 29556, "LIB"),
        "Campbelltown":      (27026, 13305, "LIB"),
        "Canterbury":        (28358, 16634, "LIB"),
        "Castle Hill":       (12561, 37043, "LIB"),
        "Cessnock":          (30229, 13364, "NAT"),
        "Charlestown":       (28270, 17069, "LIB"),
        "Clarence":          (14322, 25985, "NAT"),
        "Coogee":            (21510, 20141, "LIB"),
        "Cootamundra":       ( 9673, 32504, "NAT"),
        "Cronulla":          (14556, 33349, "LIB"),
        "Drummoyne":         (15552, 28878, "LIB"),
        "East Hills":        (21217, 21646, "LIB"),
        "Epping":            (17238, 28584, "LIB"),
        "Fairfield":         (26848, 12675, "LIB"),
        "Gosford":           (25048, 18691, "LIB"),
        "Goulburn":          (19398, 22359, "LIB"),
        "Granville":         (23629, 17365, "LIB"),
        "Hawkesbury":        (12982, 26935, "LIB"),
        "Heathcote":         (21450, 26174, "LIB"),
        "Heffron":           (28874, 15462, "LIB"),
        "Holsworthy":        (20042, 22861, "LIB"),
        "Hornsby":           (14585, 28700, "LIB"),
        "Keira":             (33744, 14635, "LIB"),
        "Kiama":             (21564, 20843, "LIB"),
        "Kogarah":           (21544, 20073, "LIB"),
        "Ku-ring-gai":       (12969, 26883, "LIB"),
        "Lake Macquarie":    (29017, 16977, "LIB"),
        "Lakemba":           (27079, 14065, "LIB"),
        "Lane Cove":         (12736, 27051, "LIB"),
        "Lismore":           (19044, 22539, "NAT"),
        "Liverpool":         (28498, 14736, "LIB"),
        "Londonderry":       (23736, 18777, "LIB"),
        "Macquarie Fields":  (27641, 13784, "LIB"),
        "Maitland":          (26601, 21133, "LIB"),
        "Maroubra":          (27557, 17193, "LIB"),
        "Miranda":           (17700, 29981, "LIB"),
        "Monaro":            (15200, 26700, "NAT"),
        "Mount Druitt":      (29370, 12680, "LIB"),
        "Mulgoa":            (18547, 26077, "LIB"),
        "Myall Lakes":       (13882, 25975, "NAT"),
        "Newcastle":         (30060, 15958, "LIB"),
        "Newtown":           (20041, 23802, "GRN"),
        "Northern Tablelands":(11888, 27637, "NAT"),
        "Oatley":            (17987, 27256, "LIB"),
        "Orange":            (12888, 30069, "NAT"),
        "Oxley":             (16164, 24140, "NAT"),
        "Parramatta":        (22745, 21084, "LIB"),
        "Penrith":           (27222, 20137, "LIB"),
        "Port Macquarie":    (12723, 27764, "LIB"),
        "Port Stephens":     (24009, 22671, "LIB"),
        "Prospect":          (24974, 15748, "LIB"),
        "Riverstone":        (25524, 18408, "LIB"),
        "Rockdale":          (23830, 18186, "LIB"),
        "Ryde":              (16992, 28186, "LIB"),
        "Seven Hills":       (22872, 22014, "LIB"),
        "Shellharbour":      (32191, 13791, "LIB"),
        "South Coast":       (19178, 26188, "LIB"),
        "Strathfield":       (22977, 19015, "LIB"),
        "Summer Hill":       (22020, 20183, "GRN"),
        "Swansea":           (27484, 18270, "LIB"),
        "Tamworth":          ( 8611, 31012, "IND"),
        "Terrigal":          (18671, 29071, "LIB"),
        "The Entrance":      (22618, 23193, "LIB"),
        "Tweed":             (18148, 25165, "NAT"),
        "Upper Hunter":      (12832, 25984, "NAT"),
        "Wakehurst":         (13157, 28657, "LIB"),
        "Wallsend":          (30548, 14673, "LIB"),
        "Willoughby":        (13975, 27513, "LIB"),
        "Wollongong":        (31164, 14469, "LIB"),
        "Wyong":             (27524, 17636, "LIB"),
    },
    202303: {
        # 2023 NSW State Election — 25 March 2023
        # Source: pastvtr.elections.nsw.gov.au/SG2301/LA/{slug}/dop/dop
        # ALP runs as "ALP" in 2023 (changed from LAB/CLP)
        # 14 non-ALP seats excluded (Ballina/GRN-NAT, Barwon/IND-NAT,
        #   Manly/IND-LIB, Murray/NAT-IND, North Shore/IND-LIB, Orange/IND-NAT,
        #   Pittwater/LIB-IND, Port Macquarie/LIB-NAT, Tamworth/IND-NAT,
        #   Vaucluse/IND-LIB, Wagga Wagga/IND-NAT, Wakehurst/LIB-IND,
        #   Willoughby/IND-LIB, Wollondilly/IND-LIB)
        "Albury":            (14626, 28811, "LIB"),
        "Auburn":            (28144, 17222, "LIB"),
        "Badgerys Creek":    (22033, 28152, "LIB"),
        "Balmain":           (20580, 22118, "GRN"),
        "Bankstown":         (29764, 12551, "LIB"),
        "Bathurst":          (17344, 29049, "NAT"),
        "Baulkham Hills":    (17010, 32267, "LIB"),
        "Bega":              (23071, 24697, "LIB"),
        "Blacktown":         (28152, 15296, "LIB"),
        "Blue Mountains":    (30521, 17076, "LIB"),
        "Cabramatta":        (30052, 13029, "LIB"),
        "Camden":            (25765, 27952, "LIB"),
        "Campbelltown":      (30063, 13665, "LIB"),
        "Canterbury":        (30530, 14267, "LIB"),
        "Castle Hill":       (16019, 33969, "LIB"),
        "Cessnock":          (29964, 10865, "ONP"),
        "Charlestown":       (29626, 16249, "LIB"),
        "Clarence":          (18006, 25014, "NAT"),
        "Coffs Harbour":     (21783, 18551, "NAT"),
        "Coogee":            (23716, 22143, "LIB"),
        "Cootamundra":       (12441, 29754, "NAT"),
        "Cronulla":          (17002, 30991, "LIB"),
        "Davidson":          (19399, 28277, "LIB"),
        "Drummoyne":         (18785, 27178, "LIB"),
        "Dubbo":             (16870, 25175, "NAT"),
        "East Hills":        (22618, 22866, "LIB"),
        "Epping":            (21020, 28155, "LIB"),
        "Fairfield":         (28943, 12624, "LIB"),
        "Gosford":           (29100, 18898, "LIB"),
        "Goulburn":          (22107, 22038, "LIB"),
        "Granville":         (27052, 15851, "LIB"),
        "Hawkesbury":        (15621, 26453, "LIB"),
        "Heathcote":         (23753, 25024, "LIB"),
        "Heffron":           (31014, 15016, "LIB"),
        "Holsworthy":        (24016, 23237, "LIB"),
        "Hornsby":           (18143, 28043, "LIB"),
        "Keira":             (35185, 12830, "LIB"),
        "Kellyville":        (17798, 30607, "LIB"),
        "Kiama":             (18715, 25530, "IND"),
        "Kogarah":           (23782, 19937, "LIB"),
        "Ku-ring-gai":       (15555, 27042, "LIB"),
        "Lake Macquarie":    (26283, 24098, "IND"),
        "Lakemba":           (28813, 12969, "LIB"),
        "Lane Cove":         (14913, 26704, "LIB"),
        "Leppington":        (24706, 22967, "LIB"),
        "Lismore":           (21290, 19840, "NAT"),
        "Liverpool":         (31151, 13290, "LIB"),
        "Londonderry":       (27024, 17481, "LIB"),
        "Macquarie Fields":  (30093, 13045, "LIB"),
        "Maitland":          (29819, 19451, "LIB"),
        "Maroubra":          (30007, 16271, "LIB"),
        "Miranda":           (20296, 27949, "LIB"),
        "Monaro":            (17630, 25690, "LIB"),
        "Mount Druitt":      (29879, 12399, "LIB"),
        "Mulgoa":            (21344, 25284, "LIB"),
        "Myall Lakes":       (17022, 25021, "NAT"),
        "Newcastle":         (32406, 15178, "LIB"),
        "Newtown":           (17991, 28390, "GRN"),
        "Northern Tablelands":(13219, 26671, "NAT"),
        "Oatley":            (19952, 26029, "LIB"),
        "Oxley":             (17855, 24103, "NAT"),
        "Parramatta":        (24925, 20671, "LIB"),
        "Penrith":           (29685, 20262, "LIB"),
        "Port Stephens":     (27207, 21682, "LIB"),
        "Prospect":          (28247, 14831, "LIB"),
        "Riverstone":        (26936, 19213, "LIB"),
        "Rockdale":          (26484, 17350, "LIB"),
        "Ryde":              (20124, 27015, "LIB"),
        "Seven Hills":       (23904, 21742, "LIB"),
        "Shellharbour":      (34046, 12651, "LIB"),
        "South Coast":       (22163, 24720, "LIB"),
        "Strathfield":       (27027, 17330, "LIB"),
        "Summer Hill":       (24432, 21459, "GRN"),
        "Swansea":           (29272, 18268, "LIB"),
        "Sydney":            (13921, 26600, "IND"),
        "Terrigal":          (19857, 27834, "LIB"),
        "The Entrance":      (25165, 22120, "LIB"),
        "Tweed":             (22117, 24018, "NAT"),
        "Upper Hunter":      (15069, 24839, "NAT"),
        "Wallsend":          (32459, 13743, "LIB"),
        "Wollongong":        (34260, 13150, "LIB"),
        "Wyong":             (29491, 17310, "LIB"),
    },
}

# ── Enrolment proxies (TCP totals as proxy) ───────────────────────────────────
NSW_ENROLMENT = {}
for eid, districts in NSW_TCP.items():
    NSW_ENROLMENT[eid] = {}
    for dname, (alp, opp, _) in districts.items():
        NSW_ENROLMENT[eid][dname] = alp + opp

ELECTIONS = [
    (201503, "2015 NSW State Election", "2015-03-28"),
    (201903, "2019 NSW State Election", "2019-03-23"),
    (202303, "2023 NSW State Election", "2023-03-25"),
]


def main() -> None:
    print(f"Connecting to {DB_PATH}")
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = OFF")

    # Apply NSW schema
    nsw_schema_path = ROOT / "nsw_schema.sql"
    print(f"Applying schema from {nsw_schema_path.name} ...")
    conn.executescript(nsw_schema_path.read_text())

    c = conn.cursor()

    # ── Elections ──────────────────────────────────────────────────────────────
    for eid, name, date in ELECTIONS:
        c.execute(
            "INSERT OR REPLACE INTO nsw_elections(election_id, name, election_date) VALUES(?,?,?)",
            (eid, name, date),
        )
    print(f"  Inserted {len(ELECTIONS)} elections.")

    # ── Districts ─────────────────────────────────────────────────────────────
    district_id_map: dict[tuple[int, str], int] = {}
    for eid, _, _ in ELECTIONS:
        names = sorted(NSW_TCP[eid].keys())
        for i, name in enumerate(names, 1):
            district_id_map[(eid, name)] = i
            enrol = NSW_ENROLMENT.get(eid, {}).get(name, 0)
            c.execute(
                "INSERT OR REPLACE INTO nsw_districts"
                "(district_id, election_id, district_name, enrolment) VALUES(?,?,?,?)",
                (i, eid, name, enrol),
            )
    print("  Inserted districts for all elections.")

    # ── Candidates + 2CP ──────────────────────────────────────────────────────
    total_seats = 0
    for eid, districts in NSW_TCP.items():
        for dname, (alp_v, opp_v, opp_party) in districts.items():
            did = district_id_map[(eid, dname)]
            alp_cid = did * 10 + 1
            opp_cid = did * 10 + 2
            total = alp_v + opp_v
            alp_pct = round(alp_v / total * 100, 4) if total else 0.0
            opp_pct = round(opp_v / total * 100, 4) if total else 0.0

            opp_party_name = {
                "LIB": "Liberal Party of Australia (NSW Division)",
                "NAT": "The Nationals",
                "GRN": "The Greens NSW",
                "IND": "Independent",
                "ONP": "Pauline Hanson's One Nation (NSW)",
                "SFF": "Shooters, Fishers and Farmers Party NSW",
            }.get(opp_party, opp_party)

            for cid, party_ab, party_name, votes, pct in [
                (alp_cid, "ALP", "Australian Labor Party (NSW Branch)", alp_v, alp_pct),
                (opp_cid, opp_party, opp_party_name, opp_v, opp_pct),
            ]:
                elected = 1 if votes > (total - votes) else 0
                c.execute(
                    "INSERT OR REPLACE INTO nsw_candidates"
                    "(candidate_id, election_id, district_id, surname, party_ab, party_name, elected)"
                    " VALUES(?,?,?,?,?,?,?)",
                    (cid, eid, did, f"{party_ab} Candidate", party_ab, party_name, elected),
                )
                c.execute(
                    "INSERT OR REPLACE INTO nsw_district_2cp"
                    "(election_id, district_id, candidate_id, total_votes, vote_pct, elected)"
                    " VALUES(?,?,?,?,?,?)",
                    (eid, did, cid, votes, pct, elected),
                )
            total_seats += 1

    print(f"  Inserted candidates and 2CP data for {total_seats} district-elections.")

    conn.commit()
    conn.close()
    print("Done. NSW data loaded successfully.")

    # ── Verify ────────────────────────────────────────────────────────────────
    print("\n── Verification ─────────────────────────────────────────────────────")
    conn = sqlite3.connect(DB_PATH)
    for eid, _, date in ELECTIONS:
        rows = conn.execute(
            """
            SELECT d.district_name, t.vote_pct
            FROM nsw_district_2cp t
            JOIN nsw_candidates c ON c.candidate_id = t.candidate_id
                                 AND c.election_id  = t.election_id
            JOIN nsw_districts  d ON d.district_id   = t.district_id
                                 AND d.election_id   = t.election_id
            WHERE t.election_id = ? AND c.party_ab = 'ALP'
            ORDER BY d.district_name
            """,
            (eid,),
        ).fetchall()
        print(f"\n{eid} ({date[:4]}) — {len(rows)} ALP districts:")
        for dname, pct in rows:
            print(f"  {dname:<25} {pct:>6.2f}% ALP")
    conn.close()


if __name__ == "__main__":
    main()
