'use client';

import { useSyncExternalStore } from 'react';

/** The tokens the canvas visualisers need to draw themselves. */
export interface CanvasPalette {
  meterLow: string;
  meterMid: string;
  meterHigh: string;
  rec: string;
  recSoft: string;
  cyan: string;
  violet: string;
  teal: string;
  ink3: string;
  line: string;
}

/**
 * Used during SSR and as a safety net if a variable ever fails to resolve.
 *
 * The light theme's values, and they have to be kept in step with `globals.css` by
 * hand — a stale copy here is a visualiser drawn in the previous palette on the one
 * render where the variables did not resolve.
 */
const FALLBACK: CanvasPalette = {
  meterLow: '#128376',
  meterMid: '#127f90',
  meterHigh: '#e01843',
  rec: '#e01843',
  recSoft: '#f3416a',
  cyan: '#127f90',
  violet: '#7a18f8',
  teal: '#128376',
  ink3: 'rgba(28,33,70,0.68)',
  line: 'rgba(17,24,55,0.14)',
};

const VARIABLES: Record<keyof CanvasPalette, string> = {
  meterLow: '--c-meter-low',
  meterMid: '--c-meter-mid',
  meterHigh: '--c-meter-high',
  rec: '--c-rec',
  recSoft: '--c-rec-soft',
  cyan: '--c-cyan',
  violet: '--c-violet',
  teal: '--c-teal',
  ink3: '--c-ink-3',
  line: '--c-line',
};

/**
 * Cached by the <html> class list. `useSyncExternalStore` demands a referentially
 * stable snapshot, and `getComputedStyle` is too expensive to run per render.
 */
let cache: { key: string; value: CanvasPalette } | null = null;

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}

function getSnapshot(): CanvasPalette {
  const key = document.documentElement.className;
  if (cache?.key === key) return cache.value;

  const styles = getComputedStyle(document.documentElement);
  const value = { ...FALLBACK };
  for (const [token, variable] of Object.entries(VARIABLES) as [
    keyof CanvasPalette,
    string,
  ][]) {
    const resolved = styles.getPropertyValue(variable).trim();
    if (resolved) value[token] = resolved;
  }

  cache = { key, value };
  return value;
}

function getServerSnapshot(): CanvasPalette {
  return FALLBACK;
}

/**
 * Read theme colours as plain strings for `<canvas>` drawing.
 *
 * Canvas cannot inherit CSS, so the waveform visualisers resolve the same custom
 * properties the rest of the UI uses and repaint when the theme class changes.
 */
export function useCanvasPalette(): CanvasPalette {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
