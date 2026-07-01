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
  it("is zero at zero or negative ON swing", () => {
    expect(extraCoalCutFor({ on: 0, coal: 0 }, 0.6)).toBe(0);
    expect(extraCoalCutFor({ on: -3, coal: 0 }, 0.6)).toBe(0);
  });

  it("cuts only the shortfall beyond an explicit Coalition swing", () => {
    expect(extraCoalCutFor({ on: 8, coal: 0 }, 0.6)).toBeCloseTo(4.8, 10);
    expect(extraCoalCutFor({ on: 8, coal: -3 }, 0.6)).toBeCloseTo(1.8, 10);
    expect(extraCoalCutFor({ on: 12, coal: -8 }, 0.6)).toBe(0);
  });

  it("raises statewide ALP 2PP versus the uncut distribution (ON no longer inflates the Coalition)", () => {
    const flows = VIC_DEFAULT_PREF_FLOWS;
    const onRise = 8;
    const uncut = computeVic2pp({ ...VIC_BASELINE_2022, on: VIC_BASELINE_2022.on + onRise }, flows, null);
    const cut = computeVic2pp({
      ...VIC_BASELINE_2022,
      coal: VIC_BASELINE_2022.coal - extraCoalCutFor({ on: onRise, coal: 0 }, flows.onFromCoalShare),
      on: VIC_BASELINE_2022.on + onRise,
    }, flows, null);
    expect(cut).toBeGreaterThan(uncut);
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

  it("does not increase the Coalition seat tally on an ON-only rise", () => {
    const base = tally(runVic(ZERO));
    const t = tally(runVic({ on: 8 }));
    expect(t.coalition ?? 0).toBeLessThanOrEqual(base.coalition);
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
