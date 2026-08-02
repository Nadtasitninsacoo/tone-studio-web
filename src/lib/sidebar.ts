/**
 * Sidebar store.
 *
 * A tiny external store rather than React state, so it can be read through
 * `useSyncExternalStore`. This avoids hydration mismatches since the server
 * renders the expanded sidebar and the client synchronizes the persisted state
 * from localStorage after hydration.
 */

export const SIDEBAR_STORAGE_KEY = 'gr-sidebar-collapsed';

let isCollapsed = false;
let started = false;

const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

function start(): void {
  if (started || typeof window === 'undefined') return;
  started = true;

  try {
    const stored = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    isCollapsed = stored === 'true';
  } catch {
    // Non-fatal: Private browsing / storage disabled.
  }
}

export function subscribeSidebar(listener: () => void): () => void {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSidebarSnapshot(): boolean {
  start();
  return isCollapsed;
}

export function getServerSidebarSnapshot(): boolean {
  return false;
}

export function setSidebarCollapsed(next: boolean): void {
  if (isCollapsed === next) return;
  isCollapsed = next;

  try {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
  } catch {
    // Non-fatal: the collapsed state still applies for this session.
  }

  emit();
}
