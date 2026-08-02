'use client';

import { Check, X } from 'lucide-react';
import { useCallback, useEffect, useRef, type CSSProperties } from 'react';

import { formatBytes, formatDuration } from '@/lib/format';
import type { VideoImportSummary } from '@/types/media';

/** How long the confirmation stays up before it retires itself. */
const DWELL_MS = 6500;

interface ImportToastProps {
  summary: VideoImportSummary;
  /**
   * Must be stable (a `useCallback`), because the dwell timer is re-armed
   * whenever it changes identity.
   */
  onDismiss: () => void;
  /**
   * Vertical placement, **replacing** the default rather than adding to it: two
   * competing `bottom-*` utilities resolve by stylesheet order, not by the order
   * they are written here, so the winner would be luck.
   */
  offset?: string;
}

/**
 * ImportToast — transient confirmation that a video landed.
 *
 * Deliberately a toast, unlike the errors on these pages: failures stay pinned
 * next to the control that caused them because they need acting on, whereas a
 * success only has to be *seen*. Keeping it out of the message row also means it
 * cannot reflow the monitor at the moment the picture appears.
 *
 * Mount it with `key={summary.id}` so a second import restarts the entrance and
 * the dwell instead of quietly reusing the first one's.
 */
export function ImportToast({
  summary,
  onDismiss,
  offset = 'bottom-3 sm:bottom-4',
}: ImportToastProps) {
  const timerRef = useRef<number | null>(null);

  const cancel = useCallback(() => {
    if (timerRef.current === null) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const arm = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(onDismiss, DWELL_MS);
  }, [onDismiss]);

  useEffect(() => {
    arm();
    return cancel;
  }, [arm, cancel]);

  const resolution = summary.width > 0 && summary.height > 0;

  return (
    <div
      className={`pointer-events-none fixed inset-x-3 z-50 flex justify-center sm:inset-x-auto sm:right-4 sm:justify-end ${offset}`}
    >
      <div
        role="status"
        aria-live="polite"
        // Hovering or tabbing in holds the toast open: the filename is the one
        // thing here worth reading slowly, and it must not vanish mid-read.
        onPointerEnter={cancel}
        onPointerLeave={arm}
        onFocus={cancel}
        onBlur={arm}
        className="group pointer-events-auto relative w-full max-w-sm animate-toast-in overflow-hidden rounded-xl border border-teal/45 bg-solid shadow-lifted"
      >
        {/* Accent wash, opaque surface underneath. Translucency here would let
            the timeline scroll through the text. */}
        <span
          aria-hidden
          className="absolute inset-0 bg-linear-to-r from-teal/12 via-transparent to-transparent"
        />

        <div className="relative flex items-start gap-3 p-3">
          {/* Poster frame. Frame zero is usually black, so it seeks a little in.
              If the browser paints nothing, the badge still identifies it. */}
          <div className="relative aspect-video w-20 shrink-0 overflow-hidden rounded-lg border border-line bg-inset">
            <video
              src={summary.url}
              muted
              playsInline
              preload="metadata"
              aria-hidden
              onLoadedMetadata={(event) => {
                const element = event.currentTarget;
                if (Number.isFinite(element.duration)) {
                  element.currentTime = Math.min(1, element.duration * 0.1);
                }
              }}
              className="h-full w-full object-cover"
            />
            <span
              aria-hidden
              className="absolute -right-1 -bottom-1 flex h-5 w-5 animate-pop-in items-center justify-center rounded-full border border-teal/60 bg-solid text-teal"
            >
              <Check className="h-3 w-3" strokeWidth={3} />
            </span>
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold tracking-[0.14em] uppercase text-teal">
              Video imported
            </p>
            <p className="mt-0.5 truncate font-mono text-[11px] text-ink" title={summary.name}>
              {summary.name}
            </p>
            <p className="mt-1 truncate font-mono text-[10px] text-ink-3">
              {formatDuration(summary.durationSec)}
              {resolution ? ` · ${summary.width}×${summary.height}` : ''}
              {summary.bytes > 0 ? ` · ${formatBytes(summary.bytes)}` : ''}
            </p>
            {/* Only stated when the page actually decoded the track, so silence
                here never implies the original audio is present. */}
            {summary.hasBacking === null ? null : (
              <p
                className={`mt-1 text-[10px] ${summary.hasBacking ? 'text-ink-2' : 'text-rec'}`}
              >
                {summary.hasBacking
                  ? 'Original audio ready — play along.'
                  : 'Original audio could not be decoded.'}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="-m-1 shrink-0 rounded p-1 text-ink-3 transition-colors duration-150 hover:bg-raised hover:text-ink"
          >
            <X aria-hidden className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Dwell countdown. Hidden under reduced motion, where the animation is
            forced to no duration and a frozen empty bar would read as broken. */}
        <span
          aria-hidden
          style={{ '--toast-dwell': `${DWELL_MS}ms` } as CSSProperties}
          className="absolute inset-x-0 bottom-0 h-0.5 origin-left animate-toast-timer bg-teal/70 group-hover:[animation-play-state:paused] motion-reduce:hidden"
        />
      </div>
    </div>
  );
}
