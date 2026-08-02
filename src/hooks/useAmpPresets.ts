'use client';

import { useSyncExternalStore } from 'react';

import {
  getAmpPresetsSnapshot,
  getServerAmpPresetsSnapshot,
  subscribeAmpPresets,
  type SavedAmpPreset,
} from '@/lib/ampPresets';

/**
 * The user's saved amp presets.
 *
 * Read-only here; saving and deleting go through the module's functions directly,
 * the way `setAccent` does. There is no reason for a hook to re-export a plain
 * function, and doing so would make the hook a dependency of every caller that
 * only wants to write.
 */
export function useAmpPresets(): SavedAmpPreset[] {
  return useSyncExternalStore(
    subscribeAmpPresets,
    getAmpPresetsSnapshot,
    getServerAmpPresetsSnapshot,
  );
}
