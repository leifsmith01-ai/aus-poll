// ── Live Results — React hook ────────────────────────────────────────────────
// The only React-aware module in webapp/src/live/. Wraps the poller + baseline fetch and
// exposes everything the page needs: the normalized feed, the prior-election baseline,
// status, and a manual refresh.
import { useCallback, useEffect, useRef, useState } from "react";
import { createPoller, fetchBaseline } from "./fetchLoop.js";
import { resolveSource } from "./sources.js";

// useLiveResults(sourceId, overrideUrl) ->
//   { feed, baseline, status, error, lastFetched, refresh, source }
// overrideUrl lets the UI swap the feed URL (e.g. dev snapshot selector) without a reload.
// status: "loading" | "ok" | "error"
export function useLiveResults(sourceId, overrideUrl) {
  const [feed, setFeed] = useState(null);
  const [baseline, setBaseline] = useState(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState(null);
  const [lastFetched, setLastFetched] = useState(null);
  const pollerRef = useRef(null);

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
      onUpdate: ({ feed: f, fetchedAt }) => {
        setFeed(f);
        setLastFetched(fetchedAt);
        setStatus("ok");
        setError(null);
      },
      onError: (err) => {
        setError(err?.message || String(err));
        setStatus((s) => (s === "ok" ? "ok" : "error")); // keep last good feed visible
      },
    });
    pollerRef.current = poller;
    poller.start();
    return () => poller.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.url, source.adapter, search]);

  const refresh = useCallback(() => pollerRef.current?.refreshNow(), []);

  return { feed, baseline, status, error, lastFetched, refresh, source };
}
