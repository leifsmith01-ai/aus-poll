-- ============================================================
-- WAEC (Western Australian Electoral Commission) — Extension Schema
-- ============================================================
-- Applied on top of schema.sql via database.init_state_schema('wa').
-- Uses wa_* tables to keep WA state election data separate
-- from the federal AEC pipeline tables and other states.
--
-- Election system: Single-member electorates, preferential voting
-- Lower house: Legislative Assembly (59 seats)
-- Electoral commission: WAEC — elections.wa.gov.au
--
-- election_id convention: YYYYMM, e.g. 202503 for March 2025
-- ============================================================

-- ── WA election metadata ───────────────────────────────────
CREATE TABLE IF NOT EXISTS wa_elections (
    election_id   INTEGER PRIMARY KEY,  -- e.g. 202503
    name          TEXT    NOT NULL,
    election_date TEXT    NOT NULL,     -- ISO-8601 YYYY-MM-DD
    jurisdiction  TEXT    NOT NULL DEFAULT 'wa_state',
    created_at    TEXT    DEFAULT (datetime('now'))
);

-- ── WA Districts (59 Legislative Assembly seats) ───────────
CREATE TABLE IF NOT EXISTS wa_districts (
    district_id   INTEGER NOT NULL,
    election_id   INTEGER NOT NULL,
    district_name TEXT    NOT NULL,
    enrolment     INTEGER,
    PRIMARY KEY (district_id, election_id),
    FOREIGN KEY (election_id) REFERENCES wa_elections(election_id)
);

-- ── WA Candidates ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wa_candidates (
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
    FOREIGN KEY (election_id) REFERENCES wa_elections(election_id),
    FOREIGN KEY (district_id, election_id)
        REFERENCES wa_districts(district_id, election_id)
);

-- ── WA First Preferences (district-level) ──────────────────
CREATE TABLE IF NOT EXISTS wa_district_fp (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    election_id  INTEGER NOT NULL,
    district_id  INTEGER NOT NULL,
    candidate_id INTEGER NOT NULL,
    total_votes  INTEGER NOT NULL DEFAULT 0,
    vote_pct     REAL,
    -- Turnout and informal-vote tracking (populated when the source files
    -- expose an enrolment column; left NULL otherwise).
    informal_votes INTEGER DEFAULT 0,
    total_enrolled INTEGER,
    turnout_pct    REAL,
    UNIQUE (election_id, district_id, candidate_id),
    FOREIGN KEY (election_id) REFERENCES wa_elections(election_id)
);

-- ── WA Two-Candidate Preferred (district-level) ────────────
CREATE TABLE IF NOT EXISTS wa_district_2cp (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    election_id  INTEGER NOT NULL,
    district_id  INTEGER NOT NULL,
    candidate_id INTEGER NOT NULL,
    total_votes  INTEGER NOT NULL DEFAULT 0,
    vote_pct     REAL,
    elected      INTEGER DEFAULT 0,
    UNIQUE (election_id, district_id, candidate_id),
    FOREIGN KEY (election_id) REFERENCES wa_elections(election_id)
);

-- ── WA Polling Places (booths) ─────────────────────────────
-- WAEC publishes booth locations and results files per election.
CREATE TABLE IF NOT EXISTS wa_polling_places (
    polling_place_id   INTEGER NOT NULL,
    election_id        INTEGER NOT NULL,
    district_id        INTEGER NOT NULL,
    polling_place_name TEXT    NOT NULL,
    premises_name      TEXT,
    address            TEXT,
    suburb             TEXT,
    postcode           TEXT,
    latitude           REAL,
    longitude          REAL,
    PRIMARY KEY (polling_place_id, election_id),
    FOREIGN KEY (election_id) REFERENCES wa_elections(election_id),
    FOREIGN KEY (district_id, election_id)
        REFERENCES wa_districts(district_id, election_id)
);

-- ── WA Booth First Preferences ─────────────────────────────
CREATE TABLE IF NOT EXISTS wa_booth_fp (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    election_id      INTEGER NOT NULL,
    district_id      INTEGER NOT NULL,
    polling_place_id INTEGER NOT NULL,
    candidate_id     INTEGER NOT NULL,
    ordinary_votes   INTEGER NOT NULL DEFAULT 0,
    prepoll_votes    INTEGER NOT NULL DEFAULT 0,
    total_votes      INTEGER NOT NULL DEFAULT 0,
    UNIQUE (election_id, district_id, polling_place_id, candidate_id),
    FOREIGN KEY (election_id) REFERENCES wa_elections(election_id),
    FOREIGN KEY (polling_place_id, election_id)
        REFERENCES wa_polling_places(polling_place_id, election_id)
);

-- ── WA Booth Two-Candidate Preferred ───────────────────────
CREATE TABLE IF NOT EXISTS wa_booth_2cp (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    election_id      INTEGER NOT NULL,
    district_id      INTEGER NOT NULL,
    polling_place_id INTEGER NOT NULL,
    candidate_id     INTEGER NOT NULL,
    ordinary_votes   INTEGER NOT NULL DEFAULT 0,
    prepoll_votes    INTEGER NOT NULL DEFAULT 0,
    total_votes      INTEGER NOT NULL DEFAULT 0,
    UNIQUE (election_id, district_id, polling_place_id, candidate_id),
    FOREIGN KEY (election_id) REFERENCES wa_elections(election_id),
    FOREIGN KEY (polling_place_id, election_id)
        REFERENCES wa_polling_places(polling_place_id, election_id)
);

-- ── Indexes ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_wa_fp_election_district
    ON wa_district_fp(election_id, district_id);
CREATE INDEX IF NOT EXISTS idx_wa_2cp_election_district
    ON wa_district_2cp(election_id, district_id);
CREATE INDEX IF NOT EXISTS idx_wa_candidates_election_district
    ON wa_candidates(election_id, district_id);
CREATE INDEX IF NOT EXISTS idx_wa_pp_election_district
    ON wa_polling_places(election_id, district_id);
CREATE INDEX IF NOT EXISTS idx_wa_booth_fp_place
    ON wa_booth_fp(election_id, district_id, polling_place_id);
CREATE INDEX IF NOT EXISTS idx_wa_booth_2cp_place
    ON wa_booth_2cp(election_id, district_id, polling_place_id);
