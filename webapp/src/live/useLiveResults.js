// ── Live Results — React hook ────────────────────────────────────────────────
// The only React-aware module in webapp/src/live/. Wraps the poller + baseline fetch and
// exposes everything the page needs: the normalized feed, the prior-election baseline,
// status, and a manual refresh.
import { useCallback, useEffect, useRef, useState } from "react";
import { createPoller, fetchBaseline } from "./fetchLoop.js";
import { resolveSource, msUntilLive } from "./sources.js";

// useLiveResults(sourceId, overrideUrl) ->
//   { feed, baseline, status, error, lastFetched, refresh, source }
// overrideUrl lets the UI swap the feed URL (e.g. dev snapshot selector) without a reload.
// status: "loading" | "ok" | "waiting" (source up, counting not started) | "error"
export function useLiveResults(sourceId, overrideUrl) {
  const [feed, setFeed] = useState(null);
  const [baseline, setBaseline] = useState(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState(null);
  const [lastFetched, setLastFetched] = useState(null);
  const pollerRef = useRef(null);

  // Re-render at the automatic switch to the live source, so a page left open from the
  // afternoon moves onto the live count by itself.
  const [, setTick] = useState(0);
  useEffect(() => {
    const ms = msUntilLive();
    if (ms == null || ms > 2 ** 31 - 1) return undefined;
    const t = setTimeout(() => setTick((n) => n + 1), ms + 1000);
    return () => clearTimeout(t);
  }, []);

  // Re-resolve when the configured source or any URL override changes. Including the live
  // search string lets a dev flip ?liveSnapshot= and re-run without a reload helper.
  const search = typeof window !== "undefined" ? window.location.search : "";
  const source = resolveSource(sourceId, overrideUrl);

  // Load the baseline once per source.
  useEffect(() => {
    let cancelled = false;
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    fetchBaseline(source, { signal: ctrl?.signal })
      .then((b) => { if (!cancelled) setBaseline(b); })
      .catch(() => { if (!cancelled) setBaseline(null); });
    return () => { cancelled = true; ctrl?.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.baselineUrl]);

  // Poll the feed.
  useEffect(() => {
    setStatus("loading");
    setError(null);
    const poller = createPoller({
      source,
      onUpdate: ({ feed: f, fetchedAt, waiting }) => {
        // A clock-selected live source never shows rehearsal/test data as the night.
        if (waiting || (source.auto && f?.meta?.test)) {
          setFeed(null);
          setLastFetched(fetchedAt);
          setStatus("waiting");
          setError(null);
          return;
        }
        setFeed(f);
        setLastFetched(fetchedAt);
        setStatus("ok");
        setError(null);
      },
      onError: (err) => {
        setError(err?.message || String(err));
        setStatus((s) => (s === "ok" || s === "waiting" ? s : "error")); // keep last good state
      },
    });
    pollerRef.current = poller;
    poller.start();
    return () => poller.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.url, source.adapter, source.auto, search]);

  const refresh = useCallback(() => pollerRef.current?.refreshNow(), []);

  return { feed, baseline, status, error, lastFetched, refresh, source };
}
