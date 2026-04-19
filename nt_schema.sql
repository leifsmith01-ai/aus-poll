-- ============================================================
-- NTEC (Northern Territory Electoral Commission) — Extension Schema
-- ============================================================
-- Applied on top of schema.sql via database.init_state_schema('nt').
-- Uses nt_* tables to keep NT election data separate from the
-- federal AEC pipeline tables and other states.
--
-- Election system: Single-member electorates, preferential voting
-- Legislature: NT Legislative Assembly (25 seats)
-- Electoral commission: NTEC — ntec.nt.gov.au
-- Note: The NT is unicameral (no upper house).
-- Main conservative party: CLP (Country Liberal Party)
-- Note: NT uses optional preferential voting (preferences optional,
--       not compulsory as in most other Australian jurisdictions).
--
-- election_id convention: YYYYMM, e.g. 202408 for August 2024
-- ============================================================

-- ── NT election metadata ───────────────────────────────────
CREATE TABLE IF NOT EXISTS nt_elections (
    election_id   INTEGER PRIMARY KEY,  -- e.g. 202408
    name          TEXT    NOT NULL,
    election_date TEXT    NOT NULL,     -- ISO-8601 YYYY-MM-DD
    jurisdiction  TEXT    NOT NULL DEFAULT 'nt_territory',
    created_at    TEXT    DEFAULT (datetime('now'))
);

-- ── NT Districts (25 Legislative Assembly seats) ───────────
CREATE TABLE IF NOT EXISTS nt_districts (
    district_id   INTEGER NOT NULL,
    election_id   INTEGER NOT NULL,
    district_name TEXT    NOT NULL,
    enrolment     INTEGER,
    PRIMARY KEY (district_id, election_id),
    FOREIGN KEY (election_id) REFERENCES nt_elections(election_id)
);

-- ── NT Candidates ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nt_candidates (
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
    FOREIGN KEY (election_id) REFERENCES nt_elections(election_id),
    FOREIGN KEY (district_id, election_id)
        REFERENCES nt_districts(district_id, election_id)
);

-- ── NT First Preferences (district-level) ──────────────────
CREATE TABLE IF NOT EXISTS nt_district_fp (
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
    FOREIGN KEY (election_id) REFERENCES nt_elections(election_id)
);

-- ── NT Two-Candidate Preferred (district-level) ────────────
-- Note: because NT uses optional preferential voting, 2CP counts
-- may exclude exhausted ballots (preferences stopped before reaching
-- either final candidate). The exhausted_votes column records the
-- district-level exhausted total when NTEC publishes it; otherwise
-- it is left at the default 0. Booth-level exhausted totals live in
-- nt_booth_2cp.exhausted_votes.
CREATE TABLE IF NOT EXISTS nt_district_2cp (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    election_id     INTEGER NOT NULL,
    district_id     INTEGER NOT NULL,
    candidate_id    INTEGER NOT NULL,
    total_votes     INTEGER NOT NULL DEFAULT 0,
    vote_pct        REAL,
    elected         INTEGER DEFAULT 0,
    exhausted_votes INTEGER NOT NULL DEFAULT 0,
    UNIQUE (election_id, district_id, candidate_id),
    FOREIGN KEY (election_id) REFERENCES nt_elections(election_id)
);

-- ── NT Polling Places (booths) ─────────────────────────────
-- NTEC publishes booth-level results.
-- Note: NT's optional preferential voting means some booths may have
-- higher exhaust rates in TCP counts.
CREATE TABLE IF NOT EXISTS nt_polling_places (
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
    FOREIGN KEY (election_id) REFERENCES nt_elections(election_id),
    FOREIGN KEY (district_id, election_id)
        REFERENCES nt_districts(district_id, election_id)
);

-- ── NT Booth First Preferences ─────────────────────────────
CREATE TABLE IF NOT EXISTS nt_booth_fp (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    election_id      INTEGER NOT NULL,
    district_id      INTEGER NOT NULL,
    polling_place_id INTEGER NOT NULL,
    candidate_id     INTEGER NOT NULL,
    ordinary_votes   INTEGER NOT NULL DEFAULT 0,
    prepoll_votes    INTEGER NOT NULL DEFAULT 0,
    total_votes      INTEGER NOT NULL DEFAULT 0,
    UNIQUE (election_id, district_id, polling_place_id, candidate_id),
    FOREIGN KEY (election_id) REFERENCES nt_elections(election_id),
    FOREIGN KEY (polling_place_id, election_id)
        REFERENCES nt_polling_places(polling_place_id, election_id)
);

-- ── NT Booth Two-Candidate Preferred ───────────────────────
-- exhausted_votes column records ballots that did not flow to either
-- candidate — common under optional preferential voting.
CREATE TABLE IF NOT EXISTS nt_booth_2cp (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    election_id      INTEGER NOT NULL,
    district_id      INTEGER NOT NULL,
    polling_place_id INTEGER NOT NULL,
    candidate_id     INTEGER NOT NULL,
    ordinary_votes   INTEGER NOT NULL DEFAULT 0,
    prepoll_votes    INTEGER NOT NULL DEFAULT 0,
    total_votes      INTEGER NOT NULL DEFAULT 0,
    exhausted_votes  INTEGER NOT NULL DEFAULT 0,
    UNIQUE (election_id, district_id, polling_place_id, candidate_id),
    FOREIGN KEY (election_id) REFERENCES nt_elections(election_id),
    FOREIGN KEY (polling_place_id, election_id)
        REFERENCES nt_polling_places(polling_place_id, election_id)
);

-- ── Indexes ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_nt_fp_election_district
    ON nt_district_fp(election_id, district_id);
CREATE INDEX IF NOT EXISTS idx_nt_2cp_election_district
    ON nt_district_2cp(election_id, district_id);
CREATE INDEX IF NOT EXISTS idx_nt_candidates_election_district
    ON nt_candidates(election_id, district_id);
CREATE INDEX IF NOT EXISTS idx_nt_pp_election_district
    ON nt_polling_places(election_id, district_id);
CREATE INDEX IF NOT EXISTS idx_nt_booth_fp_place
    ON nt_booth_fp(election_id, district_id, polling_place_id);
CREATE INDEX IF NOT EXISTS idx_nt_booth_2cp_place
    ON nt_booth_2cp(election_id, district_id, polling_place_id);
