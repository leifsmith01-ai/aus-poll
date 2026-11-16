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

## The VEC feed (VIC 2026)

The VEC results data feed is **EML-based XML inside ZIP files**, published as full
snapshots every 5 minutes on election weekend to a SharePoint site (access token,
signed terms of use). `scripts/fetch_live_vec.py` reads the **verbose Lower House**
file (`State2026mediafileverboselhv2_YYYYMMDD_HHMMSS.zip`) — it is self-contained
(candidate names, parties, booths), so no set-up files are needed.

Rules the reader follows (VEC user guide, Sept 2026 — each has a test in
`tests/test_fetch_live_vec.py`, run against the VEC's own sample files in
`tests/fixtures/vec_sample/`):

- **Latest snapshot** = highest timestamp in the file name. Snapshots are complete, not deltas.
- **2CP is "no data", never zero**, when the element is missing, has `Maverick="true"`
  (withheld), an empty `Updated`, or no votes. The pair is the VEC's choice and can change.
- **Counts can go down** (rechecks). **`Declared=true`** → seat called, probability 1.
- **"% counted"** is not in the feed: it is `Total votes / (Enrolment × 0.88)`.
- **2CP progress is tracked separately** (`tcp.countedPct`) and drives the model's
  confidence — the 2CP count lags first preferences on the night.
- A real feed with fewer than 88 districts **fails validation** (previous good snapshot stays up).

```
# newest snapshot in a folder of downloaded ZIPs -> contract JSON
python scripts/fetch_live_vec.py --dir path/to/zips --out live/vec-latest.json
# step N of the VEC sample replay (6 test districts, hence --allow-partial)
python scripts/fetch_live_vec.py --replay 10 --replay-dir tests/fixtures/vec_sample --allow-partial --out -
```

## Booth-matched projection

Early figures are skewed by *which* booths have reported. The reader compares tonight's
votes only with the **same booths' 2022 votes** and ships the sums per seat
(`seat.matched`); `project.js` adds that swing to the full 2022 district result.

- 2022 side: `data/live/vic_2022_booths.json`, built by
  `python scripts/build_live_booth_baseline.py` from the LFS booth Excel. Narracan has no
  2022 booths (its election was held separately) and falls back to the district method.
- Parcels: election-day booths matched by normalised name; early, postal, absent,
  provisional and marked-as-voted matched as whole lumps (2026 reports early voting per
  centre — it is summed back into one lump). New booths with no 2022 match are left out.
- 2CP: `tcp.flow` carries first-preference and 2CP votes for the two finalists in the
  parcels where both counts are in. The browser applies that observed preference flow to
  the booth-matched first preferences, so a 2CP count that lags does not skew the seat.
- Seats with nothing counted: Labor-v-Coalition seats move by the average swing seen in
  counted seats (`observedSwing`, shrunk while little is counted). Polls are never used.
- Not backtested on a real second election (2018 booth data is on old boundaries). The
  simulation in `tests/test_fetch_live_vec.py` (known swing + booth noise, 30% of booths
  in) gives 0.7pp error on Labor's primary vs 1.6pp for the raw count.

## Count so far vs the polls

`computeVicPollsModel()` (App.jsx) is the VIC scenario builder's "Apply latest polls"
result at default settings — fixed, independent of the user's sliders. `LiveVsPollsPanel`
sets it beside the live projection: 2PP swing (polls v count so far), seats by party with
90% ranges, chance of a majority, plus a "Polls model" column in the seat table flagging
seats where tonight's count points to a different winner.

## Rehearsal (works today)

GitHub → Actions → **Live Feed Proxy** → Run workflow with a BLANK feed URL. It replays
the 23 VEC sample snapshots through reader → `live-feed` branch → dashboard. Open the
site with `?liveSource=vec_proxy_2026`. The page shows a "Test data" banner, the six
sample districts update, and the other 82 sit at "Not started".

## Still to do before the night

1. **Download step.** SharePoint + token fetch is not written (host/token arrive with
   access). Token goes in a repository secret.
2. **Terms of use cl. 1.2** — confirm with the VEC that a public derived snapshot is OK,
   or move the proxy somewhere private.
3. **VEC election-night trial** (week before polling day; first preferences only, no 2CP)
   — run the real download path against it.
4. Flip `LIVE_CONFIG.active.sourceId` to `"vec_proxy_2026"` (or use the query param).

Query overrides (no rebuild):

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

- **Latency:** VEC 5 min + raw.githubusercontent.com cache up to 5 min (query-string
  cache-busting does not work there) + 90 s browser poll. The header shows the feed's own
  "results as at" time and a red STALE banner after 20 minutes without a new snapshot.
- **Booth matching is by name.** 2026 booth ids are all new, so a renamed booth is simply
  unmatched; check `matched.parcels` against `boothsReturned` on the night.
- **Baseline pairs** for non-classic 2022 seats are stored as ALP-v-Coalition 2PP, so
  swing is only shown when tonight's pair matches the baseline pair.
- Seats with no published 2CP project from first preferences only in ALP-v-Coalition
  contests; others hold the 2022 result (flagged in the table) until a pair is published.
- Sigma constants in `confidence.js` are calibrated against the VIC 2022 booth-level count
  (`python scripts/calibrate_live_sigma.py`); keep script and constants in sync.
