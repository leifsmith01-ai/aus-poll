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

## Election night runbook (VIC 2026)

**Primary path — the Live Feed Proxy** (no CORS dependency on the VEC):

1. Confirm the VEC live results endpoint URL (see https://www.vec.vic.gov.au/results
   and the VEC media-feed registration pack). If its JSON shape differs from the
   generic `{districts:[...]}` mapping, adjust **`scripts/fetch_live_vec.py`** —
   all VEC-shape knowledge lives there.
2. GitHub → Actions → **Live Feed Proxy** → Run workflow → paste the feed URL.
   The job polls, normalizes, validates and force-pushes each snapshot to the
   `live-feed` branch (single commit, disposable). Re-dispatch when the 6-hour
   job limit ends a run.
3. Open the dashboard with `?liveSource=vec_proxy_2026` — or flip
   `LIVE_CONFIG.active.sourceId` to `"vec_proxy_2026"` and deploy beforehand.
   The source polls `raw.githubusercontent.com/.../live-feed/live/vec-latest.json`
   (served with `CORS: *`; the fetch loop cache-busts through the CDN cache).

**Rehearsal before the night:** dispatch the workflow with a BLANK feed URL — it
replays the committed sample snapshots (0% → 35% → 80% → 100%) through the full
proxy → branch → dashboard path. Verify the Live tab follows along on
`?liveSource=vec_proxy_2026`.

**Direct-to-VEC fallback:** only if the VEC endpoint turns out to serve CORS
headers — map its raw shape in `adapters/vec.js` and use `?liveUrl=` +
`?liveAdapter=vec`.

No rebuild needed for a quick repoint — query overrides win over config:

| Query param      | Effect                                              |
|------------------|-----------------------------------------------------|
| `?liveSource=ID` | pick a registered source                            |
| `?liveUrl=URL`   | override the feed URL (adapter unchanged)           |
| `?liveAdapter=X` | override the adapter (`passthrough`/`vec`/`aec`)     |
| `?liveSnapshot=` | (dev) point at a sample snapshot                    |

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
- Sigma constants in `confidence.js` are **calibrated against the VIC 2022
  booth-level count** (`python scripts/calibrate_live_sigma.py` — a progressive
  booth-order replay). Re-run and update the constants if the replay
  methodology or 2022 inputs change; keep script and constants in sync.
- The real 2026 VEC endpoint shape is unconfirmed until the night — the generic
  district mapping in `scripts/fetch_live_vec.py` may need adjusting on the fly
  (validation failures keep the previous good snapshot on the branch).
- An ON-vs-Independent final is not modelled pre-2CP: seats without a published
  2CP project from FP only in ALP-vs-Coalition contests; others hold the
  baseline until the VEC publishes a pair.
