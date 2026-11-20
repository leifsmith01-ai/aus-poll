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

// The source the tab uses when nothing overrides it: the sample before
// LIVE_CONFIG.active.liveFrom, the live proxy from then on.
export function defaultSourceId(now = Date.now()) {
  const a = LIVE_CONFIG.active;
  const from = a.liveFrom ? Date.parse(a.liveFrom) : NaN;
  return a.liveSourceId && isFinite(from) && now >= from ? a.liveSourceId : a.sourceId;
}

// Milliseconds until the automatic switch to the live source (null if it has passed).
export function msUntilLive(now = Date.now()) {
  const from = Date.parse(LIVE_CONFIG.active.liveFrom || "");
  return isFinite(from) && from > now ? from - now : null;
}

// Precedence for the feed URL: explicit query override (operator on the night) >
// in-app override (e.g. the dev snapshot selector) > the source's configured url.
// `auto` marks a source chosen by the clock rather than by anyone: such a source must
// never show rehearsal/test data as if it were the real count.
export function resolveSource(sourceId, overrideUrl, now = Date.now()) {
  const q = query();
  const explicit = q.get("liveSource") || sourceId;
  const id = explicit || defaultSourceId(now);
  const auto = !explicit && id === LIVE_CONFIG.active.liveSourceId;
  const base = LIVE_SOURCES[id] || LIVE_SOURCES[LIVE_CONFIG.active.sourceId];
  const url = q.get("liveSnapshot") || q.get("liveUrl") || overrideUrl || base.url;
  const adapter = q.get("liveAdapter") || base.adapter;
  return { ...base, id, url, adapter, auto };
}
