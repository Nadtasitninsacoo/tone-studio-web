'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { isStripActive, stripSections, STRIP_RANGES, type ChannelStrip } from '@/lib/channelStrip';
import { logFrequencies, measureCascade } from '@/lib/filterResponse';

/**
 * The selected channel's EQ curve, measured rather than drawn.
 *
 * ---------------------------------------------------------------------------
 * Every point on this line comes out of `BiquadFilterNode.getFrequencyResponse`,
 * asked of nodes built from the same `stripSections` the desk's graph builds its
 * filters from. It is not a sketch of what a shelf "looks like": it is the
 * browser's own answer for its own implementation at the rate in use, which is the
 * standard `DspCrossoverGraph` already set on this page and the only one worth
 * holding a curve to.
 *
 * That matters more here than it looks. A hand-drawn EQ curve is a picture of the
 * developer's belief about a filter, and the two drift silently — which is the
 * failure this codebase has now met three times as *two answers to one question*.
 * One description, measured once, drawn once.
 *
 * The compressor and the alignment delay are deliberately absent. A compressor's
 * curve maps level to level and the delay moves phase; putting either on a
 * magnitude-versus-frequency plot would be a different measurement wearing this
 * one's clothes.
 * ---------------------------------------------------------------------------
 */

/** Vertical range, in dB. One band can reach ±15, so ±18 leaves the curve room. */
const DB_RANGE = 18;
const F_MIN = 20;
const F_MAX = 20000;

/** Where the gridlines and their labels sit. */
const GRID_HZ = [100, 1000, 10000];
const GRID_DB = [12, 6, 0, -6, -12];

interface StripEqGraphProps {
  strip: ChannelStrip | null;
  channelName: string | null;
}

export function StripEqGraph({ strip, channelName }: StripEqGraphProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const height = 190;

  // Measured rather than assumed: the panel is inside a responsive grid, and a
  // curve plotted to a guessed width is a curve plotted to the wrong axis.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const observer = new ResizeObserver((entries) => {
      const next = Math.floor(entries[0].contentRect.width);
      // Only on a real change: a ResizeObserver that writes state every callback
      // can re-enter its own observation and loop.
      setWidth((current) => (current === next ? current : next));
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  /**
   * Derived, not stored.
   *
   * The first version measured in an effect and wrote the result to state, which is
   * the one lint rule this codebase trips over most — a synchronous `setState` in an
   * effect body, cascading a second render for something that was never external
   * state to begin with. The curve is a pure function of the strip and the width;
   * `useMemo` says so and computes it in the render that needs it.
   *
   * It is also what keeps hydration honest. `measureCascade` returns null on the
   * server, and `width` is 0 until the observer has measured, so the server and the
   * client's first paint agree on an empty plot and the curve arrives with the
   * width — rather than the server rendering nothing and the client rendering a
   * line, which React reports and cannot patch.
   */
  const { path, peak } = useMemo(() => {
    const empty = { path: '', peak: null as { hz: number; db: number } | null };
    if (!strip || width <= 0) return empty;

    const frequencies = logFrequencies(F_MIN, F_MAX, width);
    /**
     * 48 kHz, not the live context's rate.
     *
     * A biquad's response depends on the sample rate — that is what the bilinear
     * transform does — so a curve is only true for one. Asking the desk's context
     * would tie this to an engine that may be parked, and the difference between
     * 44.1 and 48 on these corners is far below a pixel. Named rather than hidden.
     */
    const response = measureCascade(stripSections(strip), frequencies, 48000);
    // No OfflineAudioContext — server render, or a browser that refuses one. An
    // empty plot is honest; a straight line would claim the EQ is flat.
    if (!response) return empty;

    const x = (index: number) => (index / (frequencies.length - 1)) * width;
    const y = (db: number) => height / 2 - (db / DB_RANGE) * (height / 2);

    let d = '';
    let worst = { hz: 0, db: 0 };
    for (let i = 0; i < frequencies.length; i += 1) {
      const db = response.magnitudeDb[i];
      d += `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(db).toFixed(1)}`;
      if (Math.abs(db) > Math.abs(worst.db)) worst = { hz: frequencies[i], db };
    }
    return { path: d, peak: Math.abs(worst.db) >= 0.5 ? worst : null };
  }, [strip, width, height]);

  const active = strip ? isStripActive(strip) : false;
  const xOf = (hz: number) =>
    (Math.log10(hz / F_MIN) / Math.log10(F_MAX / F_MIN)) * width;
  const yOf = (db: number) => height / 2 - (db / DB_RANGE) * (height / 2);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <h4 className="font-mono text-[10px] font-bold tracking-[0.14em] uppercase text-ink-2">
          Channel EQ
        </h4>
        {channelName ? (
          <span className="rounded border border-line bg-inset px-1.5 py-0.5 font-mono text-[9px] text-ink-3">
            {channelName}
          </span>
        ) : null}
        <span className="flex-1" />
        {/* The one number worth printing beside a curve: where it departs most from
            flat. Reading a peak off a plot is guesswork, and the cascade already
            knows. */}
        {peak ? (
          <span className="font-mono text-[9px] tabular-nums text-cyan">
            {peak.db > 0 ? '+' : ''}
            {peak.db.toFixed(1)} dB @{' '}
            {peak.hz >= 1000 ? `${(peak.hz / 1000).toFixed(1)}k` : Math.round(peak.hz)} Hz
          </span>
        ) : (
          <span className="font-mono text-[9px] text-ink-3">flat</span>
        )}
      </div>

      <div
        ref={boxRef}
        className="relative w-full overflow-hidden rounded-lg border border-line bg-inset"
        style={{ height }}
      >
        {width > 0 ? (
          <svg width={width} height={height} className="block">
            {GRID_DB.map((db) => (
              <g key={db}>
                <line
                  x1={0}
                  x2={width}
                  y1={yOf(db)}
                  y2={yOf(db)}
                  className={db === 0 ? 'stroke-line-strong' : 'stroke-line'}
                  strokeWidth={db === 0 ? 1 : 0.5}
                  strokeDasharray={db === 0 ? undefined : '2 3'}
                />
                <text
                  x={3}
                  y={yOf(db) - 2}
                  className="fill-ink-3 font-mono"
                  style={{ fontSize: 7 }}
                >
                  {db > 0 ? `+${db}` : db}
                </text>
              </g>
            ))}
            {GRID_HZ.map((hz) => (
              <g key={hz}>
                <line
                  x1={xOf(hz)}
                  x2={xOf(hz)}
                  y1={0}
                  y2={height}
                  className="stroke-line"
                  strokeWidth={0.5}
                  strokeDasharray="2 3"
                />
                <text
                  x={xOf(hz) + 3}
                  y={height - 3}
                  className="fill-ink-3 font-mono"
                  style={{ fontSize: 7 }}
                >
                  {hz >= 1000 ? `${hz / 1000}k` : hz}
                </text>
              </g>
            ))}

            {path ? (
              <>
                {/* A soft wash under the line, clipped to the plot, so a boost and a
                    cut are distinguishable at a glance rather than only by reading
                    which side of centre the line is on. */}
                <path
                  d={`${path} L${width} ${height / 2} L0 ${height / 2} Z`}
                  className={active ? 'fill-cyan/10' : 'fill-transparent'}
                />
                <path
                  d={path}
                  fill="none"
                  className={active ? 'stroke-cyan' : 'stroke-ink-3'}
                  strokeWidth={1.5}
                  strokeLinejoin="round"
                />
              </>
            ) : null}
          </svg>
        ) : null}

        {!strip ? (
          <p className="absolute inset-0 flex items-center justify-center font-mono text-[9px] text-ink-3">
            เลือกช่องบนโต๊ะ
          </p>
        ) : null}
      </div>

      <p className="font-mono text-[8px] leading-tight text-ink-3/70">
        วัดจาก `getFrequencyResponse` ของเบราว์เซอร์เอง ที่ 48 kHz — ไม่ใช่เส้นที่วาดขึ้นมา ·
        ตัดต่ำ {STRIP_RANGES.hpfHz[0]}–{STRIP_RANGES.hpfHz[1]} Hz · คอมเพรสเซอร์กับ
        alignment ไม่อยู่ในกราฟนี้ เพราะวัดคนละแกน
      </p>
    </div>
  );
}
