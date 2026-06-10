-- ============================================================
-- State/Territory Election — Parameterised Extension Schema
-- ============================================================
-- Single source of truth for the per-state extension schemas
-- (NSW, QLD, WA, SA, TAS, ACT, NT). Rendered per state by
-- pipeline.database.build_state_schema_sql(), which substitutes
-- the placeholders below and keeps/drops the conditional blocks.
-- The rendered DDL is byte-identical to the former per-state
-- {p}_schema.sql files (verified against sqlite_master dumps).
--
-- Placeholders:
--   {p}                state prefix, e.g. 'nsw'
--   {P}                upper-case prefix, e.g. 'NSW'
--   {jurisdiction}     e.g. 'nsw_state' / 'nt_territory'
--   {example_id}       example YYYYMM election_id for comments
--   {elected_comment}  Hare-Clark election-order comment (or empty)
--
-- Conditional blocks (kept when the state has the flag):
--   preferential   single-member preferential states (incl. NT)
--   hare_clark     multi-member Hare-Clark states (TAS, ACT)
--   std_2cp        standard 2CP table (NSW, QLD, WA, SA)
--   nt_2cp         NT 2CP table with exhausted_votes
--   booth_level    polling place + booth vote tables
--   std_booth_2cp  standard booth 2CP (NSW, QLD, WA, SA)
--   nt_booth_2cp   NT booth 2CP with exhausted_votes
--   lc             Legislative Council (upper house) tables
--                  (bicameral states handled here: NSW, WA, SA;
--                  VIC's regional LC lives in vec_schema.sql)
--
-- election_id convention: YYYYMM, e.g. {example_id}
-- ============================================================

-- ── {P} election metadata ──────────────────────────────────
CREATE TABLE IF NOT EXISTS {p}_elections (
    election_id   INTEGER PRIMARY KEY,  -- e.g. {example_id}
    name          TEXT    NOT NULL,
    election_date TEXT    NOT NULL,     -- ISO-8601 YYYY-MM-DD
    jurisdiction  TEXT    NOT NULL DEFAULT '{jurisdiction}',
    created_at    TEXT    DEFAULT (datetime('now'))
);

-- @if preferential
-- ── {P} Districts (lower house seats) ──────────────────────
-- One row per district per election to track boundary changes.
CREATE TABLE IF NOT EXISTS {p}_districts (
    district_id   INTEGER NOT NULL,
    election_id   INTEGER NOT NULL,
    district_name TEXT    NOT NULL,
    enrolment     INTEGER,
    PRIMARY KEY (district_id, election_id),
    FOREIGN KEY (election_id) REFERENCES {p}_elections(election_id)
);
-- @endif
-- @if hare_clark
-- ── {P} Districts (Hare-Clark electorates) ─────────────────
-- seats_in_district records the number of seats to fill.
CREATE TABLE IF NOT EXISTS {p}_districts (
    district_id      INTEGER NOT NULL,
    election_id      INTEGER NOT NULL,
    district_name    TEXT    NOT NULL,
    enrolment        INTEGER,
    seats_in_district INTEGER NOT NULL DEFAULT 5,
    PRIMARY KEY (district_id, election_id),
    FOREIGN KEY (election_id) REFERENCES {p}_elections(election_id)
);
-- @endif

-- ── {P} Candidates ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS {p}_candidates (
    candidate_id    INTEGER NOT NULL,
    election_id     INTEGER NOT NULL,
    district_id     INTEGER NOT NULL,
    surname         TEXT    NOT NULL,
    given_name      TEXT,
    party_ab        TEXT,
    party_name      TEXT,
    ballot_position INTEGER,
    elected         INTEGER DEFAULT 0,{elected_comment}
    PRIMARY KEY (candidate_id, election_id),
    FOREIGN KEY (election_id) REFERENCES {p}_elections(election_id),
    FOREIGN KEY (district_id, election_id)
        REFERENCES {p}_districts(district_id, election_id)
);

-- @if preferential
-- ── {P} First Preferences (district-level) ─────────────────
CREATE TABLE IF NOT EXISTS {p}_district_fp (
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
    FOREIGN KEY (election_id) REFERENCES {p}_elections(election_id)
);
-- @endif
-- @if hare_clark
-- ── {P} First Preferences (district-level) ─────────────────
-- For Hare-Clark, quota and surplus transfers are complex; this table
-- stores first-preference totals only.
CREATE TABLE IF NOT EXISTS {p}_district_fp (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    election_id  INTEGER NOT NULL,
    district_id  INTEGER NOT NULL,
    candidate_id INTEGER NOT NULL,
    total_votes  INTEGER NOT NULL DEFAULT 0,
    vote_pct     REAL,
    UNIQUE (election_id, district_id, candidate_id),
    FOREIGN KEY (election_id) REFERENCES {p}_elections(election_id)
);
-- @endif

-- @if std_2cp
-- ── {P} Two-Candidate Preferred (district-level) ───────────
CREATE TABLE IF NOT EXISTS {p}_district_2cp (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    election_id  INTEGER NOT NULL,
    district_id  INTEGER NOT NULL,
    candidate_id INTEGER NOT NULL,
    total_votes  INTEGER NOT NULL DEFAULT 0,
    vote_pct     REAL,
    elected      INTEGER DEFAULT 0,
    UNIQUE (election_id, district_id, candidate_id),
    FOREIGN KEY (election_id) REFERENCES {p}_elections(election_id)
);
-- @endif
-- @if nt_2cp
-- ── {P} Two-Candidate Preferred (district-level) ───────────
-- Note: because NT uses optional preferential voting, 2CP counts
-- may exclude exhausted ballots (preferences stopped before reaching
-- either final candidate). The exhausted_votes column records the
-- district-level exhausted total when NTEC publishes it; otherwise
-- it is left at the default 0. Booth-level exhausted totals live in
-- nt_booth_2cp.exhausted_votes.
CREATE TABLE IF NOT EXISTS {p}_district_2cp (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    election_id     INTEGER NOT NULL,
    district_id     INTEGER NOT NULL,
    candidate_id    INTEGER NOT NULL,
    total_votes     INTEGER NOT NULL DEFAULT 0,
    vote_pct        REAL,
    elected         INTEGER DEFAULT 0,
    exhausted_votes INTEGER NOT NULL DEFAULT 0,
    UNIQUE (election_id, district_id, candidate_id),
    FOREIGN KEY (election_id) REFERENCES {p}_elections(election_id)
);
-- @endif
-- @if hare_clark

-- ── {P} District Summary (party seats per district) ────────
-- Aggregate seats won by party per district — convenient for Hare-Clark
-- analysis where TCP is not applicable. Column naming is intentionally
-- identical across Hare-Clark states so the shared _derive_party_seats()
-- helper in pipeline/state_parse.py can populate them with the same
-- dict schema.
CREATE TABLE IF NOT EXISTS {p}_district_party_seats (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    election_id  INTEGER NOT NULL,
    district_id  INTEGER NOT NULL,
    party_ab     TEXT    NOT NULL,
    seats_won    INTEGER NOT NULL DEFAULT 0,
    total_fp_votes INTEGER,
    UNIQUE (election_id, district_id, party_ab),
    FOREIGN KEY (election_id) REFERENCES {p}_elections(election_id)
);
-- @endif
-- @if booth_level

-- ── {P} Polling Places (booths) ────────────────────────────
-- One row per booth per election. lat/lon may be NULL for prepoll
-- centres and postal vote processing.
CREATE TABLE IF NOT EXISTS {p}_polling_places (
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
    FOREIGN KEY (election_id) REFERENCES {p}_elections(election_id),
    FOREIGN KEY (district_id, election_id)
        REFERENCES {p}_districts(district_id, election_id)
);

-- ── {P} Booth First Preferences ────────────────────────────
-- Booth-level FP votes per candidate.
-- ordinary_votes = votes cast in person on election day.
-- prepoll_votes  = pre-poll (early voting) counted at/attributed to this booth.
-- total_votes    = ordinary + prepoll + any other vote types included.
CREATE TABLE IF NOT EXISTS {p}_booth_fp (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    election_id      INTEGER NOT NULL,
    district_id      INTEGER NOT NULL,
    polling_place_id INTEGER NOT NULL,
    candidate_id     INTEGER NOT NULL,
    ordinary_votes   INTEGER NOT NULL DEFAULT 0,
    prepoll_votes    INTEGER NOT NULL DEFAULT 0,
    total_votes      INTEGER NOT NULL DEFAULT 0,
    UNIQUE (election_id, district_id, polling_place_id, candidate_id),
    FOREIGN KEY (election_id) REFERENCES {p}_elections(election_id),
    FOREIGN KEY (polling_place_id, election_id)
        REFERENCES {p}_polling_places(polling_place_id, election_id)
);
-- @endif
-- @if std_booth_2cp

-- ── {P} Booth Two-Candidate Preferred ──────────────────────
CREATE TABLE IF NOT EXISTS {p}_booth_2cp (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    election_id      INTEGER NOT NULL,
    district_id      INTEGER NOT NULL,
    polling_place_id INTEGER NOT NULL,
    candidate_id     INTEGER NOT NULL,
    ordinary_votes   INTEGER NOT NULL DEFAULT 0,
    prepoll_votes    INTEGER NOT NULL DEFAULT 0,
    total_votes      INTEGER NOT NULL DEFAULT 0,
    UNIQUE (election_id, district_id, polling_place_id, candidate_id),
    FOREIGN KEY (election_id) REFERENCES {p}_elections(election_id),
    FOREIGN KEY (polling_place_id, election_id)
        REFERENCES {p}_polling_places(polling_place_id, election_id)
);
-- @endif
-- @if nt_booth_2cp

-- ── {P} Booth Two-Candidate Preferred ──────────────────────
-- exhausted_votes column records ballots that did not flow to either
-- candidate — common under optional preferential voting.
CREATE TABLE IF NOT EXISTS {p}_booth_2cp (
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
    FOREIGN KEY (election_id) REFERENCES {p}_elections(election_id),
    FOREIGN KEY (polling_place_id, election_id)
        REFERENCES {p}_polling_places(polling_place_id, election_id)
);
-- @endif

-- ── Indexes ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_{p}_fp_election_district
    ON {p}_district_fp(election_id, district_id);
-- @if preferential
CREATE INDEX IF NOT EXISTS idx_{p}_2cp_election_district
    ON {p}_district_2cp(election_id, district_id);
-- @endif
CREATE INDEX IF NOT EXISTS idx_{p}_candidates_election_district
    ON {p}_candidates(election_id, district_id);
-- @if hare_clark
CREATE INDEX IF NOT EXISTS idx_{p}_party_seats_election_district
    ON {p}_district_party_seats(election_id, district_id);
-- @endif
-- @if booth_level
CREATE INDEX IF NOT EXISTS idx_{p}_pp_election_district
    ON {p}_polling_places(election_id, district_id);
CREATE INDEX IF NOT EXISTS idx_{p}_booth_fp_place
    ON {p}_booth_fp(election_id, district_id, polling_place_id);
CREATE INDEX IF NOT EXISTS idx_{p}_booth_2cp_place
    ON {p}_booth_2cp(election_id, district_id, polling_place_id);
-- @endif
-- @if lc

-- ── {P} Legislative Council (upper house) ──────────────────
-- Statewide proportional representation (group/party tickets).
-- Group-level first preferences only; full below-the-line preference
-- distribution is not modelled. Schema + loaders only for now — the
-- electoral commission's LC group first-preference downloads still
-- need a parser (see database.load_lc_* docstrings for sources).
CREATE TABLE IF NOT EXISTS {p}_lc_elections (
    election_id   INTEGER PRIMARY KEY,  -- e.g. {example_id}
    name          TEXT    NOT NULL,
    election_date TEXT    NOT NULL,     -- ISO-8601 YYYY-MM-DD
    jurisdiction  TEXT    NOT NULL DEFAULT '{p}_lc',
    seats_to_fill INTEGER NOT NULL,     -- members elected at this election
    created_at    TEXT    DEFAULT (datetime('now'))
);

-- ── {P} LC Groups (party / group tickets) ──────────────────
CREATE TABLE IF NOT EXISTS {p}_lc_groups (
    group_id    INTEGER NOT NULL,
    election_id INTEGER NOT NULL,
    group_label TEXT,                -- ballot group letter, e.g. 'A'
    party_ab    TEXT,
    party_name  TEXT,
    PRIMARY KEY (group_id, election_id),
    FOREIGN KEY (election_id) REFERENCES {p}_lc_elections(election_id)
);

-- ── {P} LC Group Votes (statewide group-level FP) ──────────
CREATE TABLE IF NOT EXISTS {p}_lc_group_votes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    election_id INTEGER NOT NULL,
    group_id    INTEGER NOT NULL,
    total_votes INTEGER NOT NULL DEFAULT 0,
    vote_pct    REAL,
    UNIQUE (election_id, group_id),
    FOREIGN KEY (election_id) REFERENCES {p}_lc_elections(election_id)
);

-- ── {P} LC Members Elected ─────────────────────────────────
CREATE TABLE IF NOT EXISTS {p}_lc_members_elected (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    election_id   INTEGER NOT NULL,
    group_id      INTEGER,            -- NULL for ungrouped independents
    surname       TEXT    NOT NULL,
    given_name    TEXT,
    party_ab      TEXT,
    elected_order INTEGER,            -- 1 = first elected
    UNIQUE (election_id, surname, given_name),
    FOREIGN KEY (election_id) REFERENCES {p}_lc_elections(election_id)
);

CREATE INDEX IF NOT EXISTS idx_{p}_lc_group_votes_election
    ON {p}_lc_group_votes(election_id);
CREATE INDEX IF NOT EXISTS idx_{p}_lc_members_election
    ON {p}_lc_members_elected(election_id);
-- @endif
