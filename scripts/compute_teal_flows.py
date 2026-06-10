"""
Compute per-seat teal→ALP preference flows from the 2025 AEC DOP data.

Background: webapp/src/App.jsx carries a per-seat SEAT_PREF_FLOWS_2025 dict.
Most entries have teal_alp populated from actual DOP data, but a non-trivial
number still carry the national default of 0.62 — including the six seats
that teals actually won (Warringah, Wentworth, Bradfield, Mackellar,
Kooyong, Goldstein), where teal is in the final 2CP so no teal preferences
are ever distributed and the teal_alp value there is moot.

This script walks the distribution_of_preferences table, identifies each
"teal" candidate by party_ab and a known teal-slate surname list, and for
each seat where that candidate was eliminated in DOP, computes:

    teal_alp = (votes transferred to ALP) / (votes transferred to ALP or Coal)

at the count in which the teal candidate was excluded.

Usage:
    python scripts/compute_teal_flows.py

Prints a per-seat table and a JS snippet ready to paste into
SEAT_PREF_FLOWS_2025 in App.jsx for any seat whose flow differs materially
from the stored value.

Requires data/elections.db populated for election_id=2025 (event_id=31496).
"""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
# DB filename must match pipeline/config.py (DB_PATH = data/aec_elections.db).
DB_PATH = ROOT / "data" / "aec_elections.db"
ELECTION_ID = 2025
COALITION = {"LP", "LNP", "NP", "CLP"}

# Known 2025 teal / teal-adjacent independents. Hand-curated: these are
# community-backed independents who campaigned on integrity / climate and
# are generally grouped with the "teal" movement. Party_ab will be "IND" or
# occasionally "CA" (Climate 200-aligned). If a name is missing, the script
# will miss that candidate — re-curate after future elections.
KNOWN_TEAL_SURNAMES = {
    # Incumbents who won in 2022 and re-ran in 2025
    "Steggall",       # Warringah
    "Spender",        # Wentworth
    "Tink",           # (ex-North Sydney — abolished; re-check)
    "Scamps",         # Mackellar
    "Ryan",           # Kooyong
    "Daniel",         # Goldstein
    "Haines",         # Indi
    "Pocock",         # ACT (senate, but national-profile)
    "Chaney",         # Curtin
    "Boele",          # Bradfield (2025 winner)
    # Challengers who ran in 2025
    "Garrard",        # Bradfield (LP, not teal — excluded but handy reference)
}


def connect() -> sqlite3.Connection:
    if not DB_PATH.exists():
        sys.exit(
            f"Error: {DB_PATH} not found. Run `python main.py --year 2025` first."
        )
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def teal_candidates(conn: sqlite3.Connection) -> list[dict]:
    """Return all 2025 candidates whose surname is in KNOWN_TEAL_SURNAMES
    and whose party is IND/CA."""
    rows = conn.execute(
        """
        SELECT c.candidate_id, c.division_id, c.surname, c.given_name,
               c.party_ab, d.division_name
        FROM candidates c
        JOIN divisions d
          ON d.division_id = c.division_id AND d.election_id = c.election_id
        WHERE c.election_id = ?
          AND c.surname IN ({placeholders})
          AND c.party_ab IN ('IND', 'CA')
        """.format(placeholders=",".join("?" * len(KNOWN_TEAL_SURNAMES))),
        (ELECTION_ID, *sorted(KNOWN_TEAL_SURNAMES)),
    ).fetchall()
    return [dict(r) for r in rows]


def candidates_in_division(conn: sqlite3.Connection, division_id: int) -> dict[int, dict]:
    rows = conn.execute(
        """
        SELECT candidate_id, surname, given_name, party_ab
        FROM candidates
        WHERE election_id = ? AND division_id = ?
        """,
        (ELECTION_ID, division_id),
    ).fetchall()
    return {r["candidate_id"]: dict(r) for r in rows}


def teal_alp_flow(conn: sqlite3.Connection, division_id: int, teal_cand_id: int) -> dict | None:
    """Extract teal→ALP flow at the count the teal candidate was excluded.

    Returns {'count_number', 'teal_votes_excluded', 'alp_receipts', 'coal_receipts',
    'teal_alp'} or None if the DOP data doesn't show the teal candidate being
    eliminated (e.g. they made the final 2CP).
    """
    # Look up the Transfer Count rows at whichever count distributed the teal
    # candidate's ballots. In AEC DOP, the "calculation_type" for transferred
    # votes is typically "Transfer Count", with calculation_value being the
    # progressive total per receiving candidate at that count. The teal
    # candidate's Gain/Loss row at that same count will be a large negative.
    teal_rows = conn.execute(
        """
        SELECT count_number, calculation_type, calculation_value
        FROM distribution_of_preferences
        WHERE election_id = ? AND division_id = ? AND candidate_id = ?
          AND polling_place_id IS NULL
        ORDER BY count_number
        """,
        (ELECTION_ID, division_id, teal_cand_id),
    ).fetchall()

    # Find the count at which this candidate's votes were transferred away:
    # signalled by a large negative Gain/Loss.
    exclusion_count = None
    for r in teal_rows:
        if r["calculation_type"] == "Transfer Count" and (r["calculation_value"] or 0) < 0:
            exclusion_count = r["count_number"]
            break
    if exclusion_count is None:
        return None

    cands = candidates_in_division(conn, division_id)
    # At exclusion_count, each other candidate's Transfer Count row shows how
    # many of the teal candidate's ballots came to them.
    receipts = conn.execute(
        """
        SELECT candidate_id, calculation_value
        FROM distribution_of_preferences
        WHERE election_id = ? AND division_id = ? AND count_number = ?
          AND calculation_type = 'Transfer Count'
          AND polling_place_id IS NULL
          AND candidate_id != ?
        """,
        (ELECTION_ID, division_id, exclusion_count, teal_cand_id),
    ).fetchall()

    alp_receipts = 0.0
    coal_receipts = 0.0
    total_transferred = 0.0
    for r in receipts:
        c = cands.get(r["candidate_id"])
        if c is None:
            continue
        val = max(0.0, r["calculation_value"] or 0.0)
        total_transferred += val
        if c["party_ab"] == "ALP":
            alp_receipts += val
        elif c["party_ab"] in COALITION:
            coal_receipts += val

    two_party = alp_receipts + coal_receipts
    if two_party <= 0:
        return None

    return {
        "count_number":         exclusion_count,
        "alp_receipts":         alp_receipts,
        "coal_receipts":        coal_receipts,
        "total_transferred":    total_transferred,
        "teal_alp":             alp_receipts / two_party,
    }


def main() -> None:
    conn = connect()
    try:
        teals = teal_candidates(conn)
        if not teals:
            sys.exit(
                "No teal candidates found. Confirm data/elections.db is populated "
                "for 2025 and extend KNOWN_TEAL_SURNAMES if necessary."
            )

        print(f"{'Div':>4}  {'Name':<22} {'Cand':<22} {'Party':<5} "
              f"{'cnt':>4} {'teal_alp':>9}  transferred")
        print("-" * 78)
        results = []
        for t in teals:
            flow = teal_alp_flow(conn, t["division_id"], t["candidate_id"])
            if flow is None:
                print(f"{t['division_id']:>4}  {t['division_name']:<22} "
                      f"{t['surname']:<22} {t['party_ab']:<5} "
                      f"{'--':>4} {'-- (won/2CP)':>9}  --")
                continue
            print(
                f"{t['division_id']:>4}  {t['division_name']:<22} "
                f"{t['surname']:<22} {t['party_ab']:<5} "
                f"{flow['count_number']:>4} {flow['teal_alp']:>9.4f}  "
                f"{flow['total_transferred']:>.0f}"
            )
            results.append((t, flow))
    finally:
        conn.close()

    print()
    print("JS snippet (paste matching IDs into SEAT_PREF_FLOWS_2025 in App.jsx):")
    for t, flow in results:
        print(f"  {t['division_id']}: {{ ..., teal_alp: {flow['teal_alp']:.4f} }}, "
              f"// {t['division_name']} ({t['surname']})")


if __name__ == "__main__":
    main()
