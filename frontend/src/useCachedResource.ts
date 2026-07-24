import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useRef, useState } from "react";

/**
 * Cache-first resource for cold, admin-authored data (events, landmarks, sets).
 * Renders the last-persisted value immediately — so the screen has data on a
 * cold or offline open — then revalidates from `fetcher` on mount and every
 * `intervalMs`, persisting each success. This is the profile load in App's
 * `ProfileGate` generalized: read AsyncStorage, show stale, refresh in the
 * background, ignore failures.
 *
 * `key` is both the resource identity and the AsyncStorage key. Pass null to
 * hold nothing (value stays null, nothing is fetched or stored) — that's how
 * callers gate on "no event": switch the key to null and the cache read, the
 * fetch, and the interval all stand down. Namespace keys by id
 * (`wta.landmarks.<eventId>`) so switching events never serves the wrong
 * event's cache.
 *
 * `fetcher` is read through a ref, so callers can pass a fresh inline closure
 * each render without re-subscribing the effect; only `key`/`intervalMs` do.
 *
 * `hydrated` flips true once the first resolution (cache or network) lands, so
 * a caller can tell "still loading" from "loaded, genuinely null".
 */
export function useCachedResource<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  intervalMs: number
): { value: T | null; hydrated: boolean } {
  const [value, setValue] = useState<T | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    setValue(null);
    setHydrated(false);
    if (!key) {
      setHydrated(true);
      return;
    }
    let cancelled = false;
    let gotFresh = false;

    // Cache-first — but the network can win the race on a warm connection, so
    // never let a late cache read clobber an already-fetched value.
    AsyncStorage.getItem(key)
      .then((raw) => {
        if (cancelled || gotFresh || raw == null) return;
        setValue(JSON.parse(raw) as T);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });

    const load = () =>
      fetcherRef
        .current()
        .then((fresh) => {
          if (cancelled) return;
          gotFresh = true;
          setValue(fresh);
          setHydrated(true);
          AsyncStorage.setItem(key, JSON.stringify(fresh)).catch(() => {});
        })
        // Leave the value as-is (cache or a prior fetch); the interval doubles
        // as the retry loop, matching the cold-data hooks this backs.
        .catch(() => {});

    load();
    const timer = setInterval(load, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [key, intervalMs]);

  return { value, hydrated };
}
