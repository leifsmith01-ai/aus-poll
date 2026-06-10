# CLAUDE.md — aus-poll Codebase Guide

This file is a reference for AI assistants working on the **aus-poll** repository. It covers project structure, development workflows, domain knowledge, and conventions you need to contribute effectively.

---

## Project Overview

**aus-poll** is an open-source, seat-by-seat Australian federal (and state) election modelling dashboard.

- **Purpose:** Interactive election night wall — live polling tracker, swing model, scenario builder
- **Live demo:** https://leifsmith01-ai.github.io/aus-poll/
- **Tech stack:**
  - Backend/pipeline: Python 3.x + SQLite
  - Frontend: React 18 + Vite (no backend at runtime — all data is baked in as JSON)
  - Deployment: GitHub Pages (frontend) + optional Vercel

---

## Repository Structure

```
aus-poll/
├── webapp/                        # Vite + React frontend dashboard
│   ├── src/
│   │   ├── App.jsx                # Main dashboard (10,000+ lines) — all modelling logic lives here
│   │   ├── main.jsx               # React entry point
│   │   └── data/
│   │       └── demographics.js    # ABS demographic overlays (Census SA1/SA2 data)
│   ├── index.html
│   ├── vite.config.js             # Base path = "/" for GitHub Pages
│   └── package.json               # react, react-dom, recharts, vite
├── pipeline/
│   ├── config.py                  # Election event IDs, file templates, party/seat constants
│   ├── download.py                # Downloads AEC CSV files from results.aec.gov.au
│   ├── parse.py                   # Parses AEC CSVs into Python dicts
│   ├── database.py                # SQLite schema initialisation, bulk loaders, query helpers
│   ├── export.py                  # Generates JSON files for the frontend (1,070 lines)
│   ├── backtest.py                # Model accuracy backtesting vs. 2022 actuals
│   ├── poll_aggregator.py         # Polling data aggregation (house effects, trend smoothing)
│   ├── state_download.py          # State/territory election downloads (NSW, QLD, WA, etc.)
│   ├── state_parse.py             # State election CSV parsing (1,095 lines)
│   ├── vec_download.py            # Victorian Electoral Commission downloads
│   ├── vec_parse.py               # VEC Excel file parsing (605 lines)
│   ├── fetch_demographics.py      # ABS Census data fetching
│   └── __init__.py
├── scripts/
│   ├── compute_calibration.py     # Generates data/calibration_report.txt
│   ├── update_s25_from_exports.py # Updates dashboard constants from export data
│   └── copy_data_to_frontend.py   # Copies JSON exports into webapp/src/data/
├── tests/
│   └── test_parse.py              # Unit tests for CSV parsing functions
├── data/
│   ├── polls/
│   │   ├── aggregated.json        # BludgerTrack-style poll aggregation with house effects
│   │   ├── bludgertrack.json      # Historical polling tracker data
│   │   └── vic_polls.json         # Victorian state polling
│   ├── calibration_report.txt     # Model accuracy report (2PP predictions vs. actuals)
│   ├── raw/                       # Downloaded AEC/VEC files (gitignored, except VEC Excels via LFS)
│   │   └── vic/202211/            # Victorian 2022 Excel files — stored in Git LFS
│   └── processed/                 # Intermediate files (gitignored)
├── main.py                        # Pipeline orchestrator (587 lines)
├── requirements.txt               # Python dependencies
├── schema.sql                     # Federal election SQLite schema
├── vec_schema.sql                 # Victorian election schema (incl. LC region tables)
├── state_schema_template.sql      # Parameterised template for the 7 non-VIC state schemas
│                                  #   (rendered by pipeline.database.build_state_schema_sql)
├── vercel.json                    # Vercel deployment config
├── PLAN.md                        # Detailed development roadmap (9,000+ lines)
├── README.md
└── .gitattributes                 # Git LFS config for VEC Excel files
```

**What is gitignored:**
- `data/raw/` (downloaded AEC CSVs — large, reproducible)
- `data/processed/` (intermediate pipeline outputs)
- `data/exports/` (large national JSON exports — generated locally)
- `data/elections.db` (SQLite database — generated locally)

**What is committed:**
- `data/polls/` (poll aggregation JSON files — manually curated)
- `data/calibration_report.txt`
- `data/raw/vic/202211/` Excel files via Git LFS

---

## Development Setup

### Python (pipeline)

```bash
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

Key dependencies: `requests`, `pandas`, `openpyxl`, `geopandas`, `shapely`, `fastapi`, `pytest`

### Node.js (frontend)

```bash
cd webapp
npm install
npm run dev        # Dev server at http://localhost:5173/
npm run build      # Outputs to webapp/dist/
```

---

## Running the Pipeline

The pipeline runs in four stages: **download → parse → load DB → export JSON**.

```bash
# Full pipeline for a single year
python main.py --year 2022

# Multiple years at once
python main.py --year 2019 2022

# Skip download (use existing files in data/raw/)
python main.py --year 2022 --skip-download

# Only regenerate JSON exports (database already populated)
python main.py --year 2022 --export-only

# Force re-download even if files exist
python main.py --year 2022 --force-download

# List locally available files
python main.py --list-files

# Verbose logging
python main.py --year 2022 -v
```

### State/territory elections

State elections use YYYYMM election IDs (e.g., `202211` = November 2022).

```bash
# Victorian state election
python main.py --state vic --year 202211

# NSW 2023
python main.py --state nsw --year 202303

# QLD 2024
python main.py --state qld --year 202410

# WA 2025
python main.py --state wa --year 202503
```

Supported `--state` values: `vic`, `nsw`, `qld`, `wa`, `sa`, `tas`, `act`, `nt`

---

## Testing

```bash
python -m pytest tests/ -v
```

Tests are in `tests/test_parse.py` and cover the AEC CSV parsing functions using synthetic data:
- `_iter_aec_csv` — skips AEC metadata header rows
- `parse_candidates` — candidate list parsing
- `parse_polling_places` — booth lat/lon parsing
- `parse_first_preferences` — FP votes by booth × candidate
- `parse_tcp` — two-candidate preferred parsing

Always run tests before committing changes to `pipeline/parse.py`.

---

## Key Files Reference

| File | Lines | Role |
|------|-------|------|
| `webapp/src/App.jsx` | ~10,000 | Entire React dashboard; all modelling constants and seat computation |
| `pipeline/config.py` | ~600 | Election event IDs, file templates, party abbreviations, seat constants |
| `pipeline/database.py` | ~1,165 | SQLite schema init, bulk loaders, query helpers |
| `pipeline/export.py` | ~1,070 | JSON generation for frontend consumption |
| `pipeline/state_parse.py` | ~1,095 | State election CSV parsing |
| `pipeline/poll_aggregator.py` | ~695 | Polling aggregation, house effects, preference flows |
| `pipeline/backtest.py` | ~582 | Model accuracy testing |
| `pipeline/vec_parse.py` | ~605 | VEC Excel parsing |
| `main.py` | ~587 | Pipeline orchestrator with argparse CLI |
| `PLAN.md` | ~9,000 | Detailed roadmap for primary-vote-based methodology upgrade |

---

## Configuration: `pipeline/config.py`

### Election event IDs

AEC assigns an integer event ID to each election used in all filenames and URLs:

| Year | Event ID | Date |
|------|----------|------|
| 2025 | 31496 | 3 May 2025 |
| 2022 | 27966 | 21 May 2022 |
| 2019 | 24310 | 18 May 2019 |
| 2016 | 20499 | 2 July 2016 |

### Adding a new election

Add an entry to `ELECTIONS` in `pipeline/config.py`:

```python
ELECTIONS[2028] = {
    "event_id": 34000,           # replace with actual AEC event ID
    "name": "2028 Australian Federal Election",
    "date": "2028-05-XX",
    "results_base_url": "https://results.aec.gov.au/34000/Website/Downloads",
}
```

Then run `python main.py --year 2028`.

### 2025 file format changes

The 2025 AEC results split first-preference files per state. The `config.py` handles this via `file_overrides`:

```python
"file_overrides": {
    "first_preferences": [
        "HouseStateFirstPrefsByPollingPlaceDownload-31496-NSW.csv",
        # ... one per state/territory
    ],
    "division_first_prefs": "HouseFirstPrefsByCandidateByVoteTypeDownload-31496.csv",
    "division_tcp":         "HouseTcpByCandidateByVoteTypeDownload-31496.csv",
    "enrolment":            "GeneralEnrolmentByDivisionDownload-31496.csv",
}
```

When a `file_overrides` key is a list, the pipeline downloads all files and merges them before parsing.

---

## Database Schemas

### Federal elections (`schema.sql`)

Tables: `elections`, `states`, `divisions`, `candidates`, `polling_places`, `first_preferences`, `tcp`, `dop`

- `first_preferences` is booth-level: `(election_id, division_id, polling_place_id, candidate_id, vote_type, votes)`
- `tcp` (two-candidate preferred): booth × candidate
- `dop` (distribution of preferences): count-by-count preference flows per division

### State-specific schemas (`state_schema_template.sql`)

The seven non-VIC state/territory schemas (NSW, QLD, WA, SA, TAS, ACT, NT) are rendered from the single parameterised template `state_schema_template.sql` by `pipeline.database.build_state_schema_sql(state_ab)` (the former per-state `nsw_schema.sql` etc. files have been deleted). Tables are prefixed by the state code: `nsw_elections`, `nsw_districts`, `nsw_candidates`, etc.

Template conditional blocks (`-- @if <flag>` … `-- @endif`) select per-state variations: `preferential` vs `hare_clark` (TAS/ACT), NT's optional-preferential `exhausted_votes` columns, booth-level tables, and Legislative Council (`lc`) upper-house tables for the bicameral states NSW/WA/SA (`{p}_lc_elections`, `{p}_lc_groups`, `{p}_lc_group_votes`, `{p}_lc_members_elected`). `tests/test_state_schema.py` verifies rendering for all 7 states.

State election IDs use YYYYMM format (e.g., `202303` for March 2023 NSW election). This avoids collision with federal event IDs.

### Victorian schema (`vec_schema.sql`)

Covers both chambers:
- Lower house: 88 electorates
- Upper house (Legislative Council): 8 regions × 5 members — `vic_lc_regions`, `vic_lc_groups`, `vic_lc_group_votes`, `vic_lc_members_elected`
- VEC tables: `vic_elections`, `vic_districts`, `vic_candidates`

---

## Frontend Architecture (`webapp/src/App.jsx`)

The entire dashboard is a single React component file (~10,000 lines). There is no backend at runtime — all election data is embedded as JavaScript constants or loaded from `webapp/src/data/`.

### Key sections in App.jsx

| Approx. lines | Section |
|---------------|---------|
| 1–320 | Imports, style constants (`STYLES` object — must be module scope), party colour maps |
| 320–800 | Election data constants: `SEAT_FP_2022`, `SEAT_FP_2025`, `ON_FP_2022`, `ON_FP_2025`, teal seat lists |
| 800–1,469 | Polling data (`POLLING_DATA`), preference flow constants, `computeModelledSeats()` |
| 1,469–2,567 | Seat-level computation: swing calculations, 2PP projections, uncertainty bands |
| 2,567–3,500 | Dashboard UI: seat table, polling chart, scenario controls |
| 3,500+ | State election views, map components, helper hooks |

### Important: `STYLES` must be at module scope

A previous bug caused a white screen when `STYLES` was defined inside the component. **Always keep `STYLES` at module (top-level) scope**, not inside a function or component.

### Modelling conventions in App.jsx

- **Primary-vote-based 2PP:** The model uses per-seat first-preference baselines rather than uniform national swing (UNS). See `PLAN.md` for the full methodology.
- **`computeModelledSeats()`:** Central function that takes polling inputs and returns projected 2PP for every seat.
- **Teal seats:** 6 identified — Warringah, Wentworth, Bradfield, Mackellar, Kooyong, Goldstein. Handled separately with teal-specific preference flows.
- **`ON_FP_2022` / `ON_FP_2025`:** Per-seat One Nation first preference constants for regional strongholds (e.g., Hunter 16.4%, Hinkler 13.8%).
- **NaN propagation guard:** Seats where `hasTeal && hasAlp` used to produce NaN. Always guard against NaN in 2PP calculations, especially in independent/ALP race branches.

---

## Election Domain Knowledge

### Australian electoral system

- **House of Representatives:** 151 seats, preferential voting, single-member electorates (divisions)
- **Two-candidate preferred (2PP):** Each seat is counted as ALP vs. Coalition (or occasionally ALP vs. Independent/Teal)
- **First preferences (FP):** Primary votes before preference distribution
- **Distribution of preferences (DOP):** Count-by-count elimination of minor candidates

### Key preference flow constants (`DEFAULT_PREF_FLOWS`, 2025 AEC DOP)

These are the 2025 defaults actually used in `poll_aggregator.py` / `PREF_FLOWS_2025`:

| Group | →ALP flow (2025) |
|-------|------------------|
| Greens (GRN) | ~81.0% |
| Teal independents | ~62.0% |
| One Nation (ON) | ~25.5% (74.5% to Coalition) |
| Other minor | ~50% |

**One Nation → ALP has shifted every election** (AEC DOP; Antony Green): 2016 ~49.6%,
2019 34.7%, 2022 35.7%, 2025 25.5% (the highest-ever flow to the Coalition). A rising ON
primary therefore favours the Coalition, not Labor. The 2026 Farrer by-election (ON won
the seat on strong Coalition→ON preferences) is additional validation — note that an
ON-vs-Independent final is not yet modelled (only ON-vs-ALP and ON-vs-Coalition).

### AEC data files (per election)

| File key | AEC filename pattern | Description |
|----------|---------------------|-------------|
| `candidates` | `HouseCandidatesDownload-{id}.csv` | All candidates, parties, elected status |
| `polling_places` | `GeneralPollingPlacesDownload-{id}.csv` | All booths with lat/lon |
| `first_preferences` | `HouseFirstPrefsByPollingPlaceDownload-{id}.csv` | FP votes by booth × candidate |
| `tcp` | `HouseTcpByCandidateByPollingPlaceDownload-{id}.csv` | TCP votes by booth × candidate |
| `dop` | `HouseDopByDivisionDownload-{id}.csv` | Full preference distribution by division |
| `division_first_prefs` | `HouseDivisionFirstPrefsByStateByVoteTypeDownload-{id}.csv` | Division-level FP by vote type |
| `division_tcp` | `HouseTcpByCandidateByDivisionDownload-{id}.csv` | Division-level TCP totals |

### AEC CSV format quirk

AEC CSVs have multi-line metadata headers before the actual column headers. `pipeline/parse.py`'s `_iter_aec_csv()` handles stripping these. Any new parser must use this helper or replicate its logic.

---

## Polling Data

Poll data lives in `data/polls/`:

- **`aggregated.json`:** BludgerTrack-style aggregated poll with house effects applied for each pollster (Newspoll, RedBridge, DemosAU, etc.)
- **`bludgertrack.json`:** Historical polling tracker with ALP 2PP estimates over time
- **`vic_polls.json`:** Victorian state polling

### House effects in `poll_aggregator.py`

`poll_aggregator.py` applies per-pollster house effect corrections and trend-smoothing before producing the aggregated poll estimate. When modifying or extending polling logic:

1. Check `data/polls/aggregated.json` for the expected output schema
2. House effects are defined as constants at the top of `poll_aggregator.py`
3. Preference flows (GRN→ALP, ON→ALP, etc.) are also defined there

---

## Handling Redistributions

Electoral boundaries change between elections. The pipeline handles this by versioning boundaries:

- Each election's data uses that election's division IDs and boundaries
- When a redistribution occurs, new `electoral_boundaries` rows are inserted with the new boundary version
- The frontend selects boundaries by `(election_id, boundary_version)`

Do not assume division IDs are stable across elections — always join through election-specific boundary tables.

---

## Git Workflow

- **Branch strategy:** Feature branches, merged via PRs
- **PR references:** Commit messages reference PR numbers (e.g., `Merge pull request #50`)
- **Commit style:** Imperative, descriptive subject lines. Examples:
  - `Fix NaN propagation in hasTeal && hasAlp seat branch`
  - `Review and improve Victorian election model — methodology + technical fixes`
  - `Fix independent seats falsely showing as changed at 2025 baseline`
- **Tests:** Always run `python -m pytest tests/ -v` before submitting a PR

---

## Deployment

### GitHub Pages (primary)

Push to `main` → GitHub Actions automatically builds and publishes `webapp/dist/`.

Build command: `cd webapp && npm install && npm run build`

The frontend is fully static — no API calls at runtime. All election data is embedded.

### Vercel (alternative)

`vercel.json` configures:
- Build: `npm install && npm run build` (run from `webapp/`)
- Output: `dist`
- Rewrites: `/*` → `/index.html` (SPA routing)

---

## Model Accuracy

`data/calibration_report.txt` contains per-seat 2PP prediction errors from backtesting (`scripts/compute_calibration.py`).

The headline "±0.05% error" on ALP/Coalition seats is the **in-sample fitted residual** (the per-seat calibration offsets are fitted to the 2025 result, so near-zero error at zero swing is by construction). The honest predictive-skill figure is the **leave-one-out MAE of ~1.4pp** reported by `compute_calibration.py`. The model skips non-ALP/Coalition races (e.g., Greens vs. Teal contests).

To regenerate:
```bash
python scripts/compute_calibration.py
```

---

## PLAN.md Reference

`PLAN.md` (~9,000 lines) contains the detailed specification for the **primary-vote-based methodology upgrade** — replacing uniform national swing with per-seat first-preference baselines. Key sections:

- **Rationale:** Why primary-vote approach is more accurate than UNS
- **`SEAT_FP_2025` & `SEAT_FP_2022` constants:** Per-seat primary baselines to embed in App.jsx
- **`getSeatFpBaseline()` helper:** Looks up baseline by seat name and year
- **`computeModelledSeats()` changes:** Unified primary-based computation flow
- **Uncertainty bands:** Should be centred on modelled 2PP, not historical 2PP
- **Seat override UI:** Shows historical context when user adjusts individual seats
- **App.jsx line references:** Changes keyed to specific line numbers (~320, ~1469, ~2567, etc.)

When implementing changes from PLAN.md, locate the referenced sections in App.jsx and follow the specified approach precisely.
