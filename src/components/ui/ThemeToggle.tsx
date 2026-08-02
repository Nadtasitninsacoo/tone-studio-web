'use client';

import { Monitor, Moon, Sun } from 'lucide-react';

import { useTheme } from '@/hooks/useTheme';
import type { ThemePreference } from '@/lib/theme';

const OPTIONS: { value: ThemePreference; label: string; Icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'system', label: 'System', Icon: Monitor },
  { value: 'dark', label: 'Dark', Icon: Moon },
];

/**
 * ThemeToggle — three-way light / system / dark segmented control.
 *
 * A sliding indicator moves between segments rather than each button toggling
 * its own background, so the change reads as one continuous movement.
 */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const { preference, setPreference } = useTheme();
  const activeIndex = OPTIONS.findIndex((option) => option.value === preference);

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className={`relative flex items-center gap-0.5 rounded-lg border border-line bg-inset p-0.5 ${className}`}
    >
      {/* Sliding highlight — positioned by index so it animates between segments. */}
      <span
        aria-hidden
        className="pointer-events-none absolute top-0.5 bottom-0.5 left-0.5 w-8 rounded-md border border-cyan/50 bg-cyan/12 transition-transform duration-300 ease-out-expo"
        style={{ transform: `translateX(${Math.max(0, activeIndex) * 2}rem)` }}
      />

      {OPTIONS.map(({ value, label, Icon }) => {
        const isActive = value === preference;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={isActive}
            aria-label={`${label} theme`}
            title={`${label} theme`}
            onClick={() => setPreference(value)}
            className={`relative flex h-8 w-8 touch-manipulation items-center justify-center rounded-full transition-colors duration-200 ${
              isActive ? 'text-cyan' : 'text-ink-3 hover:text-ink-2'
            }`}
          >
            <Icon aria-hidden className="h-4 w-4" />
          </button>
        );
      })}
    </div>
  );
}
