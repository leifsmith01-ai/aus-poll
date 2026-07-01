// State-model One Nation scenario suite (NSW/QLD/WA/SA/NT — the generic
// computeModelledSeatsState path).
//
// Ports the VIC ON fixes (PR #164) to the generic state path and pins the
// fixed behaviour:
//  1. Coalition-sourcing of ON rises at the statewide level (extraCoalCutFor
//     applied to the primaries passed into the model) — previously a rising ON
//     primary wrongly inflated Coalition 2PP via the on_alp back-flow;
//  2. logit-scale ON swing distribution in the per-seat detection (previously
//     additive);
//  3. detection requires ON to out-poll the seat's Greens/independents.
// Zero-swing baselines must stay exactly reproduced (the baseline-alignment
// suite asserts the tallies; here we assert it through the new sourcing path).

import { describe, it, expect } from "vitest";
import {
  computeModelledSeatsState,
  makeStateCompute2pp,
  extraCoalCutFor,
  getParty,
  MODEL_PARAMS,
  NSW_SEATS, QLD_SEATS, WA_SEATS, SA_SEATS, NT_SEATS,
  NSW_BL, NSW_COAL, NSW_DEFAULT_FLOWS, NSW_SEAT_ON_FP_2023,
  NSW_SEAT_PREF_FLOWS_2023, NSW_DISTRICT_REGION, NSW_REGION_SWING_MULT, NSW_SEAT_FP_2023,
  QLD_BL, QLD_COAL, QLD_DEFAULT_FLOWS, QLD_SEAT_ON_FP_2024,
  QLD_SEAT_PREF_FLOWS_2024, QLD_DISTRICT_REGION, QLD_REGION_SWING_MULT, QLD_SEAT_FP_2024,
  WA_BL, WA_COAL, WA_DEFAULT_FLOWS, WA_DISTRICT_REGION, WA_REGION_SWING_MULT, WA_SEAT_FP_2025,
  SA_BL, SA_COAL, SA_DEFAULT_FLOWS, SA_SEAT_ON_FP_2026,
  SA_DISTRICT_REGION, SA_REGION_SWING_MULT, SA_SEAT_FP_2026,
  NT_BL, NT_COAL, NT_DEFAULT_FLOWS, NT_EXHAUST_DEFAULT,
  NT_DISTRICT_REGION, NT_REGION_SWING_MULT, NT_SEAT_FP_2024,
} from "../App.jsx";

const STATES = {
  nsw: {
    seats: NSW_SEATS, bl: NSW_BL, coal: NSW_COAL, flows: NSW_DEFAULT_FLOWS,
    onFp: NSW_SEAT_ON_FP_2023, seatPrefFlows: NSW_SEAT_PREF_FLOWS_2023,
    regionMap: NSW_DISTRICT_REGION, regionMult: NSW_REGION_SWING_MULT, seatFp: NSW_SEAT_FP_2023,
  },
  qld: {
    seats: QLD_SEATS, bl: QLD_BL, coal: QLD_COAL, flows: QLD_DEFAULT_FLOWS,
    onFp: QLD_SEAT_ON_FP_2024, seatPrefFlows: QLD_SEAT_PREF_FLOWS_2024,
    regionMap: QLD_DISTRICT_REGION, regionMult: QLD_REGION_SWING_MULT, seatFp: QLD_SEAT_FP_2024,
  },
  wa: {
    seats: WA_SEATS, bl: WA_BL, coal: WA_COAL, flows: WA_DEFAULT_FLOWS,
    onFp: null, seatPrefFlows: null,
    regionMap: WA_DISTRICT_REGION, regionMult: WA_REGION_SWING_MULT, seatFp: WA_SEAT_FP_2025,
  },
  sa: {
    seats: SA_SEATS, bl: SA_BL, coal: SA_COAL, flows: SA_DEFAULT_FLOWS,
    onFp: SA_SEAT_ON_FP_2026, seatPrefFlows: null,
    regionMap: SA_DISTRICT_REGION, regionMult: SA_REGION_SWING_MULT, seatFp: SA_SEAT_FP_2026,
  },
  nt: {
    seats: NT_SEATS, bl: NT_BL, coal: NT_COAL, flows: NT_DEFAULT_FLOWS,
    onFp: null, seatPrefFlows: null,
    regionMap: NT_DISTRICT_REGION, regionMult: NT_REGION_SWING_MULT, seatFp: NT_SEAT_FP_2024,
    exhaust: NT_EXHAUST_DEFAULT,
  },
};

// Mirrors the app's call sites exactly, including the statewide Coalition-
// sourcing cut applied to the primaries before the model call.
function runState(cfg, swings = {}, onTcp = null) {
  const { seats, bl, coal, flows, onFp, seatPrefFlows, regionMap, regionMult, seatFp, exhaust = 0 } = cfg;
  const p = { ...bl };
  for (const [k, v] of Object.entries(swings)) p[k] = (bl[k] ?? 0) + v;
  const s = { alp: p.alp - bl.alp, coal: p.coal - bl.coal, grn: p.grn - bl.grn, on: p.on - bl.on };
  const prim = { ...p, coal: Math.max(0, p.coal - extraCoalCutFor(s, flows.onFromCoalShare ?? MODEL_PARAMS.onFromCoalShare)) };
  const compute2pp = makeStateCompute2pp({ ind: p.ind, onTcp, swings: s, exhaust });
  const baseline2pp = compute2pp(bl, flows);
  return computeModelledSeatsState(
    seats, prim, compute2pp, baseline2pp, flows, coal, s,
    regionMap, regionMult, onFp, 6.5, {},
    false, seatPrefFlows, bl, seatFp,
  );
}

const tally = (seats, pick) => {
  const c = {};
  seats.forEach((x) => { const g = pick(x); c[g] = (c[g] || 0) + 1; });
  return c;
};
const baselineTally = (seats) => tally(seats, (x) => getParty(x.winner.party).group);
const projectedTally = (seats) => tally(seats, (x) => x.modelled.winnerGroup);
const autoOnSeats = (m) => m.filter((x) => x.modelled.isAutoMatchup && x.modelled.activeTcpMatchup);

describe.each(Object.entries(STATES))("%s model with ON sourcing armed", (name, cfg) => {
  it("reproduces the baseline exactly at zero swing", () => {
    const m = runState(cfg, {});
    expect(m.filter((x) => x.modelled.changed).map((x) => x.name)).toEqual([]);
    expect(projectedTally(m)).toEqual(baselineTally(cfg.seats));
    expect(autoOnSeats(m)).toEqual([]);
  });

  it("adds no auto ON matchup on a negative ON swing", () => {
    const m = runState(cfg, { on: -1 });
    expect(autoOnSeats(m)).toEqual([]);
  });

  it("does not increase the Coalition seat tally on an ON-only rise", () => {
    const base = projectedTally(runState(cfg, {}));
    const t = projectedTally(runState(cfg, { on: 6 }));
    expect(t.coalition ?? 0).toBeLessThanOrEqual(base.coalition ?? 0);
  });

  it("keeps every projection finite under a large ON surge", () => {
    const m = runState(cfg, { on: 15, coal: -10, alp: -3 });
    for (const x of m) {
      expect(x.modelled.winnerGroup, x.name).toBeTruthy();
      if (x.modelled.winnerPct != null) expect(Number.isFinite(x.modelled.winnerPct), x.name).toBe(true);
      if (x.modelled.projAlp2pp != null) expect(Number.isFinite(x.modelled.projAlp2pp), x.name).toBe(true);
    }
  });
});

describe("Coalition-sourcing direction (statewide 2PP)", () => {
  it("raises ALP 2PP versus the uncut distribution when ON rises", () => {
    for (const [name, cfg] of Object.entries(STATES)) {
      const { bl, flows } = cfg;
      const s = { alp: 0, coal: 0, grn: 0, on: 6 };
      const compute2pp = makeStateCompute2pp({ ind: bl.ind, onTcp: null, swings: s, exhaust: cfg.exhaust ?? 0 });
      const raw = { ...bl, on: bl.on + 6 };
      const cut = { ...raw, coal: Math.max(0, raw.coal - extraCoalCutFor(s, flows.onFromCoalShare ?? MODEL_PARAMS.onFromCoalShare)) };
      expect(compute2pp(cut, flows), name).toBeGreaterThan(compute2pp(raw, flows));
    }
  });
});

describe("QLD existing ON-final seats", () => {
  it("reproduces the five LNP-vs-ON seats at zero swing", () => {
    const m = runState(STATES.qld, {});
    const onTcpSeats = m.filter((x) => x.tcp[0]?.party === "ON" || x.tcp[1]?.party === "ON");
    expect(onTcpSeats.length).toBeGreaterThanOrEqual(5);
    for (const x of onTcpSeats) {
      expect(x.modelled.changed, x.name).toBe(false);
    }
  });
});

describe("SA under an ON surge (highest-stakes state)", () => {
  it("reproduces Ngadjuri's ON win at zero swing", () => {
    const m = runState(STATES.sa, {});
    const ngadjuri = m.find((x) => x.name === "Ngadjuri");
    expect(ngadjuri).toBeTruthy();
    expect(ngadjuri.modelled.winnerGroup).toBe("one_nation");
    expect(ngadjuri.modelled.changed).toBe(false);
  });

  it("expands, never contracts, the ON-final set on an ON rise", () => {
    const base = runState(STATES.sa, {});
    const surged = runState(STATES.sa, { on: 5 });
    const onWinnerCount = (m) => m.filter((x) => x.modelled.winnerGroup === "one_nation").length;
    expect(onWinnerCount(surged)).toBeGreaterThanOrEqual(onWinnerCount(base));
    // Schubert-class lookup seats (ON base ~17-20) should reach an auto ON final
    // once the statewide ON primary pushes past the LP primary.
    expect(autoOnSeats(surged).length).toBeGreaterThan(0);
  });

  it("gives higher-base seats a larger ON estimate than low-base seats (logit)", () => {
    // Indirect check through detection: with a moderate surge, lookup seats with
    // high bases fire while low-base lookup seats do not all fire at once.
    const surged = runState(STATES.sa, { on: 3 });
    const auto = autoOnSeats(surged).map((x) => x.name);
    for (const name of auto) {
      const seat = SA_SEATS.find((x) => x.name === name);
      expect(SA_SEAT_ON_FP_2026[seat.id]).toBeGreaterThanOrEqual(10);
    }
  });
});
