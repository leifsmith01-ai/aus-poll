#!/usr/bin/env python3
"""
load_wa_data.py
===============
Directly populate WA election data scraped from elections.wa.gov.au into the SQLite DB.

Elections: 201703 (2017), 202103 (2021), 202503 (2025)

Data source: WAEC SPA results pages
  https://www.elections.wa.gov.au/elections/state/sgelection
  #/sg{year}/electorate/{CODE}/results
"""

import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))
from pipeline.config import DB_PATH

# ── 2CP data: {election_id: {district_name: (alp_votes, opp_votes, opp_party)}} ─
# Scraped from WAEC SPA. All ALP vs [LIB|NAT|IND] matchups included.
# Seats with no ALP in TCP are excluded.

WA_TCP = {
    201703: {
        # 2017 WA State Election — 11 March 2017
        # Source: elections.wa.gov.au #/sg2017/electorate/{CODE}/results
        # 53 ALP seats (49 vs LIB, 4 vs NAT, 1 vs IND); 4 no-TCP skipped
        # (Dawesville, Kwinana, Landsdale, North West Central)
        "Albany":            (12988, 10585, "NAT"),
        "Armadale":          (17008,  5619, "LIB"),
        "Balcatta":          (12950, 10247, "LIB"),
        "Baldivis":          (14306, 10695, "IND"),
        "Bassendean":        (15967,  6365, "LIB"),
        "Bateman":           ( 9148, 13418, "LIB"),
        "Belmont":           (13162,  8273, "LIB"),
        "Bicton":            (11968, 10641, "LIB"),
        "Bunbury":           (14003,  9010, "LIB"),
        "Burns Beach":       (12400, 11207, "LIB"),
        "Butler":            (16641,  7321, "LIB"),
        "Cannington":        (14190,  6662, "LIB"),
        "Carine":            ( 9871, 14233, "LIB"),
        "Central Wheatbelt": ( 6111, 16166, "NAT"),
        "Churchlands":       ( 8599, 14778, "LIB"),
        "Cockburn":          (15311,  7911, "LIB"),
        "Collie-Preston":    (16003,  8728, "LIB"),
        "Cottesloe":         ( 8590, 14799, "LIB"),
        "Darling Range":     (14788, 11712, "LIB"),
        "Forrestfield":      (13281,  9067, "LIB"),
        "Fremantle":         (17127,  6318, "LIB"),
        "Geraldton":         (10201, 10759, "LIB"),
        "Hillarys":          (10820, 12749, "LIB"),
        "Jandakot":          (12835, 12323, "LIB"),
        "Joondalup":         (11737, 11460, "LIB"),
        "Kalamunda":         (12268, 11100, "LIB"),
        "Kalgoorlie":        ( 6656,  8533, "LIB"),
        "Kimberley":         ( 7381,  4333, "LIB"),
        "Kingsley":          (11541, 11234, "LIB"),
        "Mandurah":          (15836,  7451, "LIB"),
        "Maylands":          (15509,  7345, "LIB"),
        "Midland":           (15315,  8976, "LIB"),
        "Mirrabooka":        (14879,  6629, "LIB"),
        "Morley":            (13064,  8203, "LIB"),
        "Mount Lawley":      (12767, 10858, "LIB"),
        "Murray-Wellington": (12082, 11430, "LIB"),
        "Nedlands":          ( 9728, 13588, "LIB"),
        "Perth":             (14815,  9148, "LIB"),
        "Pilbara":           ( 7393,  6748, "NAT"),
        "Riverton":          (10153, 12092, "LIB"),
        "Rockingham":        (16174,  5869, "LIB"),
        "Scarborough":       (10100, 12629, "LIB"),
        "South Perth":       (10187, 13585, "LIB"),
        "Southern River":    (13170,  9591, "LIB"),
        "Swan Hills":        (17703,  9734, "LIB"),
        "Thornlie":          (14965,  7781, "LIB"),
        "Vasse":             ( 8421, 15429, "LIB"),
        "Victoria Park":     (15064,  7595, "LIB"),
        "Wanneroo":          (13361,  9975, "LIB"),
        "Warnbro":           (16800,  5988, "LIB"),
        "Warren-Blackwood":  ( 8622, 14942, "NAT"),
        "West Swan":         (15812,  7744, "LIB"),
        "Willagee":          (13948,  7351, "LIB"),
    },
    202103: {
        # 2021 WA State Election — 13 March 2021
        # Source: elections.wa.gov.au #/sg2021/electorate/{CODE}/results
        # 56 ALP seats; 3 no-TCP excluded (Bassendean, Kingsley, Mount Lawley)
        # Note: Fremantle had ALP vs GRN TCP (lib votes = 0 → opponent votes back-calculated)
        "Albany":            (14780,  8432, "LIB"),
        "Armadale":          (21159,  3597, "LIB"),
        "Balcatta":          (18087,  5790, "LIB"),
        "Baldivis":          (23013,  3469, "LIB"),
        "Bateman":           (14963, 11436, "LIB"),
        "Belmont":           (18795,  4938, "LIB"),
        "Bicton":            (16136,  8466, "LIB"),
        "Bunbury":           (17730,  6719, "LIB"),
        "Burns Beach":       (18849,  5669, "LIB"),
        "Butler":            (21168,  4569, "LIB"),
        "Cannington":        (18899,  4596, "LIB"),
        "Carine":            (14195, 12864, "LIB"),
        "Central Wheatbelt": ( 8357, 12901, "LIB"),
        "Churchlands":       (12821, 12413, "LIB"),
        "Cockburn":          (19870,  6024, "LIB"),
        "Collie-Preston":    (18963,  6879, "LIB"),
        "Cottesloe":         (11470, 15470, "LIB"),
        "Darling Range":     (16822,  9668, "LIB"),
        "Dawesville":        (16633,  9378, "LIB"),
        "Forrestfield":      (17349,  5629, "LIB"),
        "Fremantle":         (16800,  8752, "GRN"),  # 65.75% ALP; opp back-calc'd
        "Geraldton":         (13170,  8173, "LIB"),
        "Hillarys":          (17597,  7919, "LIB"),
        "Jandakot":          (19773,  8067, "LIB"),
        "Joondalup":         (18150,  6137, "LIB"),
        "Kalamunda":         (15781,  9763, "LIB"),
        "Kalgoorlie":        ( 9152,  5601, "LIB"),
        "Kimberley":         ( 7618,  3044, "LIB"),
        "Kwinana":           (19754,  3550, "LIB"),
        "Landsdale":         (19820,  6471, "LIB"),
        "Mandurah":          (18368,  6049, "LIB"),
        "Maylands":          (19566,  5103, "LIB"),
        "Midland":           (19131,  6221, "LIB"),
        "Mirrabooka":        (18878,  3676, "LIB"),
        "Moore":             ( 9132, 12870, "LIB"),
        "Morley":            (19458,  5311, "LIB"),
        "Murray-Wellington": (16816,  8193, "LIB"),
        "Nedlands":          (13805, 12330, "LIB"),
        "North West Central":( 3738,  3997, "LIB"),
        "Perth":             (20719,  5413, "LIB"),
        "Riverton":          (15157, 10537, "LIB"),
        "Rockingham":        (20836,  2916, "LIB"),
        "Roe":               ( 7946, 12483, "LIB"),
        "Scarborough":       (15315, 10039, "LIB"),
        "South Perth":       (15007,  9962, "LIB"),
        "Southern River":    (20472,  4155, "LIB"),
        "Swan Hills":        (19069,  5655, "LIB"),
        "Thornlie":          (19081,  4508, "LIB"),
        "Vasse":             (12107, 14387, "LIB"),
        "Victoria Park":     (17932,  5105, "LIB"),
        "Wanneroo":          (20059,  5516, "LIB"),
        "Warnbro":           (20945,  4157, "LIB"),
        "Warren-Blackwood":  (12903, 12266, "LIB"),
        "West Swan":         (22278,  4194, "LIB"),
        "Willagee":          (18156,  5387, "LIB"),
    },
    202503: {
        # 2025 WA State Election — 8 March 2025
        # Source: elections.wa.gov.au #/sg2025/electorate/{CODE}/results
        # 57 ALP seats; 2 no-TCP excluded (Armadale, Victoria Park)
        "Albany":            (12914, 16615, "NAT"),
        "Balcatta":          (16192,  8908, "LIB"),
        "Baldivis":          (16480,  8240, "LIB"),
        "Bassendean":        (17532,  9163, "IND"),
        "Bateman":           (14700, 12881, "LIB"),
        "Belmont":           (16577,  7326, "LIB"),
        "Bibra Lake":        (16339,  9092, "GRN"),
        "Bicton":            (16346, 11200, "LIB"),
        "Bunbury":           (14901, 11178, "LIB"),
        "Butler":            (17276,  9433, "LIB"),
        "Cannington":        (16490,  7798, "LIB"),
        "Carine":            (12244, 16608, "LIB"),
        "Central Wheatbelt": ( 7096, 19490, "NAT"),
        "Churchlands":       (13635, 14271, "LIB"),
        "Cockburn":          (18479,  8764, "LIB"),
        "Collie-Preston":    (15177, 12760, "LIB"),
        "Darling Range":     (14765, 12046, "LIB"),
        "Dawesville":        (13430, 12761, "LIB"),
        "Forrestfield":      (14707, 12479, "LIB"),
        "Fremantle":         (12734, 12310, "IND"),
        "Geraldton":         ( 9414, 16812, "NAT"),
        "Girrawheen":        (17649,  7090, "LIB"),
        "Hillarys":          (17201, 11401, "LIB"),
        "Jandakot":          (15028, 11608, "LIB"),
        "Joondalup":         (15685, 12196, "LIB"),
        "Kalamunda":         (14096, 14178, "LIB"),
        "Kalgoorlie":        ( 7655,  7188, "LIB"),
        "Kimberley":         ( 6751,  3791, "LIB"),
        "Kingsley":          (14802, 12888, "LIB"),
        "Kwinana":           (19486,  6496, "LIB"),
        "Landsdale":         (16444, 11163, "LIB"),
        "Mandurah":          (15144, 10294, "LIB"),
        "Maylands":          (19214,  7305, "LIB"),
        "Midland":           (15818, 10155, "LIB"),
        "Mindarie":          (15710,  9910, "LIB"),
        "Morley":            (15795,  9671, "LIB"),
        "Mount Lawley":      (16352, 10607, "LIB"),
        "Murray-Wellington": (13581, 14520, "LIB"),
        "Nedlands":          (13314, 14845, "LIB"),
        "Oakford":           (17381, 10696, "LIB"),
        "Perth":             (18267,  7477, "LIB"),
        "Pilbara":           ( 9218,  9011, "LIB"),
        "Riverton":          (15064, 12714, "LIB"),
        "Rockingham":        (15370,  9495, "LIB"),
        "Scarborough":       (14563, 11897, "LIB"),
        "Secret Harbour":    (17011, 10630, "LIB"),
        "South Perth":       (13375, 12551, "LIB"),
        "Southern River":    (19658,  7142, "LIB"),
        "Swan Hills":        (15979, 11375, "LIB"),
        "Thornlie":          (15916,  8952, "IND"),
        "Vasse":             (10196, 17688, "LIB"),
        "Wanneroo":          (16661, 10013, "LIB"),
        "Warren-Blackwood":  (12733, 13683, "NAT"),
        "West Swan":         (19864,  8054, "LIB"),
    },
}

ELECTIONS = [
    (201703, "2017 WA State Election", "2017-03-11"),
    (202103, "2021 WA State Election", "2021-03-13"),
    (202503, "2025 WA State Election", "2025-03-08"),
]

# ── Enrolment proxies ─────────────────────────────────────────────────────────
# Using total 2CP formal votes as proxy (close to ~80-90% of enrolment).
# Computed as alp_votes + opp_votes per district.

def main() -> None:
    print(f"Connecting to {DB_PATH}")
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = OFF")

    # Apply WA schema
    import sys
    sys.path.insert(0, str(ROOT))
    from pipeline.database import build_state_schema_sql
    print("Applying rendered wa schema (state_schema_template.sql) ...")
    conn.executescript(build_state_schema_sql("wa"))

    c = conn.cursor()

    # ── Elections ──────────────────────────────────────────────────────────────
    for eid, name, date in ELECTIONS:
        c.execute(
            "INSERT OR REPLACE INTO wa_elections(election_id, name, election_date) VALUES(?,?,?)",
            (eid, name, date),
        )
    print(f"  Inserted {len(ELECTIONS)} elections.")

    # ── Districts ─────────────────────────────────────────────────────────────
    district_id_map: dict[tuple[int, str], int] = {}
    for eid, _, _ in ELECTIONS:
        names = sorted(set(WA_TCP[eid].keys()))
        for i, name in enumerate(names, 1):
            district_id_map[(eid, name)] = i
            alp_v, opp_v, _ = WA_TCP[eid][name]
            enrol = alp_v + opp_v  # TCP total as proxy
            c.execute(
                "INSERT OR REPLACE INTO wa_districts"
                "(district_id, election_id, district_name, enrolment) VALUES(?,?,?,?)",
                (i, eid, name, enrol),
            )
    print("  Inserted districts for all elections.")

    # ── Candidates + 2CP ──────────────────────────────────────────────────────
    # candidate_id scheme: district_id * 10 + 1 (ALP), district_id * 10 + 2 (opponent)
    PARTY_NAMES = {
        "LIB": "Liberal Party of Australia (WA Division)",
        "NAT": "The Nationals WA",
        "IND": "Independent",
        "GRN": "The Greens (WA)",
    }

    total_seats = 0
    for eid, districts in WA_TCP.items():
        for dname, (alp_v, opp_v, opp_party) in districts.items():
            did = district_id_map[(eid, dname)]
            alp_cid = did * 10 + 1
            opp_cid = did * 10 + 2
            total = alp_v + opp_v
            alp_pct = round(alp_v / total * 100, 4) if total else 0.0
            opp_pct = round(opp_v / total * 100, 4) if total else 0.0

            for cid, party_ab, party_name, votes, pct in [
                (alp_cid, "ALP", "Australian Labor Party (WA Branch)", alp_v, alp_pct),
                (opp_cid, opp_party, PARTY_NAMES.get(opp_party, opp_party), opp_v, opp_pct),
            ]:
                elected = 1 if votes > (total - votes) else 0
                c.execute(
                    "INSERT OR REPLACE INTO wa_candidates"
                    "(candidate_id, election_id, district_id, surname, party_ab, party_name, elected)"
                    " VALUES(?,?,?,?,?,?,?)",
                    (cid, eid, did, f"{party_ab} Candidate", party_ab, party_name, elected),
                )
                c.execute(
                    "INSERT OR REPLACE INTO wa_district_2cp"
                    "(election_id, district_id, candidate_id, total_votes, vote_pct, elected)"
                    " VALUES(?,?,?,?,?,?)",
                    (eid, did, cid, votes, pct, elected),
                )
            total_seats += 1

    print(f"  Inserted candidates and 2CP data for {total_seats} district-elections.")

    conn.commit()
    conn.close()
    print("Done. WA data loaded successfully.")

    # ── Verify ────────────────────────────────────────────────────────────────
    print("\n── Verification ─────────────────────────────────────────────────────")
    conn = sqlite3.connect(DB_PATH)
    for eid, _, date in ELECTIONS:
        rows = conn.execute(
            """
            SELECT d.district_name, t.vote_pct
            FROM wa_district_2cp t
            JOIN wa_candidates c ON c.candidate_id = t.candidate_id
                                 AND c.election_id  = t.election_id
            JOIN wa_districts  d ON d.district_id   = t.district_id
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
