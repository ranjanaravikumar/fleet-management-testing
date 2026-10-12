import { useEffect, useRef, useState } from 'react';
import { tmsGet } from '../api/tms';

/**
 * Asks the TMS API for `path` every `intervalMs` and keeps the latest answer.
 * This is "polling": the page keeps asking "anything new?", so changes the
 * agent makes show up without anyone refreshing.
 *
 * Returns { data, error, updatedAt, loading }.
 *  - data: the last good answer (kept even if a later request fails)
 *  - error: set while the API can't be reached
 *  - updatedAt: when the last good answer arrived (ms)
 */
export function useLiveData(path, intervalMs = 3000, enabled = true) {
  const [state, setState] = useState({ data: null, error: null, updatedAt: null, loading: true });
  const lastJson = useRef(null);

  useEffect(() => {
    if (!enabled || !path) return undefined;
    let stopped = false;
    let timer;
    let controller;

    async function tick() {
      // Don't poll while the browser tab is hidden; resume when it's visible.
      if (document.hidden) {
        timer = setTimeout(tick, intervalMs);
        return;
      }
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      try {
        const data = await tmsGet(path, { signal: controller.signal });
        if (stopped) return;
        const json = JSON.stringify(data);
        const changed = json !== lastJson.current;
        lastJson.current = json;
        setState(prev => ({
          data: changed ? data : prev.data,
          error: null,
          updatedAt: Date.now(),
          loading: false,
        }));
      } catch (err) {
        if (stopped) return;
        setState(prev => ({ ...prev, error: err.message || 'Request failed', loading: false }));
      } finally {
        clearTimeout(timeout);
      }
      if (!stopped) timer = setTimeout(tick, intervalMs);
    }

    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
    };
  }, [path, intervalMs, enabled]);

  return state;
}

/** Re-renders every `ms` so "12 sec ago" style labels stay current. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/**
 * Which items in `items` are new since the page opened, for a few seconds.
 * Items already there on first load don't count as new. `getKey` picks the
 * part of an item that changes, e.g. its id, or id + updated_at.
 */
export function useFreshIds(items, getKey = item => item.id, getId = item => item.id, ms = 6000) {
  const seen = useRef(null);
  const timers = useRef([]);
  const [fresh, setFresh] = useState(() => new Set());

  useEffect(() => {
    if (!items) return;
    const keys = items.map(getKey);
    if (seen.current === null) {
      seen.current = new Set(keys);
      return;
    }
    const added = items.filter(item => !seen.current.has(getKey(item))).map(getId);
    keys.forEach(k => seen.current.add(k));
    if (!added.length) return;
    setFresh(prev => new Set([...prev, ...added]));
    timers.current.push(setTimeout(() => setFresh(prev => {
      const next = new Set(prev);
      added.forEach(id => next.delete(id));
      return next;
    }), ms));
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  return fresh;
}
