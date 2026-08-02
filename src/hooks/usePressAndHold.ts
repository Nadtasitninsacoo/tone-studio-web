'use client';

import { useRef, useCallback, useEffect } from 'react';

/**
 * usePressAndHold — A custom hook to enable repeating actions when clicking/pressing and holding a button.
 *
 * It triggers once immediately on pointer down, then starts repeating at a set interval
 * after a brief delay if the user continues to hold.
 */
export function usePressAndHold(callback: () => void) {
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // Keep the callback reference up to date to avoid re-triggering effect bounds
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  const stop = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const start = useCallback((event: React.PointerEvent) => {
    // Only react to primary click (left mouse button) or touch
    if (event.button !== 0) return;

    // Prevent default touch/click behavior to ensure smooth event flow
    event.preventDefault();

    stop();

    // Trigger immediately
    callbackRef.current();

    // Start repeat timer
    timerRef.current = setTimeout(() => {
      intervalRef.current = setInterval(() => {
        callbackRef.current();
      }, 70);
    }, 400);
  }, [stop]);

  // Clean up timers on unmount to prevent leakages
  useEffect(() => {
    return stop;
  }, [stop]);

  return {
    onPointerDown: start,
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
  };
}
