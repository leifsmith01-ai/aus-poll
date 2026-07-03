// ── Live Results — confidence / uncertainty from partial counts ──────────────
// Produces per-seat win probabilities and a statewide seat-total distribution
// (ALP- and Coalition-centric) plus probability of majority, from a partial live count.
//
// Mirrors the grid-integration structure of App.jsx's computeUncertainty, but with a
// COUNT-DRIVEN sigma that shrinks to ~0 as a seat is fully counted, so projections
// converge to certainty at 100 % counted. It is jurisdiction-parameterized (majority,
// totalSeats, party groups) rather than hard-wired to the federal model.
//
// Pure (no React) — unit-testable headlessly.

// Standard normal CDF (Abramowitz & Stegun 26.2.17). Duplicated here to keep the module
// React/App-free.
function normCDF(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const pdf = Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
  const p = 1 - pdf * poly;
  return x >= 0 ? p : 1 - p;
}

// Sigma constants (pp) — CALIBRATED against the VIC 2022 booth-level count
// (scripts/calibrate_live_sigma.py, seed 20221126: progressive booth-order
// replay of VIC-2022-LA-2CP-Pollingplace.xlsx, late categories landing last).
// The empirical error of a partial count tracks the finite-population sampling
// shape sqrt((1-f)/f) almost exactly, so that replaced the old sqrt(1-f) term;
// the (1-f) term carries the district-specific early-booth vs postal/prepoll
// skew. The floor is a judgment call for recount/data-entry risk the replay
// cannot see. Statewide-COMMON skew (+1.34pp ordinary-booths-vs-final in 2022,
// cross-district spread 1.63pp) is deliberately excluded from per-seat sigma
// and covered by CORR_BASE ≈ |skew| + spread instead.
const SIGMA_FLOOR = 0.25;       // recount / check-count residual
const SAMPLE_SIGMA = 0.93;      // sqrt((1-f)/f): booth-sampling error of the remainder
const LATE_SWING_SIGMA = 0.33;  // (1-f): district-specific late-category skew
const F_MIN = 0.02;             // clamps the sampling term as f -> 0
const NON_ALP_COAL_FLOOR = 0.25;  // Greens/Independent finals (fitted separately —
const NON_ALP_COAL_SAMPLE = 0.6;  //  more booth heterogeneity, so the late/skew
const NON_ALP_COAL_LATE = 2.32;   //  term dominates their curve)
const CORR_BASE = 3.0;          // statewide correlated swing sigma at 0 % counted (→0 at 100 %)

// Per-seat winner-margin sigma, driven by how much of THIS seat is counted.
function seatSigma(f) {
  const r = Math.max(0, 1 - f);
  const sample = Math.sqrt(r / Math.max(f, F_MIN));
  return SIGMA_FLOOR + SAMPLE_SIGMA * sample + LATE_SWING_SIGMA * r;
}

function nonAlpCoalSigma(f) {
  const r = Math.max(0, 1 - f);
  const sample = Math.sqrt(r / Math.max(f, F_MIN));
  return NON_ALP_COAL_FLOOR + NON_ALP_COAL_SAMPLE * sample + NON_ALP_COAL_LATE * r;
}

// computeLiveConfidence(projectedSeats, cfg)
// cfg: { majority, totalSeats, groupOf(party)->group }
export function computeLiveConfidence(projected, cfg) {
  const majority = cfg.majority;
  const seats = projected || [];

  // Partition: standard ALP-vs-Coalition contests vs everything else (Greens/Ind/etc.).
  const alpCoal = [];
  const others = [];
  for (const s of seats) {
    const isAlpCoal = s.projAlp2pp != null &&
      s.pair.includes("ALP") && s.pair.some((p) => cfg.groupOf(p) === "coalition");
    (isAlpCoal ? alpCoal : others).push(s);
  }

  const meanCounted = seats.length
    ? seats.reduce((a, s) => a + (s.countedFraction || 0), 0) / seats.length
    : 0;

  // ── Per-seat probabilities (for the table) ─────────────────────────────────
  const seatWinProbs = {}; // P(projected winner holds)
  const alpWinProbs = {};  // P(ALP wins the seat)
  for (const s of alpCoal) {
    const sig = seatSigma(s.countedFraction);
    const pAlp = clamp01(normCDF((s.projAlp2pp - 50) / sig));
    alpWinProbs[s.seatId] = round3(pAlp);
    seatWinProbs[s.seatId] = round3(s.winnerGroup === "alp" ? pAlp : 1 - pAlp);
  }
  for (const s of others) {
    const sig = nonAlpCoalSigma(s.countedFraction);
    const pHold = clamp01(normCDF((s.leaderPct - 50) / sig));
    seatWinProbs[s.seatId] = round3(pHold);
    // ALP win prob for an "other" seat: pHold if ALP leads, (1-pHold) if ALP is runner-up.
    const runnerUp = s.pair[0] === s.winnerParty ? s.pair[1] : s.pair[0];
    if (s.winnerParty === "ALP") alpWinProbs[s.seatId] = round3(pHold);
    else if (runnerUp === "ALP") alpWinProbs[s.seatId] = round3(1 - pHold);
    else alpWinProbs[s.seatId] = 0;
  }

  // ── Statewide seat-total distribution via 1-D grid over a correlated swing shift ──
  // A correlated statewide swing (delta, pp added to every ALP-vs-Coalition seat's ALP
  // margin) captures the risk that the whole state breaks differently from the partial
  // count. Its sigma shrinks with overall count.
  // Correlated statewide-swing sigma decays linearly with the overall count: by the time
  // most of the state is counted the statewide position is well pinned, even if individual
  // marginal seats are not yet called.
  const corrStd = Math.max(1e-4, CORR_BASE * Math.max(0, 1 - meanCounted));
  const N = 81;
  const deltas = Array.from({ length: N }, (_, i) => corrStd * (-3 + (6 * i) / (N - 1)));
  const pdfs = deltas.map((d) => Math.exp(-0.5 * (d / corrStd) ** 2));
  const pdfTot = pdfs.reduce((a, b) => a + b, 0);

  // Expected "other"-seat contributions are independent of delta — precompute once.
  let otherAlp = 0, otherCoal = 0;
  const partyMeanSeats = { alp: 0, coalition: 0, greens: 0, ind: 0, other: 0 };
  for (const s of others) {
    const p = seatWinProbs[s.seatId];
    const winG = mapGroup(s.winnerGroup);
    const runnerUp = s.pair[0] === s.winnerParty ? s.pair[1] : s.pair[0];
    const loseG = mapGroup(cfg.groupOf(runnerUp));
    partyMeanSeats[winG] += p;
    partyMeanSeats[loseG] += 1 - p;
    otherAlp += alpWinProbs[s.seatId];
    otherCoal += s.winnerGroup === "coalition" ? p
      : (cfg.groupOf(runnerUp) === "coalition" ? 1 - p : 0);
  }

  const alpCdf = {};
  const coalCdf = {};
  deltas.forEach((delta, gi) => {
    const w = pdfs[gi] / pdfTot;
    let alpCount = otherAlp;
    let coalCount = otherCoal;
    for (const s of alpCoal) {
      const sig = seatSigma(s.countedFraction);
      const pAlp = clamp01(normCDF((s.projAlp2pp - 50 + delta) / sig));
      alpCount += pAlp;
      coalCount += 1 - pAlp;
    }
    bump(alpCdf, Math.round(alpCount), w);
    bump(coalCdf, Math.round(coalCount), w);
  });

  // ALP/Coalition mean seats from the grid (counts correlated swing correctly).
  partyMeanSeats.alp += expectedFromAlpCoal(alpCoal, "alp");
  partyMeanSeats.coalition += expectedFromAlpCoal(alpCoal, "coal");
  roundParty(partyMeanSeats);

  const alpDist = summarize(alpCdf);
  const coalDist = summarize(coalCdf);
  const pAlpMaj = tailProb(alpCdf, majority);
  const pCoalMaj = tailProb(coalCdf, majority);

  return {
    asOfCounted: +(meanCounted * 100).toFixed(1),
    seatWinProbs,
    alpWinProbs,
    partyMeanSeats,
    alp: alpDist,                       // { mean, std, p05, p25, p50, p75, p95 }
    coalition: coalDist,                // same shape, for the Coalition band
    seatTotalDist: distArray(alpCdf),   // [{ seats, prob }] for the ALP histogram
    coalSeatTotalDist: distArray(coalCdf),
    pMajority: {
      alp: Math.round(pAlpMaj * 100),
      coalition: Math.round(pCoalMaj * 100),
      hung: Math.round(Math.max(0, 1 - pAlpMaj - pCoalMaj) * 100),
    },
  };
}

// ── helpers ──────────────────────────────────────────────────────────────────
function expectedFromAlpCoal(alpCoal, which) {
  let n = 0;
  for (const s of alpCoal) {
    const sig = seatSigma(s.countedFraction);
    const pAlp = clamp01(normCDF((s.projAlp2pp - 50) / sig));
    n += which === "alp" ? pAlp : 1 - pAlp;
  }
  return n;
}

function mapGroup(g) {
  if (g === "alp") return "alp";
  if (g === "coalition") return "coalition";
  if (g === "greens") return "greens";
  if (g === "teal" || g === "ind") return "ind";
  return "other";
}

function bump(cdf, k, w) { cdf[k] = (cdf[k] || 0) + w; }

function distArray(cdf) {
  return Object.keys(cdf)
    .map(Number)
    .sort((a, b) => a - b)
    .map((seats) => ({ seats, prob: +(cdf[seats]).toFixed(4) }));
}

function summarize(cdf) {
  const keys = Object.keys(cdf).map(Number).sort((a, b) => a - b);
  let cum = 0;
  const cdfArr = keys.map((c) => { cum += cdf[c]; return { c, cum }; });
  const q = (p) => (cdfArr.find((x) => x.cum >= p) ?? cdfArr[cdfArr.length - 1]).c;
  const mean = keys.reduce((a, c) => a + c * cdf[c], 0);
  const varr = keys.reduce((a, c) => a + c * c * cdf[c], 0) - mean * mean;
  return {
    mean: +mean.toFixed(1),
    std: +Math.sqrt(Math.max(0, varr)).toFixed(1),
    p05: q(0.05), p25: q(0.25), p50: q(0.5), p75: q(0.75), p95: q(0.95),
  };
}

function tailProb(cdf, threshold) {
  return Object.keys(cdf).map(Number).filter((c) => c >= threshold)
    .reduce((a, c) => a + cdf[c], 0);
}

function roundParty(p) { for (const k in p) p[k] = Math.round(p[k] * 10) / 10; }
function clamp01(x) { return Math.min(1, Math.max(0, x)); }
function round3(x) { return Math.round(x * 1000) / 1000; }
