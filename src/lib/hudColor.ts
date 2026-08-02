/**
 * HUD Color store.
 *
 * A tiny external store rather than React state, so it can be read through
 * `useSyncExternalStore`. This avoids hydration mismatches since the server
 * renders the default color (green) and the client synchronizes the persisted state
 * from localStorage after hydration.
 */

export const HUD_STORAGE_KEY = 'guitar-hud-color';
export type HudColor = 'green' | 'cyan' | 'violet' | 'amber' | 'pink';

let hudColor: HudColor = 'green';
let started = false;

const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

function start(): void {
  if (started || typeof window === 'undefined') return;
  started = true;

  try {
    const stored = window.localStorage.getItem(HUD_STORAGE_KEY) as HudColor | null;
    if (stored && ['green', 'cyan', 'violet', 'amber', 'pink'].includes(stored)) {
      hudColor = stored;
    }
  } catch {
    // Non-fatal: Private browsing / storage disabled.
  }
}

export function subscribeHudColor(listener: () => void): () => void {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getHudColorSnapshot(): HudColor {
  start();
  return hudColor;
}

export function getServerHudColorSnapshot(): HudColor {
  return 'green';
}

export function setHudColor(next: HudColor): void {
  if (hudColor === next) return;
  hudColor = next;

  try {
    window.localStorage.setItem(HUD_STORAGE_KEY, next);
  } catch {
    // Non-fatal.
  }

  // Trigger a custom event to notify other legacy listeners
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('hud-color-changed'));
  }

  emit();
}
