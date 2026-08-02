'use client';

import { useSyncExternalStore } from 'react';

/**
 * Nothing to subscribe to: a browser either has an API or it does not, and that
 * cannot change while the page is open.
 */
const noSubscription = () => () => {};

/** Every capability is absent on the server, where there is no browser at all. */
const absentOnServer = () => false;

/**
 * Read a "can this browser do X" flag without breaking hydration.
 *
 * Asking a browser API during render is a hydration mismatch waiting to happen:
 * the server has no `MediaRecorder` and no `navigator`, so it renders the disabled
 * button with its "not supported" tooltip, the client renders the enabled one, and
 * React reports that the tree it hydrated does not match. React can neither patch
 * up attributes nor be argued with here.
 *
 * `useSyncExternalStore` is the sanctioned way out — the same mechanism
 * [lib/theme.ts](../lib/theme.ts) uses for the pre-paint theme. The server snapshot
 * is what SSR *and* hydration both see, then React re-renders with the real value.
 * The alternative, setting state in an effect, is a lint error in this project and
 * still paints the wrong state for a frame.
 *
 * `probe` must return a primitive and stay stable, or the store will re-render
 * forever. Booleans compare by value, so any predicate is fine.
 */
export function useClientCapability(probe: () => boolean): boolean {
  return useSyncExternalStore(noSubscription, probe, absentOnServer);
}
