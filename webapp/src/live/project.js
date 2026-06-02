// ── Live Results — projection engine ─────────────────────────────────────────
// Projects each seat's final two-candidate-preferred (2CP) result from the partial
// live count by measuring the swing against a prior-election baseline.
//
// Granularity is chosen per seat from whatever data is available:
//   • "booth"    — booth-matched swing: mean swing across *counted* booths (turnout
//                  weighted) applied to the full-electorate baseline. Corrects for which
//                  booths have reported. Requires feed.meta.boothLevel + baseline booths.
//   • "district" — district swing: the seat's current 2CP carried forward (uniform-swing
//                  assumption). Used for VIC 2026 (VEC publishes district-level only).
//   • "none"     — no baseline match: live shares projected flat.
//
// The engine is pure (no React) so it can be unit-tested headlessly.

import { tcpLeader, normalizeFp } from "./contract.js";

// project a feed into an array of ProjectedSeat (see shape at end of file).
// cfg: { prefFlows, coalitionParties:Set, groupOf(party)->group,
//        calledMargin, likelyMargin }
export function projectSeats(feed, baseline, cfg) {
  if (!feed || !Array.isArray(feed.seats)) return [];
  const baseSeats = baseline?.seats || {};
  return feed.seats.map((seat) => projectSeat(seat, baseSeats[seat.seatId], feed.meta, cfg));
}

function projectSeat(seat, base, meta, cfg) {
  const countedFraction = clamp01((seat.countedPct ?? 0) / 100);
  const fp = normalizeFp(seat.fp);

  // The contest pair we project onto: prefer the EC's published live pair, fall back to the
  // baseline pair, then to the top two first-preference parties.
  const pair = pickPair(seat, base, fp);
  // Orientation party: project the 2CP relative to a single fixed party so swings are signed
  // consistently. Prefer ALP if present (lets us emit a 2PP), else the baseline leader / pair[0].
  const refParty = pair.includes("ALP") ? "ALP" : (base?.tcp?.pair?.[0] ?? pair[0]);
  const otherParty = pair[0] === refParty ? pair[1] : pair[0];

  const liveRef = liveRefPct(seat, fp, pair, refParty, cfg); // live 2CP % for refParty (or null)
  const baseRef = baselineRefPct(base, refParty);            // baseline 2CP % for refParty (or null)

  let granularity = "none";
  let projRef = liveRef ?? baseRef ?? 50;
  let projFp = fpShares(fp);

  if (meta?.boothLevel && Array.isArray(seat.booths) && seat.booths.length && base?.booths) {
    const booth = boothMatchedSwing(seat.booths, base.booths, base, refParty, cfg);
    if (booth) {
      granularity = "booth";
      projRef = clampPct(booth.projRef);
      if (booth.projFp) projFp = booth.projFp;
    }
  }
  if (granularity === "none" && base && liveRef != null) {
    // District swing: carry the current 2CP forward (uniform-swing assumption).
    granularity = "district";
    projRef = clampPct(liveRef);
  }

  const winnerParty = projRef >= 50 ? refParty : otherParty;
  const winnerGroup = cfg.groupOf(winnerParty);
  const leaderPct = Math.max(projRef, 100 - projRef);
  const margin2cp = Math.abs(2 * projRef - 100);          // pp gap between the two contesters
  const projAlp2pp = pair.includes("ALP")
    ? (refParty === "ALP" ? projRef : 100 - projRef)
    : null;
  const baselineLeaderParty = base?.tcp?.pair?.[0] ?? null;
  const baselineWinnerGroup = baselineLeaderParty ? cfg.groupOf(baselineLeaderParty) : winnerGroup;

  const swing2cp = baseRef != null ? +(projRef - baseRef).toFixed(2) : null;
  const status = classify(seat, countedFraction, margin2cp, cfg);

  return {
    seatId: seat.seatId,
    name: seat.name,
    region: seat.region,
    countedPct: seat.countedPct ?? 0,
    countedFraction,
    lastUpdated: seat.lastUpdated,
    granularity,
    pair,
    refParty,
    projRef: +projRef.toFixed(2),       // refParty projected 2CP %
    projAlp2pp: projAlp2pp == null ? null : +projAlp2pp.toFixed(2),
    projFp,
    winnerParty,
    winnerGroup,
    leaderPct: +leaderPct.toFixed(2),
    margin: +margin2cp.toFixed(2),      // projected final 2CP margin (pp)
    swing2cp,
    changed: winnerGroup !== baselineWinnerGroup,
    status,
    observedTcpPct: liveRef == null ? null : +liveRef.toFixed(2),
    fp,
  };
}

// ── helpers ──────────────────────────────────────────────────────────────────

function pickPair(seat, base, fp) {
  if (seat.tcp?.pair?.length === 2) return seat.tcp.pair;
  if (base?.tcp?.pair?.length === 2) return base.tcp.pair;
  if (fp.length >= 2) return [fp[0].party, fp[1].party];
  return [fp[0]?.party ?? "ALP", "LP"];
}

// Live 2CP % for refParty: use the published 2CP when present, else estimate from live
// first preferences via preference flows (ALP-vs-Coalition only — otherwise fall back).
function liveRefPct(seat, fp, pair, refParty, cfg) {
  const led = tcpLeader(seat.tcp);
  if (led) {
    const pct = seat.tcp.pct;
    if (pct?.[refParty] != null) return Number(pct[refParty]);
    return refParty === led.leader ? led.leaderPct : 100 - led.leaderPct;
  }
  // No published 2CP yet — estimate from FP if this is a standard ALP/Coalition contest.
  const isAlpCoal = pair.includes("ALP") && pair.some((p) => cfg.coalitionParties.has(p));
  if (!isAlpCoal || !fp.length) return null;
  const est = estimate2ppFromFp(fp, cfg);
  if (est == null) return null;
  return refParty === "ALP" ? est : 100 - est;
}

// Rough ALP 2PP from first preferences using national-style preference flows.
function estimate2ppFromFp(fp, cfg) {
  const f = cfg.prefFlows || {};
  let a = 0, c = 0, tot = 0;
  for (const r of fp) {
    const v = r.pct ?? 0;
    tot += v;
    const g = cfg.groupOf(r.party);
    if (g === "alp") a += v;
    else if (g === "coalition") c += v;
    else if (g === "greens") { a += v * (f.grn_alp ?? 0.8); c += v * (1 - (f.grn_alp ?? 0.8)); }
    else if (g === "one_nation") { a += v * (f.on_alp ?? 0.35); c += v * (1 - (f.on_alp ?? 0.35)); }
    else { a += v * (f.other_alp ?? 0.5); c += v * (1 - (f.other_alp ?? 0.5)); }
  }
  if (a + c <= 0 || tot <= 0) return null;
  return (a / (a + c)) * 100;
}

function baselineRefPct(base, refParty) {
  const pct = base?.tcp?.pct;
  if (pct && pct[refParty] != null) return Number(pct[refParty]);
  return null;
}

// Booth-matched swing (federal-style feeds). Mean swing across counted booths, turnout
// weighted by the booth's baseline votes, applied to the full-electorate baseline 2CP.
function boothMatchedSwing(liveBooths, baseBooths, base, refParty, cfg) {
  const baseById = {};
  for (const b of baseBooths) baseById[b.boothId] = b;
  let wsum = 0, swingSum = 0;
  for (const lb of liveBooths) {
    if ((lb.countedPct ?? 0) <= 0) continue;
    const bb = baseById[lb.boothId];
    const liveLed = tcpLeader(lb.tcp);
    if (!bb || !liveLed) continue;
    const liveRef = lb.tcp.pct?.[refParty];
    const baseRef = bb.tcp?.pct?.[refParty];
    if (liveRef == null || baseRef == null) continue;
    const w = bb.totalVotes || lb.totalVotes || 1;
    wsum += w;
    swingSum += w * (Number(liveRef) - Number(baseRef));
  }
  if (wsum <= 0) return null;
  const meanSwing = swingSum / wsum;
  const baseRefFull = baselineRefPct(base, refParty);
  if (baseRefFull == null) return null;
  return { projRef: baseRefFull + meanSwing, projFp: null };
}

function fpShares(fp) {
  const out = {};
  for (const r of fp) out[r.party] = r.pct ?? 0;
  return out;
}

function classify(seat, f, margin2cp, cfg) {
  if (seat.status === "ec_called") return "called";
  if (seat.status === "not_started" || f <= 0) return "not_started";
  const called = cfg.calledMargin ?? 8;
  const likely = cfg.likelyMargin ?? 4;
  if (f >= 0.85 && margin2cp >= called) return "called";
  if (f >= 0.5 && margin2cp >= called) return "likely";
  if (margin2cp >= likely) return "likely";
  return "in_doubt";
}

function clamp01(x) { return Math.min(1, Math.max(0, x)); }
function clampPct(x) { return Math.min(100, Math.max(0, Number(x) || 0)); }

// ProjectedSeat shape:
//   { seatId, name, region, countedPct, countedFraction, granularity, pair, refParty,
//     projRef, projAlp2pp, projFp, winnerParty, winnerGroup, leaderPct, margin, swing2cp,
//     changed, status, observedTcpPct, fp }
