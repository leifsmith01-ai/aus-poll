# Live Results

Election-night live counting + projection for the dashboard. Renders the **🔴 Live** tab.

## How it works

```
EC feed (JSON)  ──fetch──▶  adapter ──▶  normalized contract  ──▶  project ──▶  confidence ──▶  LivePage
 (sample / VEC)              (per-juris)   (contract.js)          (project.js)  (confidence.js)   (App.jsx)
```

- **`contract.js`** — the jurisdiction-agnostic feed shape + validators. Every adapter
  normalizes into this; the model and UI only ever see this shape.
- **`adapters/`** — per-jurisdiction raw→contract transforms. `passthrough` (sample),
  `vec` (Victoria — wire on the night), `aec` (federal, booth-level demo). Add one per new EC.
- **`fetchLoop.js` / `useLiveResults.js`** — polling with backoff, tab-visibility pause,
  manual refresh, and a one-shot baseline fetch.
- **`project.js`** — projects each seat's final 2CP by swing vs the prior-election baseline.
  Picks the finest granularity available: **booth-matched** swing (federal feeds with booth
  arrays) → **district** swing (VIC) → flat live shares.
- **`confidence.js`** — per-seat win probabilities + statewide seat-total distribution and
  probability of majority, with a **count-driven sigma** that collapses to certainty at 100%.
- **`config.js`** — the active election, sources, baseline URL, party groups, pref flows.

## Switching to the real VEC feed on election night

1. Confirm the VEC live results endpoint URL + payload shape (see
   https://www.vec.vic.gov.au/results). Implement the mapping in **`adapters/vec.js`**.
2. Set `LIVE_SOURCES.vec_vic_2026.url` in `config.js` to that endpoint and change
   `LIVE_CONFIG.active.sourceId` to `"vec_vic_2026"`; rebuild + deploy.

No rebuild needed for a quick repoint — query overrides win over config:

| Query param      | Effect                                              |
|------------------|-----------------------------------------------------|
| `?liveSource=ID` | pick a registered source                            |
| `?liveUrl=URL`   | override the feed URL (adapter unchanged)           |
| `?liveAdapter=X` | override the adapter (`passthrough`/`vec`/`aec`)     |
| `?liveSnapshot=` | (dev) point at a sample snapshot                    |

**CORS / FTP fallback.** The browser fetches the feed directly. If the EC endpoint blocks
cross-origin requests (e.g. the AEC media feed is FTP/XML), run a thin scheduled job that
fetches + normalizes the feed and commits a same-origin snapshot to `public/live/`, then
point a source at it. The rest of the page is unchanged.

## Updating the baseline / sample data

```
python scripts/generate_live_sample.py        # writes baseline + snapshots to public/live/
node   webapp/scripts/live-check.mjs           # asserts convergence + shrinking uncertainty
```

The baseline (`baseline-vic-2026.json`) is the 2022 VIC result, sourced from `_VS` in
App.jsx. Replace the synthetic 2026 swing in `generate_live_sample.py` with real numbers, or
swap the sample source for the live VEC adapter, when the real election begins.

## Known limitations / risks

- VEC publishes **district-level** live counts only, so VIC projections use district swing
  (booth-matched swing activates automatically for feeds that carry booth arrays).
- Sigma constants in `confidence.js` are first estimates — recalibrate against
  2022 booth-vs-final once booth-level baselines are reachable.
- `webapp/src/data/state_seat_fp.js` `VIC_SEAT_FP_2022` is still placeholder data; the live
  baseline does **not** depend on it (it uses `_VS` 2CP), but populate it for the model tab.
