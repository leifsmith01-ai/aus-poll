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
-- One row per candidate × district.  Booth-level data lives in
-- the vic_booth_fp / vic_booth_2cp tables below and is sourced
-- from the VEC Tally Room booth-level exports (see
-- parse_vec_booths() in pipeline/vec_parse.py).
CREATE TABLE IF NOT EXISTS vic_district_fp (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    election_id    INTEGER NOT NULL,
    district_id    INTEGER NOT NULL,
    candidate_id   INTEGER NOT NULL,
    total_votes    INTEGER NOT NULL DEFAULT 0,
    vote_pct       REAL,
    -- Turnout and informal vote tracking (populated when VEC enrolment data available)
    informal_votes INTEGER DEFAULT 0,
    total_enrolled INTEGER,          -- enrolled voters in this district (from enrolment file)
    turnout_pct    REAL,             -- (total_formal + informal) / total_enrolled * 100
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

-- ── VIC Distribution of Preferences (district-level) ─────
-- Stores each count round from VEC DOP publications, enabling
-- preference flow analysis between elections.
-- VEC publishes DOP in its district-level Excel files.
CREATE TABLE IF NOT EXISTS vic_district_dop (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    election_id  INTEGER NOT NULL,
    district_id  INTEGER NOT NULL,
    count_number INTEGER NOT NULL,   -- preference distribution round (1 = first exclusion)
    candidate_id INTEGER NOT NULL,
    votes_gained INTEGER DEFAULT 0,  -- preferences received in this round
    votes_total  INTEGER DEFAULT 0,  -- running total after this round
    exhausted    INTEGER DEFAULT 0,  -- votes that exhausted at this round
    UNIQUE (election_id, district_id, count_number, candidate_id),
    FOREIGN KEY (election_id) REFERENCES vic_elections(election_id)
);

-- ── VIC Polling Places (booths) ───────────────────────────
-- One row per booth per election. Booth IDs are assigned
-- synthetically by the parser (deterministic hash of booth name
-- + district so the same booth across elections shares an ID
-- when possible). lat/lon may be NULL for prepoll / postal.
CREATE TABLE IF NOT EXISTS vic_polling_places (
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
    FOREIGN KEY (election_id) REFERENCES vic_elections(election_id),
    FOREIGN KEY (district_id, election_id)
        REFERENCES vic_districts(district_id, election_id)
);

-- ── VIC Booth First Preferences ───────────────────────────
-- Booth-level FP votes per candidate, sourced from the VEC
-- Tally Room booth-level exports. ordinary_votes is in-person
-- election-day votes; prepoll_votes is early votes attributed
-- to the booth; total_votes is the all-vote-types total.
CREATE TABLE IF NOT EXISTS vic_booth_fp (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    election_id      INTEGER NOT NULL,
    district_id      INTEGER NOT NULL,
    polling_place_id INTEGER NOT NULL,
    candidate_id     INTEGER NOT NULL,
    ordinary_votes   INTEGER NOT NULL DEFAULT 0,
    prepoll_votes    INTEGER NOT NULL DEFAULT 0,
    total_votes      INTEGER NOT NULL DEFAULT 0,
    UNIQUE (election_id, district_id, polling_place_id, candidate_id),
    FOREIGN KEY (election_id) REFERENCES vic_elections(election_id),
    FOREIGN KEY (polling_place_id, election_id)
        REFERENCES vic_polling_places(polling_place_id, election_id)
);

-- ── VIC Booth Two-Candidate Preferred ─────────────────────
CREATE TABLE IF NOT EXISTS vic_booth_2cp (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    election_id      INTEGER NOT NULL,
    district_id      INTEGER NOT NULL,
    polling_place_id INTEGER NOT NULL,
    candidate_id     INTEGER NOT NULL,
    ordinary_votes   INTEGER NOT NULL DEFAULT 0,
    prepoll_votes    INTEGER NOT NULL DEFAULT 0,
    total_votes      INTEGER NOT NULL DEFAULT 0,
    UNIQUE (election_id, district_id, polling_place_id, candidate_id),
    FOREIGN KEY (election_id) REFERENCES vic_elections(election_id),
    FOREIGN KEY (polling_place_id, election_id)
        REFERENCES vic_polling_places(polling_place_id, election_id)
);

-- ── Indexes ───────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_vic_fp_election_district
    ON vic_district_fp(election_id, district_id);
CREATE INDEX IF NOT EXISTS idx_vic_2cp_election_district
    ON vic_district_2cp(election_id, district_id);
CREATE INDEX IF NOT EXISTS idx_vic_candidates_election_district
    ON vic_candidates(election_id, district_id);
CREATE INDEX IF NOT EXISTS idx_vic_dop_election_district
    ON vic_district_dop(election_id, district_id);
CREATE INDEX IF NOT EXISTS idx_vic_booth_fp_election_district
    ON vic_booth_fp(election_id, district_id);
CREATE INDEX IF NOT EXISTS idx_vic_booth_2cp_election_district
    ON vic_booth_2cp(election_id, district_id);
CREATE INDEX IF NOT EXISTS idx_vic_polling_places_election_district
    ON vic_polling_places(election_id, district_id);

-- ── vic_district_margins view ─────────────────────────────
-- Convenience view: one row per elected district per election,
-- with the 2CP margin (winner_pct - 50) and the winning party.
-- Used by the export layer and frontend for seat projections.
CREATE VIEW IF NOT EXISTS vic_district_margins AS
SELECT
    d.election_id,
    d.district_id,
    dn.district_name,
    dn.enrolment,
    MAX(d.vote_pct) - 50.0        AS margin_pct,
    c.party_ab                    AS winner_party,
    c.surname || ', ' || c.given_name AS winner_name
FROM vic_district_2cp d
JOIN vic_candidates c
    ON  c.candidate_id = d.candidate_id
    AND c.election_id  = d.election_id
JOIN vic_districts dn
    ON  dn.district_id  = d.district_id
    AND dn.election_id  = d.election_id
WHERE d.elected = 1
GROUP BY d.election_id, d.district_id;
