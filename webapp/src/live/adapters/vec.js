// VEC (Victorian Electoral Commission) adapter — STUB.
//
// The VEC's live election-night results are served from dynamic pages under
// https://www.vec.vic.gov.au/results ; the underlying JSON/XML endpoint and its exact
// shape are not publicly documented and must be confirmed on the night. This adapter is
// the single place that knowledge lives — wire the real transform here and the rest of the
// Live Results page (projection, confidence, UI) is unchanged.
//
// Until then it accepts data ALREADY in the normalized contract shape (so an operator can
// point ?liveUrl= at a hand-normalized or proxy-produced snapshot and it just works), and
// throws a clear error for anything else so the failure is obvious rather than silent.
//
// Expected real-world inputs to map (district-level; VEC does not publish booth-level):
//   • district name           -> seatId (slugify) + name
//   • candidate first prefs    -> seat.fp[{ party, name, votes, pct }]
//   • two-candidate preferred  -> seat.tcp { pair, votes, pct, countedPct }
//   • % counted per district   -> seat.countedPct
import { slugify } from "../contract.js";

export default {
  id: "vec",
  parse(raw, ctx) {
    if (raw && raw.contractVersion && Array.isArray(raw.seats)) {
      // Already normalized (proxy snapshot / hand-prepared). Pass through.
      return raw;
    }
    // TODO(election-night): map the live VEC results payload into the contract here.
    // Reference fields available once the real endpoint shape is known:
    //   raw.districts[].{ name, enrolment, countedPct, candidates[], twoCandidate[] }
    void slugify; void ctx;
    throw new Error(
      "VEC adapter: live feed format not yet wired. Point ?liveUrl= at a normalized " +
      "snapshot, or implement the mapping in webapp/src/live/adapters/vec.js."
    );
  },
};
