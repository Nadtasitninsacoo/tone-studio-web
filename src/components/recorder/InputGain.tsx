'use client';

import { RotateCcw } from 'lucide-react';
import { formatDb } from '@/lib/audio';

interface InputGainProps {
  gainDb: number;
  disabled: boolean;
  onGainChange: (db: number) => void;
  hudColor?: string;
}

const MIN_DB = -24;
const MAX_DB = 24;

export function InputGain({ gainDb, disabled, onGainChange, hudColor = 'green' }: InputGainProps) {
  // scale increments shown on fader face
  const ticks = [24, 16, 8, 0, -6, -18, -24];

  // Helper colors for inline styling box-shadow
  const glowColors: Record<string, string> = {
    green: 'rgba(34,197,94,0.45)',
    cyan: 'rgba(18,127,144,0.45)',
    violet: 'rgba(122,24,248,0.45)',
    amber: 'rgba(245,158,11,0.45)',
    pink: 'rgba(236,72,153,0.45)'
  };

  const glowVal = glowColors[hudColor] || 'rgba(34,197,94,0.45)';

  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-line bg-inset/40 p-4.5 w-full">
      <div className="flex w-full items-center justify-between">
        <span className="font-mono text-[9px] font-semibold tracking-[0.18em] uppercase text-ink-3">
          INPUT GAIN
        </span>
        <div className="flex items-center gap-1.5">
          <span className="font-numeric text-[10px] font-bold text-ink">
            {formatDb(gainDb)} dB
          </span>
          <button
            type="button"
            onClick={() => onGainChange(0)}
            disabled={disabled || gainDb === 0}
            title="Reset trim to unity gain"
            className="rounded p-0.5 text-ink-3 transition-colors hover:bg-raised hover:text-ink disabled:opacity-30"
          >
            <RotateCcw className="h-2.5 w-2.5" />
          </button>
        </div>
      </div>

      {/* Vertical Slider Rack */}
      <div className="flex h-36 items-center justify-center gap-4 py-2 w-full">
        {/* Left Ticks */}
        <div className="flex flex-col justify-between h-full text-right w-6 select-none">
          {ticks.map((t) => (
            <span key={`l-${t}`} className="font-mono text-[8px] text-ink-3 leading-none">
              {t > 0 ? `+${t}` : t}
            </span>
          ))}
        </div>

        {/* Center Vertical Slider Channel */}
        <div className="relative flex h-full items-center justify-center w-6">
          {/* Channel track backdrop */}
          <div className="absolute inset-y-0 w-1.5 rounded-full bg-black/60 border border-line" />
          
          {/* Active glowing track line */}
          <div 
            className={`absolute bottom-0 w-1 rounded-full transition-all duration-150 bg-${hudColor}`}
            style={{
              height: `${((gainDb - MIN_DB) / (MAX_DB - MIN_DB)) * 100}%`,
              boxShadow: `0 0 10px ${glowVal}`
            }}
          />

          {/* Native range input overlaid vertically & hidden */}
          <input
            type="range"
            min={MIN_DB}
            max={MAX_DB}
            step={0.5}
            value={gainDb}
            disabled={disabled}
            onChange={(e) => onGainChange(Number(e.target.value))}
            className="absolute h-full w-full opacity-0 cursor-pointer pointer-events-auto z-30"
            style={{
              writingMode: 'vertical-lr',
              WebkitAppearance: 'slider-vertical' as any,
            }}
          />

          {/* Custom glass fader knob (rendered visually) */}
          <div 
            className="absolute w-6.5 h-4.5 rounded border border-line-strong bg-raised shadow-md flex items-center justify-center pointer-events-none transition-all duration-150 z-20"
            style={{
              bottom: `calc(${((gainDb - MIN_DB) / (MAX_DB - MIN_DB)) * 100}% - 9px)`
            }}
          >
            {/* Center glowing indicator notch */}
            <div className={`w-3.5 h-0.5 rounded-full bg-${hudColor} opacity-90`} />
          </div>
        </div>

        {/* Right Ticks */}
        <div className="flex flex-col justify-between h-full text-left w-6 select-none">
          {ticks.map((t) => (
            <span key={`r-${t}`} className="font-mono text-[8px] text-ink-3 leading-none">
              {t === 0 ? '0dB' : t > 0 ? `+${t}` : t}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
