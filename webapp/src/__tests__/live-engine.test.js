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
