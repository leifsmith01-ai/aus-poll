// ── Live Results — projection engine ─────────────────────────────────────────
// Projects each seat's final two-candidate-preferred (2CP) result from the partial
// live count by measuring the swing against a prior-election baseline.
//
// Granularity is chosen per seat from whatever data is available:
//   • "booth"    — booth-matched swing (VIC 2026): tonight's votes are compared only with
//                  the SAME booths' 2022 votes (seat.matched, built by the feed reader),
//                  and that swing is applied to the full 2022 district result. Corrects
//                  for which booths have reported. The 2CP then comes from tonight's
//                  observed preference flows applied to those projected first preferences.
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
  const out = feed.seats.map((seat) => projectSeat(seat, baseSeats[seat.seatId], feed.meta, cfg));
  // A feed that omits districts must not shrink the chamber: carry every missing
  // baseline seat as "not started" (held at its 2022 result) so totals stay out of 88.
  const seen = new Set(feed.seats.map((s) => s.seatId));
  for (const [seatId, base] of Object.entries(baseSeats)) {
    if (seen.has(seatId)) continue;
    const stub = { seatId, name: base.name, region: base.region, countedPct: 0, fp: [], tcp: null,
      status: "not_started", lastUpdated: null };
    out.push({ ...projectSeat(stub, base, feed.meta, cfg), missingFromFeed: true });
  }
  applyStatewideSwing(out, baseSeats, cfg);
  return out;
}

// Seats with nothing usable counted yet should not sit on their 2022 result once the rest
// of the state has shown its hand. Take the average swing in the Labor-v-Coalition seats
// that DO have a live estimate (weighted by how much each has counted), shrink it while
// the evidence is thin, and apply it to the Labor-v-Coalition seats still on the baseline.
// The polls are deliberately NOT used here: the Live tab compares against them.
const SWING_SHRINK_K = 2;   // "seats' worth" of counting at which the swing is half-trusted

// Average Labor 2PP swing since the baseline election in the Labor-v-Coalition seats that
// have a live estimate, weighted by how much each has counted. -> { swing, seats, weight }
// (swing is null until something usable is counted). This is the night's headline signal
// and is what the Live tab sets against the swing the polls implied.
export function observedSwing(seats, baseSeats, cfg) {
  const isCoal = (p) => cfg.groupOf(p) === "coalition";
  let w = 0, sw = 0, n = 0;
  for (const s of seats) {
    const b = baseSeats?.[s.seatId];
    if (s.basis === "baseline" || s.basis === "swing" || s.projAlp2pp == null) continue;
    if (!classicBase(b, isCoal) || !s.pair.some(isCoal) || !(s.countedFraction > 0)) continue;
    n += 1;
    w += s.countedFraction;
    sw += s.countedFraction * (s.projAlp2pp - Number(b.tcp.pct.ALP));
  }
  return { swing: w > 0 ? sw / w : null, seats: n, weight: w };
}

function classicBase(b, isCoal) {
  return !!(b?.tcp?.pair?.includes("ALP") && b.tcp.pair.some(isCoal) && b.tcp.pct?.ALP != null);
}

function applyStatewideSwing(seats, baseSeats, cfg) {
  const isCoal = (p) => cfg.groupOf(p) === "coalition";
  const obs = observedSwing(seats, baseSeats, cfg);
  if (obs.swing == null) return;
  const w = obs.weight;
  const swing = obs.swing * (w / (w + SWING_SHRINK_K));
  for (const s of seats) {
    const b = baseSeats[s.seatId];
    if (s.basis !== "baseline" || !classicBase(b, isCoal) || s.tcpState === "published") continue;
    const alp = clampPct(Number(b.tcp.pct.ALP) + swing);
    const other = b.tcp.pair.find((p) => p !== "ALP");
    s.pair = ["ALP", other];
    s.refParty = "ALP";
    s.projRef = +alp.toFixed(2);
    s.projAlp2pp = s.projRef;
    s.winnerParty = alp >= 50 ? "ALP" : other;
    s.winnerGroup = cfg.groupOf(s.winnerParty);
    s.leaderPct = +Math.max(alp, 100 - alp).toFixed(2);
    s.margin = +Math.abs(2 * alp - 100).toFixed(2);
    s.swing2cp = +swing.toFixed(2);
    s.changed = s.winnerGroup !== cfg.groupOf(b.winnerParty ?? b.tcp.pair[0]);
    s.basis = "swing";
  }
}

// ── Booth-matched projection ─────────────────────────────────────────────────
const LIVE_GROUPS = ["alp", "coalition", "greens", "one_nation", "ind", "other"];

// Projected final first-preference % by party group: full 2022 result + the swing seen in
// the booths counted so far (same booths, then vs now). Clamped at zero and rescaled to 100.
export function matchedGroupShares(matched) {
  if (!matched || !(matched.formal > 0)) return null;
  const out = {};
  let tot = 0;
  for (const g of LIVE_GROUPS) {
    const swing = (100 * ((matched.now?.[g] || 0) - (matched.then?.[g] || 0))) / matched.formal;
    out[g] = Math.max(0, (matched.base?.[g] || 0) + swing);
    tot += out[g];
  }
  if (tot <= 0) return null;
  for (const g of LIVE_GROUPS) out[g] = (out[g] / tot) * 100;
  return out;
}

// Split each group's projected share between its candidates in proportion to tonight's votes.
function matchedPartyShares(fp, groupShares, cfg) {
  const groupVotes = {}, groupRows = {};
  for (const r of fp) {
    const g = liveGroup(cfg.groupOf(r.party));
    groupVotes[g] = (groupVotes[g] || 0) + r.votes;
    groupRows[g] = (groupRows[g] || 0) + 1;
  }
  const out = {};
  let tot = 0;
  for (const r of fp) {
    const g = liveGroup(cfg.groupOf(r.party));
    const share = groupVotes[g] > 0 ? r.votes / groupVotes[g] : 1 / groupRows[g];
    out[r.party] = (groupShares[g] || 0) * share;
    tot += out[r.party];
  }
  // Groups with no candidate tonight drop out; rescale so the candidates sum to 100.
  if (tot > 0) for (const k of Object.keys(out)) out[k] = (out[k] / tot) * 100;
  return out;
}

function liveGroup(g) {
  return LIVE_GROUPS.includes(g) ? g : (g === "teal" ? "ind" : "other");
}

// 2CP % for `refParty` from projected first preferences + tonight's observed preference flow
// (the share of everyone else's votes that ended up with each finalist, in the booths where
// both counts are in). Null when the flow cannot be measured yet.
function flowProjectedRef(tcp, partyShares, refParty) {
  const f = tcp?.flow;
  if (!f || !tcp.pair || tcp.pair.length !== 2) return null;
  const [a, b] = tcp.pair;
  const prefs = (f.tcp?.[a] || 0) + (f.tcp?.[b] || 0) - (f.fp?.[a] || 0) - (f.fp?.[b] || 0);
  if (!(prefs > 0)) return null;
  const flowA = clamp01(((f.tcp[a] || 0) - (f.fp[a] || 0)) / prefs);
  const pa = partyShares[a] || 0, pb = partyShares[b] || 0;
  const projA = pa + flowA * Math.max(0, 100 - pa - pb);
  return refParty === a ? projA : 100 - projA;
}

function projectSeat(seat, base, meta, cfg) {
  const fpFraction = clamp01((seat.countedPct ?? 0) / 100);
  const fp = normalizeFp(seat.fp);
  // The uncertainty must follow the count the projection is actually built on. The 2CP
  // count lags first preferences on the night, so a 2CP from one booth is NOT as solid
  // as the FP progress suggests. Old feeds without tcp.countedPct fall back to FP progress.
  const usesTcp = !!tcpLeader(seat.tcp);
  const tcpFraction = usesTcp && seat.tcp.countedPct != null
    ? clamp01(Number(seat.tcp.countedPct) / 100) : fpFraction;
  let countedFraction = usesTcp ? Math.min(fpFraction, tcpFraction) : fpFraction;

  // Booth-matched first preferences (when the feed carries the matched sums).
  const groupShares = matchedGroupShares(seat.matched);
  const partyShares = groupShares ? matchedPartyShares(fp, groupShares, cfg) : null;

  // The contest pair we project onto: prefer the EC's published live pair, fall back to the
  // baseline pair, then to the top two first-preference parties.
  const pair = pickPair(seat, base, fp);
  // Orientation party: project the 2CP relative to a single fixed party so swings are signed
  // consistently. Prefer ALP if present (lets us emit a 2PP), else the baseline leader / pair[0].
  // The reference party MUST be one of the two contenders, or the winner test below
  // picks the wrong side whenever the baseline leader is not in tonight's final pair.
  const baseLead = base?.tcp?.pair?.[0];
  const refParty = pair.includes("ALP") ? "ALP" : (pair.includes(baseLead) ? baseLead : pair[0]);
  const otherParty = pair[0] === refParty ? pair[1] : pair[0];

  const liveRef = liveRefPct(seat, fp, pair, refParty, cfg); // live 2CP % for refParty (or null)
  const baseRef = baselineRefPct(base, refParty);            // baseline 2CP % for refParty (or null)

  let granularity = "none";
  let projRef = liveRef ?? baseRef ?? 50;
  let projFp = fpShares(fp);
  let boothRef = null;

  if (partyShares) {
    projFp = partyShares;
    if (usesTcp) {
      boothRef = flowProjectedRef(seat.tcp, partyShares, refParty);
      // The projection now rests on the (much fuller) first-preference count, with the
      // 2CP count only supplying the flow rate — so its solidity sits between the two.
      if (boothRef != null) countedFraction = Math.min(fpFraction, Math.sqrt(fpFraction * tcpFraction));
    } else if (liveRef != null) {
      // No 2CP yet, Labor v Coalition: assumed flows on the booth-matched first preferences.
      const rows = fp.map((r) => ({ ...r, pct: partyShares[r.party] ?? 0 }));
      const est = estimate2ppFromFp(rows, cfg);
      if (est != null) boothRef = refParty === "ALP" ? est : 100 - est;
    }
    if (boothRef != null) {
      granularity = "booth";
      projRef = clampPct(boothRef);
    }
  }

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
  const baselineLeaderParty = base?.winnerParty ?? base?.tcp?.pair?.[0] ?? null;
  const baselineWinnerGroup = baselineLeaderParty ? cfg.groupOf(baselineLeaderParty) : winnerGroup;

  // A swing only means something when the live contest is the same two parties as the
  // baseline one (e.g. not LP-v-IND tonight against an LP-v-ALP baseline figure).
  const basePair = base?.tcp?.pair || [];
  const samePair = basePair.length === 2 && pair.every((p) => basePair.includes(p));
  const swing2cp = baseRef != null && samePair && liveRef != null ? +(projRef - baseRef).toFixed(2) : null;
  const hasEstimate = liveRef != null;
  // No live estimate (e.g. 2CP withheld in a non-classic seat): the seat is still sitting
  // on its 2022 result, so it carries start-of-night uncertainty however many FPs are in.
  if (!hasEstimate) countedFraction = 0;
  const status = classify(seat, countedFraction, margin2cp, cfg, fpFraction);

  return {
    seatId: seat.seatId,
    name: seat.name,
    region: seat.region,
    countedPct: seat.countedPct ?? 0,
    countedFraction,                    // share of expected votes behind the PROJECTION (drives sigma)
    declared: seat.status === "ec_called",   // the commission has declared the seat
    basis: usesTcp ? "tcp" : (hasEstimate ? "fp" : "baseline"),   // what the projection rests on
    tcpState: seat.tcpState ?? (seat.tcp ? "published" : "none"),
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
  // Both sides must actually be on tonight's ballot with votes counted — the pair may have
  // come from the 2022 baseline, and a flow estimate without one side is meaningless.
  const has = (g) => fp.some((r) => cfg.groupOf(r.party) === g && r.votes > 0);
  if (!has("alp") || !has("coalition")) return null;
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
  for (const r of fp) out[r.party] = (out[r.party] || 0) + (r.pct ?? 0);
  return out;
}

// f = share of expected votes behind the projection (0 when there is no live estimate yet);
// fpFraction = first-preference progress, used only to tell "not started" from "counting".
function classify(seat, f, margin2cp, cfg, fpFraction = f) {
  if (seat.status === "ec_called") return "called";
  if (seat.status === "not_started" || fpFraction <= 0) return "not_started";
  const called = cfg.calledMargin ?? 8;
  const likely = cfg.likelyMargin ?? 4;
  const minLikely = cfg.minCountedForLikely ?? 0.1;
  if (f < minLikely) return "in_doubt";         // too little counted to say anything
  if (f >= 0.85 && margin2cp >= called) return "called";
  if (margin2cp >= likely) return "likely";
  return "in_doubt";
}

function clamp01(x) { return Math.min(1, Math.max(0, x)); }
function clampPct(x) { return Math.min(100, Math.max(0, Number(x) || 0)); }

// ProjectedSeat shape:
//   { seatId, name, region, countedPct, countedFraction, granularity, pair, refParty,
//     projRef, projAlp2pp, projFp, winnerParty, winnerGroup, leaderPct, margin, swing2cp,
//     changed, status, observedTcpPct, fp }
