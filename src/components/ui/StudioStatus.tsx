'use client';

import { useCallback, useRef } from 'react';

import { useRecorderStudio } from '@/components/providers/StudioProviders';
import { useAnimationFrame } from '@/hooks/useAnimationFrame';
import { INSTRUMENTS } from '@/lib/rig';

/** −60 dBFS is silence for a bar this small; anything quieter is not worth a pixel. */
const FLOOR_DB = -60;

function dbToWidth(db: number): number {
  if (!Number.isFinite(db) || db <= FLOOR_DB) return 0;
  return Math.min(100, ((db - FLOOR_DB) / -FLOOR_DB) * 100);
}

interface StudioStatusProps {
  isCollapsed: boolean;
}

/**
 * StudioStatus — what the engine is doing, on every page.
 *
 * ---------------------------------------------------------------------------
 * The sidebar had a column of empty space under the nav, and the app had a whole day of
 * debugging in which **every control on screen read correctly while the page was silent**.
 * Those two facts belong together: the four numbers that would have ended that day early
 * are all cheap to show and none of them were anywhere.
 *
 * So this reports the things that are invisible from a rack:
 *
 * - **Signal.** A meter that is moving separates "no sound" from "no signal", which is the
 *   first fork in every one of these and was guessed at for hours.
 * - **Who owns the live monitor.** Since it moves on a press rather than on a navigation,
 *   there is otherwise no way to tell from a page that does not own it.
 * - **Racks live.** The load, in the only unit that predicts a dropout on this machine.
 * - **Buffer and quality.** Both are the difference between clean and broken up, and both
 *   are otherwise only visible on the Rig page's output row.
 *
 * **It is a child of the sidebar, not part of it.** The sidebar itself reads no context, so
 * it does not re-render when the transport does; putting the subscription here keeps that
 * true and confines the re-render to this block.
 *
 * The meter is painted from a ref inside one animation frame, never from state — the rule
 * this app applies to every meter, because 60 re-renders a second of anything mounted this
 * high would be paid for by every page at once.
 * ---------------------------------------------------------------------------
 */
export function StudioStatus({ isCollapsed }: StudioStatusProps) {
  const { recorder } = useRecorderStudio();
  const barRef = useRef<HTMLSpanElement | null>(null);

  const isLive = recorder.status !== 'idle' && recorder.status !== 'error';
  const liveRacks = INSTRUMENTS.filter((id) => recorder.enabled[id]).length;
  const ownsMonitor = recorder.monitorScope === 'recorder';

  /**
   * A callback ref, not a ref object handed back from a hook.
   *
   * `react-hooks/refs` flags any member read on an object that holds a ref, and rightly:
   * the value read during render is whatever the last commit left behind. Assigning the
   * node here and reading it only inside the frame keeps the read out of render entirely.
   */
  const setBar = useCallback((node: HTMLSpanElement | null) => {
    barRef.current = node;
  }, []);

  useAnimationFrame(() => {
    const bar = barRef.current;
    if (!bar) return;
    const peaks = recorder.meterRef.current?.peak;
    const loudest = peaks && peaks.length > 0 ? Math.max(...peaks) : FLOOR_DB;
    bar.style.width = `${dbToWidth(loudest)}%`;
  }, isLive);

  if (isCollapsed) {
    return (
      <div
        title={`${isLive ? 'Signal open' : 'No input'} · ${liveRacks} racks · ${recorder.bufferMs} ms · ${recorder.rigQuality}`}
        className="flex flex-col items-center gap-1 py-1"
      >
        <span
          aria-hidden
          className={`h-1.5 w-1.5 rounded-full ${isLive ? 'bg-cyan' : 'bg-ink-3/40'}`}
        />
        <span className="font-mono text-[9px] tabular-nums text-ink-3">{liveRacks}</span>
      </div>
    );
  }

  return (
    <div className="animate-fade-in rounded-lg border border-line/50 bg-inset/40 px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[9px] font-bold tracking-[0.16em] uppercase text-ink-3">
          Engine
        </span>
        <span
          className={`font-mono text-[9px] tracking-wider uppercase ${
            isLive ? 'text-cyan' : 'text-ink-3/60'
          }`}
        >
          {isLive ? 'signal open' : 'no input'}
        </span>
      </div>

      {/* Peak of whichever channel is loudest. One bar, because this answers "is anything
          arriving", not "how is the balance" — the real meters are two clicks away. */}
      <span aria-hidden className="mt-1.5 block h-1 w-full overflow-hidden rounded-full bg-raised">
        <span
          ref={setBar}
          className={`block h-full rounded-full transition-[background-color] duration-200 ${
            isLive ? 'bg-cyan' : 'bg-transparent'
          }`}
          style={{ width: '0%' }}
        />
      </span>

      <dl className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 font-mono text-[9px] tracking-wider uppercase">
        {/* Names the side, never "here". This block is mounted in the sidebar, which is on
            every page — so "here" read as "this page owns the sound" while standing on the
            mixer with the Rig side owning it, which is precisely the thing it exists to
            report and precisely backwards. */}
        <dt className="text-ink-3">Monitor</dt>
        <dd className={`text-right ${ownsMonitor ? 'text-cyan' : 'text-amber'}`}>
          {ownsMonitor ? 'rig' : 'mixer'}
        </dd>

        <dt className="text-ink-3">Racks</dt>
        <dd className="text-right tabular-nums text-ink-2">{liveRacks}/{INSTRUMENTS.length}</dd>

        <dt className="text-ink-3">Buffer</dt>
        <dd className="text-right tabular-nums text-ink-2">{recorder.bufferMs} ms</dd>

        <dt className="text-ink-3">Mode</dt>
        <dd className={`text-right ${recorder.rigQuality === 'full' ? 'text-ink-2' : 'text-amber'}`}>
          {recorder.rigQuality}
        </dd>
      </dl>
    </div>
  );
}
