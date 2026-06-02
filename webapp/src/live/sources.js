// ── Live Results — source resolution ─────────────────────────────────────────
// Resolves a source id into a concrete { url, adapter, pollMs, baselineUrl } config,
// honouring URL query overrides so an operator can repoint at the real feed on the night
// WITHOUT a rebuild:
//   ?liveSource=vec_vic_2026   — pick a registered source
//   ?liveUrl=https://…         — override the feed URL (adapter stays the source's)
//   ?liveAdapter=vec           — override the adapter
//   ?liveSnapshot=…            — (dev) override feed URL with a sample snapshot
import { LIVE_SOURCES, LIVE_CONFIG } from "./config.js";

function query() {
  if (typeof window === "undefined") return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

// Precedence for the feed URL: explicit query override (operator on the night) >
// in-app override (e.g. the dev snapshot selector) > the source's configured url.
export function resolveSource(sourceId, overrideUrl) {
  const q = query();
  const id = q.get("liveSource") || sourceId || LIVE_CONFIG.active.sourceId;
  const base = LIVE_SOURCES[id] || LIVE_SOURCES[LIVE_CONFIG.active.sourceId];
  const url = q.get("liveSnapshot") || q.get("liveUrl") || overrideUrl || base.url;
  const adapter = q.get("liveAdapter") || base.adapter;
  return { ...base, id, url, adapter };
}
