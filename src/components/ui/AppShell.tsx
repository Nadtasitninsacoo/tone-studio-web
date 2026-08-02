import type { ReactNode } from 'react';

import { Sidebar } from './Sidebar';

/**
 * AppShell — the frame every route renders inside.
 *
 * Deliberately plain: no background art. An earlier version painted animated
 * colour glows behind everything, which bled through the panels and over the
 * video monitor. The background's job is to stay out of the way.
 *
 * `min-w-0` on the content column is load-bearing: without it a wide child (the
 * editor timeline, a long filename) would push the flex row past the viewport and
 * reintroduce horizontal scrolling on mobile.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 lg:h-dvh">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
