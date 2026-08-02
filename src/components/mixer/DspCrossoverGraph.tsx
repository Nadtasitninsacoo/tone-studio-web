'use client';

import { useEffect, useRef, useState } from 'react';

import { crossoverSections, logFrequencies, measureCascade } from '@/lib/filterResponse';

interface DspCrossoverGraphProps {
  crossoverHz: number;
  onChange: (hz: number) => void;
  hudColor?: string;
  /**
   * The rate to measure at. A biquad's response is rate-dependent near Nyquist, so the
   * curve is only the filter in the signal path if this matches the engine's context.
   */
  sampleRate?: number;
}

const F_MIN = 20;
const F_MAX = 20000;
const DB_MIN = -60;
const DB_MAX = 0;

export function DspCrossoverGraph({
  crossoverHz,
  onChange,
  hudColor = 'cyan',
  sampleRate = 48000,
}: DspCrossoverGraphProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Map frequency to log X coordinate
  const getX = (freq: number, width: number) => {
    const logMin = Math.log10(F_MIN);
    const logMax = Math.log10(F_MAX);
    const logFreq = Math.log10(Math.max(F_MIN, Math.min(F_MAX, freq)));
    return ((logFreq - logMin) / (logMax - logMin)) * width;
  };

  // Map log X coordinate back to frequency
  const getFreq = (x: number, width: number) => {
    const logMin = Math.log10(F_MIN);
    const logMax = Math.log10(F_MAX);
    const logFreq = logMin + (x / width) * (logMax - logMin);
    return Math.pow(10, logFreq);
  };

  // Map dB to Y coordinate
  const getY = (db: number, height: number) => {
    const clamped = Math.max(DB_MIN, Math.min(DB_MAX, db));
    return ((DB_MAX - clamped) / (DB_MAX - DB_MIN)) * height;
  };

  // Handle resizing and canvas drawing
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) return;

      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

      const width = rect.width;
      const height = rect.height;

      ctx.clearRect(0, 0, width, height);

      // 1. Draw Grid Lines
      ctx.strokeStyle = '#27272a'; // tailwind zinc-800
      ctx.lineWidth = 1;
      ctx.font = '8px monospace';
      ctx.fillStyle = '#71717a'; // tailwind zinc-500

      // Logarithmic vertical ticks
      const ticks = [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
      ticks.forEach((t) => {
        const x = getX(t, width);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();

        // Labels for decades
        if (t === 100 || t === 1000 || t === 10000) {
          const label = t >= 1000 ? `${t / 1000}kHz` : `${t}Hz`;
          ctx.fillText(label, x + 2, height - 4);
        }
      });

      // Horizontal dB ticks
      const dbTicks = [0, -12, -24, -36, -48, -60];
      dbTicks.forEach((db) => {
        const y = getY(db, height);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
        ctx.fillText(`${db}dB`, 4, y - 2);
      });

      /**
       * The real filters' response, measured per pixel column.
       *
       * This used to be the textbook Linkwitz-Riley expression. That expression is correct
       * and it is still not the filter in the signal path: a `BiquadFilterNode` is digital,
       * its coefficients come from the bilinear transform, and the frequency axis warps
       * towards Nyquist. `getFrequencyResponse` is the browser answering for its own
       * implementation at the rate in use — see `lib/filterResponse.ts`.
       *
       * Measured at exactly the frequency of each pixel column, so nothing is interpolated:
       * the curve is the response, sampled where it is drawn. `logFrequencies` spans the
       * same axis `getX` maps, so the array index is the pixel column.
       *
       * Inside the effect rather than beside it: it depends only on values the effect
       * already lists, and hoisting it would make it a dependency of its own.
       */
      const measured =
        width < 2
          ? null
          : (() => {
              const freqs = logFrequencies(F_MIN, F_MAX, width);
              return {
                low: measureCascade(crossoverSections(crossoverHz, 'low'), freqs, sampleRate),
                high: measureCascade(crossoverSections(crossoverHz, 'high'), freqs, sampleRate),
              };
            })();

      // Null only on a browser with no `OfflineAudioContext`; the grid and the labels
      // still draw and the curves do not — an absent curve is honest, and a modelled one
      // pretending to be measured is not.

      // 2. Plot Low-pass Curve (Magenta)
      if (measured?.low) {
      ctx.beginPath();
      ctx.strokeStyle = '#d946ef'; // Fuchsia-500
      ctx.lineWidth = 2.5;
      ctx.shadowColor = '#d946ef';
      ctx.shadowBlur = 8;

      for (let x = 0; x < width; x++) {
        const y = getY(measured.low.magnitudeDb[x], height);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0; // Reset shadow
      }

      // 3. Plot High-pass Curve (Cyan/HUD color)
      const activeColor = hudColor === 'green' ? '#22c55e' : 
                          hudColor === 'cyan' ? '#06b6d4' : 
                          hudColor === 'violet' ? '#8b5cf6' : 
                          hudColor === 'amber' ? '#f59e0b' : '#ec4899';

      if (measured?.high) {
      ctx.beginPath();
      ctx.strokeStyle = activeColor;
      ctx.lineWidth = 2.5;
      ctx.shadowColor = activeColor;
      ctx.shadowBlur = 8;

      for (let x = 0; x < width; x++) {
        const y = getY(measured.high.magnitudeDb[x], height);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0; // Reset shadow
      }

      // 4. Draw Crossover point intersection marker
      const crossX = getX(crossoverHz, width);
      const crossY = getY(-6, height); // Linkwitz-Riley crosses at -6dB

      // Vertical dashed marker line
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = '#a1a1aa';
      ctx.beginPath();
      ctx.moveTo(crossX, 0);
      ctx.lineTo(crossX, height);
      ctx.stroke();
      ctx.setLineDash([]); // Reset dash

      // Drag handle circle
      ctx.fillStyle = activeColor;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(crossX, crossY, 6, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();

      // Intersection Text readout
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 9px monospace';
      ctx.fillText(`${crossoverHz.toFixed(0)}Hz`, crossX + 10, crossY - 10);
      ctx.fillText(`-6.0 dB`, crossX + 10, crossY + 3);
    };

    draw();
    window.addEventListener('resize', draw);

    return () => {
      window.removeEventListener('resize', draw);
    };
  }, [crossoverHz, hudColor, sampleRate]);

  // Drag listeners
  const handleStart = (clientX: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;

    // If click is near crossover frequency (log scale check)
    const crossX = getX(crossoverHz, rect.width);
    if (Math.abs(x - crossX) < 20) {
      setIsDragging(true);
    }
  };

  const handleMove = (clientX: number) => {
    if (!isDragging) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const freq = getFreq(x, rect.width);
    
    // Clamp between 40Hz and 600Hz
    const clampedHz = Math.max(40, Math.min(600, freq));
    onChange(clampedHz);
  };

  return (
    <div className="flex flex-col gap-2 w-full">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[9px] font-bold tracking-wider text-ink-3 uppercase">
          CROSSOVER GRAPH (4th-order Linkwitz-Riley)
        </span>
        <span className="font-mono text-[9px] font-bold text-cyan">
          SPLIT: {crossoverHz.toFixed(0)} Hz
        </span>
      </div>

      <div 
        ref={containerRef} 
        className="relative h-44 w-full rounded-xl border border-line bg-inset/70 cursor-ew-resize overflow-hidden"
        onMouseDown={(e) => handleStart(e.clientX)}
        onMouseMove={(e) => handleMove(e.clientX)}
        onMouseUp={() => setIsDragging(false)}
        onMouseLeave={() => setIsDragging(false)}
        onTouchStart={(e) => {
          if (e.touches[0]) handleStart(e.touches[0].clientX);
        }}
        onTouchMove={(e) => {
          if (e.touches[0]) handleMove(e.touches[0].clientX);
        }}
        onTouchEnd={() => setIsDragging(false)}
      >
        <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" />
      </div>
    </div>
  );
}
