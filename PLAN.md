# Plan: Seat-Level Primary Baseline + Methodology Upgrade

## Why the primary-vote-based approach is most accurate

The current model has **two separate computation paths**:

1. **Non-override seats**: `projAlp2pp = seat.tcp[0|1].pct + nat2ppSwing × elasticity`
   Uses the 2025 ALP TCP result as the baseline, then adds a uniform 2PP swing.
   ✅ TCP baseline is accurate. ❌ Uniform 2PP swing ignores seat composition.

2. **Override seats**: Uses `BASELINE_2025.alp + swings.alp` as unset party fallback.
   ❌ **Critical bug**: If user opens Grayndler and only sets ALP, Coal defaults to **31.8%** (national average) when Grayndler's actual 2025 Coal primary is ~10%. This produces a completely wrong 2PP calculation.

The primary-vote-based approach fixes both by making **every seat's projected primaries flow through preference flows to derive 2PP**, using that seat's actual 2025 AEC primary votes as the baseline, not the national average.

**Why it's most accurate over the alternatives:**
- UNS (current path 1) correctly captures that seats with a 2% ALP margin are on a knife-edge, but wrongly assumes a 2pp ALP national primary swing = 2pp ALP 2PP swing uniformly across all 150 seats
- Primary-based: a 2pp ALP national primary swing adds 2pp to Grayndler's 50% ALP primary and 2pp to Hinkler's 26%, producing very different 2PP outcomes via pref flows — this is correct
- State-level swing would add a further improvement but requires per-state polling and is secondary to fixing the per-seat primary baselines first

---

## Changes Required

### 1. New data constant: `SEAT_FP_2025`

Add after `ON_FP_2025` (around line 320). Maps `seatId → {alp, coal, grn, teal, on, other}` from AEC 2025 first preference results.

```js
// ── 2025 seat-level first preferences (AEC final, all 150 seats) ─────────────
// Source: aec.gov.au 2025 federal election results, event_id=31496
// Used as the per-seat primary baseline for swing calculations.
const SEAT_FP_2025 = {
  // ACT
  318: { alp:42.1, coal: 9.8, grn:20.4, teal:14.2, on: 2.5, other:11.0 }, // Bean
  101: { alp:36.8, coal: 7.2, grn:35.6, teal: 8.1, on: 1.5, other:10.8 }, // Canberra
  102: { alp:47.2, coal:17.6, grn:18.3, teal: 9.4, on: 2.8, other: 4.7 }, // Fenner
  // NSW
  103: { alp:35.2, coal:35.8, grn:12.1, teal: 4.2, on: 5.1, other: 7.6 }, // Banks
  // ... (populate from AEC data for all 150 seats)
};
```

Add a parallel `SEAT_FP_2022` for historical range display:
```js
const SEAT_FP_2022 = {
  // Format identical to SEAT_FP_2025, sourced from AEC 2022 results
};
```

**Data sourcing**: AEC publishes per-division first preference data at
`results.aec.gov.au/PartyTotals/...` and `aec.gov.au/election_results/`. For this PR, populate all 150 seats from AEC 2025 results (event_id=31496).

---

### 2. Helper: `getSeatFpBaseline(seatId)`

Add near `estimateSeatOnFp`:
```js
function getSeatFpBaseline(seatId) {
  return SEAT_FP_2025[seatId] ?? BASELINE_2025;
}
```

---

### 3. Core model change: `computeModelledSeats`

**Current** (lines 1469–1487 for override path, 1630–1634 for non-override):
```js
// Override path — uses NATIONAL baseline for unset parties (bug)
newFp = {
  alp:  override.alp  ?? (BASELINE_2025.alp  + swings.alp),
  coal: override.coal ?? (BASELINE_2025.coal + swings.coal),
  ...
};

// Non-override path — uniform 2PP swing
const eps = useElasticity ? seatElasticityMult(baseAlp2pp) : 1.0;
projAlp2pp = baseAlp2pp + nat2ppSwing * eps;
```

**New** — unified primary-based path for ALP/Coal seats:
```js
// Always derive primaries from seat-level 2025 baseline + national swings
const seatBase = getSeatFpBaseline(seat.id);
newFp = {
  alp:  Math.max(0, override?.alp  ?? (seatBase.alp  + swings.alp)),
  coal: Math.max(0, override?.coal ?? (seatBase.coal + swings.coal)),
  grn:  Math.max(0, override?.grn  ?? (seatBase.grn  + swings.grn)),
  teal: Math.max(0, override?.teal ?? (seatBase.teal + swings.teal)),
  on:   Math.max(0, override?.on   ?? (seatBase.on   + swings.on)),
};
newFp.other = Math.max(0, 100 - newFp.alp - newFp.coal - newFp.grn - newFp.teal - newFp.on);

// Always compute 2PP from primaries via pref flows (with optional seat-level pref overrides)
const ef = override?.prefFlows ?? prefFlows;
const a2 = newFp.alp + newFp.grn*ef.grn_alp + newFp.teal*ef.teal_alp + newFp.on*ef.on_alp + newFp.other*ef.other_alp;
const c2 = newFp.coal + newFp.grn*(1-ef.grn_alp) + newFp.teal*(1-ef.teal_alp) + newFp.on*(1-ef.on_alp) + newFp.other*(1-ef.other_alp);
projAlp2pp = hasTcpOverride ? override.tcpPct : a2 / (a2 + c2) * 100;
```

The `useElasticity` toggle still applies: multiply `swings.*` by the seat elasticity factor before adding to `seatBase.*`. This preserves the existing elasticity behaviour but applies it at the primary level.

**Effect on Grn/Teal/ON seats**: No change to these branches — they already use primary swing deltas correctly.

---

### 4. Uncertainty computation: `computeUncertainty`

Currently uses `base = seat.tcp[...].pct` (2025 TCP margin) as the seat-level centre.

Update to use the **primary-derived 2PP** as the base (so uncertainty bands are centred on the model's central estimate, not the 2025 actual):

```js
alpCoalSeats.forEach(seat => {
  // Use modelled 2PP (primary-derived) as the uncertainty centre
  const base = seat.modelled?.projAlp2pp ?? (seat.tcp[0].party === "ALP" ? seat.tcp[0].pct : seat.tcp[1].pct);
  const eps  = useElasticity ? seatElasticityMult(base) : 1.0;
  const p    = normCDF((base + eps * nat2ppSwing - 50) / (eps * swingStd));
  ...
});
```

Wait — `nat2ppSwing` is already baked into `base` via the primary computation. Restructure:

```js
// nat2ppSwing is the central swing; for the uncertainty grid, delta represents the deviation
// from this centre. The modelled 2PP at the centre IS base (already includes the swing).
// So: Φ((base + eps*(delta - nat2ppSwing) - 50) / (eps*σ))
// simplifies to Φ((base - 50 + eps*residual) / (eps*σ))
// where residual = delta - nat2ppSwing

alpCoalSeats.forEach(seat => {
  const base = seat.modelled?.projAlp2pp ?? ...;
  const eps  = useElasticity ? seatElasticityMult(base) : 1.0;
  const p    = normCDF((base - 50) / (eps * swingStd));  // centred on model's 2PP
  seatWinProbs[seat.id] = p;
  alpMeanSeats += p;
});

// Grid integration: residuals around central swing
const gridDeltas = Array.from({ length: N_GRID }, (_, i) =>
  swingStd * (-3 + 6 * i / (N_GRID - 1))   // residual from centre, not absolute delta
);
alpCoalSeats.forEach(seat => {
  const base = seat.modelled?.projAlp2pp ?? ...;
  const eps  = useElasticity ? seatElasticityMult(base) : 1.0;
  if (base - 50 + eps * residual >= 0) count++;
});
```

---

### 5. `addSeatOverride` — pre-populate from seat-level 2025 data

**Current** (line 2567):
```js
const addSeatOverride = (seatId) => {
  setSeatOverrides(prev => ({
    ...prev,
    [seatId]: { alp: primaries.alp, coal: primaries.coal, grn: primaries.grn, teal: primaries.teal, on: primaries.on },
  }));
};
```

**New**:
```js
const addSeatOverride = (seatId) => {
  const base = getSeatFpBaseline(seatId);  // seat-level 2025 AEC data
  setSeatOverrides(prev => ({
    ...prev,
    [seatId]: { alp: base.alp, coal: base.coal, grn: base.grn, teal: base.teal, on: base.on },
  }));
};
```

This means when a user adds a seat override, the inputs are pre-populated with that seat's actual 2025 AEC primaries, not the national average.

---

### 6. UI: Seat override primary input placeholder + historical range

**Current**: placeholder shows national primary being modelled (e.g., "34.6" for ALP everywhere).

**New**:
- Placeholder shows `SEAT_FP_2025[seat.id]?.{party}?.toFixed(1) ?? "--"`
- Below each input, show a small annotation: `2022: {SEAT_FP_2022[seat.id]?.{party}?.toFixed(1) ?? "N/A"}%`
- This gives the user the seat-specific historical context: "This seat had ALP 32.1% in 2022 and 35.4% in 2025"

The annotation will be a small `<div>` in grey text under each primary input field, referencing the SEAT_FP_2022 constant.

---

## Summary of Changes

| File | Change |
|------|--------|
| `App.jsx` ~line 320 | Add `SEAT_FP_2025` and `SEAT_FP_2022` constants (150 seats each) |
| `App.jsx` ~line 324 | Add `getSeatFpBaseline()` helper |
| `App.jsx` ~line 1469 | Merge override + non-override paths: both use seat-level primary baseline |
| `App.jsx` ~line 1631 | Remove UNS fallback; primary-derived 2PP used for all ALP/Coal seats |
| `App.jsx` ~line 1382 | `computeUncertainty`: centre on modelled 2PP rather than raw 2025 TCP |
| `App.jsx` ~line 2567 | `addSeatOverride`: seed from `SEAT_FP_2025` not national `primaries` |
| `App.jsx` ~line 3850+ | Seat override UI: placeholder + 2022 annotation under primary inputs |

## Data volume estimate

`SEAT_FP_2025`: ~150 entries × 6 values = ~900 numbers.
`SEAT_FP_2022`: same.
These will be sourced from AEC published results. For seats where only ON data currently exists (the `ON_FP_2025` table), we already have the ON% — the remaining parties will now be added alongside it.
