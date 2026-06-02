// ── Live Results — normalized feed contract ──────────────────────────────────
// A jurisdiction-agnostic shape that every Electoral Commission adapter normalizes
// into. The projection (project.js) and confidence (confidence.js) modules only ever
// see this shape, so adding a new jurisdiction means writing one adapter, not touching
// the model or UI.
//
// Feed shape:
//   {
//     contractVersion: 1,
//     meta: { jurisdiction, electionId, chamber, asAt, totalSeats, majority,
//             boothLevel, source, baselineElectionId, countedPct },
//     seats: [ Seat ]
//   }
//
// Seat shape:
//   {
//     seatId,            // stable slug — the join key to the baseline
//     name, region,
//     countedPct,        // 0–100, first-preference count progress
//     expectedTotal,     // est. final formal vote count (null if unknown)
//     enrolment,
//     lastUpdated,       // ISO8601
//     fp:  [ { party, name, votes, pct } ],          // first preferences
//     tcp: { pair:[p,q], votes:{}, pct:{}, countedPct } | null,  // 2CP if EC has published it
//     status,            // "not_started" | "in_progress" | "ec_called"
//     booths?: [ { boothId, name, countedPct, fp, tcp } ]   // optional, federal-style feeds
//   }

export const CONTRACT_VERSION = 1;

// Stable slug used as the seat join key. Must match scripts/generate_live_sample.py:slugify
// so feed seatIds line up with baseline keys.
export function slugify(name) {
  return String(name || "")
    .replace(/\(.*?\)/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// Recompute first-preference percentages from raw votes (never trust feed-supplied pct).
// Returns a new array of { party, name, votes, pct } sorted by votes desc.
export function normalizeFp(fp) {
  const rows = Array.isArray(fp) ? fp : [];
  const total = rows.reduce((s, r) => s + (Number(r.votes) || 0), 0);
  return rows
    .map((r) => ({
      party: r.party,
      name: r.name || "",
      votes: Number(r.votes) || 0,
      pct: total > 0 ? +(((Number(r.votes) || 0) / total) * 100).toFixed(2) : (r.pct ?? null),
    }))
    .sort((a, b) => b.votes - a.votes);
}

// Two-candidate-preferred leader for a seat's published tcp block, or null.
// Returns { leader, leaderPct, pair } where leaderPct is the leader's 2CP share (>= 50).
export function tcpLeader(tcp) {
  if (!tcp || !tcp.pair || tcp.pair.length !== 2) return null;
  const [p, q] = tcp.pair;
  const pp = Number(tcp.pct?.[p]);
  const qp = Number(tcp.pct?.[q]);
  if (!isFinite(pp) || !isFinite(qp)) return null;
  return pp >= qp
    ? { leader: p, leaderPct: pp, pair: tcp.pair }
    : { leader: q, leaderPct: qp, pair: tcp.pair };
}

// Lightweight runtime validation. Returns { ok, errors:[...], feed }.
// Tolerant by design — a malformed individual seat is dropped rather than failing the feed,
// so a single bad row from the EC on the night does not blank the whole page.
export function validateFeed(json) {
  const errors = [];
  if (!json || typeof json !== "object") {
    return { ok: false, errors: ["feed is not an object"], feed: null };
  }
  if (json.contractVersion !== CONTRACT_VERSION) {
    errors.push(`unexpected contractVersion ${json.contractVersion} (want ${CONTRACT_VERSION})`);
  }
  const meta = json.meta || {};
  if (!meta.jurisdiction) errors.push("meta.jurisdiction missing");
  if (!Array.isArray(json.seats)) {
    return { ok: false, errors: [...errors, "seats is not an array"], feed: null };
  }

  const seats = [];
  json.seats.forEach((s, i) => {
    if (!s || !s.seatId) {
      errors.push(`seat[${i}] missing seatId — dropped`);
      return;
    }
    seats.push({
      seatId: s.seatId,
      name: s.name || s.seatId,
      region: s.region || null,
      countedPct: clampPct(s.countedPct),
      expectedTotal: s.expectedTotal ?? null,
      enrolment: s.enrolment ?? null,
      lastUpdated: s.lastUpdated || meta.asAt || null,
      fp: normalizeFp(s.fp),
      tcp: s.tcp || null,
      status: s.status || "in_progress",
      booths: Array.isArray(s.booths) ? s.booths : null,
    });
  });

  const feed = {
    contractVersion: CONTRACT_VERSION,
    meta: {
      jurisdiction: meta.jurisdiction || null,
      electionId: meta.electionId || null,
      chamber: meta.chamber || null,
      asAt: meta.asAt || null,
      totalSeats: meta.totalSeats ?? seats.length,
      majority: meta.majority ?? Math.floor((meta.totalSeats ?? seats.length) / 2) + 1,
      boothLevel: !!meta.boothLevel,
      source: meta.source || "unknown",
      baselineElectionId: meta.baselineElectionId || null,
      countedPct: clampPct(meta.countedPct ?? meanCounted(seats)),
    },
    seats,
  };
  return { ok: seats.length > 0, errors, feed };
}

function clampPct(v) {
  const n = Number(v);
  if (!isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

function meanCounted(seats) {
  if (!seats.length) return 0;
  return seats.reduce((s, x) => s + (x.countedPct || 0), 0) / seats.length;
}
