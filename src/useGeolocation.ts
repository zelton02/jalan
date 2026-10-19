import { useCallback, useEffect, useRef, useState } from "react";

export type Fix = { lat: number; lon: number; accuracy: number; at: number };

/**
 * Live position while a journey is running. watchPosition keeps the fix fresh; the browser only
 * hands it over on HTTPS (or localhost), which is why the app is served from zhng.tech.
 */
export function useGeolocation() {
  const [fix, setFix] = useState<Fix | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [watching, setWatching] = useState(false);
  const watchId = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
    setWatching(false);
  }, []);

  const start = useCallback(() => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setError("Peranti ini tiada GPS. / No geolocation on this device.");
      return;
    }
    setError(null);
    if (watchId.current != null) return;
    setWatching(true);
    watchId.current = navigator.geolocation.watchPosition(
      (position) => {
        setFix({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          accuracy: position.coords.accuracy,
          at: position.timestamp,
        });
        setError(null);
        setWatching(true);
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setError("Kebenaran lokasi ditolak. Benarkan dalam tetapan pelayar. / Location permission denied.");
          setWatching(false);
          if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
          watchId.current = null;
          return;
        }
        // A timeout or a weak signal is not fatal: keep watching and let the next fix through.
        setError((prev) => prev ?? "Isyarat GPS lemah — menunggu lokasi. / Weak GPS signal — waiting for a fix.");
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
  }, []);

  useEffect(
    () => () => {
      if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
    },
    [],
  );

  return { fix, error, watching, start, stop };
}
