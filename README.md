# Aus Poll

An open-source, seat-by-seat Australian federal election modelling dashboard. Live polling tracker, swing model, and scenario builder — think Antony Green's election night wall, but interactive and explorable before polling day.

**[Live demo →](https://leifsmith01-ai.github.io/aus-poll/)**

## Features (roadmap)

- **Booth-level data** — every polling place, every candidate, every vote type (ordinary, postal, pre-poll, absent, provisional)
- **Preference distribution** — full count-by-count DOP data for every seat
- **TCP margin maps** — two-candidate preferred margins with swing vs. prior elections
- **Sensitivity testing** — adjust preference flows and primary vote shares to model different outcomes
- **Redistribution-aware** — boundaries versioned so the tool handles electoral redistributions cleanly
- **ABS demographic overlay** — Census data mapped to electoral divisions (Phase 4)
- **State/territory expansion** — same pipeline for NSW, VIC, QLD, etc. (Phase 5)

## Data sources

- **AEC results**: [results.aec.gov.au](https://results.aec.gov.au) — booth-level CSV files published after each federal election
- **Electoral boundaries**: AEC GeoJSON/Shapefile downloads
- **Polling data**: Manual input, with optional scraping from [pollbludger.com](https://www.pollbludger.com)
- **Demographics**: ABS Census data at SA1/SA2 level with correspondence files to electoral divisions

## Webapp

The interactive dashboard lives in `webapp/`. It's a self-contained [Vite](https://vitejs.dev/) + React app — no backend required, all 2022 election data is baked in.

```bash
cd webapp
npm install
npm run dev        # http://localhost:5173/aus-poll/
npm run build      # outputs to webapp/dist/
```

To deploy to GitHub Pages, push to `main` — a GitHub Actions workflow automatically builds and publishes `webapp/dist/`.

## Project structure

```
aus-poll/
├── webapp/                  # ← Vite + React dashboard (start here)
│   ├── src/App.jsx          #   Main dashboard component
│   ├── src/main.jsx         #   React entry point
│   ├── index.html
│   └── vite.config.js
├── data/
│   └── polls/
│       └── bludgertrack.json  # BludgerTrack poll history
├── main.py                  # Pipeline entry point
├── requirements.txt
├── schema.sql               # SQLite database schema
├── pipeline/
│   ├── config.py            # Election event IDs, URLs, constants
│   ├── download.py          # Download AEC CSV files
│   ├── parse.py             # Parse CSVs into Python dicts
│   ├── database.py          # SQLite load + query helpers
│   └── export.py            # Generate JSON files for the frontend
├── data/
│   ├── raw/                 # Downloaded AEC CSVs (gitignored)
│   ├── processed/           # Intermediate files (gitignored)
│   └── exports/             # JSON files consumed by frontend
│       ├── elections.json
│       ├── 2022/
│       │   ├── national_summary.json
│       │   ├── divisions.json
│       │   ├── booths.geojson
│       │   ├── preference_flows.json
│       │   └── divisions/
│       │       ├── 200.json  (booth-level detail per seat)
│       │       └── …
│       └── 2019/
│           └── …
└── tests/
    └── test_parse.py
```

## Quickstart

### 1. Clone and install

```bash
git clone https://github.com/leifsmith01-ai/aus-poll.git
cd aus-poll
python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Run the full pipeline

```bash
# Download 2022 + 2019 data, load into SQLite, export JSON
python main.py --year 2022 2019

# Just 2022
python main.py --year 2022

# Skip download (if files already present)
python main.py --year 2022 --skip-download

# Only regenerate exports (database already populated)
python main.py --year 2022 --export-only

# Verbose output
python main.py --year 2022 -v
```

### 3. Check what's been downloaded

```bash
python main.py --list-files
```

### 4. Run tests

```bash
python -m pytest tests/ -v
```

## Data files downloaded per election

| File key | AEC filename | Description |
|---|---|---|
| `candidates` | `HouseCandidatesDownload-{id}.csv` | All candidates, parties, elected status |
| `polling_places` | `GeneralPollingPlacesDownload-{id}.csv` | All booths with lat/lon |
| `first_preferences` | `HouseFirstPrefsByPollingPlaceDownload-{id}.csv` | FP votes by booth × candidate |
| `tcp` | `HouseTcpByCandidateByPollingPlaceDownload-{id}.csv` | TCP votes by booth × candidate |
| `dop` | `HouseDopByDivisionDownload-{id}.csv` | Full preference distribution by division |
| `division_first_prefs` | `HouseDivisionFirstPrefsByStateByVoteTypeDownload-{id}.csv` | Division-level FP by vote type |
| `division_tcp` | `HouseTcpByCandidateByDivisionDownload-{id}.csv` | Division-level TCP totals |

## Election event IDs

| Year | AEC Event ID | Date |
|---|---|---|
| 2022 | 27966 | 21 May 2022 |
| 2019 | 24310 | 18 May 2019 |
| 2016 | 20499 | 2 July 2016 |

## Adding a new election

1. Add the year + event ID to `pipeline/config.py`:
   ```python
   ELECTIONS[2025] = {
       "event_id": 29000,  # replace with actual AEC event ID
       "name": "2025 Australian Federal Election",
       "date": "2025-05-17",
       "results_base_url": "https://results.aec.gov.au/29000/Website/Downloads",
   }
   ```
2. Run `python main.py --year 2025`

## Handling redistributions

Electoral boundaries change between elections. The schema handles this by versioning boundaries:
- Each election's data uses that election's division IDs and boundaries
- When a redistribution occurs, new `electoral_boundaries` rows are inserted with the new boundary version
- The frontend selects boundaries by `(election_id, boundary_version)`

## Roadmap

- **Phase 1** ✅ Data pipeline (this repo)
- **Phase 2** Frontend dashboard (React + Leaflet + Next.js, deployed on Vercel)
- **Phase 3** Preference flow sensitivity sliders + polling data input
- **Phase 4** ABS demographic overlay (Census SA1/SA2 → electoral division correspondence)
- **Phase 5** State/territory election pipelines (NSW, VIC, QLD, WA, SA, TAS, ACT, NT)

## Contributing

PRs welcome. Please run tests before submitting: `python -m pytest tests/ -v`

## Licence

MIT
