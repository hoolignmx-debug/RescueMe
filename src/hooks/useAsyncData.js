import { useCallback, useEffect, useRef, useState } from 'react';
import { subscribeToChanges } from '../services/bus.js';

// Loads data, optionally polls, and refreshes when another page changes data.
//  * Polling pauses while the browser tab is hidden (no needless requests).
//  * A failed background refresh keeps the last good data and exposes `error`
//    so the page can show "showing last known data".
//  * Stale responses (from an older request) are ignored.
export function useAsyncData(fetcher, deps = [], { intervalMs = 0, refreshOnChange = false, enabled = true } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: enabled, updatedAt: null });
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const requestId = useRef(0);

  const load = useCallback(async ({ silent = false } = {}) => {
    const id = ++requestId.current;
    if (!silent) setState((s) => ({ ...s, loading: true }));
    try {
      const data = await fetcherRef.current();
      if (id !== requestId.current) return;
      setState({ data, error: null, loading: false, updatedAt: new Date() });
    } catch (error) {
      if (id !== requestId.current || error?.name === 'AbortError') return;
      setState((s) => ({ ...s, error, loading: false }));
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setState({ data: null, error: null, loading: false, updatedAt: null });
      return undefined;
    }
    setState({ data: null, error: null, loading: true, updatedAt: null });
    load();
    return () => {
      requestId.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  useEffect(() => {
    if (!enabled || !intervalMs) return undefined;
    const t = setInterval(() => {
      if (typeof document === 'undefined' || !document.hidden) load({ silent: true });
    }, intervalMs);
    return () => clearInterval(t);
  }, [enabled, intervalMs, load]);

  useEffect(() => {
    if (!enabled || !refreshOnChange) return undefined;
    return subscribeToChanges(() => load({ silent: true }));
  }, [enabled, refreshOnChange, load]);

  return { ...state, refresh: () => load(), refreshSilent: () => load({ silent: true }), setData: (data) => setState((s) => ({ ...s, data })) };
}
