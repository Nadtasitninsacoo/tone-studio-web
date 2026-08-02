'use client';

import { useSyncExternalStore } from 'react';

/**
 * Whether the user has asked for reduced motion.
 *
 * `prefers-reduced-motion` is a browser capability read, so it falls under the
 * same rule as `canExportVideo()`: every route here is
 * prerendered, and a probe that answers differently on the server and on the
 * first client render is a hydration mismatch. An external store read through
 * `useSyncExternalStore` hands SSR and hydration the same answer and lets React
 * re-render with the real one — the pattern `lib/theme.ts` already uses, and the
 * reason this is not `useState` + `useEffect` (which would also trip
 * `react-hooks/set-state-in-effect`).
 *
 * CSS animations do NOT need this: the `prefers-reduced-motion` block in
 * `globals.css` already neutralises all of them. This exists for motion driven
 * from JS, which has to opt in by hand.
 */

const QUERY = '(prefers-reduced-motion: reduce)';

/**
 * `false` for the first paint, by design — it matches the CSS default, where
 * motion is on until the media query says otherwise. Being wrong for one frame
 * in the reduced-motion direction is the safe way round: the CSS block has
 * already stopped every looping animation regardless of what this returns.
 */
const SERVER_SNAPSHOT = false;

let query: MediaQueryList | null = null;
let snapshot = SERVER_SNAPSHOT;

function subscribe(onStoreChange: () => void): () => void {
  const media = (query ??= window.matchMedia(QUERY));
  // Read on subscribe rather than at module scope: module init can run during
  // prerender, where `window` does not exist.
  snapshot = media.matches;

  const onChange = () => {
    snapshot = media.matches;
    onStoreChange();
  };

  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

function getSnapshot(): boolean {
  // Before the first subscribe there is nothing to read, and inventing an answer
  // here would be the probe-during-render this hook exists to avoid.
  return query ? snapshot : SERVER_SNAPSHOT;
}

function getServerSnapshot(): boolean {
  return SERVER_SNAPSHOT;
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
