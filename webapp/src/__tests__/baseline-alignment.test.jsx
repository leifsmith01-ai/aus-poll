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
  computeVic2pp,
  getParty,
  getSeatGroup,
  SEATS,
  VIC_SEATS, NSW_SEATS, QLD_SEATS, WA_SEATS, SA_SEATS, NT_SEATS,
  FED_DEFAULT_PREF_FLOWS,
  VIC_BASELINE_2022, VIC_DEFAULT_PREF_FLOWS, VIC_SEAT_FP_2022,
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

// Generic state compute2pp mirroring the per-state closures in App.jsx at zero
// swing (coalToOnXfer = 0 → effOnAlp = f.on_alp). `exhaust` covers NT's
// optional-preferential exhaustion factor.
const makeCompute2pp = (prim, onTcp = null, exhaust = 0) => (p, f) => {
  const onV = p.on ?? 0;
  const other = Math.max(0, 100 - p.alp - p.coal - p.grn - prim.ind - onV);
  const k = 1 - exhaust;
  if (onTcp === "on_v_alp") {
    const a = p.alp + k * (p.coal * f.coal_alp_v_on + p.grn * f.grn_alp_v_on + prim.ind * f.ind_alp_v_on + other * f.other_alp_v_on);
    const on = onV + k * (p.coal * (1 - f.coal_alp_v_on) + p.grn * (1 - f.grn_alp_v_on) + prim.ind * (1 - f.ind_alp_v_on) + other * (1 - f.other_alp_v_on));
    return a / (a + on) * 100;
  }
  if (onTcp === "on_v_coal") {
    const on = onV + k * (p.alp * f.alp_on_v_coal + p.grn * f.grn_on_v_coal + prim.ind * f.ind_on_v_coal + other * f.other_on_v_coal);
    const c = p.coal + k * (p.alp * (1 - f.alp_on_v_coal) + p.grn * (1 - f.grn_on_v_coal) + prim.ind * (1 - f.ind_on_v_coal) + other * (1 - f.other_on_v_coal));
    return on / (on + c) * 100;
  }
  const a = p.alp + k * (prim.ind * f.ind_alp + p.grn * f.grn_alp + onV * f.on_alp + other * f.other_alp);
  const c = p.coal + k * (prim.ind * (1 - f.ind_alp) + p.grn * (1 - f.grn_alp) + onV * (1 - f.on_alp) + other * (1 - f.other_alp));
  return a / (a + c) * 100;
};

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
  const compute2pp = makeCompute2pp(prim, null, exhaust);
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
