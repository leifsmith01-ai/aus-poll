# State Election Update Checklist

How to refresh a state/territory baseline in the dashboard after an election (or after
a provisional count is finalised, e.g. SA 2026). All frontend constants live in
`webapp/src/App.jsx` unless noted — search by constant name, the file is large and
line numbers drift.

## 1. Statewide baselines

- [ ] **Primary-vote baseline** — update the state's `*_BL` constant
      (`NSW_BL`, `QLD_BL`, `WA_BL`, `SA_BL`, `NT_BL`, `TAS_BL`, `ACT_BL`;
      VIC uses `VIC_BASELINE_2022`) with the official first-preference shares.
- [ ] **2PP baseline** — update `*_2PP` (`NSW_2PP`, `QLD_2PP`, `WA_2PP`, `SA_2PP`,
      `NT_2PP`; VIC uses `VIC_2PP_2022`) and the right-bloc variants
      (`*_RIGHT_BLOC_2PP`) where present.
- [ ] **useState defaults** — the corresponding `useState({ ...XX_BL, undecided: 0 })`
      picks the baseline up automatically, but VIC hardcodes its primaries in
      `useState(...)` and in the VIC "Reset model" button — update both.

## 2. Per-seat data

- [ ] **Per-seat first preferences** — regenerate `webapp/src/data/state_seat_fp.js`
      via `python scripts/generate_state_seat_fp.py` after loading the new election
      into the database (`python main.py --state <st> --year <YYYYMM>`). Rename the
      exported constant for the new year (e.g. `SA_SEAT_FP_2026` → `SA_SEAT_FP_2030`)
      and update the `STATE_SEAT_FP.*` references near the top of App.jsx.
- [ ] **Seat lists** — update the state's seat array (`_NSW`/`NSW_SEATS`,
      `_QLD`/`QLD_SEATS`, `_WA`, `_SA`, `_NT`, `_VS`/`VIC_SEATS`,
      `TAS_ELECTORATES`, `ACT_ELECTORATES`): winners, TCP pairs, margins. Also update
      the static results entry in `ELECTION_DATA` (label, date, counts, twopp) and
      the `*_2022_SUMMARY`-style summary constants if present.
- [ ] **ON per-seat maps** — refresh `*_SEAT_ON_FP_*` (e.g. `NSW_SEAT_ON_FP_2023`,
      `QLD_SEAT_ON_FP_2024`, `SA_SEAT_ON_FP_2026`) from the commission's
      first-preference results, and any per-seat flow maps
      (`NSW_SEAT_PREF_FLOWS_2023`, `QLD_SEAT_PREF_FLOWS_2024`) from the new DOP.
- [ ] **Region maps** — check `*_DISTRICT_REGION` against the new boundaries
      (redistributions silently break these; only VIC has `VIC_DISTRICT_ALIASES` in
      `pipeline/config.py`) and revisit `*_REGION_SWING_MULT` if the observed
      metro/regional swing split changed.

## 3. Flows and polls

- [ ] **Preference-flow defaults** — update the state's `useState({...})` flow
      defaults *and* the matching `resetFlows` object in the reusable-builder `cfgs`
      map, plus the `*HasChanges` literal comparisons (they hardcode the defaults).
- [ ] **Poll JSON** — reset `data/polls/<state>_polls.json`: new `election_date`,
      replace the baseline entry (pollster `"<year> Election Result"`) with the new
      result, prune pre-election polls. Re-run
      `python scripts/copy_data_to_frontend.py` to sync `webapp/src/data/`.
- [ ] **Caveats** — remove or update any `caveat:` text in the builder `cfgs`
      (e.g. the SA provisional-count note) once results are final.

## 4. Verify

- [ ] `cd webapp && npm run build` passes.
- [ ] Visual check: state view loads, baseline seat counts match the official
      result, "Reset model" returns every control to the new baseline, zero-change
      scenario projects zero seats changing.
- [ ] `python -m pytest tests/ -v` still passes if pipeline data was reloaded.

---

# VIC 2026 readiness (election due 28 November 2026)

The VIC view is still on the 2022 baseline. Everything below must be refreshed after
election night. Current constants and where they live in `webapp/src/App.jsx`:

| Constant | What it is | Where |
|---|---|---|
| `VIC_2022_SUMMARY` | header summary of the 2022 result | top of App.jsx (~line 29) |
| `VIC_SEAT_FP_2022` | per-seat primaries (from `state_seat_fp.js`) | import block / `STATE_SEAT_FP` refs (~line 495) |
| `_VS` / `VIC_SEATS` | 88-seat list with winners/TCP/margins | ~line 1700 |
| `ELECTION_DATA["vic_2022"]` | tab label, date, counts | ~line 1720 |
| `VIC_BASELINE_2022`, `VIC_2PP_2022`, `VIC_RIGHT_BLOC_2PP_2022`, `VIC_BASELINE_2018`, `VIC_2PP_2018` | statewide baselines | ~line 2640 |
| `VIC_DISTRICT_REGION`, `VIC_REGION_SWING_MULT` | region map + swing multipliers | ~line 2650–2700 |
| `vicPrimaries` useState default | hardcodes 2022 primaries | ~line 3950 |
| `vicPrefFlows` useState default | VEC 2022 DOP flows | ~line 3955 |
| VIC "Reset model" button | hardcodes primaries + flows again | search `setVicPrimaries({ alp: 38.1` |
| `data/polls/vic_polls.json` | VIC polling (81 entries, 2026 election date) | `data/polls/` |

Pipeline: `python main.py --state vic --year 202611` once VEC publishes results
(check `pipeline/config.py` for the new VEC file templates; 2026 will need new
entries). Also rename `VIC_SEAT_FP_2022` → `VIC_SEAT_FP_2026` end-to-end, update the
`vic_2022` ELECTION_DATA key/label, and re-check `VIC_DISTRICT_ALIASES`
(`pipeline/config.py`) against the 2026 redistribution.
