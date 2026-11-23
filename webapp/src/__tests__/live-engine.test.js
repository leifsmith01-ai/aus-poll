// Live Results engine — behaviour on real VEC-shaped feeds.
// Guards the election-night failure modes found in the Nov 2026 readiness review.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateFeed } from "../live/contract.js";
import { projectSeats } from "../live/project.js";
import { computeLiveConfidence } from "../live/confidence.js";
import { LIVE_CFG, groupOf } from "../live/config.js";

const baseline = JSON.parse(
  readFileSync(resolve(__dirname, "../../public/live/baseline-vic-2026.json"), "utf-8"));

const seat = (over) => ({
  seatId: "bass", name: "Bass", countedPct: 40, status: "in_progress",
  fp: [{ party: "ALP", votes: 400 }, { party: "LP", votes: 380 }, { party: "GRN", votes: 120 }],
  tcp: null, ...over,
});
const run = (seats, meta = {}) => {
  const { feed } = validateFeed({ contractVersion: 1, meta: { jurisdiction: "vic", ...meta }, seats });
  const projected = projectSeats(feed, baseline, LIVE_CFG);
  return { feed, projected, conf: computeLiveConfidence(projected, LIVE_CFG),
    get: (id) => projected.find((s) => s.seatId === id) };
};

describe("live engine on VEC-shaped feeds", () => {
  it("fills districts missing from the feed so the chamber stays at 88", () => {
    const r = run([seat()]);
    expect(r.projected).toHaveLength(88);
    expect(r.projected.filter((s) => s.missingFromFeed)).toHaveLength(87);
    expect(r.get("narracan").status).toBe("not_started");
  });

  it("picks the winner from tonight's pair even when the 2022 leader is not in it", () => {
    // Bass 2022 baseline is ALP v LP; tonight's final is IND v ON with ON ahead.
    const r = run([seat({ tcp: { pair: ["IND", "ON"], votes: { IND: 400, ON: 600 },
      pct: { IND: 40, ON: 60 }, countedPct: 35 } })]);
    const bass = r.get("bass");
    expect(bass.winnerParty).toBe("ON");
    expect(bass.winnerGroup).toBe("one_nation");
    expect(bass.swing2cp).toBeNull();          // different pair from 2022: no swing
  });

  it("ties confidence to the 2CP count, not first-preference progress", () => {
    const tcp = (c) => ({ pair: ["ALP", "LP"], votes: { ALP: 53, LP: 47 }, pct: { ALP: 53, LP: 47 }, countedPct: c });
    const thin = run([seat({ countedPct: 40, tcp: tcp(1) })]);
    const solid = run([seat({ countedPct: 40, tcp: tcp(38) })]);
    expect(thin.conf.seatWinProbs.bass).toBeLessThan(solid.conf.seatWinProbs.bass);
    expect(thin.get("bass").status).toBe("in_doubt");     // never "likely" on 1% counted
    expect(solid.get("bass").status).toBe("likely");
  });

  it("treats a withheld 2CP in a non-classic seat as still sitting on the baseline", () => {
    const r = run([seat({ tcpState: "withheld",
      fp: [{ party: "IND", votes: 500 }, { party: "GRN", votes: 300 }] })]);
    const bass = r.get("bass");
    expect(bass.basis).toBe("baseline");
    expect(bass.countedFraction).toBe(0);
    expect(bass.status).toBe("in_doubt");
  });

  it("makes a declared seat certain", () => {
    const r = run([seat({ status: "ec_called", countedPct: 30,
      tcp: { pair: ["ALP", "LP"], votes: { ALP: 51, LP: 49 }, pct: { ALP: 51, LP: 49 }, countedPct: 30 } })]);
    expect(r.get("bass").status).toBe("called");
    expect(r.conf.seatWinProbs.bass).toBe(1);
  });

  it("keeps two independents distinct and groups both as independents", () => {
    expect(groupOf("IND#2")).toBe("ind");
    const r = run([seat({ fp: [{ party: "IND", votes: 300 }, { party: "IND#2", votes: 280 }, { party: "NP", votes: 200 }],
      tcp: { pair: ["IND", "IND#2"], votes: { IND: 380, "IND#2": 400 }, pct: { IND: 48.7, "IND#2": 51.3 }, countedPct: 30 } })]);
    expect(r.get("bass").winnerParty).toBe("IND#2");
    expect(r.get("bass").winnerGroup).toBe("ind");
  });

  it("flags sample and VEC trial data as test data", () => {
    expect(run([seat()], { source: "sample" }).feed.meta.test).toBe(true);
    expect(run([seat()], { source: "vec", test: true }).feed.meta.test).toBe(true);
    expect(run([seat()], { source: "vec" }).feed.meta.test).toBe(false);
  });
});

// ── Booth-matched projection + the polls benchmark ───────────────────────────
import { matchedGroupShares, observedSwing } from "../live/project.js";
import { computeVicPollsModel } from "../App.jsx";

describe("booth-matched projection", () => {
  const base = { alp: 40, coalition: 40, greens: 12, other: 8 };

  it("returns the full 2022 result when the counted booths show no swing", () => {
    // Counted booths are far more Labor than the seat (60% v 40%) — but they were in 2022 too.
    const shares = matchedGroupShares({ formal: 1000, base,
      now: { alp: 600, coalition: 250, greens: 100, other: 50 },
      then: { alp: 600, coalition: 250, greens: 100, other: 50 } });
    expect(shares.alp).toBeCloseTo(40, 5);
    expect(shares.coalition).toBeCloseTo(40, 5);
  });

  it("applies the swing seen in matched booths to the whole seat", () => {
    const shares = matchedGroupShares({ formal: 1000, base,
      now: { alp: 550, coalition: 300, greens: 100, other: 50 },
      then: { alp: 600, coalition: 250, greens: 100, other: 50 } });
    expect(shares.alp).toBeCloseTo(35, 5);          // -5 in the booths -> -5 overall
    expect(shares.coalition).toBeCloseTo(45, 5);
    expect(Object.values(shares).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 5);
  });

  it("projects the 2CP from tonight's observed preference flow, not the raw early 2CP", () => {
    // Labor-heavy booths are in first: raw 2CP says ALP 62, but those booths were ALP 64 in
    // 2022 terms. Greens/others are flowing 75% to Labor where both counts are in.
    const matched = { formal: 1000, base,
      now: { alp: 500, coalition: 300, greens: 150, other: 50 },
      then: { alp: 520, coalition: 290, greens: 140, other: 50 } };
    const r = run([seat({ countedPct: 30, matched,
      fp: [{ party: "ALP", votes: 500 }, { party: "LP", votes: 300 }, { party: "GRN", votes: 150 }, { party: "FFV", votes: 50 }],
      tcp: { pair: ["ALP", "LP"], votes: { ALP: 310, LP: 190 }, pct: { ALP: 62, LP: 38 }, countedPct: 15,
        flow: { formal: 500, fp: { ALP: 250, LP: 150 }, tcp: { ALP: 325, LP: 175 } } } })]);
    const bass = r.get("bass");
    expect(bass.granularity).toBe("booth");
    // FP: ALP 40-2=38, LP 40+1=41, others 21; flow to ALP = 75/100 -> 38 + 0.75*21 = 53.75
    expect(bass.projAlp2pp).toBeCloseTo(53.75, 1);
    expect(bass.observedTcpPct).toBe(62);           // raw figure kept for reference
  });

  it("moves seats with no count by the swing seen elsewhere, and reports that swing", () => {
    // Every counted Labor-v-Coalition seat shows Labor 5 points down on 2022.
    const counted = Object.entries(baseline.seats)
      .filter(([, b]) => b.tcp.pair.includes("ALP") && b.tcp.pair.some((p) => p === "LP" || p === "NP"))
      .slice(0, 30)
      .map(([seatId, b]) => {
        const alp = b.tcp.pct.ALP - 5, other = b.tcp.pair.find((p) => p !== "ALP");
        return { seatId, name: b.name, countedPct: 50, status: "in_progress",
          fp: [{ party: "ALP", votes: 500 }, { party: other, votes: 500 }],
          tcp: { pair: ["ALP", other], votes: {}, pct: { ALP: alp, [other]: 100 - alp }, countedPct: 50 } };
      });
    const r = run(counted);
    const obs = observedSwing(r.projected, baseline.seats, LIVE_CFG);
    expect(obs.seats).toBe(30);
    expect(obs.swing).toBeCloseTo(-5, 1);
    const uncounted = r.projected.filter((s) => s.basis === "swing");
    expect(uncounted.length).toBeGreaterThan(40);
    // 15 seats' worth counted -> shrink 15/17 -> about -4.4 applied
    for (const s of uncounted) expect(s.swing2cp).toBeCloseTo(-5 * (15 / 17), 1);
    // Non-classic seats (e.g. Greens v Labor) are left on their 2022 result.
    expect(r.get("melbourne").basis).toBe("baseline");
  });
});

describe("polls benchmark for the Live tab", () => {
  const m = computeVicPollsModel();
  it("covers all 88 seats and joins to the live seat ids", () => {
    expect(Object.keys(m.seats).sort()).toEqual(Object.keys(baseline.seats).sort());
    expect(Object.values(m.counts).reduce((a, b) => a + b, 0)).toBe(88);
  });
  it("is deterministic and carries ranges that contain the point count", () => {
    expect(computeVicPollsModel()).toEqual(m);
    for (const g of ["alp", "coalition"]) {
      expect(m.ranges[g].p05).toBeLessThanOrEqual(m.counts[g]);
      expect(m.ranges[g].p95).toBeGreaterThanOrEqual(m.counts[g]);
    }
    const pm = m.pMajority;
    expect(pm.alp + pm.coalition + pm.hung).toBeGreaterThanOrEqual(99);
  });
});

// ── Automatic election-night switch-over ─────────────────────────────────────
import { vi } from "vitest";
import { defaultSourceId, resolveSource, msUntilLive } from "../live/sources.js";
import { fetchOnce } from "../live/fetchLoop.js";
import { LIVE_CONFIG } from "../live/config.js";

describe("election-night switch-over", () => {
  const from = Date.parse(LIVE_CONFIG.active.liveFrom);

  it("is set for 5:30pm Melbourne time on polling day", () => {
    // 28 Nov 2026 06:30 UTC = 17:30 AEDT (UTC+11)
    expect(new Date(from).toISOString()).toBe("2026-11-28T06:30:00.000Z");
  });

  it("uses the sample before the switch and the live proxy from then on", () => {
    expect(defaultSourceId(from - 1)).toBe("sample_vic_2026");
    expect(defaultSourceId(from)).toBe("vec_proxy_2026");
    const live = resolveSource(null, null, from + 60_000);
    expect(live.id).toBe("vec_proxy_2026");
    expect(live.auto).toBe(true);
    expect(live.pollMs).toBeGreaterThan(0);
    expect(msUntilLive(from - 5000)).toBe(5000);
    expect(msUntilLive(from + 1)).toBeNull();
  });

  it("does not treat an explicitly chosen source as automatic", () => {
    expect(resolveSource("vec_proxy_2026", null, from - 1).auto).toBe(false);
    expect(resolveSource(null, null, from - 1).auto).toBe(false);   // the sample
  });

  it("reports 'waiting' while the proxy has nothing, or only its waiting marker", async () => {
    const source = resolveSource(null, null, from + 1);
    const mock = (body, status = 200) => vi.fn(async () => ({
      ok: status < 400, status, json: async () => body }));
    globalThis.fetch = mock(null, 404);
    expect((await fetchOnce(source)).waiting).toBe(true);
    globalThis.fetch = mock({ contractVersion: 1, waiting: true, meta: {}, seats: [] });
    expect((await fetchOnce(source)).waiting).toBe(true);
    globalThis.fetch = mock(null, 500);
    await expect(fetchOnce(source)).rejects.toThrow("HTTP 500");
  });
});

// ── Projected status, call estimate, change log ──────────────────────────────
import { withCallStatus, estimateCallAt, PROJECT_P } from "../live/confidence.js";
import { seatEvents } from "../live/events.js";

describe("projected status and call estimate", () => {
  const tcp = (alp, c) => ({ pair: ["ALP", "LP"], votes: {}, pct: { ALP: alp, LP: 100 - alp }, countedPct: c });
  const at = (alp, counted) => {
    const r = run([seat({ countedPct: counted, tcp: tcp(alp, counted) })]);
    return withCallStatus(r.projected, r.conf, LIVE_CFG).find((s) => s.seatId === "bass");
  };

  it("projects a seat whose lead is safe for its count, before the formal call", () => {
    const s = at(60, 30);                       // 20-point margin at 30% counted
    expect(s.winProb).toBeGreaterThanOrEqual(PROJECT_P);
    expect(s.status).toBe("projected");
    expect(s.callAt).toBeLessThanOrEqual(30);
  });

  it("keeps a close seat open and estimates when it could be called", () => {
    const s = at(52, 30);                       // 4-point margin at 30% counted
    expect(s.status).not.toBe("projected");
    expect(s.callAt).toBeGreaterThan(30);
    expect(s.callAt).toBeLessThanOrEqual(100);
    expect(at(52, s.callAt + 1).status).toBe("projected");   // the estimate is consistent
  });

  it("has no call estimate for a dead heat or a seat with nothing counted", () => {
    expect(at(50.02, 60).callAt).toBeNull();
    const r = run([seat({ countedPct: 0, status: "not_started", fp: [] })]);
    expect(withCallStatus(r.projected, r.conf, LIVE_CFG).find((s) => s.seatId === "bass").callAt).toBeNull();
  });

  it("never projects below the minimum count, however lopsided", () => {
    expect(at(80, 3).status).toBe("in_doubt");
  });

  it("estimateCallAt ignores declared seats", () => {
    expect(estimateCallAt({ declared: true, margin: 2, countedFraction: 0.5 }, LIVE_CFG)).toBeNull();
  });
});

describe("change log between updates", () => {
  const s = (id, party, status, extra = {}) => ({ seatId: id, name: id, winnerParty: party,
    winnerGroup: groupOf(party), status, basis: "tcp", ...extra });

  it("reports lead changes, calls, projections and seats falling into doubt", () => {
    const prev = [s("a", "ALP", "likely"), s("b", "LP", "likely"), s("c", "ALP", "likely"),
      s("d", "ALP", "projected"), s("e", "LP", "in_doubt")];
    const cur = [s("a", "LP", "in_doubt"), s("b", "LP", "called"), s("c", "ALP", "projected"),
      s("d", "ALP", "in_doubt"), s("e", "LP", "in_doubt")];
    const ev = seatEvents(prev, cur).map((e) => `${e.seatId}:${e.kind}`);
    expect(ev).toEqual(["a:lead", "b:called", "c:projected", "a:doubt", "d:doubt"]);
  });

  it("does not report seats merely starting to count, or estimates with no count behind them", () => {
    const prev = [s("a", "ALP", "not_started"), s("b", "ALP", "likely", { basis: "swing" })];
    const cur = [s("a", "LP", "in_doubt"), s("b", "LP", "likely", { basis: "swing" })];
    expect(seatEvents(prev, cur)).toEqual([]);
    expect(seatEvents(null, cur)).toEqual([]);
  });
});

describe("chamber layout", () => {
  it("places every seat exactly once, ordered from left to right", async () => {
    const { chamberLayout } = await import("../App.jsx");
    for (const n of [88, 93, 151]) {
      const pts = chamberLayout(n, n > 100 ? 8 : 6);
      expect(pts).toHaveLength(n);
      for (let i = 1; i < n; i++) expect(pts[i].a).toBeLessThanOrEqual(pts[i - 1].a + 1e-9);
      expect(pts[0].a).toBeCloseTo(Math.PI, 6);
      expect(pts[n - 1].a).toBeCloseTo(0, 6);
      expect(new Set(pts.map((p) => `${p.r.toFixed(4)}:${p.a.toFixed(4)}`)).size).toBe(n);
    }
  });
});

describe("tile labels", () => {
  it("gives every Victorian district a unique, short label", async () => {
    const { seatAbbrevs } = await import("../App.jsx");
    const names = Object.values(baseline.seats).map((s) => s.name);
    const ab = seatAbbrevs(names);
    expect(new Set(Object.values(ab)).size).toBe(names.length);
    for (const a of Object.values(ab)) expect(a.length).toBeLessThanOrEqual(4);
    expect(ab.Mornington).not.toBe(ab.Mordialloc);
  });
});
