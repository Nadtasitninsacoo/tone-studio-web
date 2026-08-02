'use client';

import { useSyncExternalStore } from 'react';

import {
  accentById,
  getAccentHueSnapshot,
  getAccentSnapshot,
  getServerAccentHueSnapshot,
  getServerAccentSnapshot,
  subscribeAccent,
  type Accent,
  type AccentId,
} from '@/lib/accent';

/**
 * The knobs' accent colour.
 *
 * `useSyncExternalStore` rather than state + an effect: the value comes from
 * `localStorage`, and the repo's lint forbids `setState` in an effect body for
 * exactly this case — see `lib/theme.ts`, which solves the same problem.
 *
 * Two subscriptions to one store, because each snapshot has to be a primitive.
 * A single getter returning `{ id, hue }` would allocate on every call, and
 * `useSyncExternalStore` compares snapshots by identity — it would re-render
 * without end.
 */
export function useAccent(): { id: AccentId; hue: number; accent: Accent } {
  const id = useSyncExternalStore(subscribeAccent, getAccentSnapshot, getServerAccentSnapshot);
  const hue = useSyncExternalStore(
    subscribeAccent,
    getAccentHueSnapshot,
    getServerAccentHueSnapshot,
  );
  return { id, hue, accent: accentById(id) };
}
