// ── Live Results — fetch + polling orchestration ─────────────────────────────
// Framework-agnostic. fetchOnce() does one fetch -> adapter -> validate. createPoller()
// runs it on an interval with exponential backoff, pauses when the tab is hidden, and
// supports a manual refresh. The React hook (useLiveResults) wraps this.
import { getAdapter } from "./adapters/index.js";
import { validateFeed } from "./contract.js";

async function fetchJson(url, signal) {
  const res = await fetch(url, { signal, cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.json();
}

// One feed fetch. Returns { feed, errors, fetchedAt }. Throws on network/parse failure.
export async function fetchOnce(source, { signal } = {}) {
  const raw = await fetchJson(source.url, signal);
  const adapter = getAdapter(source.adapter);
  const normalized = adapter.parse(raw, {
    jurisdiction: source.jurisdiction,
  });
  const { ok, errors, feed } = validateFeed(normalized);
  if (!ok) throw new Error(`feed validation failed: ${errors.join("; ") || "no seats"}`);
  return { feed, errors, fetchedAt: new Date().toISOString() };
}

// Fetch the prior-election baseline once (no polling).
export async function fetchBaseline(source, { signal } = {}) {
  if (!source.baselineUrl) return null;
  return fetchJson(source.baselineUrl, signal);
}

const BACKOFF_CAP_MS = 5 * 60_000;

// createPoller({ source, onUpdate, onError }) -> controller.
// onUpdate({ feed, fetchedAt }); onError(err). pollMs<=0 => fetch once, no interval.
export function createPoller({ source, onUpdate, onError }) {
  let timer = null;
  let abort = null;
  let stopped = false;
  let failures = 0;
  let current = source;

  const clearTimer = () => { if (timer) { clearTimeout(timer); timer = null; } };

  async function tick() {
    if (stopped) return;
    if (typeof document !== "undefined" && document.hidden) {
      schedule(current.pollMs || 30_000); // re-check later while hidden
      return;
    }
    abort?.abort();
    abort = typeof AbortController !== "undefined" ? new AbortController() : null;
    try {
      const result = await fetchOnce(current, { signal: abort?.signal });
      failures = 0;
      onUpdate?.(result);
    } catch (err) {
      if (err?.name === "AbortError") return;
      failures += 1;
      onError?.(err);
    }
    if (current.pollMs > 0) schedule(nextDelay());
  }

  function nextDelay() {
    if (failures === 0) return current.pollMs;
    return Math.min(BACKOFF_CAP_MS, current.pollMs * 2 ** failures);
  }

  function schedule(ms) {
    clearTimer();
    if (stopped || ms <= 0) return;
    timer = setTimeout(tick, ms);
  }

  function onVisibility() {
    if (typeof document !== "undefined" && !document.hidden && !stopped) {
      schedule(0); // refetch promptly when the tab regains focus
    }
  }

  return {
    start() {
      stopped = false;
      if (typeof document !== "undefined") {
        document.addEventListener("visibilitychange", onVisibility);
      }
      tick();
    },
    stop() {
      stopped = true;
      clearTimer();
      abort?.abort();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
    },
    refreshNow() { schedule(0); },
    setSource(next) { current = next; failures = 0; schedule(0); },
  };
}
