"""
Database operations for the AEC election dashboard.

Handles:
  - Schema creation
  - Bulk loading parsed data
  - Query helpers used by the export and modelling layers
"""

import sqlite3
import logging
from pathlib import Path
from contextlib import contextmanager

from .config import ELECTIONS, DB_PATH, COALITION_PARTIES

logger = logging.getLogger(__name__)


# ── Connection helpers ────────────────────────────────────────────────────────

def get_connection(db_path: str = None) -> sqlite3.Connection:
    """Return a SQLite connection with row_factory set for dict-like access."""
    path = db_path or DB_PATH
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@contextmanager
def transaction(db_path: str = None):
    """Context manager: yields a cursor, commits on exit, rolls back on error."""
    conn = get_connection(db_path)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# ── Schema ────────────────────────────────────────────────────────────────────

def init_db(db_path: str = None) -> None:
    """Create all tables from schema.sql if they don't exist."""
    schema_file = Path(__file__).parent.parent / "schema.sql"
    if not schema_file.exists():
        raise FileNotFoundError(f"schema.sql not found at {schema_file}")

    sql = schema_file.read_text(encoding="utf-8")
    with transaction(db_path) as conn:
        conn.executescript(sql)
    logger.info("Database schema initialised at %s", db_path or DB_PATH)


# ── Election metadata ─────────────────────────────────────────────────────────

def upsert_election(election_id: int, db_path: str = None) -> None:
    """Insert or update the election metadata row."""
    if election_id not in ELECTIONS:
        raise ValueError(f"Election year {election_id} not in config.")

    cfg = ELECTIONS[election_id]
    with transaction(db_path) as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO elections (election_id, event_id, name, election_date)
            VALUES (?, ?, ?, ?)
            """,
            (election_id, cfg["event_id"], cfg["name"], cfg["date"]),
        )
    logger.info("Upserted election: %d (%s)", election_id, cfg["name"])


# ── Bulk loaders ─────────────────────────────────────────────────────────────

def _bulk_insert(conn: sqlite3.Connection, table: str, records: list[dict],
                 conflict: str = "OR IGNORE") -> int:
    """
    Insert a list of dicts into ``table``.
    Returns the number of rows inserted.
    """
    if not records:
        return 0

    columns = list(records[0].keys())
    placeholders = ", ".join("?" * len(columns))
    sql = f"INSERT {conflict} INTO {table} ({', '.join(columns)}) VALUES ({placeholders})"

    data = [[r.get(c) for c in columns] for r in records]

    cursor = conn.executemany(sql, data)
    return cursor.rowcount


def load_candidates(records: list[dict], db_path: str = None) -> None:
    """Load candidate records into the database."""
    if not records:
        return

    # First, ensure divisions exist (candidates file has division info)
    divisions = {}
    for r in records:
        key = (r["division_id"], r["election_id"])
        if key not in divisions:
            divisions[key] = {
                "division_id":   r["division_id"],
                "election_id":   r["election_id"],
                "state_ab":      r["state_ab"],
                "division_name": r["division_name"],
            }

    with transaction(db_path) as conn:
        _bulk_insert(conn, "divisions", list(divisions.values()), "OR IGNORE")

        candidate_rows = [
            {k: v for k, v in r.items()
             if k in ("candidate_id", "election_id", "division_id",
                      "surname", "given_name", "party_ab", "party_name",
                      "ballot_position", "elected", "historic_elected")}
            for r in records
        ]
        n = _bulk_insert(conn, "candidates", candidate_rows, "OR REPLACE")
        logger.info("Loaded %d candidates", n)


def load_polling_places(records: list[dict], db_path: str = None) -> None:
    """Load polling place (booth) records."""
    with transaction(db_path) as conn:
        n = _bulk_insert(conn, "polling_places", records, "OR REPLACE")
        logger.info("Loaded %d polling places", n)


def load_first_preferences(records: list[dict], db_path: str = None) -> None:
    """Load first preference booth-level vote records."""
    with transaction(db_path) as conn:
        n = _bulk_insert(conn, "first_preferences", records, "OR REPLACE")
        logger.info("Loaded %d first preference rows", n)


def load_tcp(records: list[dict], db_path: str = None) -> None:
    """Load TCP booth-level vote records."""
    with transaction(db_path) as conn:
        n = _bulk_insert(conn, "tcp_votes", records, "OR REPLACE")
        logger.info("Loaded %d TCP rows", n)


def load_dop(records: list[dict], db_path: str = None) -> None:
    """Load distribution of preferences records."""
    with transaction(db_path) as conn:
        n = _bulk_insert(conn, "distribution_of_preferences", records, "OR REPLACE")
        logger.info("Loaded %d DOP rows", n)


# ── Post-load derived data ────────────────────────────────────────────────────

def compute_preference_flows(election_id: int, db_path: str = None) -> None:
    """
    Derive observed preference flows from the DOP data and store them
    in the preference_flows table (national level).

    Flow = for each eliminated candidate's party, what % of their
    preferences went to each surviving candidate's party at the
    count where they were eliminated.
    """
    logger.info(
        "Computing observed preference flows for election %d ...", election_id
    )

    with transaction(db_path) as conn:
        # Get all divisions
        divisions = conn.execute(
            "SELECT division_id FROM divisions WHERE election_id = ?",
            (election_id,)
        ).fetchall()

        flow_records = []

        for div_row in divisions:
            div_id = div_row["division_id"]

            # Get DOP data for this division, ordered by count
            dop = conn.execute(
                """
                SELECT d.count_number, d.calculation_type, d.calculation_value,
                       c.party_ab, c.candidate_id
                FROM distribution_of_preferences d
                JOIN candidates c ON c.candidate_id = d.candidate_id
                                  AND c.election_id = d.election_id
                WHERE d.election_id = ? AND d.division_id = ?
                ORDER BY d.count_number, c.party_ab
                """,
                (election_id, div_id),
            ).fetchall()

            if not dop:
                continue

            # Find transfer counts (when a candidate is excluded)
            # and compute where their preferences went
            counts = {}
            for row in dop:
                cn = row["count_number"]
                if cn not in counts:
                    counts[cn] = []
                counts[cn].append(dict(row))

            # For each count, find candidates receiving transfers
            # and the source (excluded) party
            for cn, rows in counts.items():
                if cn == 1:
                    continue  # skip first count

                transfers = [
                    r for r in rows
                    if r["calculation_type"] == "Transfer Count"
                    and r["calculation_value"] is not None
                    and r["calculation_value"] != 0
                ]
                if not transfers:
                    continue

                total_transferred = sum(
                    abs(r["calculation_value"]) for r in transfers
                    if r["calculation_value"] < 0
                )
                if total_transferred == 0:
                    continue

                # Positive transfer_value = receiving preferences
                gaining = [t for t in transfers if t["calculation_value"] > 0]
                total_gained = sum(t["calculation_value"] for t in gaining)
                if total_gained == 0:
                    continue

                for gain in gaining:
                    pct = (gain["calculation_value"] / total_gained) * 100
                    flow_records.append({
                        "election_id": election_id,
                        "scope":       "division",
                        "scope_value": str(div_id),
                        "from_party":  "UNKNOWN",   # requires more complex matching
                        "to_party":    gain["party_ab"],
                        "flow_pct":    round(pct, 4),
                        "is_observed": 1,
                        "label":       f"Observed {election_id} count {cn}",
                    })

        if flow_records:
            n = _bulk_insert(conn, "preference_flows", flow_records, "OR IGNORE")
            logger.info("Stored %d preference flow records", n)
        else:
            logger.warning("No preference flow records computed for election %d", election_id)


# ── Query helpers ─────────────────────────────────────────────────────────────

def get_all_divisions(election_id: int, db_path: str = None) -> list[dict]:
    """Return all divisions (seats) for an election with basic totals."""
    conn = get_connection(db_path)
    try:
        rows = conn.execute(
            """
            SELECT d.division_id, d.division_name, d.state_ab, d.enrolment,
                   c.surname, c.given_name, c.party_ab, c.party_name
            FROM divisions d
            LEFT JOIN candidates c ON c.division_id = d.division_id
                                   AND c.election_id = d.election_id
                                   AND c.elected = 1
            WHERE d.election_id = ?
            ORDER BY d.state_ab, d.division_name
            """,
            (election_id,),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_division_summary(division_id: int, election_id: int,
                          db_path: str = None) -> dict:
    """Return first preference and TCP totals for a division."""
    conn = get_connection(db_path)
    try:
        fp = conn.execute(
            """
            SELECT c.party_ab, c.party_name,
                   c.surname || ', ' || c.given_name AS candidate_name,
                   c.elected,
                   SUM(fp.total_votes) AS total_votes
            FROM first_preferences fp
            JOIN candidates c ON c.candidate_id = fp.candidate_id
                              AND c.election_id = fp.election_id
            WHERE fp.election_id = ? AND fp.division_id = ?
            GROUP BY c.candidate_id
            ORDER BY total_votes DESC
            """,
            (election_id, division_id),
        ).fetchall()

        tcp = conn.execute(
            """
            SELECT c.party_ab, c.surname || ', ' || c.given_name AS candidate_name,
                   c.elected,
                   CAST(d.calculation_value AS INTEGER) AS total_votes
            FROM distribution_of_preferences d
            JOIN candidates c ON c.candidate_id = d.candidate_id
                              AND c.election_id = d.election_id
            WHERE d.election_id = ?
              AND d.division_id = ?
              AND d.calculation_type = 'Preference Count'
              AND d.calculation_value > 0
              AND d.count_number = (
                  SELECT MAX(d2.count_number)
                  FROM distribution_of_preferences d2
                  WHERE d2.election_id = ? AND d2.division_id = ?
              )
            ORDER BY total_votes DESC
            """,
            (election_id, division_id, election_id, division_id),
        ).fetchall()

        booths = conn.execute(
            """
            SELECT pp.polling_place_id, pp.polling_place_name,
                   pp.suburb, pp.latitude, pp.longitude
            FROM polling_places pp
            WHERE pp.election_id = ? AND pp.division_id = ?
            ORDER BY pp.polling_place_name
            """,
            (election_id, division_id),
        ).fetchall()

        return {
            "division_id":  division_id,
            "election_id":  election_id,
            "first_prefs":  [dict(r) for r in fp],
            "tcp":          [dict(r) for r in tcp],
            "booths":       [dict(r) for r in booths],
        }
    finally:
        conn.close()


def get_national_summary(election_id: int, db_path: str = None) -> dict:
    """Return national first preference totals by party."""
    conn = get_connection(db_path)
    try:
        rows = conn.execute(
            """
            SELECT
                c.party_ab,
                c.party_name,
                SUM(fp.total_votes) AS total_votes,
                COUNT(DISTINCT fp.division_id) AS seats_contested
            FROM first_preferences fp
            JOIN candidates c ON c.candidate_id = fp.candidate_id
                              AND c.election_id = fp.election_id
            WHERE fp.election_id = ?
            GROUP BY c.party_ab
            ORDER BY total_votes DESC
            """,
            (election_id,),
        ).fetchall()

        total = sum(r["total_votes"] for r in rows)
        result = []
        for r in rows:
            d = dict(r)
            d["vote_share_pct"] = round(d["total_votes"] / total * 100, 2) if total else 0
            result.append(d)

        # Seats won
        seats = conn.execute(
            """
            SELECT c.party_ab, COUNT(*) AS seats_won
            FROM candidates c
            WHERE c.election_id = ? AND c.elected = 1
            GROUP BY c.party_ab
            ORDER BY seats_won DESC
            """,
            (election_id,),
        ).fetchall()

        return {
            "election_id":    election_id,
            "total_votes":    total,
            "parties":        result,
            "seats_won":      [dict(r) for r in seats],
        }
    finally:
        conn.close()


def get_booth_votes(polling_place_id: int, division_id: int,
                     election_id: int, db_path: str = None) -> dict:
    """Return all votes (FP + TCP) for a single booth."""
    conn = get_connection(db_path)
    try:
        fp = conn.execute(
            """
            SELECT c.candidate_id, c.surname, c.given_name, c.party_ab,
                   c.ballot_position,
                   fp.ordinary_votes, fp.absent_votes, fp.provisional_votes,
                   fp.prepoll_votes, fp.postal_votes, fp.total_votes
            FROM first_preferences fp
            JOIN candidates c ON c.candidate_id = fp.candidate_id
                              AND c.election_id = fp.election_id
            WHERE fp.election_id = ? AND fp.division_id = ?
              AND fp.polling_place_id = ?
            ORDER BY c.ballot_position
            """,
            (election_id, division_id, polling_place_id),
        ).fetchall()

        tcp = conn.execute(
            """
            SELECT c.candidate_id, c.surname, c.given_name, c.party_ab,
                   t.ordinary_votes, t.absent_votes, t.provisional_votes,
                   t.prepoll_votes, t.postal_votes, t.total_votes
            FROM tcp_votes t
            JOIN candidates c ON c.candidate_id = t.candidate_id
                              AND c.election_id = t.election_id
            WHERE t.election_id = ? AND t.division_id = ?
              AND t.polling_place_id = ?
            ORDER BY t.total_votes DESC
            """,
            (election_id, division_id, polling_place_id),
        ).fetchall()

        return {
            "polling_place_id": polling_place_id,
            "first_prefs": [dict(r) for r in fp],
            "tcp": [dict(r) for r in tcp],
        }
    finally:
        conn.close()
