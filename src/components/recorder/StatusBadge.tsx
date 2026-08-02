import { AlertTriangle, CircleDot, Loader2, Pause, PowerOff, Radio, RefreshCw } from 'lucide-react';

import type { RecorderStatus } from '@/types/recorder';

interface StatusBadgeProps {
  status: RecorderStatus;
  className?: string;
}

/**
 * Per-state copy and styling.
 *
 * Red is reserved exclusively for "live" and "broken" — every other state is
 * greyscale, which is what makes the recording state impossible to misread.
 */
const PRESETS: Record<
  RecorderStatus,
  { label: string; short: string; classes: string; dot: string; Icon: typeof Radio }
> = {
  idle: {
    label: 'No Input',
    short: 'Idle',
    classes: 'border-line bg-raised text-ink-3',
    dot: 'bg-ink-3',
    Icon: PowerOff,
  },
  arming: {
    label: 'Opening Device',
    short: 'Opening',
    classes: 'border-line-strong bg-raised text-ink-2',
    dot: 'bg-ink-2',
    Icon: Loader2,
  },
  ready: {
    label: 'Armed',
    short: 'Armed',
    classes: 'border-cyan/45 bg-cyan/12 text-cyan',
    dot: 'bg-cyan',
    Icon: CircleDot,
  },
  recording: {
    label: 'Recording',
    short: 'Rec',
    classes: 'border-rec/55 bg-rec/12 text-rec',
    dot: 'bg-rec',
    Icon: Radio,
  },
  paused: {
    label: 'Paused',
    short: 'Hold',
    classes: 'border-line-strong bg-inset text-ink-2',
    dot: 'bg-ink-2',
    Icon: Pause,
  },
  /**
   * Greyscale, and shaped like `arming` rather than like `error`.
   *
   * That is the whole message: the device dropped out and is being reopened, which
   * is the same kind of event as opening it in the first place. Red here would say
   * the session had failed — it has not, and the banner below explains it.
   */
  recovering: {
    label: 'Reconnecting',
    short: 'Recon',
    classes: 'border-line-strong bg-raised text-ink-2',
    dot: 'bg-ink-2',
    Icon: RefreshCw,
  },
  error: {
    label: 'Device Error',
    short: 'Error',
    classes: 'border-rec/55 bg-rec/8 text-rec',
    dot: 'bg-rec',
    Icon: AlertTriangle,
  },
};

/**
 * StatusBadge — single source of truth for "what is the engine doing right now".
 * Announced politely so screen readers pick up transport changes. The label
 * shortens on narrow screens rather than wrapping or truncating.
 */
export function StatusBadge({ status, className = '' }: StatusBadgeProps) {
  const { label, short, classes, dot, Icon } = PRESETS[status];
  const isLive = status === 'recording';
  // Both states are "the engine is working on the device", and both spin.
  const isBusy = status === 'arming' || status === 'recovering';

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1.5 backdrop-blur-sm text-[11px] font-semibold tracking-wider uppercase transition-colors duration-300 sm:px-3 sm:text-xs ${classes} ${className}`}
    >
      <span className="relative flex h-2 w-2 shrink-0">
        {isLive ? (
          <span aria-hidden className={`absolute inset-0 animate-rec-ring rounded-full ${dot}`} />
        ) : null}
        <span
          aria-hidden
          className={`relative h-2 w-2 rounded-full transition-colors duration-300 ${dot} ${
            isLive || isBusy ? 'animate-led-blink' : ''
          }`}
        />
      </span>

      <Icon aria-hidden className={`h-3.5 w-3.5 ${isBusy ? 'animate-spin' : ''}`} />

      {/* Full wording from `sm` up, abbreviation on phones. */}
      <span className="hidden sm:inline">{label}</span>
      <span className="sm:hidden">{short}</span>
    </div>
  );
}
