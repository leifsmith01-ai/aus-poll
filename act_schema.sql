-- ============================================================
-- ACT Electoral Commission — Extension Schema
-- ============================================================
-- Applied on top of schema.sql via database.init_state_schema('act').
-- Uses act_* tables to keep ACT election data separate from the
-- federal AEC pipeline tables and other states.
--
-- Election system: Hare-Clark proportional representation
-- Legislature: ACT Legislative Assembly (5 electorates × 5 members = 25 seats)
-- Electoral commission: ACT Electoral Commission — elections.act.gov.au
-- Note: The ACT is unicameral (no upper house).
--
-- Hare-Clark notes:
--   - Multi-member electorates (5 members per electorate since 2016).
--   - act_districts represents the 5 electorates (Brindabella, Ginninderra,
--     Kurrajong, Murrumbidgee, Molonglo pre-2016).
--   - seats_in_district column records the number of seats to fill.
--   - Multiple candidates can be elected per district.
--
-- election_id convention: YYYYMM, e.g. 202410 for October 2024
-- ============================================================

-- ── ACT election metadata ──────────────────────────────────
CREATE TABLE IF NOT EXISTS act_elections (
    election_id   INTEGER PRIMARY KEY,  -- e.g. 202410
    name          TEXT    NOT NULL,
    election_date TEXT    NOT NULL,     -- ISO-8601 YYYY-MM-DD
    jurisdiction  TEXT    NOT NULL DEFAULT 'act_territory',
    created_at    TEXT    DEFAULT (datetime('now'))
);

-- ── ACT Districts (Hare-Clark electorates) ─────────────────
-- seats_in_district = 5 for all electorates since 2016 redistribution.
CREATE TABLE IF NOT EXISTS act_districts (
    district_id      INTEGER NOT NULL,
    election_id      INTEGER NOT NULL,
    district_name    TEXT    NOT NULL,
    enrolment        INTEGER,
    seats_in_district INTEGER NOT NULL DEFAULT 5,
    PRIMARY KEY (district_id, election_id),
    FOREIGN KEY (election_id) REFERENCES act_elections(election_id)
);

-- ── ACT Candidates ─────────────────────────────────────────
-- elected stores election order (1 = first elected, etc.) or 0 for not elected.
CREATE TABLE IF NOT EXISTS act_candidates (
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
    FOREIGN KEY (election_id) REFERENCES act_elections(election_id),
    FOREIGN KEY (district_id, election_id)
        REFERENCES act_districts(district_id, election_id)
);

-- ── ACT First Preferences (district-level) ─────────────────
CREATE TABLE IF NOT EXISTS act_district_fp (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    election_id  INTEGER NOT NULL,
    district_id  INTEGER NOT NULL,
    candidate_id INTEGER NOT NULL,
    total_votes  INTEGER NOT NULL DEFAULT 0,
    vote_pct     REAL,
    UNIQUE (election_id, district_id, candidate_id),
    FOREIGN KEY (election_id) REFERENCES act_elections(election_id)
);

-- ── ACT District Summary (party seats per district) ────────
-- For Hare-Clark analysis where TCP is not applicable.
CREATE TABLE IF NOT EXISTS act_district_party_seats (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    election_id  INTEGER NOT NULL,
    district_id  INTEGER NOT NULL,
    party_ab     TEXT    NOT NULL,
    seats_won    INTEGER NOT NULL DEFAULT 0,
    total_fp_votes INTEGER,
    UNIQUE (election_id, district_id, party_ab),
    FOREIGN KEY (election_id) REFERENCES act_elections(election_id)
);

-- ── Indexes ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_act_fp_election_district
    ON act_district_fp(election_id, district_id);
CREATE INDEX IF NOT EXISTS idx_act_candidates_election_district
    ON act_candidates(election_id, district_id);
CREATE INDEX IF NOT EXISTS idx_act_party_seats_election_district
    ON act_district_party_seats(election_id, district_id);
