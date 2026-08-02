'use client';

import { useEffect, useRef } from 'react';

/**
 * Run a callback on every animation frame while `active` is true.
 *
 * Meters and waveforms update at display rate. Pushing that through React state
 * would re-render the dashboard 60x/second, so the visualiser components use
 * this hook to read engine refs and paint directly instead.
 */
export function useAnimationFrame(callback: (deltaMs: number) => void, active = true): void {
  const callbackRef = useRef(callback);

  // Keep the latest closure without restarting the loop.
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!active) return;

    let frameId = 0;
    let previous = performance.now();

    const tick = (now: number) => {
      const deltaMs = now - previous;
      previous = now;
      callbackRef.current(deltaMs);
      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [active]);
}
