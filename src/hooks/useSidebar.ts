'use client';

import { useSyncExternalStore } from 'react';

import {
  getSidebarSnapshot,
  getServerSidebarSnapshot,
  subscribeSidebar,
  setSidebarCollapsed,
} from '@/lib/sidebar';

/**
 * Hook to consume and control the sidebar collapsed state.
 *
 * Adheres to strict linting rules and avoids hydration mismatch by subscribing
 * to the localStorage-backed store via useSyncExternalStore.
 */
export function useSidebar(): readonly [boolean, (collapsed: boolean) => void] {
  const isCollapsed = useSyncExternalStore(
    subscribeSidebar,
    getSidebarSnapshot,
    getServerSidebarSnapshot,
  );

  return [isCollapsed, setSidebarCollapsed] as const;
}
