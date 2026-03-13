-- ============================================================
-- NSWEC (NSW Electoral Commission) — Extension Schema
-- ============================================================
-- Applied on top of schema.sql via database.init_state_schema('nsw').
-- Uses nsw_* tables to keep NSW state election data separate
-- from the federal AEC pipeline tables and other states.
--
-- Election system: Single-member electorates, preferential voting
-- Lower house: Legislative Assembly (93 seats)
-- Electoral commission: NSWEC — nswec.com.au
--
-- election_id convention: YYYYMM, e.g. 202303 for March 2023
-- ============================================================

-- ── NSW election metadata ──────────────────────────────────
CREATE TABLE IF NOT EXISTS nsw_elections (
    election_id   INTEGER PRIMARY KEY,  -- e.g. 202303
    name          TEXT    NOT NULL,
    election_date TEXT    NOT NULL,     -- ISO-8601 YYYY-MM-DD
    jurisdiction  TEXT    NOT NULL DEFAULT 'nsw_state',
    created_at    TEXT    DEFAULT (datetime('now'))
);

-- ── NSW Districts (93 Legislative Assembly seats) ──────────
-- One row per district per election to track boundary changes.
CREATE TABLE IF NOT EXISTS nsw_districts (
    district_id   INTEGER NOT NULL,
    election_id   INTEGER NOT NULL,
    district_name TEXT    NOT NULL,
    enrolment     INTEGER,
    PRIMARY KEY (district_id, election_id),
    FOREIGN KEY (election_id) REFERENCES nsw_elections(election_id)
);

-- ── NSW Candidates ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nsw_candidates (
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
    FOREIGN KEY (election_id) REFERENCES nsw_elections(election_id),
    FOREIGN KEY (district_id, election_id)
        REFERENCES nsw_districts(district_id, election_id)
);

-- ── NSW First Preferences (district-level) ─────────────────
CREATE TABLE IF NOT EXISTS nsw_district_fp (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    election_id  INTEGER NOT NULL,
    district_id  INTEGER NOT NULL,
    candidate_id INTEGER NOT NULL,
    total_votes  INTEGER NOT NULL DEFAULT 0,
    vote_pct     REAL,
    UNIQUE (election_id, district_id, candidate_id),
    FOREIGN KEY (election_id) REFERENCES nsw_elections(election_id)
);

-- ── NSW Two-Candidate Preferred (district-level) ───────────
CREATE TABLE IF NOT EXISTS nsw_district_2cp (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    election_id  INTEGER NOT NULL,
    district_id  INTEGER NOT NULL,
    candidate_id INTEGER NOT NULL,
    total_votes  INTEGER NOT NULL DEFAULT 0,
    vote_pct     REAL,
    elected      INTEGER DEFAULT 0,
    UNIQUE (election_id, district_id, candidate_id),
    FOREIGN KEY (election_id) REFERENCES nsw_elections(election_id)
);

-- ── Indexes ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_nsw_fp_election_district
    ON nsw_district_fp(election_id, district_id);
CREATE INDEX IF NOT EXISTS idx_nsw_2cp_election_district
    ON nsw_district_2cp(election_id, district_id);
CREATE INDEX IF NOT EXISTS idx_nsw_candidates_election_district
    ON nsw_candidates(election_id, district_id);
