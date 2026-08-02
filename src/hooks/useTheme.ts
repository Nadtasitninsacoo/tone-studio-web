'use client';

import { useSyncExternalStore } from 'react';

import {
  getServerThemeSnapshot,
  getThemeSnapshot,
  setThemePreference,
  subscribeTheme,
  type ThemeState,
} from '@/lib/theme';

export interface UseThemeResult extends ThemeState {
  setPreference: (preference: ThemeState['preference']) => void;
}

/** Subscribe to the theme store. Safe to call from any client component. */
export function useTheme(): UseThemeResult {
  const state = useSyncExternalStore(subscribeTheme, getThemeSnapshot, getServerThemeSnapshot);
  return { ...state, setPreference: setThemePreference };
}
