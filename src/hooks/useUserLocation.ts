import { useState, useEffect, useCallback, useRef } from "react";

interface UseUserLocationOptions {
  immediate?: boolean;
}

export interface UseUserLocationResult {
  position: GeolocationCoordinates | null;
  isLocating: boolean;
  /** 1=denied, 2=unavailable, 3=timeout, -1=browser unsupported, null=no error */
  errorCode: number | null;
  /** Date.now() of last successful fix, or null */
  lastFetched: number | null;
  locate: () => void;
}

export function useUserLocation(options?: UseUserLocationOptions): UseUserLocationResult {
  const [position, setPosition] = useState<GeolocationCoordinates | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [errorCode, setErrorCode] = useState<number | null>(null);
  const [lastFetched, setLastFetched] = useState<number | null>(null);

  // Ref-based guard so locate() is a stable reference with no state deps
  const isLocatingRef = useRef(false);

  const locate = useCallback(() => {
    if (isLocatingRef.current) return;

    if (!navigator.geolocation) {
      setErrorCode(-1);
      return;
    }

    isLocatingRef.current = true;
    setIsLocating(true);
    setErrorCode(null);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        isLocatingRef.current = false;
        setPosition(pos.coords);
        setLastFetched(Date.now());
        setIsLocating(false);
      },
      (err) => {
        isLocatingRef.current = false;
        setErrorCode(err.code);
        setIsLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  }, []); // stable — guard uses ref, not state

  const immediateRef = useRef(options?.immediate ?? false);
  useEffect(() => {
    if (immediateRef.current) locate();
  }, [locate]); // locate is stable, so this runs exactly once on mount

  return { position, isLocating, errorCode, lastFetched, locate };
}
