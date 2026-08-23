// VIC One Nation scenario suite.
//
// The VIC model historically mishandled high-ON scenarios in three ways:
//  1. no per-seat ON signal (VIC_SEAT_FP_2022 has on: 0.0 everywhere — ON ran no
//     LA candidates in 2022), so an ON swing spread uniformly across the state;
//  2. no Coalition-sourcing of ON rises, so a rising ON primary wrongly *inflated*
//     Coalition 2PP via ON's ~75% back-flow;
//  3. no per-seat ON-final detection — only the statewide vicOnTcp force toggle.
// These tests pin the fixed behaviour: zero-swing invariance with the ON machinery
// armed, the Coalition-sourcing direction, logit-scale swing distribution, and
// regional (not inner-metro) ON-final auto-detection under a genuine ON surge.

import { describe, it, expect } from "vitest";
import {
  computeModelledSeatsVic,
  computeVic2pp,
  logitShiftOnFp,
  extraCoalCutFor,
  getParty,
  MODEL_PARAMS,
  VIC_SEATS,
  VIC_BASELINE_2022,
  VIC_DEFAULT_PREF_FLOWS,
  VIC_SEAT_FP_2022,
  VIC_SEAT_ON_FP,
} from "../App.jsx";

const ZERO = { alp: 0, coal: 0, grn: 0, ind: 0, on: 0 };
const BASELINE_2PP = computeVic2pp(VIC_BASELINE_2022, VIC_DEFAULT_PREF_FLOWS, null);

function runVic(swings, { onTcp = null, overrides = null } = {}) {
  return computeModelledSeatsVic(
    VIC_SEATS, { ...ZERO, ...swings },
    VIC_DEFAULT_PREF_FLOWS, true, onTcp, BASELINE_2PP, overrides, VIC_SEAT_FP_2022,
    VIC_SEAT_ON_FP, MODEL_PARAMS.onThresholdDefault,
  );
}

const tally = (seats) => {
  const c = {};
  seats.forEach((s) => { const g = s.modelled.winnerGroup; c[g] = (c[g] || 0) + 1; });
  return c;
};
const seatByName = (seats, name) => seats.find((s) => s.name === name);

describe("VIC_SEAT_ON_FP propensity prior shape", () => {
  it("covers all 88 districts with finite values in [0, 60]", () => {
    expect(Object.keys(VIC_SEAT_ON_FP).length).toBe(88);
    expect(VIC_SEATS.every((s) => VIC_SEAT_ON_FP[s.id] != null)).toBe(true);
    for (const v of Object.values(VIC_SEAT_ON_FP)) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(60);
    }
  });

  it("has a seat mean matching the statewide ON baseline (1.3 ± 0.3)", () => {
    const vals = Object.values(VIC_SEAT_ON_FP);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    expect(Math.abs(mean - VIC_BASELINE_2022.on)).toBeLessThanOrEqual(0.3);
  });

  it("concentrates ON in regional Victoria over the inner city", () => {
    const byName = Object.fromEntries(VIC_SEATS.map((s) => [s.name, VIC_SEAT_ON_FP[s.id]]));
    for (const regional of ["Morwell", "Mildura", "Gippsland East", "Shepparton"]) {
      for (const metro of ["Brunswick", "Melbourne", "Kew", "Albert Park"]) {
        expect(byName[regional]).toBeGreaterThan(byName[metro]);
      }
    }
  });
});

describe("logitShiftOnFp", () => {
  it("returns the seat base exactly at zero swing", () => {
    expect(logitShiftOnFp(3.3, 1.3, 0)).toBe(3.3);
    expect(logitShiftOnFp(0.2, 1.3, 0)).toBe(0.2);
  });

  it("gives high-base seats a larger pp gain than low-base seats for the same swing", () => {
    const hi = logitShiftOnFp(3.3, 1.3, 8) - 3.3;
    const lo = logitShiftOnFp(0.4, 1.3, 8) - 0.4;
    expect(hi).toBeGreaterThan(lo);
    expect(lo).toBeGreaterThan(0);
    // Low-base seats must not absorb the full statewide swing linearly.
    expect(lo).toBeLessThan(8);
  });

  it("stays finite for degenerate bases and extreme swings", () => {
    expect(Number.isFinite(logitShiftOnFp(0, 1.3, 50))).toBe(true);
    expect(Number.isFinite(logitShiftOnFp(60, 1.3, 50))).toBe(true);
    expect(Number.isFinite(logitShiftOnFp(3.3, 1.3, -10))).toBe(true);
  });
});

describe("Coalition-sourcing of ON rises (extraCoalCutFor)", () => {
  // The cut answers "where did the extra ON vote come from?" — and only for the part
  // the entered primaries have not already answered. Charging the Coalition for a rise
  // the vector already sources double-counts it and moves ex-Coalition vote into the
  // residual "other" pool, which preferences far more favourably to Labor. See the
  // "tracks the pollsters' own published 2PP" suite for the empirical case.
  const withOn = (on, over = {}) => ({ ...VIC_BASELINE_2022, on, ...over });
  const share = 0.6;

  it("is zero at zero or negative ON swing", () => {
    expect(extraCoalCutFor(VIC_BASELINE_2022, VIC_BASELINE_2022, share)).toBe(0);
    expect(extraCoalCutFor(VIC_BASELINE_2022, withOn(VIC_BASELINE_2022.on - 3), share)).toBe(0);
  });

  it("is zero while the residual 'other' pool can supply the whole rise", () => {
    // VIC 2022 leaves 11.8pp in "other" (right-wing micros, mostly). An ON rise of 8
    // inside that is fully sourced — the Coalition primary is not implicated.
    expect(extraCoalCutFor(VIC_BASELINE_2022, withOn(VIC_BASELINE_2022.on + 8), share)).toBe(0);
  });

  it("charges the Coalition once the rise outgrows every other source", () => {
    // ON +20.5 with nothing else moved: "other" can only supply its 11.8, leaving
    // 8.7 unsourced, of which onFromCoalShare is taken off the Coalition.
    const cut = extraCoalCutFor(VIC_BASELINE_2022, withOn(VIC_BASELINE_2022.on + 20.5), share);
    expect(cut).toBeCloseTo(share * 8.7, 6);
  });

  it("is zero when the entered primaries already state where the rise came from", () => {
    // The Aug 2026 VIC polling shape: ALP and the Coalition both down, "other"
    // collapsed into ON. Every point of the rise is accounted for, so cutting the
    // Coalition below the figure the poll reports would be inventing a decline.
    const polled = { alp: 25.4, coal: 28.7, grn: 13.1, ind: 9.4, on: 21.8 };
    expect(extraCoalCutFor(VIC_BASELINE_2022, polled, share)).toBe(0);
  });

  it("never cuts the Coalition primary below zero", () => {
    const collapsed = { alp: 20, coal: 2, grn: 10, ind: 5, on: 45 };
    const cut = extraCoalCutFor(VIC_BASELINE_2022, collapsed, share);
    expect(cut).toBeLessThanOrEqual(collapsed.coal);
    expect(cut).toBeGreaterThanOrEqual(0);
  });

  it("lowers ALP 2PP when it fires (the cut moves Coalition vote into 'other')", () => {
    const flows = VIC_DEFAULT_PREF_FLOWS;
    const raw = { ...VIC_BASELINE_2022, on: VIC_BASELINE_2022.on + 20.5 };
    const cut = { ...raw, coal: raw.coal - extraCoalCutFor(VIC_BASELINE_2022, raw, flows.onFromCoalShare) };
    // "other" preferences to ALP (43%) more strongly than ON does (25%), so sourcing
    // the rise from the Coalition is a pro-ALP adjustment. That is exactly why it must
    // only fire on genuinely unsourced mass.
    expect(computeVic2pp(cut, flows, null)).toBeGreaterThan(computeVic2pp(raw, flows, null));
  });
});

describe("VIC model zero-swing invariance with the ON machinery armed", () => {
  const modelled = runVic(ZERO);

  it("flips no seat and flags no ON race", () => {
    expect(modelled.filter((s) => s.modelled.changed)).toEqual([]);
    expect(modelled.filter((s) => s.modelled.isOnRace)).toEqual([]);
  });

  it("reproduces the 2022 tallies", () => {
    const t = tally(modelled);
    expect(t.alp).toBe(56);
    expect(t.coalition).toBe(28);
    expect(t.greens).toBe(4);
  });
});

describe("VIC model under a rising ON primary", () => {
  it("does nothing new on a negative ON swing", () => {
    const modelled = runVic({ on: -1 });
    expect(modelled.filter((s) => s.modelled.isOnRace)).toEqual([]);
  });

  it("does not increase the Coalition seat tally when the ON rise comes off the Coalition", () => {
    // The scenario that actually matters: ON up, Coalition down by the same order.
    // A rising ON vote fed by Coalition defection must never hand the Coalition seats.
    const base = tally(runVic(ZERO));
    const t = tally(runVic({ on: 8, coal: -6 }));
    expect(t.coalition ?? 0).toBeLessThanOrEqual(base.coalition);
  });

  it("lets the Coalition gain slightly when ON grows purely out of the minor-party pool", () => {
    // ON +8 with nothing else moved means the vote came from the residual micro-party
    // bucket, which preferences 57% to the Coalition against ON's 75%. The Coalition
    // genuinely gains a little. Suppressing that with an unconditional Coalition
    // haircut is what put a ~5pp pro-Labor bias into the ON-era projections.
    const base = tally(runVic(ZERO));
    const t = tally(runVic({ on: 8 }));
    expect(t.coalition ?? 0).toBeGreaterThanOrEqual(base.coalition);
    expect((t.coalition ?? 0) - base.coalition).toBeLessThanOrEqual(6);
  });

  it("auto-detects regional ON finals under a genuine ON surge, but not inner-metro ones", () => {
    // Statewide ON ≈ 13.3 with the right fracturing (Coalition −8, ALP −2) —
    // roughly the SA March 2026 shape transplanted to VIC.
    const modelled = runVic({ on: 12, coal: -8, alp: -2 });
    const onRaces = modelled.filter((s) => s.modelled.isOnRace);
    expect(onRaces.length).toBeGreaterThan(0);
    for (const s of onRaces) {
      expect(s.modelled.isAutoMatchup).toBe(true);
      expect(["on_v_alp", "on_v_coal"]).toContain(s.modelled.activeTcpMatchup);
      expect(Number.isFinite(s.modelled.winnerPct)).toBe(true);
    }
    const regionalNames = ["Morwell", "Mildura", "Gippsland East", "Gippsland South"];
    expect(onRaces.some((s) => regionalNames.includes(s.name))).toBe(true);
    for (const name of ["Albert Park", "Kew", "Hawthorn", "Brunswick", "Melbourne"]) {
      expect(seatByName(modelled, name).modelled.isOnRace).toBeUndefined();
    }
  });

  it("keeps every projection finite under an extreme surge", () => {
    const modelled = runVic({ on: 20, coal: -12, alp: -4 });
    for (const s of modelled) {
      expect(s.modelled.winnerGroup, s.name).toBeTruthy();
      if (s.modelled.winnerPct != null) expect(Number.isFinite(s.modelled.winnerPct), s.name).toBe(true);
      if (s.modelled.projAlp2pp != null) expect(Number.isFinite(s.modelled.projAlp2pp), s.name).toBe(true);
    }
  });

  it("suppresses per-seat auto-detection when a statewide ON final is forced", () => {
    const modelled = runVic({ on: 12, coal: -8, alp: -2 }, { onTcp: "on_v_coal" });
    expect(modelled.filter((s) => s.modelled.isOnRace)).toEqual([]);
  });
});
