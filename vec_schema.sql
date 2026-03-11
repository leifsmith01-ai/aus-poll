-- ============================================================
-- VEC (Victorian Electoral Commission) — Extension Schema
-- ============================================================
-- Applied on top of schema.sql via database.init_vec_schema().
-- Uses separate tables (vic_*) to avoid entangling VIC state
-- election data with the federal AEC pipeline tables.
--
-- election_id convention:
--   Federal (AEC): plain year, e.g. 2022
--   VIC state:     YYYYMM, e.g. 202211 for November 2022
-- ============================================================

-- ── VIC election metadata ─────────────────────────────────
-- Mirrors the federal elections table but adds jurisdiction.
-- VEC elections are inserted here in addition to the shared
-- elections table (which needs an entry for FK references).
CREATE TABLE IF NOT EXISTS vic_elections (
    election_id   INTEGER PRIMARY KEY,  -- e.g. 202211
    name          TEXT    NOT NULL,
    election_date TEXT    NOT NULL,     -- ISO-8601 YYYY-MM-DD
    jurisdiction  TEXT    NOT NULL DEFAULT 'vic_state',
    created_at    TEXT    DEFAULT (datetime('now'))
);

-- ── VIC Districts (88 Legislative Assembly seats) ─────────
-- One row per district per election to track boundary changes.
-- district_id is assigned synthetically by the parser (1–88,
-- alphabetical order within each election year).
CREATE TABLE IF NOT EXISTS vic_districts (
    district_id   INTEGER NOT NULL,
    election_id   INTEGER NOT NULL,
    district_name TEXT    NOT NULL,
    enrolment     INTEGER,
    PRIMARY KEY (district_id, election_id),
    FOREIGN KEY (election_id) REFERENCES vic_elections(election_id)
);

-- ── VIC Candidates ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vic_candidates (
    candidate_id    INTEGER NOT NULL,
    election_id     INTEGER NOT NULL,
    district_id     INTEGER NOT NULL,
    surname         TEXT    NOT NULL,
    given_name      TEXT,
    party_ab        TEXT,
    party_name      TEXT,
    ballot_position INTEGER,
    elected         INTEGER DEFAULT 0,
    PRIMARY KEY (candidate_id, election_id),
    FOREIGN KEY (election_id) REFERENCES vic_elections(election_id),
    FOREIGN KEY (district_id, election_id)
        REFERENCES vic_districts(district_id, election_id)
);

-- ── VIC First Preferences (district-level) ────────────────
-- One row per candidate × district.  No booth breakdown
-- because the VEC does not publish booth-level data publicly
-- (use Tally Room if booth-level data is needed).
CREATE TABLE IF NOT EXISTS vic_district_fp (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    election_id  INTEGER NOT NULL,
    district_id  INTEGER NOT NULL,
    candidate_id INTEGER NOT NULL,
    total_votes  INTEGER NOT NULL DEFAULT 0,
    vote_pct     REAL,
    UNIQUE (election_id, district_id, candidate_id),
    FOREIGN KEY (election_id) REFERENCES vic_elections(election_id)
);

-- ── VIC Two-Candidate Preferred (district-level) ──────────
-- One row per candidate in the final TCP count for each district.
-- Typically 2 rows per district (the two finalists).
CREATE TABLE IF NOT EXISTS vic_district_2cp (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    election_id  INTEGER NOT NULL,
    district_id  INTEGER NOT NULL,
    candidate_id INTEGER NOT NULL,
    total_votes  INTEGER NOT NULL DEFAULT 0,
    vote_pct     REAL,
    elected      INTEGER DEFAULT 0,
    UNIQUE (election_id, district_id, candidate_id),
    FOREIGN KEY (election_id) REFERENCES vic_elections(election_id)
);

-- ── Indexes ───────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_vic_fp_election_district
    ON vic_district_fp(election_id, district_id);
CREATE INDEX IF NOT EXISTS idx_vic_2cp_election_district
    ON vic_district_2cp(election_id, district_id);
CREATE INDEX IF NOT EXISTS idx_vic_candidates_election_district
    ON vic_candidates(election_id, district_id);
