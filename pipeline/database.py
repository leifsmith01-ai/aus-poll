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

from .config import (
    ELECTIONS, VIC_ELECTIONS, DB_PATH, COALITION_PARTIES, VIC_COALITION_PARTIES,
    STATE_REGISTRY,
)

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


def init_vec_schema(db_path: str = None) -> None:
    """Apply the VEC extension schema (vec_schema.sql) to the database."""
    schema_file = Path(__file__).parent.parent / "vec_schema.sql"
    if not schema_file.exists():
        raise FileNotFoundError(f"vec_schema.sql not found at {schema_file}")

    sql = schema_file.read_text(encoding="utf-8")
    with transaction(db_path) as conn:
        conn.executescript(sql)
    logger.info("VEC schema initialised at %s", db_path or DB_PATH)


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


# ── VIC state election helpers ────────────────────────────────────────────────

def upsert_vic_election(election_id: int, db_path: str = None) -> None:
    """Insert or update a VIC state election metadata row."""
    if election_id not in VIC_ELECTIONS:
        raise ValueError(f"VIC election {election_id} not in config.")

    cfg = VIC_ELECTIONS[election_id]
    with transaction(db_path) as conn:
        # Insert into shared elections table (needed for any cross-table FK references)
        conn.execute(
            """
            INSERT OR REPLACE INTO elections (election_id, event_id, name, election_date)
            VALUES (?, ?, ?, ?)
            """,
            (election_id, cfg["event_id"], cfg["name"], cfg["date"]),
        )
        # Insert into VIC-specific elections table
        conn.execute(
            """
            INSERT OR REPLACE INTO vic_elections (election_id, name, election_date, jurisdiction)
            VALUES (?, ?, ?, ?)
            """,
            (election_id, cfg["name"], cfg["date"], cfg["jurisdiction"]),
        )
    logger.info("Upserted VIC election: %d (%s)", election_id, cfg["name"])


def load_vic_districts(records: list[dict], db_path: str = None) -> None:
    """Load VIC district (seat) metadata."""
    if not records:
        return

    # Deduplicate by (district_id, election_id)
    seen = set()
    rows = []
    for r in records:
        key = (r["district_id"], r["election_id"])
        if key not in seen:
            seen.add(key)
            rows.append({
                "district_id":   r["district_id"],
                "election_id":   r["election_id"],
                "district_name": r["district_name"],
                "enrolment":     r.get("enrolment"),
            })

    with transaction(db_path) as conn:
        n = _bulk_insert(conn, "vic_districts", rows, "OR REPLACE")
        logger.info("Loaded %d VIC districts", n)


def load_vic_candidates(records: list[dict], db_path: str = None) -> None:
    """Load VIC candidate records (deduplicated)."""
    if not records:
        return

    seen = set()
    rows = []
    for r in records:
        key = (r["candidate_id"], r["election_id"])
        if key in seen:
            continue
        seen.add(key)
        rows.append({k: v for k, v in r.items()
                     if k in ("candidate_id", "election_id", "district_id",
                               "surname", "given_name", "party_ab", "party_name",
                               "ballot_position", "elected")})

    with transaction(db_path) as conn:
        n = _bulk_insert(conn, "vic_candidates", rows, "OR REPLACE")
        logger.info("Loaded %d VIC candidates", n)


def load_vic_fp(records: list[dict], db_path: str = None) -> None:
    """Load VIC first-preference district-level vote records."""
    if not records:
        return
    rows = [{k: v for k, v in r.items()
             if k in ("election_id", "district_id", "candidate_id", "total_votes", "vote_pct")}
            for r in records]
    with transaction(db_path) as conn:
        n = _bulk_insert(conn, "vic_district_fp", rows, "OR REPLACE")
        logger.info("Loaded %d VIC FP rows", n)


def load_vic_2cp(records: list[dict], db_path: str = None) -> None:
    """Load VIC two-candidate-preferred district-level vote records."""
    if not records:
        return
    rows = [{k: v for k, v in r.items()
             if k in ("election_id", "district_id", "candidate_id",
                      "total_votes", "vote_pct", "elected")}
            for r in records]
    with transaction(db_path) as conn:
        n = _bulk_insert(conn, "vic_district_2cp", rows, "OR REPLACE")
        logger.info("Loaded %d VIC 2CP rows", n)


def load_vic_polling_places(records: list[dict], db_path: str = None) -> None:
    """Load VIC polling place (booth) metadata into vic_polling_places."""
    if not records:
        return
    allowed = {
        "polling_place_id", "election_id", "district_id", "polling_place_name",
        "premises_name", "address", "suburb", "postcode", "latitude", "longitude",
    }
    rows = [{k: v for k, v in r.items() if k in allowed} for r in records]
    with transaction(db_path) as conn:
        n = _bulk_insert(conn, "vic_polling_places", rows, "OR REPLACE")
        logger.info("Loaded %d VIC polling places", n)


def load_vic_booth_fp(records: list[dict], db_path: str = None) -> None:
    """Load VIC booth-level first-preference votes into vic_booth_fp."""
    if not records:
        return
    allowed = {
        "election_id", "district_id", "polling_place_id", "candidate_id",
        "ordinary_votes", "prepoll_votes", "total_votes",
    }
    rows = [{k: v for k, v in r.items() if k in allowed} for r in records]
    with transaction(db_path) as conn:
        n = _bulk_insert(conn, "vic_booth_fp", rows, "OR REPLACE")
        logger.info("Loaded %d VIC booth FP rows", n)


def load_vic_booth_2cp(records: list[dict], db_path: str = None) -> None:
    """Load VIC booth-level TCP votes into vic_booth_2cp."""
    if not records:
        return
    allowed = {
        "election_id", "district_id", "polling_place_id", "candidate_id",
        "ordinary_votes", "prepoll_votes", "total_votes",
    }
    rows = [{k: v for k, v in r.items() if k in allowed} for r in records]
    with transaction(db_path) as conn:
        n = _bulk_insert(conn, "vic_booth_2cp", rows, "OR REPLACE")
        logger.info("Loaded %d VIC booth 2CP rows", n)


def get_vic_districts(election_id: int, db_path: str = None) -> list[dict]:
    """Return all VIC districts for an election with winner info."""
    conn = get_connection(db_path)
    try:
        rows = conn.execute(
            """
            SELECT d.district_id, d.district_name, d.enrolment,
                   c.candidate_id, c.surname, c.given_name, c.party_ab, c.party_name
            FROM vic_districts d
            LEFT JOIN vic_candidates c ON c.district_id = d.district_id
                                       AND c.election_id = d.election_id
                                       AND c.elected = 1
            WHERE d.election_id = ?
            ORDER BY d.district_name
            """,
            (election_id,),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_vic_district_results(district_id: int, election_id: int,
                              db_path: str = None) -> dict:
    """Return FP and 2CP totals for a single VIC district."""
    conn = get_connection(db_path)
    try:
        fp = conn.execute(
            """
            SELECT c.party_ab, c.party_name,
                   c.surname || ', ' || COALESCE(c.given_name, '') AS candidate_name,
                   c.elected, f.total_votes, f.vote_pct
            FROM vic_district_fp f
            JOIN vic_candidates c ON c.candidate_id = f.candidate_id
                                  AND c.election_id = f.election_id
            WHERE f.election_id = ? AND f.district_id = ?
            ORDER BY f.total_votes DESC
            """,
            (election_id, district_id),
        ).fetchall()

        tcp = conn.execute(
            """
            SELECT c.party_ab, c.party_name,
                   c.surname || ', ' || COALESCE(c.given_name, '') AS candidate_name,
                   c.elected, t.total_votes, t.vote_pct
            FROM vic_district_2cp t
            JOIN vic_candidates c ON c.candidate_id = t.candidate_id
                                  AND c.election_id = t.election_id
            WHERE t.election_id = ? AND t.district_id = ?
            ORDER BY t.total_votes DESC
            """,
            (election_id, district_id),
        ).fetchall()

        return {
            "district_id": district_id,
            "election_id": election_id,
            "first_prefs": [dict(r) for r in fp],
            "tcp":         [dict(r) for r in tcp],
        }
    finally:
        conn.close()


def get_vic_state_summary(election_id: int, db_path: str = None) -> dict:
    """Return VIC state-level first preference totals by party and seats won."""
    conn = get_connection(db_path)
    try:
        fp_rows = conn.execute(
            """
            SELECT c.party_ab, c.party_name,
                   SUM(f.total_votes) AS total_votes,
                   COUNT(DISTINCT f.district_id) AS districts_contested
            FROM vic_district_fp f
            JOIN vic_candidates c ON c.candidate_id = f.candidate_id
                                  AND c.election_id = f.election_id
            WHERE f.election_id = ?
            GROUP BY c.party_ab
            ORDER BY total_votes DESC
            """,
            (election_id,),
        ).fetchall()

        total = sum(r["total_votes"] for r in fp_rows) or 1
        parties = []
        for r in fp_rows:
            d = dict(r)
            d["vote_share_pct"] = round(d["total_votes"] / total * 100, 2) if total else 0
            parties.append(d)

        seats_won = conn.execute(
            """
            SELECT c.party_ab, COUNT(*) AS seats_won
            FROM vic_candidates c
            WHERE c.election_id = ? AND c.elected = 1
            GROUP BY c.party_ab
            ORDER BY seats_won DESC
            """,
            (election_id,),
        ).fetchall()

        return {
            "election_id": election_id,
            "total_votes": total,
            "parties":     parties,
            "seats_won":   [dict(r) for r in seats_won],
        }
    finally:
        conn.close()


# ── Generic state/territory election helpers ──────────────────────────────────
#
# These functions support NSW, QLD, WA, SA, TAS, ACT, and NT state elections.
# Each state has its own set of {state_ab}_* schema tables (e.g. nsw_elections,
# nsw_districts, etc.) but the pipeline logic is identical, parameterised by
# state_ab.  Use the STATE_REGISTRY in config.py to look up election configs.
#
# Supported state_ab values: 'nsw', 'qld', 'wa', 'sa', 'tas', 'act', 'nt'


def _validate_state(state_ab: str) -> dict:
    """Return the STATE_REGISTRY entry for state_ab, raising ValueError if unknown."""
    key = state_ab.lower()
    if key not in STATE_REGISTRY:
        raise ValueError(
            f"Unknown state '{state_ab}'. Valid values: {list(STATE_REGISTRY)}"
        )
    return STATE_REGISTRY[key]


def init_state_schema(state_ab: str, db_path: str = None) -> None:
    """Apply the {state_ab}_schema.sql extension to the database."""
    cfg = _validate_state(state_ab)
    schema_file = Path(__file__).parent.parent / cfg["schema_file"]
    if not schema_file.exists():
        raise FileNotFoundError(
            f"{cfg['schema_file']} not found at {schema_file}"
        )
    sql = schema_file.read_text(encoding="utf-8")
    with transaction(db_path) as conn:
        conn.executescript(sql)
    logger.info("%s schema initialised at %s", state_ab.upper(), db_path or DB_PATH)


def upsert_state_election(state_ab: str, election_id: int,
                           db_path: str = None) -> None:
    """Insert or update a state election metadata row in {state_ab}_elections."""
    cfg = _validate_state(state_ab)
    elections = cfg["elections"]
    if election_id not in elections:
        raise ValueError(
            f"Election {election_id} not found in {state_ab.upper()} config. "
            f"Valid IDs: {list(elections)}"
        )
    ecfg = elections[election_id]
    table = f"{state_ab.lower()}_elections"
    with transaction(db_path) as conn:
        conn.execute(
            f"""
            INSERT OR REPLACE INTO {table}
                (election_id, name, election_date, jurisdiction)
            VALUES (?, ?, ?, ?)
            """,
            (election_id, ecfg["name"], ecfg["date"], ecfg["jurisdiction"]),
        )
    logger.info(
        "Upserted %s election: %d (%s)", state_ab.upper(), election_id, ecfg["name"]
    )


def load_state_districts(state_ab: str, records: list[dict],
                          db_path: str = None) -> None:
    """Load district (seat/electorate) metadata into {state_ab}_districts."""
    if not records:
        return
    table = f"{state_ab.lower()}_districts"
    # Hare-Clark states (TAS, ACT) may include seats_in_district; others don't.
    hare_clark = _validate_state(state_ab)["system"] == "hare-clark"

    seen = set()
    rows = []
    for r in records:
        key = (r["district_id"], r["election_id"])
        if key in seen:
            continue
        seen.add(key)
        row = {
            "district_id":   r["district_id"],
            "election_id":   r["election_id"],
            "district_name": r["district_name"],
            "enrolment":     r.get("enrolment"),
        }
        if hare_clark:
            row["seats_in_district"] = r.get("seats_in_district", 5)
        rows.append(row)

    with transaction(db_path) as conn:
        n = _bulk_insert(conn, table, rows, "OR REPLACE")
        logger.info("Loaded %d %s districts", n, state_ab.upper())


def load_state_candidates(state_ab: str, records: list[dict],
                           db_path: str = None) -> None:
    """Load candidate records into {state_ab}_candidates (deduplicated)."""
    if not records:
        return
    table = f"{state_ab.lower()}_candidates"
    seen = set()
    rows = []
    for r in records:
        key = (r["candidate_id"], r["election_id"])
        if key in seen:
            continue
        seen.add(key)
        rows.append({k: v for k, v in r.items()
                     if k in ("candidate_id", "election_id", "district_id",
                               "surname", "given_name", "party_ab", "party_name",
                               "ballot_position", "elected")})
    with transaction(db_path) as conn:
        n = _bulk_insert(conn, table, rows, "OR REPLACE")
        logger.info("Loaded %d %s candidates", n, state_ab.upper())


def load_state_fp(state_ab: str, records: list[dict],
                  db_path: str = None) -> None:
    """Load first-preference district-level vote records into {state_ab}_district_fp."""
    if not records:
        return
    table = f"{state_ab.lower()}_district_fp"
    allowed = {
        "election_id", "district_id", "candidate_id", "total_votes", "vote_pct",
        # Turnout / enrolment columns — populated when the parser sourced them
        # from an enrolment file; NULL when no enrolment data was available.
        "informal_votes", "total_enrolled", "turnout_pct",
    }
    rows = [{k: v for k, v in r.items() if k in allowed} for r in records]
    with transaction(db_path) as conn:
        n = _bulk_insert(conn, table, rows, "OR REPLACE")
        logger.info("Loaded %d %s FP rows", n, state_ab.upper())


def load_state_2cp(state_ab: str, records: list[dict],
                   db_path: str = None) -> None:
    """Load two-candidate-preferred records into {state_ab}_district_2cp.

    Not applicable to Hare-Clark states (TAS, ACT) — use load_state_party_seats
    for those instead.
    """
    cfg = _validate_state(state_ab)
    if cfg["system"] == "hare-clark":
        raise ValueError(
            f"{state_ab.upper()} uses Hare-Clark; there is no 2CP table. "
            "Use load_state_party_seats() instead."
        )
    if not records:
        return
    table = f"{state_ab.lower()}_district_2cp"
    # nt_district_2cp carries an exhausted_votes column for optional
    # preferential voting — other states' tables don't have it.
    allowed = ["election_id", "district_id", "candidate_id",
               "total_votes", "vote_pct", "elected"]
    if state_ab.lower() == "nt":
        allowed.append("exhausted_votes")
    rows = [{k: v for k, v in r.items() if k in allowed}
            for r in records]
    with transaction(db_path) as conn:
        n = _bulk_insert(conn, table, rows, "OR REPLACE")
        logger.info("Loaded %d %s 2CP rows", n, state_ab.upper())


def load_state_party_seats(state_ab: str, records: list[dict],
                            db_path: str = None) -> None:
    """Load party seat totals per district into {state_ab}_district_party_seats.

    Only applicable to Hare-Clark states (TAS, ACT).
    """
    cfg = _validate_state(state_ab)
    if cfg["system"] != "hare-clark":
        raise ValueError(
            f"{state_ab.upper()} does not use Hare-Clark; use load_state_2cp() instead."
        )
    if not records:
        return
    table = f"{state_ab.lower()}_district_party_seats"
    rows = [{k: v for k, v in r.items()
             if k in ("election_id", "district_id", "party_ab",
                      "seats_won", "total_fp_votes")}
            for r in records]
    with transaction(db_path) as conn:
        n = _bulk_insert(conn, table, rows, "OR REPLACE")
        logger.info("Loaded %d %s party-seats rows", n, state_ab.upper())


# ── Generic state query helpers ───────────────────────────────────────────────

def get_state_districts(state_ab: str, election_id: int,
                         db_path: str = None) -> list[dict]:
    """Return all districts for a state election with elected candidate info."""
    ab = state_ab.lower()
    hare_clark = _validate_state(state_ab)["system"] == "hare-clark"
    conn = get_connection(db_path)
    try:
        if hare_clark:
            rows = conn.execute(
                f"""
                SELECT d.district_id, d.district_name, d.enrolment,
                       d.seats_in_district
                FROM {ab}_districts d
                WHERE d.election_id = ?
                ORDER BY d.district_name
                """,
                (election_id,),
            ).fetchall()
        else:
            rows = conn.execute(
                f"""
                SELECT d.district_id, d.district_name, d.enrolment,
                       c.candidate_id, c.surname, c.given_name,
                       c.party_ab, c.party_name
                FROM {ab}_districts d
                LEFT JOIN {ab}_candidates c
                       ON c.district_id = d.district_id
                      AND c.election_id = d.election_id
                      AND c.elected = 1
                WHERE d.election_id = ?
                ORDER BY d.district_name
                """,
                (election_id,),
            ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_state_district_results(state_ab: str, district_id: int,
                                election_id: int,
                                db_path: str = None) -> dict:
    """Return FP (and 2CP if applicable) totals for a single district."""
    ab = state_ab.lower()
    hare_clark = _validate_state(state_ab)["system"] == "hare-clark"
    conn = get_connection(db_path)
    try:
        fp = conn.execute(
            f"""
            SELECT c.party_ab, c.party_name,
                   c.surname || ', ' || COALESCE(c.given_name, '') AS candidate_name,
                   c.elected, f.total_votes, f.vote_pct
            FROM {ab}_district_fp f
            JOIN {ab}_candidates c ON c.candidate_id = f.candidate_id
                                   AND c.election_id = f.election_id
            WHERE f.election_id = ? AND f.district_id = ?
            ORDER BY f.total_votes DESC
            """,
            (election_id, district_id),
        ).fetchall()

        result: dict = {
            "district_id": district_id,
            "election_id": election_id,
            "first_prefs": [dict(r) for r in fp],
        }

        if not hare_clark:
            tcp = conn.execute(
                f"""
                SELECT c.party_ab, c.party_name,
                       c.surname || ', ' || COALESCE(c.given_name, '') AS candidate_name,
                       c.elected, t.total_votes, t.vote_pct
                FROM {ab}_district_2cp t
                JOIN {ab}_candidates c ON c.candidate_id = t.candidate_id
                                       AND c.election_id = t.election_id
                WHERE t.election_id = ? AND t.district_id = ?
                ORDER BY t.total_votes DESC
                """,
                (election_id, district_id),
            ).fetchall()
            result["tcp"] = [dict(r) for r in tcp]
        else:
            party_seats = conn.execute(
                f"""
                SELECT party_ab, seats_won, total_fp_votes
                FROM {ab}_district_party_seats
                WHERE election_id = ? AND district_id = ?
                ORDER BY seats_won DESC
                """,
                (election_id, district_id),
            ).fetchall()
            result["party_seats"] = [dict(r) for r in party_seats]

        return result
    finally:
        conn.close()


def get_state_previous_election_id(state_ab: str, election_id: int,
                                    db_path: str = None) -> int | None:
    """Return the most recent prior election_id for a state, or None if not found."""
    ab = state_ab.lower()
    conn = get_connection(db_path)
    try:
        row = conn.execute(
            f"""
            SELECT election_id FROM {ab}_elections
            WHERE election_id < ?
            ORDER BY election_id DESC
            LIMIT 1
            """,
            (election_id,),
        ).fetchone()
        return row["election_id"] if row else None
    except sqlite3.OperationalError as exc:
        # State tables may not exist yet for jurisdictions that haven't been loaded.
        logger.info("No %s_elections table available (%s); returning None", ab, exc)
        return None
    finally:
        conn.close()


def get_state_district_tcp_pcts(state_ab: str, election_id: int,
                                 db_path: str = None) -> dict[int, dict]:
    """
    Return TCP/2CP percentages per district for a state election.

    Returns a dict keyed by district_id:
      { district_id: { alp_pct: float | None, winner_party: str | None } }

    ALP 2CP% is None if ALP was not in the final TCP (e.g. GRN vs Coalition,
    ON vs Coalition seats).
    """
    ab = state_ab.lower()
    conn = get_connection(db_path)
    result: dict[int, dict] = {}
    try:
        rows = conn.execute(
            f"""
            SELECT t.district_id, c.party_ab, t.vote_pct, c.elected
            FROM {ab}_district_2cp t
            JOIN {ab}_candidates c ON c.candidate_id = t.candidate_id
                                   AND c.election_id = t.election_id
            WHERE t.election_id = ?
            ORDER BY t.district_id, t.vote_pct DESC
            """,
            (election_id,),
        ).fetchall()
        for row in rows:
            did = row["district_id"]
            if did not in result:
                result[did] = {"alp_pct": None, "winner_party": None}
            if row["party_ab"] == "ALP":
                result[did]["alp_pct"] = row["vote_pct"]
            if row["elected"]:
                result[did]["winner_party"] = row["party_ab"]
    except sqlite3.OperationalError as exc:
        # State 2CP table may not exist yet for unloaded jurisdictions.
        logger.info("Could not read %s_district_2cp (%s); returning empty result", ab, exc)
    finally:
        conn.close()
    return result


def get_state_summary(state_ab: str, election_id: int,
                       db_path: str = None) -> dict:
    """Return state-level first preference totals by party and seats won."""
    ab = state_ab.lower()
    hare_clark = _validate_state(state_ab)["system"] == "hare-clark"
    conn = get_connection(db_path)
    try:
        fp_rows = conn.execute(
            f"""
            SELECT c.party_ab, c.party_name,
                   SUM(f.total_votes) AS total_votes,
                   COUNT(DISTINCT f.district_id) AS districts_contested
            FROM {ab}_district_fp f
            JOIN {ab}_candidates c ON c.candidate_id = f.candidate_id
                                   AND c.election_id = f.election_id
            WHERE f.election_id = ?
            GROUP BY c.party_ab
            ORDER BY total_votes DESC
            """,
            (election_id,),
        ).fetchall()

        total = sum(r["total_votes"] for r in fp_rows) or 1
        parties = []
        for r in fp_rows:
            d = dict(r)
            d["vote_share_pct"] = round(d["total_votes"] / total * 100, 2)
            parties.append(d)

        if hare_clark:
            seats_won = conn.execute(
                f"""
                SELECT party_ab, SUM(seats_won) AS seats_won
                FROM {ab}_district_party_seats
                WHERE election_id = ?
                GROUP BY party_ab
                ORDER BY seats_won DESC
                """,
                (election_id,),
            ).fetchall()
        else:
            seats_won = conn.execute(
                f"""
                SELECT party_ab, COUNT(*) AS seats_won
                FROM {ab}_candidates
                WHERE election_id = ? AND elected = 1
                GROUP BY party_ab
                ORDER BY seats_won DESC
                """,
                (election_id,),
            ).fetchall()

        return {
            "election_id": election_id,
            "state_ab":    state_ab.upper(),
            "total_votes": total,
            "parties":     parties,
            "seats_won":   [dict(r) for r in seats_won],
        }
    finally:
        conn.close()


# ── State booth-level helpers ─────────────────────────────────────────────────
#
# Booth-level data (polling places, booth FP, booth 2CP) is only available for
# states that use single-member preferential or optional-preferential voting:
# NSW, QLD, WA, SA, NT.
#
# Hare-Clark states (TAS, ACT) do not have booth-level tables — check
# STATE_REGISTRY['tas']['booth_level'] before calling these functions.

_BOOTH_LEVEL_STATES = {"nsw", "qld", "wa", "sa", "nt"}


def _require_booth_state(state_ab: str) -> None:
    if state_ab.lower() not in _BOOTH_LEVEL_STATES:
        raise ValueError(
            f"{state_ab.upper()} does not have booth-level tables. "
            f"Booth data is only available for: {sorted(_BOOTH_LEVEL_STATES)}"
        )


def load_state_polling_places(state_ab: str, records: list[dict],
                               db_path: str = None) -> None:
    """Load polling place (booth) metadata into {state_ab}_polling_places."""
    _require_booth_state(state_ab)
    if not records:
        return
    table = f"{state_ab.lower()}_polling_places"
    allowed = {
        "polling_place_id", "election_id", "district_id", "polling_place_name",
        "premises_name", "address", "suburb", "postcode", "latitude", "longitude",
    }
    rows = [{k: v for k, v in r.items() if k in allowed} for r in records]
    with transaction(db_path) as conn:
        n = _bulk_insert(conn, table, rows, "OR REPLACE")
        logger.info("Loaded %d %s polling places", n, state_ab.upper())


def load_state_booth_fp(state_ab: str, records: list[dict],
                         db_path: str = None) -> None:
    """Load booth-level first-preference votes into {state_ab}_booth_fp."""
    _require_booth_state(state_ab)
    if not records:
        return
    table = f"{state_ab.lower()}_booth_fp"
    allowed = {
        "election_id", "district_id", "polling_place_id", "candidate_id",
        "ordinary_votes", "prepoll_votes", "total_votes",
    }
    rows = [{k: v for k, v in r.items() if k in allowed} for r in records]
    with transaction(db_path) as conn:
        n = _bulk_insert(conn, table, rows, "OR REPLACE")
        logger.info("Loaded %d %s booth FP rows", n, state_ab.upper())


def load_state_booth_2cp(state_ab: str, records: list[dict],
                          db_path: str = None) -> None:
    """Load booth-level TCP votes into {state_ab}_booth_2cp."""
    _require_booth_state(state_ab)
    if not records:
        return
    table = f"{state_ab.lower()}_booth_2cp"
    # NT has exhausted_votes; others don't — only insert columns present in records
    base_allowed = {
        "election_id", "district_id", "polling_place_id", "candidate_id",
        "ordinary_votes", "prepoll_votes", "total_votes",
    }
    nt_extra = {"exhausted_votes"}
    allowed = base_allowed | (nt_extra if state_ab.lower() == "nt" else set())
    rows = [{k: v for k, v in r.items() if k in allowed} for r in records]
    with transaction(db_path) as conn:
        n = _bulk_insert(conn, table, rows, "OR REPLACE")
        logger.info("Loaded %d %s booth 2CP rows", n, state_ab.upper())


def get_state_polling_places(state_ab: str, election_id: int,
                              district_id: int = None,
                              db_path: str = None) -> list[dict]:
    """Return polling places for a state election, optionally filtered by district."""
    _require_booth_state(state_ab)
    ab = state_ab.lower()
    conn = get_connection(db_path)
    try:
        if district_id is not None:
            rows = conn.execute(
                f"""
                SELECT polling_place_id, polling_place_name, premises_name,
                       address, suburb, postcode, latitude, longitude, district_id
                FROM {ab}_polling_places
                WHERE election_id = ? AND district_id = ?
                ORDER BY polling_place_name
                """,
                (election_id, district_id),
            ).fetchall()
        else:
            rows = conn.execute(
                f"""
                SELECT polling_place_id, polling_place_name, premises_name,
                       address, suburb, postcode, latitude, longitude, district_id
                FROM {ab}_polling_places
                WHERE election_id = ?
                ORDER BY district_id, polling_place_name
                """,
                (election_id,),
            ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_state_booth_votes(state_ab: str, polling_place_id: int,
                           district_id: int, election_id: int,
                           db_path: str = None) -> dict:
    """Return FP and 2CP vote totals for a single booth."""
    _require_booth_state(state_ab)
    ab = state_ab.lower()
    conn = get_connection(db_path)
    try:
        fp = conn.execute(
            f"""
            SELECT c.candidate_id, c.surname, c.given_name, c.party_ab,
                   c.ballot_position,
                   b.ordinary_votes, b.prepoll_votes, b.total_votes
            FROM {ab}_booth_fp b
            JOIN {ab}_candidates c ON c.candidate_id = b.candidate_id
                                   AND c.election_id = b.election_id
            WHERE b.election_id = ? AND b.district_id = ?
              AND b.polling_place_id = ?
            ORDER BY c.ballot_position
            """,
            (election_id, district_id, polling_place_id),
        ).fetchall()

        extra_cols = ", b.exhausted_votes" if ab == "nt" else ""
        tcp = conn.execute(
            f"""
            SELECT c.candidate_id, c.surname, c.given_name, c.party_ab,
                   b.ordinary_votes, b.prepoll_votes, b.total_votes{extra_cols}
            FROM {ab}_booth_2cp b
            JOIN {ab}_candidates c ON c.candidate_id = b.candidate_id
                                   AND c.election_id = b.election_id
            WHERE b.election_id = ? AND b.district_id = ?
              AND b.polling_place_id = ?
            ORDER BY b.total_votes DESC
            """,
            (election_id, district_id, polling_place_id),
        ).fetchall()

        return {
            "polling_place_id": polling_place_id,
            "district_id":      district_id,
            "election_id":      election_id,
            "first_prefs":      [dict(r) for r in fp],
            "tcp":              [dict(r) for r in tcp],
        }
    finally:
        conn.close()
