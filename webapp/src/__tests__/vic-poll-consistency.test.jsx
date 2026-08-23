// VIC poll-consistency regression suite.
//
// The zero-swing suites prove the model reproduces the 2022 election. They cannot
// catch the failure mode this suite exists for: a model that is exactly right at
// the baseline and drifts away from the published polls as the scenario moves.
//
// That is what happened through the 2026 One Nation surge. The Coalition-sourcing
// mechanism (extraCoalCutFor) took 0.6 x ON's rise off the Coalition primary even
// when the primaries came straight from a poll that already reported the Coalition
// and the minor-party residual. On the August 2026 poll average that cut 9.9pp off
// a polled Coalition primary of 28.7, landing the mass in the residual "other" pool
// — which preferences 43% to ALP against ON's 25%. The seat engine ran on an ALP 2PP
// of 52.6 while the pollsters published ~47 and the dashboard's own headline card
// showed 48.3, projecting an ALP majority off polling that implies the opposite.
//
// These tests pin the model to external ground truth: the pollsters' own published
// two-party figures, computed by them from the same primaries the model is given.

import { describe, it, expect } from "vitest";
import VIC_STATE_POLLS from "../data/vic_polls.json";
import {
  computeModelledSeatsVic,
  computeVic2pp,
  extraCoalCutFor,
  normalizeStatePoll,
  statePollAverage,
  MODEL_PARAMS,
  VIC_SEATS,
  VIC_BASELINE_2022,
  VIC_DEFAULT_PREF_FLOWS,
  VIC_SEAT_FP_2022,
  VIC_SEAT_ON_FP,
} from "../App.jsx";

const FLOWS = VIC_DEFAULT_PREF_FLOWS;

// Mirrors the "Apply latest polls" button in the VIC scenario builder.
const polls = (VIC_STATE_POLLS?.polls ?? [])
  .map((p) => normalizeStatePoll(p, ["lp"]))
  .filter(Boolean)
  .sort((a, b) => new Date(b.date) - new Date(a.date));
const pollAvg = statePollAverage(polls);

const applied = {
  alp: pollAvg.alp,
  coal: pollAvg.coal,
  grn: pollAvg.grn ?? VIC_BASELINE_2022.grn,
  ind: pollAvg.ind ?? VIC_BASELINE_2022.ind,
  on: pollAvg.on ?? VIC_BASELINE_2022.on,
};

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe("VIC preference flows track the pollsters' own published 2PP", () => {
  const withTpp = polls.filter((p) => p.tpp != null);

  it("has enough published-2PP polls to be a meaningful check", () => {
    expect(withTpp.length).toBeGreaterThanOrEqual(20);
  });

  it("shows no systematic lean against the published figures", () => {
    const errs = withTpp.map((p) =>
      computeVic2pp({ alp: p.alp, coal: p.coal, grn: p.grn, ind: p.ind ?? 0, on: p.on ?? 0 }, FLOWS, null) - p.tpp);
    // Mean signed error is the bias; MAE is the spread across houses. A drift here
    // means the default flow set has come adrift from what pollsters actually apply.
    expect(Math.abs(mean(errs))).toBeLessThanOrEqual(1.5);
    expect(mean(errs.map(Math.abs))).toBeLessThanOrEqual(2.5);
  });

  it("shows no lean specific to the high-One-Nation polls", () => {
    // The regression that motivated this suite only appeared once ON was polling
    // in the twenties, so the ON-era subset is checked on its own.
    const onEra = withTpp.filter((p) => (p.on ?? 0) >= 10);
    expect(onEra.length).toBeGreaterThanOrEqual(10);
    const errs = onEra.map((p) =>
      computeVic2pp({ alp: p.alp, coal: p.coal, grn: p.grn, ind: p.ind ?? 0, on: p.on ?? 0 }, FLOWS, null) - p.tpp);
    expect(Math.abs(mean(errs))).toBeLessThanOrEqual(1.5);
  });
});

describe("VIC seat engine agrees with the primaries it was given", () => {
  const swings = {
    alp: +(applied.alp - VIC_BASELINE_2022.alp).toFixed(2),
    coal: +(applied.coal - VIC_BASELINE_2022.coal).toFixed(2),
    grn: +(applied.grn - VIC_BASELINE_2022.grn).toFixed(2),
    ind: +(applied.ind - VIC_BASELINE_2022.ind).toFixed(2),
    on: +(applied.on - VIC_BASELINE_2022.on).toFixed(2),
  };
  const baseline2pp = computeVic2pp(VIC_BASELINE_2022, FLOWS, null);
  const modelled = computeModelledSeatsVic(
    VIC_SEATS, swings, FLOWS, true, null, baseline2pp, null,
    VIC_SEAT_FP_2022, VIC_SEAT_ON_FP, MODEL_PARAMS.onThresholdDefault,
  );

  // The 2PP the seat engine internally swings on: it rebuilds the statewide primaries
  // from the same swings, applying the Coalition-sourcing cut. With the poll vector
  // fully specified the cut must be zero, so this has to match the headline card.
  const headline2pp = computeVic2pp(applied, FLOWS, null);

  it("does not re-cut a Coalition primary the poll already reported", () => {
    // Rebuild exactly what computeModelledSeatsVic does internally, cut included.
    const swung = {
      alp: Math.max(0, VIC_BASELINE_2022.alp + swings.alp),
      coal: Math.max(0, VIC_BASELINE_2022.coal + swings.coal),
      grn: Math.max(0, VIC_BASELINE_2022.grn + swings.grn),
      ind: Math.max(0, VIC_BASELINE_2022.ind + swings.ind),
      on: Math.max(0, VIC_BASELINE_2022.on + swings.on),
    };
    const cut = extraCoalCutFor(VIC_BASELINE_2022, swung, FLOWS.onFromCoalShare);
    expect(cut).toBe(0);
    const seatEngine2pp = computeVic2pp({ ...swung, coal: swung.coal - cut }, FLOWS, null);
    // The number the seats move on and the number on the headline card must agree.
    expect(Math.abs(seatEngine2pp - headline2pp)).toBeLessThanOrEqual(0.05);
  });

  it("lands within 2.5pp of the pollsters' recency-weighted published 2PP", () => {
    const t0 = Math.max(...polls.filter((p) => p.tpp != null).map((p) => new Date(p.date).getTime()));
    let num = 0, den = 0;
    for (const p of polls) {
      if (p.tpp == null) continue;
      const w = Math.pow(0.5, (t0 - new Date(p.date).getTime()) / 86400000 / 60);
      num += w * p.tpp; den += w;
    }
    expect(Math.abs(headline2pp - num / den)).toBeLessThanOrEqual(2.5);
  });

  it("does not project an ALP majority off sub-50 polling", () => {
    // The headline symptom of the old bias: ALP 25% primary and a sub-50 published
    // 2PP still produced 46 of 88 seats and an "ALP majority" call.
    expect(headline2pp).toBeLessThan(50);
    const alpSeats = modelled.filter((s) => s.modelled.winnerGroup === "alp").length;
    expect(alpSeats).toBeLessThan(45);
  });

  it("keeps most seats on an ALP-vs-Coalition final rather than an ON final", () => {
    // With the dispersion prior unshrunk, a 22% statewide ON projected up to 42% in
    // a single district and threw a majority of the chamber into ON finals, leaving
    // the "Avg seat 2PP" card averaging a small, non-random subset.
    const onFinals = modelled.filter((s) => s.modelled.isOnRace).length;
    expect(onFinals).toBeLessThan(VIC_SEATS.length / 2);
    const with2pp = modelled.filter((s) => Number.isFinite(s.modelled.projAlp2pp)).length;
    expect(with2pp).toBeGreaterThanOrEqual(VIC_SEATS.length / 2);
  });

  it("keeps every projection finite", () => {
    for (const s of modelled) {
      expect(s.modelled.winnerGroup, s.name).toBeTruthy();
      if (s.modelled.winnerPct != null) expect(Number.isFinite(s.modelled.winnerPct), s.name).toBe(true);
      if (s.modelled.projAlp2pp != null) expect(Number.isFinite(s.modelled.projAlp2pp), s.name).toBe(true);
    }
  });
});
