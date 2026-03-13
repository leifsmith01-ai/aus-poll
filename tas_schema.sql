-- ============================================================
-- TEC (Tasmanian Electoral Commission) — Extension Schema
-- ============================================================
-- Applied on top of schema.sql via database.init_state_schema('tas').
-- Uses tas_* tables to keep TAS state election data separate
-- from the federal AEC pipeline tables and other states.
--
-- Election system: Hare-Clark proportional representation
-- Lower house: House of Assembly (5 electorates × 5 members = 25 seats)
-- Electoral commission: TEC — tec.tas.gov.au
--
-- Hare-Clark notes:
--   - Multi-member electorates (5 members per electorate).
--   - tas_districts represents the 5 electorates (not individual seats).
--   - seats_in_district column records the number of seats to fill (5).
--   - Multiple candidates can be elected per district (elected > 0 means
--     the candidate was elected; their count position is stored in elected).
--   - No two-candidate preferred in the traditional sense; quota-based counts
--     are used instead (stored in tas_district_fp with quota info).
--
-- election_id convention: YYYYMM, e.g. 202403 for March 2024
-- ============================================================

-- ── TAS election metadata ──────────────────────────────────
CREATE TABLE IF NOT EXISTS tas_elections (
    election_id   INTEGER PRIMARY KEY,  -- e.g. 202403
    name          TEXT    NOT NULL,
    election_date TEXT    NOT NULL,     -- ISO-8601 YYYY-MM-DD
    jurisdiction  TEXT    NOT NULL DEFAULT 'tas_state',
    created_at    TEXT    DEFAULT (datetime('now'))
);

-- ── TAS Districts (5 Hare-Clark electorates) ───────────────
-- seats_in_district is normally 5 but could change (e.g. Franklin had 7
-- seats before 1998 redistribution).
CREATE TABLE IF NOT EXISTS tas_districts (
    district_id      INTEGER NOT NULL,
    election_id      INTEGER NOT NULL,
    district_name    TEXT    NOT NULL,
    enrolment        INTEGER,
    seats_in_district INTEGER NOT NULL DEFAULT 5,
    PRIMARY KEY (district_id, election_id),
    FOREIGN KEY (election_id) REFERENCES tas_elections(election_id)
);

-- ── TAS Candidates ─────────────────────────────────────────
-- elected stores election order (1 = first elected, 2 = second, etc.)
-- or 0 for not elected. Use elected > 0 to check if elected.
CREATE TABLE IF NOT EXISTS tas_candidates (
    candidate_id    INTEGER NOT NULL,
    election_id     INTEGER NOT NULL,
    district_id     INTEGER NOT NULL,
    surname         TEXT    NOT NULL,
    given_name      TEXT,
    party_ab        TEXT,
    party_name      TEXT,
    ballot_position INTEGER,
    elected         INTEGER DEFAULT 0,  -- 0 = not elected; 1–5 = election order
    PRIMARY KEY (candidate_id, election_id),
    FOREIGN KEY (election_id) REFERENCES tas_elections(election_id),
    FOREIGN KEY (district_id, election_id)
        REFERENCES tas_districts(district_id, election_id)
);

-- ── TAS First Preferences (district-level) ─────────────────
-- For Hare-Clark, quota and surplus transfers are complex; this table
-- stores first-preference totals only. Full preference distribution
-- (count-by-count) is not modelled here but can be added as a separate
-- tas_count_by_count table if needed.
CREATE TABLE IF NOT EXISTS tas_district_fp (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    election_id  INTEGER NOT NULL,
    district_id  INTEGER NOT NULL,
    candidate_id INTEGER NOT NULL,
    total_votes  INTEGER NOT NULL DEFAULT 0,
    vote_pct     REAL,
    UNIQUE (election_id, district_id, candidate_id),
    FOREIGN KEY (election_id) REFERENCES tas_elections(election_id)
);

-- ── TAS District Summary (party seats per district) ────────
-- Aggregate seats won by party per district — convenient for Hare-Clark
-- analysis where TCP is not applicable.
CREATE TABLE IF NOT EXISTS tas_district_party_seats (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    election_id  INTEGER NOT NULL,
    district_id  INTEGER NOT NULL,
    party_ab     TEXT    NOT NULL,
    seats_won    INTEGER NOT NULL DEFAULT 0,
    total_fp_votes INTEGER,
    UNIQUE (election_id, district_id, party_ab),
    FOREIGN KEY (election_id) REFERENCES tas_elections(election_id)
);

-- ── Indexes ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_tas_fp_election_district
    ON tas_district_fp(election_id, district_id);
CREATE INDEX IF NOT EXISTS idx_tas_candidates_election_district
    ON tas_candidates(election_id, district_id);
CREATE INDEX IF NOT EXISTS idx_tas_party_seats_election_district
    ON tas_district_party_seats(election_id, district_id);
