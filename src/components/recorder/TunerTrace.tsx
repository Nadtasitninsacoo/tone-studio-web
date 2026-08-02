'use client';

import { useEffect, useRef, type RefObject } from 'react';

import { useAnimationFrame } from '@/hooks/useAnimationFrame';
import { useCanvasPalette } from '@/hooks/useCanvasPalette';
import { IN_TUNE_CENTS, METER_RANGE_CENTS } from '@/lib/tuner';

/** What the panel writes each frame for the trace to read. */
export interface TraceSample {
  /** Deviation from the target in cents. */
  cents: number;
  /** False when nothing is being played — drawn as a gap, not as zero. */
  live: boolean;
  inTune: boolean;
}

interface TunerTraceProps {
  sampleRef: RefObject<TraceSample>;
  active: boolean;
}

/** Frames of history kept. 240 at 60 fps is four seconds. */
const COLUMNS = 240;

/** Vertical padding so the ±50 lines are not flush against the border. */
const PAD = 6;

/**
 * TunerTrace — the last few seconds of tuning error, as a line.
 *
 * The needle answers "am I sharp or flat right now". It cannot answer the
 * question people actually have while turning a peg, which is **"is this
 * settling, and which way was I going"** — a needle at +3 cents looks identical
 * whether it is on its way to zero or on its way to +30.
 *
 * A trace answers both at a glance, and it also makes the one thing a beginner
 * cannot otherwise see visible: the wobble. A note that is dead on but drifting
 * two cents either side is a note that was plucked too hard or a string that is
 * not settled, and on a graph that is obvious where on a needle it is just
 * unsteadiness.
 *
 * Canvas rather than DOM: this is 240 points redrawn at display rate, and it is
 * driven from an animation frame so React never re-renders for it. Colours come
 * from `useCanvasPalette` because canvas cannot inherit CSS.
 */
export function TunerTrace({ sampleRef, active }: TunerTraceProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const history = useRef<Float32Array>(new Float32Array(COLUMNS).fill(NaN));
  const writeIndex = useRef(0);
  const palette = useCanvasPalette();

  // Kept in a ref so a theme change never restarts the draw loop.
  const paletteRef = useRef(palette);
  useEffect(() => {
    paletteRef.current = palette;
  }, [palette]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      canvas.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  // Drop the trail when the tuner stops, so a stale line is not left implying
  // the tuner is still watching.
  useEffect(() => {
    if (active) return;
    history.current.fill(NaN);
    writeIndex.current = 0;
  }, [active]);

  useAnimationFrame(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const sample = sampleRef.current;
    history.current[writeIndex.current] = sample?.live
      ? Math.max(-METER_RANGE_CENTS, Math.min(METER_RANGE_CENTS, sample.cents))
      : NaN;
    writeIndex.current = (writeIndex.current + 1) % COLUMNS;

    const colors = paletteRef.current;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.width / dpr;
    const height = canvas.height / dpr;
    const middle = height / 2;
    const scale = (middle - PAD) / METER_RANGE_CENTS;
    const yOf = (cents: number) => middle - cents * scale;

    ctx.clearRect(0, 0, width, height);

    // The in-tune band, drawn as a place rather than stated as a number. Anything
    // inside this stripe is done.
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = colors.teal;
    ctx.fillRect(0, yOf(IN_TUNE_CENTS), width, yOf(-IN_TUNE_CENTS) - yOf(IN_TUNE_CENTS));

    // ±25 cent guides.
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = colors.line;
    for (const mark of [-25, 25]) ctx.fillRect(0, yOf(mark), width, 1);

    // Dead centre.
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = colors.teal;
    ctx.fillRect(0, yOf(0) - 0.5, width, 1);

    // ---- The trace ---------------------------------------------------------
    const step = width / (COLUMNS - 1);
    ctx.globalAlpha = 1;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = sample?.inTune ? colors.teal : colors.cyan;

    // One path per unbroken run, so silence reads as a gap in the line instead of
    // a stroke back to the middle that looks like a note at concert pitch.
    ctx.beginPath();
    let drawing = false;
    for (let column = 0; column < COLUMNS; column += 1) {
      const index = (writeIndex.current + column) % COLUMNS;
      const value = history.current[index];
      if (Number.isNaN(value)) {
        drawing = false;
        continue;
      }
      const x = column * step;
      const y = yOf(value);
      if (drawing) ctx.lineTo(x, y);
      else {
        ctx.moveTo(x, y);
        drawing = true;
      }
    }
    ctx.stroke();

    // The newest point, marked. The right-hand edge is "now"; without a dot the
    // eye has to guess where the line ends when it is nearly flat.
    const latest = history.current[(writeIndex.current - 1 + COLUMNS) % COLUMNS];
    if (!Number.isNaN(latest)) {
      ctx.fillStyle = sample?.inTune ? colors.teal : colors.cyan;
      ctx.beginPath();
      ctx.arc(width - 2, yOf(latest), 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }, active);

  return (
    <div className="relative h-16 overflow-hidden rounded-md border border-line bg-inset sm:h-20">
      <canvas ref={canvasRef} className="h-full w-full" aria-hidden />

      {/* Scale, drawn in DOM so it stays crisp and translatable. */}
      <span className="pointer-events-none absolute top-1 left-2 font-mono text-[9px] tracking-wider text-ink-3">
        +50¢ sharp
      </span>
      <span className="pointer-events-none absolute bottom-1 left-2 font-mono text-[9px] tracking-wider text-ink-3">
        −50¢ flat
      </span>
      <span className="pointer-events-none absolute right-2 bottom-1 font-mono text-[9px] tracking-wider text-ink-3">
        now
      </span>

      {!active ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="px-4 text-center font-mono text-[9px] tracking-[0.2em] uppercase text-ink-3">
            Turn the tuner on to see the last few seconds
          </p>
        </div>
      ) : null}
    </div>
  );
}
