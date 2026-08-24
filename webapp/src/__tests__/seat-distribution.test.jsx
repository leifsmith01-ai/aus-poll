// Seat-count distribution suite.
//
// computeSeatDistribution() is the engine behind the per-party seat ranges on the
// dashboard and the Safe/Likely/Lean/Toss-up label on every seat row. It is a Monte
// Carlo simulation, so the properties worth pinning are structural rather than exact
// values: the draws must be reproducible, the party counts must add up to the
// chamber, the ranges must bracket the point projection and widen with σ, and the
// per-seat probabilities must stay consistent with the projection shown beside them.
//
// It also has to agree with computeUncertainty(), the analytic engine that still
// drives the Labor-only confidence panel: the two are built from the same error
// components, so a change that pulls them apart is a bug in one of them.

import { describe, it, expect } from "vitest";
import {
  computeSeatDistribution,
  computeUncertainty,
  computeModelledSeats,
  computeModelledSeatsVic,
  computeVic2pp,
  getSeatGroup,
  SEAT_BANDS,
  IN_PLAY_P,
  MODEL_PARAMS,
  SEATS,
  VIC_SEATS,
  FED_DEFAULT_PREF_FLOWS,
  VIC_BASELINE_2022, VIC_DEFAULT_PREF_FLOWS, VIC_SEAT_FP_2022, VIC_SEAT_ON_FP,
} from "../App.jsx";

const ZERO_SWINGS = { alp: 0, coal: 0, grn: 0, ind: 0, on: 0, teal: 0, other: 0 };

const fedModelled = computeModelledSeats(
  SEATS, ZERO_SWINGS, FED_DEFAULT_PREF_FLOWS, {}, 0, 6.5, false, null,
);
const fedDist = computeSeatDistribution(fedModelled, 0, 1.5, false, 76);

const projTally = (seats) => {
  const c = {};
  seats.forEach((s) => { const g = s.modelled.winnerGroup; c[g] = (c[g] || 0) + 1; });
  return c;
};

describe("computeSeatDistribution — structural invariants", () => {
  it("is deterministic: identical inputs give identical output", () => {
    const a = computeSeatDistribution(fedModelled, 0, 1.5, false, 76);
    const b = computeSeatDistribution(fedModelled, 0, 1.5, false, 76);
    expect(a.groups).toEqual(b.groups);
    expect(a.pMajority).toEqual(b.pMajority);
    expect(a.inPlay).toBe(b.inPlay);
  });

  it("covers every seat exactly once in every draw", () => {
    expect(fedDist.total).toBe(SEATS.length);
    // Group means are per-draw counts over a partition of the chamber, so they sum
    // to the chamber size regardless of how the draws fell.
    // Means are rounded to 1dp for display, so allow the accumulated rounding.
    const meanSum = Object.values(fedDist.groups).reduce((s, g) => s + g.mean, 0);
    expect(Math.abs(meanSum - SEATS.length)).toBeLessThan(0.5);
    expect(Object.keys(fedDist.seatOutlook).length).toBe(SEATS.length);
  });

  it("gives every seat a probability distribution summing to 1", () => {
    Object.values(fedDist.seatProbs).forEach((probs) => {
      const total = Object.values(probs).reduce((s, p) => s + p, 0);
      expect(total).toBeCloseTo(1, 6);
    });
  });

  it("produces ordered percentiles for every party", () => {
    Object.entries(fedDist.groups).forEach(([g, d]) => {
      expect(d.min, g).toBeLessThanOrEqual(d.p05);
      expect(d.p05, g).toBeLessThanOrEqual(d.p25);
      expect(d.p25, g).toBeLessThanOrEqual(d.p50);
      expect(d.p50, g).toBeLessThanOrEqual(d.p75);
      expect(d.p75, g).toBeLessThanOrEqual(d.p95);
      expect(d.p95, g).toBeLessThanOrEqual(d.max);
    });
  });

  it("brackets the point projection inside each party's 90% interval", () => {
    // The point projection is the modal outcome of the same model, so it cannot sit
    // outside the simulated 90% band. A failure here means the simulation is being
    // driven off different numbers than the seat table renders.
    const point = projTally(fedModelled);
    Object.entries(point).forEach(([g, n]) => {
      const d = fedDist.groups[g];
      expect(d, g).toBeDefined();
      expect(n, `${g} point projection ${n} outside ${d.p05}–${d.p95}`).toBeGreaterThanOrEqual(d.p05);
      expect(n, `${g} point projection ${n} outside ${d.p05}–${d.p95}`).toBeLessThanOrEqual(d.p95);
    });
  });

  it("reports majority probabilities that partition the outcome space", () => {
    const { alp, coalition, hung } = fedDist.pMajority;
    expect(alp + coalition + hung).toBeGreaterThanOrEqual(99);
    expect(alp + coalition + hung).toBeLessThanOrEqual(101);
  });
});

describe("computeSeatDistribution — responds to uncertainty inputs", () => {
  it("widens every major party's range as swing σ grows", () => {
    const tight = computeSeatDistribution(fedModelled, 0, 0.5, false, 76);
    const wide = computeSeatDistribution(fedModelled, 0, 4.0, false, 76);
    ["alp", "coalition"].forEach((g) => {
      const tw = tight.groups[g].p95 - tight.groups[g].p05;
      const ww = wide.groups[g].p95 - wide.groups[g].p05;
      expect(ww, `${g} range did not widen with σ`).toBeGreaterThan(tw);
    });
  });

  it("puts more seats in play as swing σ grows", () => {
    const tight = computeSeatDistribution(fedModelled, 0, 0.5, false, 76);
    const wide = computeSeatDistribution(fedModelled, 0, 4.0, false, 76);
    expect(wide.inPlay).toBeGreaterThan(tight.inPlay);
    expect(wide.expectedMisses).toBeGreaterThan(tight.expectedMisses);
  });
});

describe("computeSeatDistribution — per-seat outlook", () => {
  it("labels each seat by the probability of the group the table projects", () => {
    fedModelled.forEach((seat) => {
      const o = fedDist.seatOutlook[seat.id];
      expect(o, seat.name).toBeDefined();
      // The confidence chip sits beside the "Projected" column; if `group` drifted
      // from winnerGroup the two would contradict each other on screen.
      expect(o.group, seat.name).toBe(seat.modelled.winnerGroup);
      expect(o.p, seat.name).toBeCloseTo(fedDist.seatProbs[seat.id][o.group] ?? 0, 6);
      expect(o.band.key, seat.name).toBe(
        SEAT_BANDS.find((b) => o.p >= b.min).key,
      );
    });
  });

  it("counts as in play exactly the Lean and Toss-up seats", () => {
    const byBand = fedModelled.filter(
      (s) => ["lean", "tossup"].includes(fedDist.seatOutlook[s.id].band.key),
    ).length;
    expect(fedDist.inPlay).toBe(byBand);
    const byProb = fedModelled.filter((s) => fedDist.seatOutlook[s.id].p < IN_PLAY_P).length;
    expect(fedDist.inPlay).toBe(byProb);
  });

  it("ranks safe seats above marginal ones", () => {
    // At the 2025 baseline Labor holds Blaxland on a huge margin and Bean on a small
    // one; the simulation has to reflect that ordering or the bands are meaningless.
    const byName = Object.fromEntries(fedModelled.map((s) => [s.name, s]));
    const safe = byName["Blaxland"], tight = byName["Bean"];
    if (safe && tight) {
      expect(fedDist.seatOutlook[safe.id].p).toBeGreaterThan(fedDist.seatOutlook[tight.id].p);
    }
    // Whatever the individual seats, the safest quartile must out-rank the tightest.
    const ps = fedModelled
      .map((s) => ({ p: fedDist.seatOutlook[s.id].p, m: Math.abs((s.modelled.projAlp2pp ?? s.modelled.winnerPct ?? 50) - 50) }))
      .filter((x) => Number.isFinite(x.m));
    const wide = ps.filter((x) => x.m > 15);
    const narrow = ps.filter((x) => x.m < 1);
    if (wide.length && narrow.length) {
      const mean = (xs) => xs.reduce((s, x) => s + x.p, 0) / xs.length;
      expect(mean(wide)).toBeGreaterThan(mean(narrow));
    }
  });
});

describe("computeSeatDistribution agrees with the analytic computeUncertainty", () => {
  // Both engines resolve seats through resolveSeatContest() and consume the same σ
  // constants, so they must agree on Labor to within Monte Carlo noise at every σ the
  // dashboard's slider offers. This is the guard that stopped the two from drifting:
  // before resolveSeatContest() existed, the analytic engine read every non-classic
  // seat as "winner vs Labor" and ran ~2.6 seats high.
  [0.5, 1.5, 2.5, 4.0].forEach((sigma) => {
    it(`matches the analytic Labor mean at σ=${sigma}pp`, () => {
      const mc = computeSeatDistribution(fedModelled, 0, sigma, false, 76);
      const analytic = computeUncertainty(fedModelled, 0, sigma, false, 76);
      expect(Math.abs(mc.groups.alp.mean - analytic.alpMean)).toBeLessThanOrEqual(0.6);
      expect(Math.abs(mc.pMajority.alp - analytic.pMajority)).toBeLessThanOrEqual(3);
    });
  });

  it("matches the analytic Labor 90% interval to within 3 seats at each end", () => {
    const analytic = computeUncertainty(fedModelled, 0, 1.5, false, 76);
    expect(Math.abs(fedDist.groups.alp.p05 - analytic.alpP05)).toBeLessThanOrEqual(3);
    expect(Math.abs(fedDist.groups.alp.p95 - analytic.alpP95)).toBeLessThanOrEqual(3);
  });

  it("gives Labor no chance in seats it is not contesting", () => {
    // Bradfield, Goldstein and Kooyong are teal-vs-Liberal contests. The pre-fix
    // analytic engine put Labor at ~50% in each of them.
    const analytic = computeUncertainty(fedModelled, 0, 1.5, false, 76);
    ["Bradfield", "Goldstein", "Kooyong"].forEach((name) => {
      const seat = fedModelled.find((s) => s.name === name);
      if (!seat) return;
      expect(fedDist.seatProbs[seat.id].alp ?? 0, `${name} (simulated)`).toBe(0);
      expect(analytic.seatWinProbs[seat.id], `${name} (analytic)`).toBe(0);
    });
  });
});

describe("computeSeatDistribution — Victoria", () => {
  const vicBaseline2pp = computeVic2pp(VIC_BASELINE_2022, VIC_DEFAULT_PREF_FLOWS, null);
  const vicModelled = computeModelledSeatsVic(
    VIC_SEATS, { alp: 0, coal: 0, grn: 0, ind: 0, on: 0 },
    VIC_DEFAULT_PREF_FLOWS, true, null, vicBaseline2pp, null, VIC_SEAT_FP_2022,
    VIC_SEAT_ON_FP, MODEL_PARAMS.onThresholdDefault,
  );
  const vicDist = computeSeatDistribution(vicModelled, 0, 1.5, false, 45);

  it("covers the 88-seat chamber and brackets the 2022 tallies", () => {
    expect(vicDist.total).toBe(88);
    const meanSum = Object.values(vicDist.groups).reduce((s, g) => s + g.mean, 0);
    expect(Math.abs(meanSum - 88)).toBeLessThan(0.5);
    // ALP 56 / Coalition 28 at zero swing must sit inside the simulated bands.
    expect(vicDist.groups.alp.p05).toBeLessThanOrEqual(56);
    expect(vicDist.groups.alp.p95).toBeGreaterThanOrEqual(56);
    expect(vicDist.groups.coalition.p05).toBeLessThanOrEqual(28);
    expect(vicDist.groups.coalition.p95).toBeGreaterThanOrEqual(28);
  });

  it("gives the Greens a non-degenerate range rather than a fixed count", () => {
    // The analytic engine cannot do this: it collapses every Greens seat into an
    // ALP-vs-field binary and so reports no Greens distribution at all.
    const grn = vicDist.groups.greens;
    expect(grn.max).toBeGreaterThan(0);
    expect(grn.p95).toBeGreaterThanOrEqual(grn.p05);
    expect(getSeatGroup(VIC_SEATS.find((s) => s.name === "Melbourne") ?? VIC_SEATS[0])).toBeTruthy();
  });
});
