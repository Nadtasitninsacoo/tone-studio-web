'use client';

import {
  AudioWaveform,
  ChevronsLeft,
  Menu,
  Mic,
  Settings,
  Sliders,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { useSidebar } from '@/hooks/useSidebar';
import { InstallApp } from './InstallApp';
import { ThemeToggle } from './ThemeToggle';

interface NavItem {
  href: string;
  label: string;
  hint: string;
  Icon: LucideIcon;
}

const NAV: NavItem[] = [
  { href: '/', label: 'Recorder', hint: 'Capture takes', Icon: Mic },
  { href: '/amp', label: 'Tone', hint: 'Amp, cabinet & AI', Icon: Zap },
  { href: '/mixer', label: 'Mixer', hint: 'Audio & DSP', Icon: Sliders },
];

/**
 * Sidebar — primary navigation.
 *
 * One component covers both breakpoints rather than duplicating the nav: on
 * desktop it is a collapsible rail, on phones the same markup becomes a slide-in
 * drawer behind a hamburger. Duplicating it would mean two lists to keep in sync
 * and two sets of active states to get wrong.
 */
export function Sidebar() {
  const pathname = usePathname();
  const [isCollapsed, setIsCollapsed] = useSidebar();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // Escape closes the drawer, matching every other overlay in the app.
  useEffect(() => {
    if (!isDrawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsDrawerOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isDrawerOpen]);

  return (
    <>
      {/* --- Mobile trigger. Fixed so it survives page scroll. ---------------- */}
      <button
        type="button"
        onClick={() => setIsDrawerOpen(true)}
        aria-label="Open navigation"
        aria-expanded={isDrawerOpen}
        className="fixed top-3 left-3 z-50 flex h-10 w-10 touch-manipulation items-center justify-center rounded-lg border border-line bg-solid text-ink shadow-panel transition-colors duration-200 hover:border-cyan/50 active:scale-95 lg:hidden"
      >
        <Menu aria-hidden className="h-4.5 w-4.5" />
      </button>

      {/* --- Mobile scrim ---------------------------------------------------- */}
      {isDrawerOpen ? (
        <div
          aria-hidden
          onClick={() => setIsDrawerOpen(false)}
          className="fixed inset-0 z-50 animate-fade-in bg-black/60 backdrop-blur-sm lg:hidden"
        />
      ) : null}

      <aside
        // `fixed` on mobile so it overlays; `sticky` on desktop so it stays beside
        // the scrolling content without a second scroll container.
        className={`fixed inset-y-0 left-0 z-50 flex flex-col border-r border-line bg-solid/75 backdrop-blur-lg transition-[width,transform] duration-300 ease-out-expo lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${
          isDrawerOpen ? 'translate-x-0' : '-translate-x-full'
        } ${isCollapsed ? 'w-[4.5rem]' : 'w-60'}`}
      >
        {/* Brand */}
        <div className="flex items-center gap-3 border-b border-line px-3.5 py-4">
          <span
            aria-hidden
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-cyan/35 bg-cyan/10 text-cyan"
          >
            <AudioWaveform className="h-4.5 w-4.5" />
          </span>

          {!isCollapsed ? (
            <div className="min-w-0 flex-1 animate-fade-in">
              <p className="truncate text-[12px] font-bold tracking-[0.18em] uppercase text-ink">
                Guitar
              </p>
              <p className="truncate font-mono text-[10px] text-ink-3">Recorder Studio</p>
            </div>
          ) : null}

          {/* Drawer close, mobile only */}
          <button
            type="button"
            onClick={() => setIsDrawerOpen(false)}
            aria-label="Close navigation"
            className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-raised hover:text-ink lg:hidden"
          >
            <X aria-hidden className="h-4 w-4" />
          </button>
        </div>

        {/* Nav */}
        <nav aria-label="Main" className="flex flex-1 flex-col gap-1 p-2.5">
          {NAV.map(({ href, label, hint, Icon }) => {
            // Exact match for the root, prefix match for sections, so a future
            // `/jam/x` still highlights Jam.
            const isActive = href === '/' ? pathname === '/' : pathname.startsWith(href);

            return (
              <Link
                key={href}
                href={href}
                onClick={() => setIsDrawerOpen(false)}
                aria-current={isActive ? 'page' : undefined}
                title={isCollapsed ? label : undefined}
                className={`group relative flex items-center gap-3 rounded-lg border px-2.5 py-2.5 transition-colors duration-200 ${
                  isActive
                    ? 'border-cyan/50 bg-cyan/12 text-cyan'
                    : 'border-transparent text-ink-2 hover:bg-raised hover:text-ink'
                }`}
              >
                {/* Active rail marker, so the state reads even when collapsed */}
                {isActive ? (
                  <span
                    aria-hidden
                    className="absolute top-1/2 -left-2.5 h-6 w-1 -translate-y-1/2 rounded-r-full bg-cyan"
                  />
                ) : null}

                <Icon aria-hidden className="h-4.5 w-4.5 shrink-0" />

                {!isCollapsed ? (
                  <span className="min-w-0 flex-1 animate-fade-in">
                    <span className="block truncate text-sm font-medium">{label}</span>
                    <span className="block truncate font-mono text-[10px] text-ink-3">{hint}</span>
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>

        {/* Footer: what is running, theme, collapse */}
        <div className="flex flex-col gap-2 border-t border-line p-2.5 lg:pb-16">
          {/* Playback survives leaving its page, so its stop button has to exist
              somewhere that does not. This is that somewhere. */}
          <InstallApp isCollapsed={isCollapsed} />

          <div className={isCollapsed ? 'flex justify-center' : 'flex items-center gap-2'}>
            <ThemeToggle className={isCollapsed ? 'scale-90' : ''} />
          </div>

          <button
            type="button"
            onClick={() => setIsCollapsed(!isCollapsed)}
            aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="group hidden items-center gap-2.5 rounded-xl border border-line/40 bg-raised/20 px-2.5 py-2 text-ink-2 shadow-sm transition-all duration-300 hover:border-cyan/50 hover:bg-cyan/6 hover:text-cyan active:scale-95 lg:flex"
          >
            <ChevronsLeft
              aria-hidden
              className={`h-4 w-4 shrink-0 transition-transform duration-300 ease-out ${
                isCollapsed
                  ? 'rotate-180 group-hover:-translate-x-1'
                  : 'group-hover:-translate-x-1'
              }`}
            />
            {!isCollapsed ? (
              <span className="animate-fade-in font-mono text-[10px] tracking-wider uppercase">
                Collapse
              </span>
            ) : null}
          </button>

          {!isCollapsed ? (
            <p className="animate-fade-in px-2.5 font-mono text-[9px] tracking-[0.16em] uppercase text-ink-3">
              <Settings aria-hidden className="mr-1 inline h-2.5 w-2.5" />
              16-bit WAV
            </p>
          ) : null}
        </div>
      </aside>
    </>
  );
}
