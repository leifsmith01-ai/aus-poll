// Baseline-alignment regression suite.
//
// Invariant: every model, evaluated at ZERO swing from its baseline election
// (all primary-vote inputs equal to the recorded baseline), must reproduce the
// actual election outcome — the same winner in every seat and the documented
// statewide seat tallies. If this suite fails, the dashboard's default/baseline
// projections no longer match reality and must be recalibrated before shipping.
//
// The calls below mirror the dashboard's call sites in App.jsx (the useMemo
// blocks for each jurisdiction) with their default settings: regional swing on,
// no overrides, no ON TCP forcing, elasticity off.

import { describe, it, expect } from "vitest";
import {
  computeModelledSeats,
  computeModelledSeatsVic,
  computeModelledSeatsState,
  makeStateCompute2pp,
  computeVic2pp,
  getParty,
  getSeatGroup,
  MODEL_PARAMS,
  SEATS,
  VIC_SEATS, NSW_SEATS, QLD_SEATS, WA_SEATS, SA_SEATS, NT_SEATS,
  FED_DEFAULT_PREF_FLOWS,
  VIC_BASELINE_2022, VIC_DEFAULT_PREF_FLOWS, VIC_SEAT_FP_2022, VIC_SEAT_ON_FP,
  NSW_BL, NSW_COAL, NSW_DEFAULT_FLOWS, NSW_SEAT_ON_FP_2023,
  NSW_SEAT_PREF_FLOWS_2023, NSW_DISTRICT_REGION, NSW_REGION_SWING_MULT, NSW_SEAT_FP_2023,
  QLD_BL, QLD_COAL, QLD_DEFAULT_FLOWS, QLD_SEAT_ON_FP_2024,
  QLD_SEAT_PREF_FLOWS_2024, QLD_DISTRICT_REGION, QLD_REGION_SWING_MULT, QLD_SEAT_FP_2024,
  WA_BL, WA_COAL, WA_DEFAULT_FLOWS,
  WA_DISTRICT_REGION, WA_REGION_SWING_MULT, WA_SEAT_FP_2025,
  SA_BL, SA_COAL, SA_DEFAULT_FLOWS, SA_SEAT_ON_FP_2026,
  SA_DISTRICT_REGION, SA_REGION_SWING_MULT, SA_SEAT_FP_2026,
  NT_BL, NT_COAL, NT_DEFAULT_FLOWS, NT_EXHAUST_DEFAULT,
  NT_DISTRICT_REGION, NT_REGION_SWING_MULT, NT_SEAT_FP_2024,
} from "../App.jsx";

const ZERO_SWINGS = { alp: 0, coal: 0, grn: 0, ind: 0, on: 0, teal: 0, other: 0 };
const NO_SWING = { alp: 0, coal: 0, grn: 0, on: 0 };

const tallyByGroup = (seats, pick) => {
  const c = {};
  seats.forEach((s) => {
    const g = pick(s);
    c[g] = (c[g] || 0) + 1;
  });
  return c;
};

const baselineTally = (seats) => tallyByGroup(seats, (s) => getParty(s.winner.party).group);
// Federal groups use the app's teal-vs-other-independent refinement (getSeatGroup),
// matching the group labels computeModelledSeats emits. State models use the
// coarse getParty grouping on both sides.
const baselineTallyFed = (seats) => tallyByGroup(seats, (s) => getSeatGroup(s));
const projectedTally = (seats) => tallyByGroup(seats, (s) => s.modelled.winnerGroup);

function expectNoChanges(modelled, label) {
  const changed = modelled.filter((s) => s.modelled.changed);
  expect(
    changed.map((s) => `${s.name}: ${s.winner.party} -> ${s.modelled.winnerParty}`),
    `${label}: seats flipping at zero swing`
  ).toEqual([]);
}

function runState({ seats, bl, coal, flows, onFp, seatPrefFlows, regionMap, regionMult, seatFp, exhaust = 0 }) {
  const prim = { ...bl, undecided: 0 };
  // Use the production 2CP calculator (zero swing → coalToOnXfer = 0).
  const compute2pp = makeStateCompute2pp({ ind: prim.ind, onTcp: null, swings: NO_SWING, exhaust });
  const baseline2pp = compute2pp(bl, flows);
  return computeModelledSeatsState(
    seats, prim, compute2pp, baseline2pp, flows, coal,
    { alp: 0, coal: 0, grn: 0, on: 0 },
    regionMap, regionMult,
    onFp, 6.5, {},
    false, seatPrefFlows, bl, seatFp,
  );
}

describe("federal model at zero swing reproduces the 2025 result", () => {
  const modelled = computeModelledSeats(
    SEATS, ZERO_SWINGS, FED_DEFAULT_PREF_FLOWS, {}, 0, 6.5, false, null,
  );

  it("does not flip any seat", () => {
    expectNoChanges(modelled, "federal");
  });

  it("matches the actual 2025 tallies", () => {
    expect(projectedTally(modelled)).toEqual(baselineTallyFed(SEATS));
    expect(projectedTally(modelled).alp).toBe(94);
  });
});

describe("VIC model at zero swing reproduces the 2022 result", () => {
  const baseline2pp = computeVic2pp(VIC_BASELINE_2022, VIC_DEFAULT_PREF_FLOWS, null);
  const modelled = computeModelledSeatsVic(
    VIC_SEATS, { alp: 0, coal: 0, grn: 0, ind: 0, on: 0 },
    VIC_DEFAULT_PREF_FLOWS, true, null, baseline2pp, null, VIC_SEAT_FP_2022,
    VIC_SEAT_ON_FP, MODEL_PARAMS.onThresholdDefault,
  );

  it("does not flip any seat", () => {
    expectNoChanges(modelled, "VIC");
  });

  it("matches the actual 2022 tallies (ALP 56 / Coalition 28 / GRN 4)", () => {
    const t = projectedTally(modelled);
    expect(t).toEqual(baselineTally(VIC_SEATS));
    expect(t.alp).toBe(56);
    expect(t.coalition).toBe(28);
    expect(t.greens).toBe(4);
  });

  it("uses the regenerated per-seat FP baselines (87 of 88 districts)", () => {
    // Guards against the corrupt/never-matching state_seat_fp.js regression:
    // the map must cover every district except Narracan (no valid 2022 count)
    // and contain plausible major-party vote shares.
    const ids = Object.keys(VIC_SEAT_FP_2022);
    expect(ids.length).toBe(87);
    const fps = Object.values(VIC_SEAT_FP_2022);
    const avgMajor = fps.reduce((a, fp) => a + fp.alp + fp.coal, 0) / fps.length;
    expect(avgMajor).toBeGreaterThan(50);
  });
});

describe("NSW model at zero swing reproduces the 2023 result", () => {
  const modelled = runState({
    seats: NSW_SEATS, bl: NSW_BL, coal: NSW_COAL, flows: NSW_DEFAULT_FLOWS,
    onFp: NSW_SEAT_ON_FP_2023, seatPrefFlows: NSW_SEAT_PREF_FLOWS_2023,
    regionMap: NSW_DISTRICT_REGION, regionMult: NSW_REGION_SWING_MULT,
    seatFp: NSW_SEAT_FP_2023,
  });

  it("does not flip any seat", () => {
    expectNoChanges(modelled, "NSW");
  });

  it("matches the actual 2023 tallies (ALP 45)", () => {
    const t = projectedTally(modelled);
    expect(t).toEqual(baselineTally(NSW_SEATS));
    expect(t.alp).toBe(45);
  });
});

describe("QLD model at zero swing reproduces the 2024 result", () => {
  const modelled = runState({
    seats: QLD_SEATS, bl: QLD_BL, coal: QLD_COAL, flows: QLD_DEFAULT_FLOWS,
    onFp: QLD_SEAT_ON_FP_2024, seatPrefFlows: QLD_SEAT_PREF_FLOWS_2024,
    regionMap: QLD_DISTRICT_REGION, regionMult: QLD_REGION_SWING_MULT,
    seatFp: QLD_SEAT_FP_2024,
  });

  it("does not flip any seat", () => {
    expectNoChanges(modelled, "QLD");
  });

  it("matches the actual 2024 tallies (LNP 52 / ALP 36)", () => {
    const t = projectedTally(modelled);
    expect(t).toEqual(baselineTally(QLD_SEATS));
    expect(t.coalition).toBe(52);
    expect(t.alp).toBe(36);
  });
});

describe("WA model at zero swing reproduces the 2025 result", () => {
  const modelled = runState({
    seats: WA_SEATS, bl: WA_BL, coal: WA_COAL, flows: WA_DEFAULT_FLOWS,
    onFp: null, seatPrefFlows: null,
    regionMap: WA_DISTRICT_REGION, regionMult: WA_REGION_SWING_MULT,
    seatFp: WA_SEAT_FP_2025,
  });

  it("does not flip any seat", () => {
    expectNoChanges(modelled, "WA");
  });

  it("matches the actual 2025 tallies (ALP 46)", () => {
    const t = projectedTally(modelled);
    expect(t).toEqual(baselineTally(WA_SEATS));
    expect(t.alp).toBe(46);
  });
});

describe("SA model at zero swing reproduces the 2026 provisional result", () => {
  const modelled = runState({
    seats: SA_SEATS, bl: SA_BL, coal: SA_COAL, flows: SA_DEFAULT_FLOWS,
    onFp: SA_SEAT_ON_FP_2026, seatPrefFlows: null,
    regionMap: SA_DISTRICT_REGION, regionMult: SA_REGION_SWING_MULT,
    seatFp: SA_SEAT_FP_2026,
  });

  it("does not flip any seat", () => {
    expectNoChanges(modelled, "SA");
  });

  it("matches the provisional tallies recorded in the seat data", () => {
    expect(projectedTally(modelled)).toEqual(baselineTally(SA_SEATS));
  });
});

describe("NT model at zero swing reproduces the 2024 result", () => {
  const modelled = runState({
    seats: NT_SEATS, bl: NT_BL, coal: NT_COAL, flows: NT_DEFAULT_FLOWS,
    onFp: null, seatPrefFlows: null,
    regionMap: NT_DISTRICT_REGION, regionMult: NT_REGION_SWING_MULT,
    seatFp: NT_SEAT_FP_2024, exhaust: NT_EXHAUST_DEFAULT,
  });

  it("does not flip any seat", () => {
    expectNoChanges(modelled, "NT");
  });

  it("matches the actual 2024 tallies", () => {
    expect(projectedTally(modelled)).toEqual(baselineTally(NT_SEATS));
  });
});

// Direct coverage of the unified state 2CP calculator across the swing-dependent
// paths the baseline (zero-swing) cases never exercise: the standard ALP-vs-Coal
// distribution, optional-preferential exhaustion, the forced ON-vs-ALP and
// ON-vs-Coalition finals, and the Coalition-fed ON-surge preference adjustment.
describe("makeStateCompute2pp (non-baseline preference distribution)", () => {
  const FLOWS = {
    ind_alp: 0.5, grn_alp: 0.8, on_alp: 0.3, other_alp: 0.5, onCoalOriginFactor: 0,
    coal_alp_v_on: 0.12, grn_alp_v_on: 0.85, ind_alp_v_on: 0.6, other_alp_v_on: 0.5,
    alp_on_v_coal: 0.2, grn_on_v_coal: 0.07, ind_on_v_coal: 0.12, other_on_v_coal: 0.25,
  };

  it("distributes preferences to an ALP-vs-Coalition 2PP", () => {
    const f = makeStateCompute2pp({ ind: 5, onTcp: null, swings: NO_SWING });
    // a = 40 + 5*.5 + 12*.8 + 5*.3 = 53.6 ; c = 46.4 → 53.6
    expect(f({ alp: 40, coal: 38, grn: 12, on: 5 }, FLOWS)).toBeCloseTo(53.6, 4);
  });

  it("optional-preferential exhaustion damps minor-party preferences", () => {
    const f = makeStateCompute2pp({ ind: 5, onTcp: null, swings: NO_SWING, exhaust: 0.2 });
    // k=0.8 → a=50.88, c=44.72, total 95.6 → 53.2218
    expect(f({ alp: 40, coal: 38, grn: 12, on: 5 }, FLOWS)).toBeCloseTo(53.2218, 3);
  });

  it("computes a One-Nation-vs-ALP final when forced", () => {
    const f = makeStateCompute2pp({ ind: 5, onTcp: "on_v_alp", swings: NO_SWING });
    // a = 30 + 35*.12 + 10*.85 + 5*.6 = 45.7 ; on = 54.3 → returns ALP share 45.7
    expect(f({ alp: 30, coal: 35, grn: 10, on: 20 }, FLOWS)).toBeCloseTo(45.7, 4);
  });

  it("computes a One-Nation-vs-Coalition final when forced", () => {
    const f = makeStateCompute2pp({ ind: 5, onTcp: "on_v_coal", swings: NO_SWING });
    // on = 25 + 25*.2 + 10*.07 + 5*.12 = 31.3 ; c = 68.7 → returns ON share 31.3
    expect(f({ alp: 25, coal: 35, grn: 10, on: 25 }, FLOWS)).toBeCloseTo(31.3, 4);
  });

  it("lifts ALP 2PP when a Coalition-fed ON surge raises the ON→ALP flow", () => {
    const seat = { alp: 35, coal: 35, grn: 10, on: 15 };
    const neutral = makeStateCompute2pp({ ind: 5, onTcp: null, swings: NO_SWING });
    // ON up 5, Coalition down 4 → coalToOnXfer = 0.8; onCoalOriginFactor lifts ON→ALP.
    const coalFed = makeStateCompute2pp({
      ind: 5, onTcp: null, swings: { alp: 0, coal: -4, grn: 0, on: 5 },
    });
    const base = neutral(seat, FLOWS);
    const lifted = coalFed(seat, { ...FLOWS, onCoalOriginFactor: 0.5 });
    expect(base).toBeCloseTo(50.0, 4);
    expect(lifted).toBeGreaterThan(base);
  });
});
