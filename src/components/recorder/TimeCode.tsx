'use client';

import { useRef, type RefObject } from 'react';
import { useHudColor } from '@/hooks/useHudColor';
import { Battery, Bluetooth, Signal } from 'lucide-react';

import { useAnimationFrame } from '@/hooks/useAnimationFrame';
import { formatCentiseconds, formatTimecode } from '@/lib/format';
import type { RecorderStatus } from '@/types/recorder';

interface TimeCodeProps {
  /** High-resolution elapsed seconds, owned by the recorder engine. */
  elapsedRef: RefObject<number>;
  status: RecorderStatus;
}

const LCD_THEMES = {
  green: {
    text: 'text-[#4ade80]',
    glow: 'drop-shadow-[0_0_8px_rgba(74,222,128,0.55)]',
    border: 'border-[#4ade80]/30',
    bg: 'bg-[#4ade80]/5',
    led: 'bg-[#4ade80]'
  },
  cyan: {
    text: 'text-cyan',
    glow: 'drop-shadow-[0_0_8px_rgba(18,127,144,0.55)]',
    border: 'border-cyan/30',
    bg: 'bg-cyan/5',
    led: 'bg-cyan'
  },
  violet: {
    text: 'text-violet',
    glow: 'drop-shadow-[0_0_8px_rgba(122,24,248,0.55)]',
    border: 'border-violet/30',
    bg: 'bg-violet/5',
    led: 'bg-violet'
  },
  amber: {
    text: 'text-amber',
    glow: 'drop-shadow-[0_0_8px_rgba(245,158,11,0.55)]',
    border: 'border-amber/30',
    bg: 'bg-amber/5',
    led: 'bg-amber'
  },
  pink: {
    text: 'text-pink',
    glow: 'drop-shadow-[0_0_8px_rgba(236,72,153,0.55)]',
    border: 'border-pink/30',
    bg: 'bg-pink/5',
    led: 'bg-pink'
  }
};

// LCD theme type definition derived from external store

export function TimeCode({ elapsedRef, status }: TimeCodeProps) {
  const mainRef = useRef<HTMLSpanElement>(null);
  const centiRef = useRef<HTMLSpanElement>(null);
  const lastMain = useRef('');
  const lastCenti = useRef('');

  const isRecording = status === 'recording';
  const isPaused = status === 'paused';

  const hudColor = useHudColor();

  useAnimationFrame(() => {
    const elapsed = elapsedRef.current ?? 0;

    // Only touch the DOM when the rendered text actually changes.
    const main = formatTimecode(elapsed);
    if (main !== lastMain.current && mainRef.current) {
      mainRef.current.textContent = main;
      lastMain.current = main;
    }

    const centi = formatCentiseconds(elapsed);
    if (centi !== lastCenti.current && centiRef.current) {
      centiRef.current.textContent = centi;
      lastCenti.current = centi;
    }
  }, isRecording || isPaused);

  const theme = LCD_THEMES[hudColor];

  return (
    <div
      className={`relative flex flex-col justify-between rounded-xl border p-3.5 bg-[#0d0d15] shadow-inner select-none transition-all duration-300 w-full ${theme.border}`}
    >
      {/* Top HUD Row */}
      <div className="flex w-full items-center justify-between text-[8px] font-mono text-ink-3 uppercase tracking-wider mb-2">
        <div className="flex items-center gap-1.5">
          <Signal className={`h-2.5 w-2.5 ${theme.text} opacity-80`} />
          <span>LINE</span>
        </div>
        <div className="flex items-center gap-1.5 font-bold">
          <span className={`h-1.5 w-1.5 rounded-full ${isRecording ? 'bg-rec animate-pulse' : theme.led}`} />
          <span className={isRecording ? 'text-rec' : theme.text}>
            {isRecording ? '● REC' : '● STDBY'}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Bluetooth className="h-2.5 w-2.5 opacity-60" />
          <Battery className="h-3 w-3 opacity-80" />
        </div>
      </div>

      {/* Main Counter Display */}
      <div className={`flex items-baseline justify-center gap-1 ${theme.glow}`}>
        <span
          ref={mainRef}
          className={`font-numeric text-[2.75rem] leading-none font-bold tracking-tight transition-colors duration-300 ${theme.text}`}
          style={{ letterSpacing: '-0.02em' }}
        >
          00:00:00
        </span>
        <span
          ref={centiRef}
          className={`font-numeric text-lg leading-none font-bold tracking-tight transition-colors duration-300 ${theme.text}`}
        >
          00
        </span>
      </div>

      {/* Bottom HUD Row */}
      <div className="flex w-full items-center justify-between text-[8px] font-mono text-ink-3 uppercase tracking-wider mt-3">
        <span>3 FRAMES</span>
        <span>48kHz / 16bit</span>
        <span className={`font-bold tracking-[0.1em] ${isRecording ? 'text-rec animate-pulse' : isPaused ? 'text-cyan animate-pulse' : theme.text}`}>
          {isRecording ? 'CAPTURING' : isPaused ? 'HELD' : 'READY'}
        </span>
      </div>
    </div>
  );
}
