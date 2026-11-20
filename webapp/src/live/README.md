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

## Where the results come from (VIC 2026)

**Primary: the public VEC results website** — `scripts/fetch_live_vec_web.py`.
The VEC's data feed is restricted to approved media/stakeholders; its website carries
the same numbers (both come from one source) and is licensed **CC BY 4.0**
(vec.vic.gov.au/legal), so a derived public snapshot is fine with the credit
"© Victorian Electoral Commission", which the Live tab shows.

Per district it reads two pages: `…-results-by-voting-centre` (first preferences for
every booth and vote type, enrolment, declared member) and
`…-2cp-results-by-voting-centre` (the two-candidate count, same rows). District pages
are found from the election's results index; their sub-page links are cached between
passes and re-looked-up while missing.

Rules it follows (each tested in `tests/test_fetch_live_vec_web.py` against trimmed real
pages in `tests/fixtures/vec_web/`):

- Rows are classified by **label**, not position: the 2022 and 2026 templates differ
  (2022's 2CP page lists vote types inline with a second header row of party names;
  2026 groups rows into Ordinary / Early / Declaration sections and can show early votes
  only as a section total).
- **2CP finalists take their party from the first-preference table, matched by name** —
  the 2CP page has been seen labelling an independent with the other finalist's party.
- Blank cells = not counted yet. "Elected member" = declared; the declared member
  overrides a near-50 indicative 2CP (Pakenham 2022: 2CP had the Liberal ahead by
  0.12%, Labor won on the full distribution).
- A district that fails to load keeps its previous figures (`--previous`); a snapshot
  missing districts outright fails validation and the last good one stays up.

Validated against the real 2022 site: all 87 district pages, ≥98.6% of each seat's vote
matched to 2022 booths, and the projection reproduces 2022 exactly (Labor 56, Coalition
28, Greens 4; swing 0.0).

**Alternative: the VEC data feed** (`scripts/fetch_live_vec.py`), if access is granted —
EML XML in ZIP snapshots. See its docstring; the download step from the VEC's SharePoint
site is not written.

## Election night

1. GitHub → Actions → **Live Feed Proxy** → Run workflow → mode **website**. Leave
   `results_url` as is unless the VEC uses a different address (if the default 404s, the
   script searches the state-results landing page for the 2026 election). Before 6pm the
   index does not exist yet; passes fail harmlessly until it does.
2. Open the site with `?liveSource=vec_proxy_2026`, or set
   `LIVE_CONFIG.active.sourceId = "vec_proxy_2026"` and deploy beforehand.
3. Re-dispatch when the 6-hour job limit ends a run.

## Rehearsal (works today)

Run the workflow with mode **rehearsal-2022**: it fetches the real 2022 results website
once, then replays it as a night in progress (5% → 100% of booths; early votes part-way;
postals last), labelled "Test data". Offline:

```
python scripts/fetch_live_vec_web.py --index https://www.vec.vic.gov.au/results/state-election-results/2022-state-election-results --save-html work/html22 --rehearsal --out -
python scripts/fetch_live_vec_web.py --from-html work/html22 --rehearsal --reveal 0.3 --out -
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

## Query overrides (no rebuild)

| Query param      | Effect                                              |
|------------------|-----------------------------------------------------|
| `?liveSource=ID` | pick a registered source                            |
| `?liveUrl=URL`   | override the feed URL (adapter unchanged)           |
| `?liveAdapter=X` | override the adapter (`passthrough`/`vec`/`aec`)     |
| `?liveSnapshot=` | (dev) point at a sample snapshot                    |

## Updating the baseline / sample data

```
git lfs pull --include "data/raw/vic/202211/*"
python scripts/generate_live_sample.py        # writes baseline + snapshots to public/live/
node   webapp/scripts/live-check.mjs           # asserts convergence + shrinking uncertainty
```

The baseline (`baseline-vic-2026.json`) is the 2022 VIC result: winners from `_VS` in
App.jsx, two-candidate pairs and percentages from the VEC's official 2022 2CP file. (`_VS`
margins are the winner's lead over 50%; an earlier version halved them, squeezing every
baseline 2CP halfway to 50-50 and biasing every displayed swing.) Replace the synthetic 2026 swing in `generate_live_sample.py` with real numbers, or
swap the sample source for the live VEC adapter, when the real election begins.

## Known limitations / risks

- **Latency:** VEC 5 min + raw.githubusercontent.com cache up to 5 min (query-string
  cache-busting does not work there) + 90 s browser poll. The header shows the feed's own
  "results as at" time and a red STALE banner after 20 minutes without a new snapshot.
- **Booth matching is by name.** 2026 booth ids are all new, so a renamed booth is simply
  unmatched; check `matched.parcels` against `boothsReturned` on the night.
- **Swing is only shown when tonight's final two match 2022's** (e.g. not for a seat that
  was Labor v Greens in 2022 and is Labor v Liberal tonight).
- **The website may change shape on the night.** The parser is label-based and tested on
  both the 2022 and 2026 templates, but a new layout could still need a fix — watch the
  first passes after 6pm.
- Seats with no published 2CP project from first preferences only in ALP-v-Coalition
  contests; others hold the 2022 result (flagged in the table) until a pair is published.
- Sigma constants in `confidence.js` are calibrated against the VIC 2022 booth-level count
  (`python scripts/calibrate_live_sigma.py`); keep script and constants in sync.
