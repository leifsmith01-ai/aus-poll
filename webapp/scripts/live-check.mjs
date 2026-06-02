// Headless check for the Live Results projection + confidence engines.
// Run: node webapp/scripts/live-check.mjs   (from repo root or webapp/)
// Asserts that projected seat winners converge to the feed at 100 % counted and that
// statewide uncertainty collapses as the count progresses.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { validateFeed } from "../src/live/contract.js";
import { projectSeats } from "../src/live/project.js";
import { computeLiveConfidence } from "../src/live/confidence.js";

const here = dirname(fileURLToPath(import.meta.url));
const pub = resolve(here, "../public/live");
const load = (f) => JSON.parse(readFileSync(resolve(pub, f), "utf-8"));

const GROUP_OF = { ALP: "alp", LP: "coalition", NP: "coalition", GRN: "greens", IND: "ind", ON: "one_nation" };
const cfg = {
  prefFlows: { grn_alp: 0.8, on_alp: 0.3, other_alp: 0.5 },
  coalitionParties: new Set(["LP", "NP"]),
  groupOf: (p) => GROUP_OF[p] || "other",
  majority: 45, totalSeats: 88, calledMargin: 8, likelyMargin: 4,
};

const baseline = load("baseline-vic-2026.json");
let prevStd = Infinity;
let failures = 0;

for (const tag of ["000", "035", "080", "100"]) {
  const { feed } = validateFeed(load(`sample-vic-2026-${tag}.json`));
  const proj = projectSeats(feed, baseline, cfg);
  const conf = computeLiveConfidence(proj, cfg);
  const counts = {};
  for (const s of proj) counts[s.winnerGroup] = (counts[s.winnerGroup] || 0) + 1;
  console.log(`${tag}% counted: ALP ${conf.alp.mean} [${conf.alp.p05}-${conf.alp.p95}] std ${conf.alp.std} | P(maj) ${JSON.stringify(conf.pMajority)} | ${JSON.stringify(counts)}`);
  if (conf.alp.std > prevStd + 0.5) { console.error(`  ! std rose at ${tag}%`); failures++; }
  prevStd = conf.alp.std;
}

const { feed: f100 } = validateFeed(load("sample-vic-2026-100.json"));
const p100 = projectSeats(f100, baseline, cfg);
const c100 = computeLiveConfidence(p100, cfg);
const raw = {}, prj = {};
for (const s of f100.seats) {
  if (!s.tcp) continue;
  const lead = Object.entries(s.tcp.pct).sort((a, b) => b[1] - a[1])[0][0];
  raw[cfg.groupOf(lead)] = (raw[cfg.groupOf(lead)] || 0) + 1;
}
for (const s of p100) prj[s.winnerGroup] = (prj[s.winnerGroup] || 0) + 1;
if (JSON.stringify(raw) !== JSON.stringify(prj)) { console.error("FAIL: winners diverge at 100%", raw, prj); failures++; }
if (c100.alp.std > 2.5) { console.error("FAIL: std too wide at 100%:", c100.alp.std); failures++; }

if (failures) { console.error(`\n${failures} check(s) FAILED`); process.exit(1); }
console.log("\nAll live-engine checks passed.");
