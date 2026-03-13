-- ============================================================
-- ECQ (Electoral Commission Queensland) — Extension Schema
-- ============================================================
-- Applied on top of schema.sql via database.init_state_schema('qld').
-- Uses qld_* tables to keep QLD state election data separate
-- from the federal AEC pipeline tables and other states.
--
-- Election system: Single-member electorates, preferential voting
-- Lower house: Legislative Assembly (93 seats)
-- Electoral commission: ECQ — ecq.qld.gov.au
-- Note: Queensland is unicameral (no upper house).
-- Main conservative party: LNP (Liberal National Party, merged 2008)
--
-- election_id convention: YYYYMM, e.g. 202410 for October 2024
-- ============================================================

-- ── QLD election metadata ──────────────────────────────────
CREATE TABLE IF NOT EXISTS qld_elections (
    election_id   INTEGER PRIMARY KEY,  -- e.g. 202410
    name          TEXT    NOT NULL,
    election_date TEXT    NOT NULL,     -- ISO-8601 YYYY-MM-DD
    jurisdiction  TEXT    NOT NULL DEFAULT 'qld_state',
    created_at    TEXT    DEFAULT (datetime('now'))
);

-- ── QLD Districts (93 Legislative Assembly seats) ──────────
CREATE TABLE IF NOT EXISTS qld_districts (
    district_id   INTEGER NOT NULL,
    election_id   INTEGER NOT NULL,
    district_name TEXT    NOT NULL,
    enrolment     INTEGER,
    PRIMARY KEY (district_id, election_id),
    FOREIGN KEY (election_id) REFERENCES qld_elections(election_id)
);

-- ── QLD Candidates ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS qld_candidates (
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
    FOREIGN KEY (election_id) REFERENCES qld_elections(election_id),
    FOREIGN KEY (district_id, election_id)
        REFERENCES qld_districts(district_id, election_id)
);

-- ── QLD First Preferences (district-level) ─────────────────
CREATE TABLE IF NOT EXISTS qld_district_fp (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    election_id  INTEGER NOT NULL,
    district_id  INTEGER NOT NULL,
    candidate_id INTEGER NOT NULL,
    total_votes  INTEGER NOT NULL DEFAULT 0,
    vote_pct     REAL,
    UNIQUE (election_id, district_id, candidate_id),
    FOREIGN KEY (election_id) REFERENCES qld_elections(election_id)
);

-- ── QLD Two-Candidate Preferred (district-level) ───────────
CREATE TABLE IF NOT EXISTS qld_district_2cp (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    election_id  INTEGER NOT NULL,
    district_id  INTEGER NOT NULL,
    candidate_id INTEGER NOT NULL,
    total_votes  INTEGER NOT NULL DEFAULT 0,
    vote_pct     REAL,
    elected      INTEGER DEFAULT 0,
    UNIQUE (election_id, district_id, candidate_id),
    FOREIGN KEY (election_id) REFERENCES qld_elections(election_id)
);

-- ── QLD Polling Places (booths) ────────────────────────────
-- ECQ publishes booth locations with coordinates via their results portal.
CREATE TABLE IF NOT EXISTS qld_polling_places (
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
    FOREIGN KEY (election_id) REFERENCES qld_elections(election_id),
    FOREIGN KEY (district_id, election_id)
        REFERENCES qld_districts(district_id, election_id)
);

-- ── QLD Booth First Preferences ────────────────────────────
CREATE TABLE IF NOT EXISTS qld_booth_fp (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    election_id      INTEGER NOT NULL,
    district_id      INTEGER NOT NULL,
    polling_place_id INTEGER NOT NULL,
    candidate_id     INTEGER NOT NULL,
    ordinary_votes   INTEGER NOT NULL DEFAULT 0,
    prepoll_votes    INTEGER NOT NULL DEFAULT 0,
    total_votes      INTEGER NOT NULL DEFAULT 0,
    UNIQUE (election_id, district_id, polling_place_id, candidate_id),
    FOREIGN KEY (election_id) REFERENCES qld_elections(election_id),
    FOREIGN KEY (polling_place_id, election_id)
        REFERENCES qld_polling_places(polling_place_id, election_id)
);

-- ── QLD Booth Two-Candidate Preferred ──────────────────────
CREATE TABLE IF NOT EXISTS qld_booth_2cp (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    election_id      INTEGER NOT NULL,
    district_id      INTEGER NOT NULL,
    polling_place_id INTEGER NOT NULL,
    candidate_id     INTEGER NOT NULL,
    ordinary_votes   INTEGER NOT NULL DEFAULT 0,
    prepoll_votes    INTEGER NOT NULL DEFAULT 0,
    total_votes      INTEGER NOT NULL DEFAULT 0,
    UNIQUE (election_id, district_id, polling_place_id, candidate_id),
    FOREIGN KEY (election_id) REFERENCES qld_elections(election_id),
    FOREIGN KEY (polling_place_id, election_id)
        REFERENCES qld_polling_places(polling_place_id, election_id)
);

-- ── Indexes ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_qld_fp_election_district
    ON qld_district_fp(election_id, district_id);
CREATE INDEX IF NOT EXISTS idx_qld_2cp_election_district
    ON qld_district_2cp(election_id, district_id);
CREATE INDEX IF NOT EXISTS idx_qld_candidates_election_district
    ON qld_candidates(election_id, district_id);
CREATE INDEX IF NOT EXISTS idx_qld_pp_election_district
    ON qld_polling_places(election_id, district_id);
CREATE INDEX IF NOT EXISTS idx_qld_booth_fp_place
    ON qld_booth_fp(election_id, district_id, polling_place_id);
CREATE INDEX IF NOT EXISTS idx_qld_booth_2cp_place
    ON qld_booth_2cp(election_id, district_id, polling_place_id);
