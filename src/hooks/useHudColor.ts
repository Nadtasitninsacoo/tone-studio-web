'use client';

import { useSyncExternalStore } from 'react';
import { subscribeHudColor, getHudColorSnapshot, getServerHudColorSnapshot, type HudColor } from '@/lib/hudColor';

export function useHudColor(): HudColor {
  return useSyncExternalStore(subscribeHudColor, getHudColorSnapshot, getServerHudColorSnapshot);
}
