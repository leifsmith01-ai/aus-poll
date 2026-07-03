// VEC (Victorian Electoral Commission) adapter.
//
// The PRIMARY election-night path is the Live Feed Proxy: the live-feed.yml
// workflow polls the VEC server-side, scripts/fetch_live_vec.py normalizes the
// payload into the contract (all VEC-shape knowledge lives in that script), and
// the snapshot is published on the `live-feed` branch, which the
// `vec_proxy_2026` source polls via raw.githubusercontent.com (CORS: *).
// By the time data reaches the browser it is already contract-shaped, so this
// adapter passes it through.
//
// Direct-to-VEC (the `vec_vic_2026` source) only works if the VEC endpoint
// serves CORS headers AND its raw shape is mapped below — the 2026 endpoint
// shape must be confirmed on the night. Keep any browser-side mapping added
// here in sync with the Python normalizer.
import { slugify } from "../contract.js";

export default {
  id: "vec",
  parse(raw, ctx) {
    if (raw && raw.contractVersion && Array.isArray(raw.seats)) {
      // Already normalized (proxy snapshot / hand-prepared). Pass through.
      return raw;
    }
    // Raw VEC payload in the browser: only reachable on the direct source.
    // Map it in scripts/fetch_live_vec.py (proxy) or here (direct) once the
    // real endpoint shape is confirmed.
    void slugify; void ctx;
    throw new Error(
      "VEC adapter: raw VEC feed format not wired browser-side. Use the " +
      "vec_proxy_2026 source (Live Feed Proxy workflow), point ?liveUrl= at a " +
      "normalized snapshot, or map the payload in webapp/src/live/adapters/vec.js."
    );
  },
};
