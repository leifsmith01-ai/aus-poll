// ── Live Results — configuration ─────────────────────────────────────────────
// Declares the active live election, its data sources, the prior-election baseline, and
// the projection/confidence parameters. Adding a future election = add an entry here +
// (if its feed isn't already in contract shape) an adapter.

const BASE = import.meta.env.BASE_URL || "/";

// Party -> group mapping for live jurisdictions (kept independent of App.jsx's PARTY map
// so the live modules stay self-contained / testable).
const GROUP_OF = {
  ALP: "alp",
  LP: "coalition", LNP: "coalition", NP: "coalition", CLP: "coalition",
  GRN: "greens",
  IND: "ind", CA: "ind", TEAL: "ind",
  ON: "one_nation",
};
export function groupOf(party) {
  return GROUP_OF[party] || "other";
}

const COALITION_PARTIES = new Set(["LP", "LNP", "NP", "CLP"]);

// Victorian preference-flow assumptions for the FP->2PP fallback (used only before the VEC
// publishes a 2CP). Greens flow strongly to ALP; minors split roughly evenly.
const VIC_PREF_FLOWS = { grn_alp: 0.80, on_alp: 0.30, other_alp: 0.50, ind_alp: 0.50 };

export const LIVE_CFG = {
  prefFlows: VIC_PREF_FLOWS,
  coalitionParties: COALITION_PARTIES,
  groupOf,
  majority: 45,
  totalSeats: 88,
  calledMargin: 8,
  likelyMargin: 4,
};

// Registered feed sources. `url` is the same-origin (sample/proxy) or EC endpoint to fetch;
// `adapter` selects the raw->contract transform; `pollMs` 0 disables auto-polling.
export const LIVE_SOURCES = {
  sample_vic_2026: {
    id: "sample_vic_2026",
    jurisdiction: "vic",
    label: "Sample (VIC 2026)",
    url: `${BASE}live/sample-vic-2026.json`,
    adapter: "passthrough",
    pollMs: 0,
    baselineUrl: `${BASE}live/baseline-vic-2026.json`,
  },
  vec_vic_2026: {
    id: "vec_vic_2026",
    jurisdiction: "vic",
    label: "VEC Live",
    // Confirmed on election night — see webapp/src/live/adapters/vec.js.
    url: `${BASE}live/sample-vic-2026.json`,
    adapter: "vec",
    pollMs: 90_000,
    baselineUrl: `${BASE}live/baseline-vic-2026.json`,
  },
};

// The election the Live tab tracks. `enabled` controls whether the tab is shown at all.
export const LIVE_CONFIG = {
  active: {
    id: "vic_2026",
    jurisdiction: "vic",
    label: "Live: VIC 2026",
    chamber: "Legislative Assembly",
    date: "28 November 2026",
    sourceId: "sample_vic_2026",   // switch to "vec_vic_2026" on the night
    baselineElectionId: "vic_2022",
    majority: 45,
    totalSeats: 88,
    enabled: true,
    cfg: LIVE_CFG,
  },
  sources: LIVE_SOURCES,
};

// Sample snapshots for the dev-only count-progression selector (0 -> 100 %).
export const SAMPLE_SNAPSHOTS = [
  { label: "0%", url: `${BASE}live/sample-vic-2026-000.json` },
  { label: "35%", url: `${BASE}live/sample-vic-2026-035.json` },
  { label: "80%", url: `${BASE}live/sample-vic-2026-080.json` },
  { label: "100%", url: `${BASE}live/sample-vic-2026-100.json` },
];
