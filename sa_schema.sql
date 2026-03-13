-- ============================================================
-- ECSA (Electoral Commission South Australia) — Extension Schema
-- ============================================================
-- Applied on top of schema.sql via database.init_state_schema('sa').
-- Uses sa_* tables to keep SA state election data separate
-- from the federal AEC pipeline tables and other states.
--
-- Election system: Single-member electorates, preferential voting
-- Lower house: House of Assembly (47 seats)
-- Electoral commission: ECSA — ecsa.sa.gov.au
--
-- election_id convention: YYYYMM, e.g. 202203 for March 2022
-- ============================================================

-- ── SA election metadata ───────────────────────────────────
CREATE TABLE IF NOT EXISTS sa_elections (
    election_id   INTEGER PRIMARY KEY,  -- e.g. 202203
    name          TEXT    NOT NULL,
    election_date TEXT    NOT NULL,     -- ISO-8601 YYYY-MM-DD
    jurisdiction  TEXT    NOT NULL DEFAULT 'sa_state',
    created_at    TEXT    DEFAULT (datetime('now'))
);

-- ── SA Districts (47 House of Assembly seats) ──────────────
CREATE TABLE IF NOT EXISTS sa_districts (
    district_id   INTEGER NOT NULL,
    election_id   INTEGER NOT NULL,
    district_name TEXT    NOT NULL,
    enrolment     INTEGER,
    PRIMARY KEY (district_id, election_id),
    FOREIGN KEY (election_id) REFERENCES sa_elections(election_id)
);

-- ── SA Candidates ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sa_candidates (
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
    FOREIGN KEY (election_id) REFERENCES sa_elections(election_id),
    FOREIGN KEY (district_id, election_id)
        REFERENCES sa_districts(district_id, election_id)
);

-- ── SA First Preferences (district-level) ──────────────────
CREATE TABLE IF NOT EXISTS sa_district_fp (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    election_id  INTEGER NOT NULL,
    district_id  INTEGER NOT NULL,
    candidate_id INTEGER NOT NULL,
    total_votes  INTEGER NOT NULL DEFAULT 0,
    vote_pct     REAL,
    UNIQUE (election_id, district_id, candidate_id),
    FOREIGN KEY (election_id) REFERENCES sa_elections(election_id)
);

-- ── SA Two-Candidate Preferred (district-level) ────────────
CREATE TABLE IF NOT EXISTS sa_district_2cp (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    election_id  INTEGER NOT NULL,
    district_id  INTEGER NOT NULL,
    candidate_id INTEGER NOT NULL,
    total_votes  INTEGER NOT NULL DEFAULT 0,
    vote_pct     REAL,
    elected      INTEGER DEFAULT 0,
    UNIQUE (election_id, district_id, candidate_id),
    FOREIGN KEY (election_id) REFERENCES sa_elections(election_id)
);

-- ── Indexes ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_sa_fp_election_district
    ON sa_district_fp(election_id, district_id);
CREATE INDEX IF NOT EXISTS idx_sa_2cp_election_district
    ON sa_district_2cp(election_id, district_id);
CREATE INDEX IF NOT EXISTS idx_sa_candidates_election_district
    ON sa_candidates(election_id, district_id);
