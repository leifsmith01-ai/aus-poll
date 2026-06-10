# Election Model Review — Federal & State

A comprehensive methodology and code review of the aus-poll election models, covering the
federal seat model, all eight state/territory models, the polling aggregation pipeline, and
the backtesting/calibration machinery. Line references are accurate as of commit `df59bd2`
(June 2026). Findings marked **[verified]** were independently confirmed against the source;
the remainder were identified during the structured review and should be re-confirmed at the
referenced location before acting on them.

---

## 1. Executive summary

The model is in good shape overall: a primary-vote-based 2PP model with per-seat AEC DOP
preference flows, seat-level calibration, dynamic One Nation final detection (including the
post-Farrer ON-vs-IND branch), state models for all eight jurisdictions, and a poll
aggregator with house effects. The main risks are not in the core methodology but in
**validation honesty, data hygiene, and manual synchronisation**:

1. The live primary-based model path has **never been backtested** — the backtest validates
   a different (UNS) model.
2. Headline accuracy ("±0.05%") reflects in-sample calibration residuals, not predictive
   skill; the honest figure is the leave-one-out MAE of ~1.4pp.
3. Two seats carry **impossible placeholder preference flows** (all flows = 1.0).
4. The federal model has state-swing machinery that is **never invoked** at the call site.
5. Several constants flow from pipeline to frontend by **manual copy-paste**, with stale
   examples already present (the data-copy script doesn't know about 2025).

### Implementation status (June 2026)

All sixteen roadmap items below have since been implemented on this branch. Key empirical
results from that work, which update several of this review's open questions:

- **Primary-based vs UNS (item 2, resolved):** backtested head-to-head on held-out cycles
  (`python -m pipeline.backtest --compare`), **UNS + elasticity beats the raw primary-based
  model** — 2019→2022 MAE 3.44pp vs 4.19pp, 2022→2025 MAE 3.21pp vs 3.77pp, with higher
  winner accuracy. The live model's accuracy near baseline therefore rests on its per-seat
  zero-swing calibration, not on the primary mechanics; PLAN.md's premise that the primary
  approach is inherently more accurate is not supported out-of-sample.
- **Probabilistic calibration (item 4):** Monte Carlo win probabilities score Brier 0.056
  with a near-monotone calibration table; 50%/90% seat-count intervals covered the actual
  result in all three test elections. Mild overconfidence at the extremes ("sure losers"
  still win ~5% of the time).
- **Demographic multipliers (item 7, negative result):** the demographic regression FAILED
  leave-one-pair-out cross-validation (CV RMSE 1.77 vs 1.68 for always-predict-1.0), so
  `SEAT_DEMO_MULT` is intentionally left empty. The margin-based elasticity curve *did*
  validate and was refit on 2022→2025 (0.593 + 0.856/(1+e^(0.35(m−8.725)))).
- **Seat residuals:** empirical per-seat sigmas (3 cycles) average 1.69pp — the old uniform
  1.0pp assumption understated per-seat uncertainty; `SEAT_RESIDUAL_MAP` is now populated.
- **Barker/Grey flows (item 1):** root cause was deeper than stale constants — the export's
  finalist detection picked up zero-vote excluded candidates at the final DOP count. Fixed;
  both seats turn out to be genuine ALP/Coalition finals with sane flows now exported.
- **Hare-Clark (item 8):** replaced with a party-aggregated STV count simulation that
  reproduces the actual TAS 2024 result in all five electorates (including Braddon's second
  JLN seat) and the exact ACT 2024 result, without the Franklin calibration fudge. Also
  fixed: the Hare-Clark Monte Carlo previously perturbed an ignored argument, making all
  simulations identical.
- **Upper houses (item 14):** LC projection panels (NSW/WA/SA/VIC) using the same STV
  engine, ±1–2 seats vs declared compositions at baseline, clearly labelled indicative;
  LC schema tables, loaders, and an `lc_summary` export added to the pipeline.
- Five scripts referenced a database filename (`data/elections.db`) the pipeline never
  writes (`data/aec_elections.db`), and two more had drifted from the export schema — none
  of the "run X to regenerate" paths documented in the codebase had been runnable.

### Top 10 improvements (priority / effort / impact)

| # | Improvement | Priority | Effort | Impact |
|---|------------|----------|--------|--------|
| 1 | Fix Barker/Grey placeholder flows (=1.0) in `SEAT_PREF_FLOWS_2025` | Critical | Trivial | Removes silently-wrong 2PP in two SA seats |
| 2 | Backtest the *live* primary-based model path (not just UNS) | Critical | Medium | Validates the model actually deployed |
| 3 | Pass state swings into the federal `computeModelledSeats()` call | High | Small | Captures QLD/WA ±2–4pp deviations from national swing |
| 4 | Probabilistic calibration tests (Brier score, interval coverage) for the Monte Carlo outputs | High | Medium | Win probabilities are currently unvalidated |
| 5 | Wire NSW/QLD/WA/SA polling JSON into the state models (currently VIC only) | High | Medium | State models otherwise drift stale between elections |
| 6 | Automate constant sync (extend `inject_model_constants.py` to `_S25`/`SEAT_FP_2025`/`SEAT_CALIB_2025`) | High | Medium | Eliminates copy-paste staleness class of bugs |
| 7 | Populate `SEAT_FP_2022`, `SEAT_DEMO_MULT`, `SEAT_RESIDUAL_MAP` (generators already exist) | Medium | Small | Enables cycle-over-cycle validation and per-seat uncertainty |
| 8 | Real Hare-Clark count simulation for TAS/ACT | Medium | Large | Current FP-share heuristic is structurally unsound for STV |
| 9 | Model preference exhaustion in NT (data already in DB) | Medium | Small | Optional preferential treated as full preferential today |
| 10 | Add a state/regional correlated-error dimension to the uncertainty model | Medium | Medium | Tail risk (e.g. regional ON surges) currently understated |

---

## 2. Federal model (`webapp/src/App.jsx`, ~10,070 lines)

### 2.1 Methodology as implemented

- **`computeModelledSeats()`** (line 2210) is the central function. For ALP/Coalition seats
  with a `SEAT_FP_2025` entry it applies seat-level primary swings and converts to 2PP via
  preference flows (lines 2460–2482); seats without primary data fall back to uniform
  national swing on the 2025 TCP baseline (lines 2483–2491).
- **Preference flows**: national defaults in `PREF_FLOWS_2025` (lines 824–833), per-seat AEC
  DOP overrides in `SEAT_PREF_FLOWS_2025` (~120 seats, lines 652–810), applied as an
  additive slider delta via `applyPrefDelta()` (line 852).
- **Calibration**: `SEAT_CALIB_2025` per-seat offsets (lines ~518–644) anchor the zero-swing
  projection to the 2025 result, fading linearly to zero at ±5pp national swing. A frozen
  basis (`CALIB_BASIS_FLOWS`, on_alp = 0.43, line 869) is reconciled to the live default
  (0.255) via `dopCalibDelta()` (lines 876–891).
- **One Nation**: surge auto-detection at a 6.5% threshold (line ~2152) routes seats into
  `on_v_alp` / `on_v_coal` / `on_v_ind` final branches (lines ~2265–2426), with per-seat
  ON-race flow overrides (`SEAT_ON_RACE_FLOWS`, line 842 — Hunter only) and zero-swing
  anchoring to the two seats where ON made the 2025 TCP.
- **Elasticity**: logistic margin-based multiplier `seatElasticityMult()` (lines ~1835–1838),
  intended to be superseded per seat by `SEAT_DEMO_MULT` (line 912 — empty).
- **Uncertainty**: 2-D grid integration over national 2PP swing × correlated preference-flow
  shift, plus independent per-seat noise (uniform 1.0pp residual; `SEAT_RESIDUAL_MAP` at
  line 921 is empty), win probability via normal CDF (lines ~1892–2027).

### 2.2 Data-quality issues

- **[verified] Barker (180) and Grey (183) have all preference flows = 1.0000**
  (App.jsx:739, 741) — i.e. 100% of Greens, teal, ON and other preferences to ALP, which is
  impossible and clearly placeholder/bad export data. Their `SEAT_CALIB_2025` offsets
  (+0.00 and −0.03, lines 588/590) appear to have been fitted with these flows in place, so
  fixing the flows shifts the zero-swing projection for these two (safe-Coalition) seats
  until `compute_calibration.py` is re-run. *Fixed in this review by removing the two
  entries so the seats use the national-flow fallback; regenerate proper DOP values via
  `update_s25_from_exports.py` and then re-run calibration.*
- **`SEAT_FP_2022` is empty** (~line 483). This blocks any cycle-over-cycle validation of
  the primary-based model (e.g. projecting 2025 from a 2022 baseline) and prevents using
  2022 as a prior.
- **`SEAT_FP_2025` is partially reconstructed** rather than raw AEC FP in some seats (per
  the comment near line 318), with reconstruction error concentrated in ON-heavy seats.
  Several seats also carry the national fallback `teal_alp: 0.6200` in their per-seat DOP
  rows rather than an observed value (e.g. lines 654, 738, 807–809) — fine by design via
  `applyPrefDelta`'s key fallback, but it means "per-seat DOP" coverage is thinner than the
  ~120-entry map suggests.
- **Largest calibration offset is New England at −2.38pp** (~line 542) — an outlier worth
  investigating (bad FP reconstruction, unusual DOP, or a genuine model miss).
- **[verified] Stale UI copy**: the preference-flow help text (App.jsx:6547–6548) quotes
  "2025…43%" and "2022…15%" for ON→ALP, contradicting both the authoritative comment at
  lines 816–818 and CLAUDE.md (2022: 35.7%, 2025: 25.5%). The 43% figure is the frozen
  calibration basis, not the 2025 actual.

### 2.3 Statistical shortcomings

- **[verified] State-level swing decomposition exists but is unused federally.**
  `computeModelledSeats()` accepts a `stateSwings` parameter and `blendSwings()`
  (~line 2183, α = 0.6) implements the blend, but the federal call site passes nothing
  (App.jsx:4025) — every federal seat gets the pure national swing. QLD and WA routinely
  deviate ±2–4pp from the national swing; this is the single highest-value modelling change
  available at low effort.
- **No correlated regional/state error component.** The uncertainty grid covers national
  swing × national preference-flow shift only. A regionally-correlated ON surge (the most
  plausible 2028 tail scenario) is treated as independent per-seat noise, understating
  seat-count variance.
- **Preference-flow uncertainty is ad hoc**: `PREF_FLOW_CORR_STD` / `PREF_FLOW_IND_STD`
  (~lines 1875–76) have no cited empirical basis, despite the AEC DOP history (ON→ALP
  ranging 25.5%–49.6% across four elections) providing exactly the data needed to estimate
  them.
- **ON first preferences swing linearly** (`estimateSeatOnFp()`, line 924: base + national
  ON swing) with no saturation. A +7pp national ON swing adds 7pp in a 2% seat and a 16%
  seat alike; empirically high-base seats absorb more of a surge.
- **ON-vs-IND flows rest on one data point** (Farrer 2026 by-election), as the code itself
  acknowledges (lines 828–831). Reasonable, but the branch deserves wide uncertainty or a
  UI caveat when it drives a seat call.
- **Magic numbers without sensitivity analysis**: `onThreshold` 6.5, `calibFadeHalfWidth` 5,
  `STATE_SWING_ALPHA` 0.6, `onFromCoalShare` 0.6 (~lines 2152–2174). Each is plausibly
  motivated in comments but none has a documented backtest or sensitivity check.

### 2.4 Missing features

- No sophomore-surge or retirement adjustments (well-documented ~1pp effects in Australian
  seat modelling), no candidate-strength terms.
- `TEAL_SEAT_IDS` is a hardcoded 6-seat list (~line 52); a future community independent in
  any other seat is classified as generic "other" with 50% flows instead of teal-like 62%.
- `SEAT_DEMO_MULT` and `SEAT_RESIDUAL_MAP` are empty placeholders even though their
  generator scripts exist (`scripts/compute_demographic_regression.py`,
  `scripts/compute_seat_residuals.py`) and `scripts/inject_model_constants.py` can patch
  them into App.jsx automatically. **[verified]** The automation path exists; it simply has
  never produced/injected data.

---

## 3. State models (`App.jsx` ~2580–4800; pipeline `state_*`/`vec_*`)

### 3.1 Coverage

All eight jurisdictions have frontend seat models and database pipelines:

| State | System | Model approach | Booth data | Notable gap |
|-------|--------|----------------|-----------|-------------|
| VIC | Full preferential | Primary-swing + flows, regional multipliers | No official booth data (Tally Room optional) | 2026 election due Nov; baselines are 2022 |
| NSW | Full preferential | Primary-swing + flows | Yes | Polls JSON unused |
| QLD | Full preferential (since 2016) | Primary-swing + flows | Yes | No per-seat flow overrides |
| WA | Full preferential | Primary-swing + flows | Yes | Polls JSON unused |
| SA | Full preferential | Primary-swing + flows | Yes | Baseline is a *provisional* count (see below) |
| TAS | Hare-Clark | FP share → seat-count heuristic | n/a | No STV simulation |
| ACT | Hare-Clark | FP share → seat-count heuristic | n/a | No STV simulation |
| NT | **Optional** preferential | Primary-swing + flows | Yes | Exhaustion ignored |

### 3.2 Findings

- **Hardcoded baselines and seat lists.** Every state's primaries (`VIC_BASELINE_2022`,
  `NSW_BL`, `QLD_BL`, `WA_BL`, `SA_BL`, `NT_BL`) and full seat lists with winners/margins
  are JS constants requiring manual post-election updates. The VIC 2026 election (due
  November) will silently invalidate the VIC view unless someone remembers.
- **[verified] SA baseline is a provisional count.** `SA_BL` (App.jsx:4583) encodes the
  21 March 2026 provisional result (ON 21.6% statewide, ON won Ngadjuri) with 6 seats still
  in count as of the source comment (App.jsx:4556–4567). The numbers are correct as of
  capture but must be refreshed against the final ECSA declaration; the per-seat
  `SA_SEAT_ON_FP_2026` map is similarly provisional.
- **Upper houses are completely unmodelled.** VIC (40), NSW (42), WA (37) and SA (22)
  Legislative Council seats have no schema tables, no parser, and no frontend view. For a
  full "election night wall" this is the largest missing surface.
- **Hare-Clark is modelled as if it were first-past-the-post-ish.** TAS/ACT views map FP
  share to seat counts without quota/exclusion simulation. In Hare-Clark, 45% FP can yield
  2 or 3 of 5 seats depending on exclusions and intra-party leakage; a proper STV count
  simulation (e.g. Meek or the actual TEC/Elections ACT rules) is the only defensible
  approach. Until then the TAS/ACT projections should carry a UI caveat.
- **NT preference exhaustion ignored.** The schemas and parser capture `exhausted_votes`
  (`nt_schema.sql`; `state_parse.py` `_parse_tcp_csv(..., include_exhausted=True)`) but the
  frontend TCP arithmetic assumes every FP vote reaches the final count. Under optional
  preferential this overstates flow-driven swings, particularly in ON-heavy seats.
- **Only VIC polling reaches the frontend.** `data/polls/{nsw,qld,wa,sa}_polls.json` exist
  but nothing reads them; those models run off static election-day baselines.
- **Per-seat preference-flow overrides exist for NSW only** (Hunter,
  `NSW_SEAT_PREF_FLOWS_2023`). QLD/WA/SA/NT regional seats with distinctive flows use
  statewide defaults.
- **Regional swing multipliers are hand-set** (e.g. VIC inner-metro 1.15 / regional 0.85,
  ~lines 2592–2638; similar maps for NSW/QLD/WA/SA/NT) with no documented empirical fit,
  and the seat→region maps are manual, so any redistribution breaks them silently. Only VIC
  has a district-alias map for redistributions (`VIC_DISTRICT_ALIASES`, config.py:153–160).
- **The fixed ON-final threshold (6.5%)** is reused from the federal model in state contexts
  with very different ON bases (SA at 21.6% statewide vs VIC at ~1–2%).
- **Heavy duplication.** Eight near-identical per-state SQL schemas; `export.py` has both a
  VIC-specific export path (≈ lines 584–891) and a generic state path (≈ lines 932–1220);
  and `computeModelledSeatsState()` re-implements most of the federal flow arithmetic.
  A single parameterised schema/export/compute path would shrink the surface area
  substantially.
- **Parser robustness** (`state_parse.py`): no duplicate-candidate or duplicate-district-ID
  detection, TCP parsing silently returns empty when the file is missing, and
  `state_download.py`'s link scraping (`_fetch_links()`, lines ~95–123) is a plain
  substring scan over HTML that breaks quietly when an electoral commission redesigns its
  results page (manual file placement is the only fallback).

---

## 4. Validation, pipeline & code health

### 4.1 The backtest validates a different model than the one deployed

`pipeline/backtest.py` applies **uniform national swing with the elasticity curve**
(line ~421) to 2016→2019 and 2019→2022. The live frontend model uses the **primary-based
path** for every seat with `SEAT_FP_2025` data. Consequences:

- The deployed model path has no historical validation at all.
- The elasticity curve parameters (L=0.80, H=1.30, k=0.20, m0=8) were hand-tuned on the
  same two cycles the backtest scores — partially circular. `scripts/fit_elasticity.py`
  exists to refit against 2022→2025 **[verified]** but its output is print-and-paste and
  there is no record it has been applied.
- Non-classic seats (~35: Greens, teal, ON finals) are skipped entirely (line ~406), which
  is precisely where the model's distinctive machinery (ON branches, teal flows) lives.
- `monte_carlo_seat_counts()` (lines ~264–357) produces seat-count distributions and
  majority probabilities that are **never calibration-checked** — no Brier score, no
  interval-coverage test, on any historical election.

### 4.2 Calibration honesty

`SEAT_CALIB_2025` offsets are by construction `actual − model` for the 2025 election
(compute_calibration.py:242), so the in-sample "fitted MAE" (~0.002pp) is meaningless as an
accuracy claim. The script itself reports the honest number — **leave-one-out MAE ≈ 1.4pp**
(lines 266–285) — but `data/calibration_report.txt` and CLAUDE.md lead with the ±0.05%
figure. The offsets only pin the model at zero swing; nothing validates the *slope* (the
model's response to swing), which is what matters for forecasting. Pre-calibration regional
error is uneven (SA ≈ 2.6pp MAE; individual seats up to ~8pp), suggesting structure the
per-seat constant offsets paper over.

### 4.3 Manual synchronisation points

The pipeline→frontend constant flow has three copy-paste steps, each a staleness hazard:

1. `scripts/update_s25_from_exports.py` prints `_S25` / `SEAT_FP_2025` /
   `SEAT_PREF_FLOWS_2025` JS to stdout for hand-pasting into App.jsx. (The Barker/Grey
   bug in §2.2 is exactly the failure mode this invites.)
2. `scripts/compute_calibration.py` regex-parses App.jsx to *read* constants and prints
   `SEAT_CALIB_2025` back to stdout — a fragile circular dependency on App.jsx formatting.
3. **[verified]** `scripts/copy_data_to_frontend.py:98` hardcodes `[2022, 2019, 2016]` —
   2025 exports were never added. *Fixed in this review.*

`scripts/inject_model_constants.py` already demonstrates the right pattern (patch App.jsx
in place from JSON, with dry-run and a CI workflow); extending it to cover the three
constants above would eliminate this class of bug.

### 4.4 Test coverage

`tests/` covers AEC/VEC CSV parsing and the poll scraper only. Untested: all of
`backtest.py`, `export.py` (including the ~112-line `_compute_division_pref_flows` DOP
logic), `database.py`, `poll_aggregator.py`, every script in `scripts/`, and the entire
~10k-line App.jsx model (no JS test infrastructure exists at all). The highest-ROI
additions, in order:

1. Golden-value tests for the 2PP arithmetic (a handful of seats, hand-computed) in both
   `backtest.py` and a small extracted JS module.
2. Tests for `_compute_division_pref_flows` including the silently-skipped multi-party
   exclusion case (export.py:479).
3. An end-to-end pipeline smoke test on a fixture CSV set (download-skip → parse → load →
   export → JSON schema check).

### 4.5 Pipeline data-quality gaps

- DOP counts with multi-party exclusions are silently skipped (export.py:479) — no warning,
  no count of how much flow data is dropped.
- Division TCP export indexes `tcp_sorted[0]/[1]` with no guard for fewer than two rows
  (export.py:~181–184).
- No votes ≤ enrolment or turnout-plausibility validation anywhere in load/export.
- Informal-vote candidate ID 999 is an undocumented magic number (parse.py:~160); AEC header
  detection relies on `first[0:4].isdigit()` (parse.py:~46).
- 2025's per-state FP file merge (`parse_all`) concatenates with no duplicate-booth check.
- `pipeline/poll_aggregator.py` matches App.jsx on headline flows (0.81/0.62/0.255/0.50)
  **[verified consistent]**, but has no equivalent of the JS `dopCalibDelta` re-basing and
  no state-decomposition output the federal model could consume.

### 4.6 Documentation drift

CLAUDE.md describes App.jsx as ~5,500 lines (actual ≈ 10,070) **[verified]**, repeats the
±0.05% accuracy claim without the LOO caveat, and its App.jsx section map predates the
state models. *Line count and accuracy claim fixed in this review.*

---

## 5. Prioritised roadmap

### Critical (do first)

1. **Fix bad per-seat flow data** — Barker/Grey (done in this review); audit
   `SEAT_PREF_FLOWS_2025` for other anomalies (flows of exactly 0.62 teal in non-teal seats
   are fallbacks, fine; anything ≥0.95 or ≤0.02 for grn/on deserves a look); re-run
   `compute_calibration.py` afterwards.
2. **Backtest the live model path**: populate `SEAT_FP_2022` (the pipeline already has the
   data), then run the primary-based model 2022→2025 and compare against UNS seat-by-seat.
   This is the single most important credibility exercise available.

### High

3. **Wire state swings into the federal model**: derive per-state 2PP/primary swings from
   state breakdowns already published by Newspoll/RedBridge (extend `poll_aggregator.py` to
   emit them), and pass `stateSwings` at the App.jsx:4025 call site — the blending code
   already exists.
4. **Probabilistic validation**: simulate past elections with `monte_carlo_seat_counts()`,
   report Brier scores and 50%/90% interval coverage; tune `SEAT_RESIDUAL_STD` and the
   pref-flow sigmas from those residuals instead of the current ad-hoc values.
5. **Integrate state polling**: load `{nsw,qld,wa,sa}_polls.json` into the corresponding
   state views with the same house-effect treatment as federal.
6. **Automate constant sync**: extend `inject_model_constants.py` to also inject `_S25`,
   `SEAT_FP_2025`, `SEAT_PREF_FLOWS_2025`, `SEAT_CALIB_2025` from JSON exports, and add the
   GitHub Actions wiring so a pipeline re-run can't leave the frontend stale.
7. **Run the existing generators**: `fit_elasticity.py` (refit on 2022→2025),
   `compute_demographic_regression.py`, `compute_seat_residuals.py` — the placeholders
   (`SEAT_DEMO_MULT`, `SEAT_RESIDUAL_MAP`) and injection tooling are already in place.

### Medium

8. **Hare-Clark simulation** for TAS/ACT (full STV count with transfer values); until then,
   label those projections as indicative only.
9. **NT exhaustion**: reduce final-count denominators by observed exhaustion rates (data is
   already in `nt_district_2cp`).
10. **Correlated regional errors**: add a state-level (or metro/regional) correlated
    component to `computeUncertainty()`, sized from historical state-vs-national swing
    deviations.
11. **Per-seat ON-race flows beyond Hunter** (Maranoa and other high-ON regional seats have
    2025 DOP data available); saturating ON FP swing curve.
12. **Refresh SA to final results** once the ECSA declaration is complete; add VIC 2026
    pre-election readiness (baseline update checklist).
13. **Schema/export unification**: one parameterised state schema and one export path
    instead of eight clones plus a VIC special case.
14. **Upper house modelling** (VIC/NSW/WA/SA Legislative Councils) — large, but starts with
    schema + group-ticket/quota data capture.

### Low

15. Sophomore/retirement/candidate adjustments; dynamic teal classification; UI copy fixes
    (the stale ON-flow help text at App.jsx:6547–6548); parser hardening (duplicate
    detection, votes ≤ enrolment checks, multi-party-exclusion warning); extract the shared
    2PP arithmetic used by federal and state compute functions into one utility.
