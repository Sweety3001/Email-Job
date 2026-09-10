import { useEffect, useRef, useState } from "react";

/**
 * Poll a loader function on a fixed interval. The loader is also invoked
 * immediately on mount and whenever `deps` change. While a poll is in
 * flight, overlapping invocations are skipped.
 */
export function usePolling<T>(loader: () => Promise<T>, intervalMs: number, deps: unknown[] = []): {
  data: T | null;
  error: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
} {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const inFlight = useRef(false);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const refresh = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const result = await loaderRef.current();
      setData(result);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, intervalMs);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, loading, refresh };
}
