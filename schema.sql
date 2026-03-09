-- ============================================================
-- AEC Election Dashboard – SQLite schema
-- ============================================================
-- Design principles:
--   • election_id (year) + AEC's own IDs are the natural keys
--   • All vote counts stored as integers (AEC publishes whole numbers)
--   • Preference flows stored as REAL (percentages for modelling)
--   • Boundary geometries stored as GeoJSON text for portability
-- ============================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ── Elections ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS elections (
    election_id   INTEGER PRIMARY KEY,   -- e.g. 2022
    event_id      INTEGER NOT NULL UNIQUE, -- AEC internal event ID
    name          TEXT    NOT NULL,
    election_date TEXT    NOT NULL,       -- ISO-8601 YYYY-MM-DD
    created_at    TEXT    DEFAULT (datetime('now'))
);

-- ── States ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS states (
    state_ab   TEXT PRIMARY KEY,  -- NSW, VIC, …
    state_name TEXT NOT NULL
);

INSERT OR IGNORE INTO states VALUES
    ('NSW', 'New South Wales'),
    ('VIC', 'Victoria'),
    ('QLD', 'Queensland'),
    ('WA',  'Western Australia'),
    ('SA',  'South Australia'),
    ('TAS', 'Tasmania'),
    ('ACT', 'Australian Capital Territory'),
    ('NT',  'Northern Territory');

-- ── Divisions (electoral divisions / seats) ──────────────────
-- One row per division per election to track boundary changes.
CREATE TABLE IF NOT EXISTS divisions (
    division_id   INTEGER NOT NULL,  -- AEC DivisionID
    election_id   INTEGER NOT NULL,
    state_ab      TEXT    NOT NULL,
    division_name TEXT    NOT NULL,
    enrolment     INTEGER,            -- total enrolled voters
    PRIMARY KEY (division_id, election_id),
    FOREIGN KEY (election_id) REFERENCES elections(election_id),
    FOREIGN KEY (state_ab)    REFERENCES states(state_ab)
);

-- ── Candidates ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS candidates (
    candidate_id   INTEGER NOT NULL,  -- AEC CandidateID
    election_id    INTEGER NOT NULL,
    division_id    INTEGER NOT NULL,
    surname        TEXT    NOT NULL,
    given_name     TEXT,
    party_ab       TEXT,
    party_name     TEXT,
    ballot_position INTEGER,
    elected        INTEGER DEFAULT 0, -- 1 = elected, 0 = not
    historic_elected INTEGER DEFAULT 0,
    PRIMARY KEY (candidate_id, election_id),
    FOREIGN KEY (election_id) REFERENCES elections(election_id),
    FOREIGN KEY (division_id, election_id) REFERENCES divisions(division_id, election_id)
);

-- ── Polling places (booths) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS polling_places (
    polling_place_id      INTEGER NOT NULL,  -- AEC PollingPlaceID
    election_id           INTEGER NOT NULL,
    division_id           INTEGER NOT NULL,
    polling_place_name    TEXT    NOT NULL,
    polling_place_type_id INTEGER,
    premises_name         TEXT,
    address               TEXT,
    suburb                TEXT,
    state_ab              TEXT,
    postcode              TEXT,
    latitude              REAL,
    longitude             REAL,
    PRIMARY KEY (polling_place_id, election_id),
    FOREIGN KEY (election_id) REFERENCES elections(election_id),
    FOREIGN KEY (division_id, election_id) REFERENCES divisions(division_id, election_id)
);

-- ── First preferences by booth ────────────────────────────────
-- Granularity: one row per candidate × booth × election.
-- Vote types are kept separate for sensitivity analysis
-- (e.g. postal votes often skew differently).
CREATE TABLE IF NOT EXISTS first_preferences (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    election_id       INTEGER NOT NULL,
    division_id       INTEGER NOT NULL,
    polling_place_id  INTEGER NOT NULL,
    candidate_id      INTEGER NOT NULL,
    ordinary_votes    INTEGER DEFAULT 0,
    absent_votes      INTEGER DEFAULT 0,
    provisional_votes INTEGER DEFAULT 0,
    prepoll_votes     INTEGER DEFAULT 0,
    postal_votes      INTEGER DEFAULT 0,
    total_votes       INTEGER DEFAULT 0,
    UNIQUE (election_id, division_id, polling_place_id, candidate_id),
    FOREIGN KEY (election_id) REFERENCES elections(election_id),
    FOREIGN KEY (candidate_id, election_id) REFERENCES candidates(candidate_id, election_id)
);

-- ── Two-candidate preferred (TCP) by booth ────────────────────
CREATE TABLE IF NOT EXISTS tcp_votes (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    election_id       INTEGER NOT NULL,
    division_id       INTEGER NOT NULL,
    polling_place_id  INTEGER NOT NULL,
    candidate_id      INTEGER NOT NULL,
    ordinary_votes    INTEGER DEFAULT 0,
    absent_votes      INTEGER DEFAULT 0,
    provisional_votes INTEGER DEFAULT 0,
    prepoll_votes     INTEGER DEFAULT 0,
    postal_votes      INTEGER DEFAULT 0,
    total_votes       INTEGER DEFAULT 0,
    UNIQUE (election_id, division_id, polling_place_id, candidate_id),
    FOREIGN KEY (election_id) REFERENCES elections(election_id),
    FOREIGN KEY (candidate_id, election_id) REFERENCES candidates(candidate_id, election_id)
);

-- ── Distribution of preferences (full count-by-count) ─────────
-- Stores the progressive preference distribution for each division.
-- calculation_type values: "Preference Count", "Transfer Count",
--   "Exhausted", "Gain/Loss", etc.
CREATE TABLE IF NOT EXISTS distribution_of_preferences (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    election_id       INTEGER NOT NULL,
    division_id       INTEGER NOT NULL,
    polling_place_id  INTEGER,          -- NULL for division-level DOP
    candidate_id      INTEGER NOT NULL,
    count_number      INTEGER NOT NULL,
    calculation_type  TEXT    NOT NULL,
    calculation_value REAL,
    FOREIGN KEY (election_id) REFERENCES elections(election_id)
);

-- ── Electoral boundaries (GeoJSON) ───────────────────────────
-- Stores boundary polygons per division per election.
-- When redistribution occurs, add a new row with the new boundary_version.
CREATE TABLE IF NOT EXISTS electoral_boundaries (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    election_id       INTEGER NOT NULL,
    division_id       INTEGER NOT NULL,
    boundary_version  TEXT    NOT NULL,  -- e.g. "2022", "2024-redistribution"
    effective_date    TEXT,              -- ISO-8601
    geojson           TEXT    NOT NULL,
    FOREIGN KEY (election_id) REFERENCES elections(election_id)
);

-- ── Preference flow matrices ──────────────────────────────────
-- Stores observed (or user-modelled) preference flows between parties.
-- Used by the sensitivity testing tool.
-- from_party -> to_party : flow_pct (0-100)
-- scope: 'national', 'state', 'division'
CREATE TABLE IF NOT EXISTS preference_flows (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    election_id  INTEGER NOT NULL,
    scope        TEXT    NOT NULL DEFAULT 'national', -- national|state|division
    scope_value  TEXT,                                -- e.g. 'VIC' or division_id
    from_party   TEXT    NOT NULL,
    to_party     TEXT    NOT NULL,
    flow_pct     REAL    NOT NULL,   -- percentage of prefs (0-100)
    is_observed  INTEGER DEFAULT 1,  -- 1=from actual data, 0=user model
    label        TEXT,               -- description for user-created scenarios
    created_at   TEXT    DEFAULT (datetime('now')),
    FOREIGN KEY (election_id) REFERENCES elections(election_id)
);

-- ── Polling data (manual input / scraped) ─────────────────────
CREATE TABLE IF NOT EXISTS polling_data (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    pollster     TEXT,
    poll_date    TEXT,               -- ISO-8601
    scope        TEXT    NOT NULL DEFAULT 'national', -- national|state|division
    scope_value  TEXT,               -- state_ab or division_id
    party_ab     TEXT    NOT NULL,
    primary_vote REAL,               -- % first preferences
    two_pp       REAL,               -- % two-party preferred (ALP vs Coalition)
    sample_size  INTEGER,
    source_url   TEXT,
    notes        TEXT,
    created_at   TEXT    DEFAULT (datetime('now'))
);

-- ── Scenario projections (user-created) ───────────────────────
-- Stores named scenarios (polling adjustments + preference flow tweaks)
-- so users can save and share them via URL slug.
CREATE TABLE IF NOT EXISTS scenarios (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    slug         TEXT    NOT NULL UNIQUE,  -- short URL-safe identifier
    label        TEXT    NOT NULL,
    description  TEXT,
    base_election_id INTEGER NOT NULL,
    config_json  TEXT    NOT NULL,  -- JSON blob of all scenario settings
    created_at   TEXT    DEFAULT (datetime('now')),
    FOREIGN KEY (base_election_id) REFERENCES elections(election_id)
);

-- ── Indexes for query performance ────────────────────────────
CREATE INDEX IF NOT EXISTS idx_fp_election_division
    ON first_preferences(election_id, division_id);
CREATE INDEX IF NOT EXISTS idx_fp_election_booth
    ON first_preferences(election_id, polling_place_id);
CREATE INDEX IF NOT EXISTS idx_tcp_election_division
    ON tcp_votes(election_id, division_id);
CREATE INDEX IF NOT EXISTS idx_dop_election_division
    ON distribution_of_preferences(election_id, division_id);
CREATE INDEX IF NOT EXISTS idx_candidates_election_division
    ON candidates(election_id, division_id);
CREATE INDEX IF NOT EXISTS idx_booths_election_division
    ON polling_places(election_id, division_id);
CREATE INDEX IF NOT EXISTS idx_pref_flows_election_scope
    ON preference_flows(election_id, scope, scope_value);
CREATE INDEX IF NOT EXISTS idx_polling_scope
    ON polling_data(scope, scope_value, poll_date);
