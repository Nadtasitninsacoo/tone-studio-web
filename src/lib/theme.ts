/**
 * Theme store.
 *
 * A tiny external store rather than React state, so it can be read through
 * `useSyncExternalStore`. That matters for correctness: the theme is decided by
 * a pre-paint inline script (see `layout.tsx`) before React exists, so React
 * must *read* the existing value rather than own it — otherwise the first client
 * render disagrees with the server HTML.
 */

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'gr-theme';

export interface ThemeState {
  /** What the user chose. */
  preference: ThemePreference;
  /** What that resolves to right now, after consulting the OS setting. */
  resolved: ResolvedTheme;
}

/** Server render and hydration both use this, so the markup always matches. */
const SERVER_STATE: ThemeState = { preference: 'system', resolved: 'light' };

let preference: ThemePreference = 'system';
let resolved: ResolvedTheme = 'light';
let started = false;

/** Cached snapshot — `useSyncExternalStore` requires a stable reference. */
let snapshot: ThemeState = SERVER_STATE;

const listeners = new Set<() => void>();

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false;
}

function resolve(next: ThemePreference): ResolvedTheme {
  return next === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : next;
}

function refreshSnapshot(): void {
  if (snapshot.preference !== preference || snapshot.resolved !== resolved) {
    snapshot = { preference, resolved };
  }
}

function emit(): void {
  listeners.forEach((listener) => listener());
}

/**
 * Read the persisted preference once. Intentionally does NOT touch the DOM — the
 * inline script has already applied the correct class, and writing to the DOM
 * from a render-phase read would be a side effect during render.
 */
function start(): void {
  if (started || typeof window === 'undefined') return;
  started = true;

  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      preference = stored;
    }
  } catch {
    // Private browsing / storage disabled — fall back to following the system.
  }

  resolved = resolve(preference);
  refreshSnapshot();

  // Follow the OS while the user is on "system".
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (preference !== 'system') return;
    resolved = resolve('system');
    applyToDocument();
    refreshSnapshot();
    emit();
  });
}

/** Write the resolved theme onto <html>. Called from event handlers only. */
function applyToDocument(): void {
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  root.style.colorScheme = resolved;
}

export function subscribeTheme(listener: () => void): () => void {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getThemeSnapshot(): ThemeState {
  start();
  return snapshot;
}

export function getServerThemeSnapshot(): ThemeState {
  return SERVER_STATE;
}

export function setThemePreference(next: ThemePreference): void {
  preference = next;
  resolved = resolve(next);

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // Non-fatal: the theme still applies for this session.
  }

  applyToDocument();
  refreshSnapshot();
  emit();
}
