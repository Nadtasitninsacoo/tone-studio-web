'use client';

import React, { useRef, useEffect } from 'react';
import type { StripMeter } from '@/hooks/useMixer';

declare module 'react' {
  interface CSSProperties {
    WebkitAppearance?: 'slider-vertical' | string;
  }
}

interface MixerChannelStripProps {
  channelId: string;
  name: string;
  gain: number;      // -24 to +24 dB
  pan: number;       // -100 (L) to +100 (R)
  volume: number;    // 0 to 100 (fader level)
  mute: boolean;
  getMeter: (id: string) => StripMeter;
  isLive: boolean;
  onParamChange: {
    (param: 'mute', value: boolean): void;
    (param: 'gain' | 'pan' | 'volume', value: number): void;
  };
  hudColor?: string;
  /**
   * What this strip is playing, in one word, and how to give it the live input.
   *
   * On the strip rather than only in the source row below the console, because a strip
   * with no source is silent no matter what its controls do — and a control that has to
   * be *found* before any of the others mean anything cannot be the smallest thing on
   * the page. This is the fix for a desk that looked complete and made no sound.
   */
  source?: 'live' | 'clip' | 'empty';
  onTakeLive?: () => void;
}

export function MixerChannelStrip({
  channelId,
  name,
  gain,
  pan,
  volume,
  mute,
  getMeter,
  isLive,
  onParamChange,
  hudColor = 'cyan',
  source = 'empty',
  onTakeLive,
}: MixerChannelStripProps) {
  // sensitivity parameters for dragging
  const GAIN_SENSITIVITY = 0.35;
  const PAN_SENSITIVITY = 1.5;

  const segmentRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Paint LED VU meter segments inside its own requestAnimationFrame loop
  useEffect(() => {
    if (!isLive) {
      for (let s = 0; s < 14; s++) {
        const el = segmentRefs.current[s];
        if (el) el.className = 'h-1 w-2.5 rounded-xs bg-[#151722]';
      }
      return;
    }

    let active = true;
    const tick = () => {
      if (!active) return;
      const meter = getMeter(channelId);
      const peak = meter.peak;

      for (let s = 0; s < 14; s++) {
        const el = segmentRefs.current[s];
        if (!el) continue;
        const threshold = s / 13;
        const isLit = peak >= threshold && peak > 0.01 && !mute;

        if (isLit) {
          if (s >= 12) {
            el.className = 'h-1 w-2.5 rounded-xs bg-rec shadow-[0_0_4px_#ff3b5c]';
          } else if (s >= 8) {
            el.className = 'h-1 w-2.5 rounded-xs bg-amber shadow-[0_0_4px_#fcb321]';
          } else {
            el.className = 'h-1 w-2.5 rounded-xs bg-green shadow-[0_0_4px_#2af650]';
          }
        } else {
          el.className = 'h-1 w-2.5 rounded-xs bg-[#151722]';
        }
      }
      requestAnimationFrame(tick);
    };
    tick();
    return () => {
      active = false;
    };
  }, [channelId, getMeter, isLive, mute]);

  const handleKnobMouseDown = (
    e: React.MouseEvent,
    type: 'gain' | 'pan',
    currentVal: number,
    min: number,
    max: number,
    sens: number
  ) => {
    e.preventDefault();
    const startY = e.clientY;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaY = startY - moveEvent.clientY;
      const newVal = Math.max(min, Math.min(max, currentVal + deltaY * sens));
      onParamChange(type, newVal);
    };

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  // Convert volume fader (0-100) to pixel position percentage
  const faderPercentage = volume;

  // Calculate knob rotation angles (-135deg to +135deg)
  const gainRotation = ((gain + 24) / 48) * 270 - 135;
  const panRotation = ((pan + 100) / 200) * 270 - 135;

  // Accent glow styling based on theme
  const activeColor = hudColor === 'green' ? '#22c55e' : 
                      hudColor === 'cyan' ? '#06b6d4' : 
                      hudColor === 'violet' ? '#8b5cf6' : 
                      hudColor === 'amber' ? '#f59e0b' : '#ec4899';

  return (
    <div className={`flex flex-col items-center py-2.5 px-1 bg-panel/30 border border-line rounded-lg w-17.5 transition-all select-none ${mute ? 'opacity-60' : ''}`}>
      {/* 1. Header Channel Label */}
      <span className="font-mono text-[8px] font-bold tracking-wider text-ink-2 uppercase bg-inset px-2 py-0.5 rounded border border-line mb-2 w-full text-center">
        {name}
      </span>

      {/* 1b. Source. A strip with none of these is silent, so it says so. */}
      <button
        type="button"
        onClick={onTakeLive}
        disabled={!onTakeLive}
        title={
          source === 'live'
            ? 'Playing the live input'
            : source === 'clip'
              ? 'Playing a loaded take or file — press to switch to the live input'
              : 'No source. Press to take the live input on this channel.'
        }
        className={`mb-2 h-4 w-full rounded border font-mono text-[7px] font-bold tracking-[0.12em] uppercase transition-colors duration-150 active:scale-95 ${
          source === 'live'
            ? 'border-cyan/50 bg-cyan/12 text-cyan'
            : source === 'clip'
              ? 'border-line-strong bg-inset text-ink-2'
              : 'border-rec/35 bg-rec/6 text-rec'
        }`}
      >
        {source === 'live' ? 'live in' : source === 'clip' ? 'clip' : 'no source'}
      </button>

      {/* 2. LED VU Meters */}
      <div className="flex flex-col gap-0.5 bg-black/60 p-1 rounded-sm border border-line/45 mb-2.5 select-none">
        {Array.from({ length: 14 }).map((_, idx) => (
          <div
            key={idx}
            ref={(el) => {
              segmentRefs.current[13 - idx] = el;
            }}
            className="h-1 w-2.5 rounded-xs bg-[#151722]"
          />
        ))}
      </div>

      {/* 3. MUTE Button */}
      <button
        type="button"
        onClick={() => onParamChange('mute', !mute)}
        className={`h-5 w-11 rounded border text-[8px] font-mono font-bold uppercase transition-all duration-150 active:scale-95 mb-3.5 ${
          mute
            ? 'border-[#ec4899] bg-[#ec4899]/15 text-[#ec4899] shadow-[0_0_8px_rgba(236,72,153,0.25)]'
            : 'border-line text-ink-3 hover:text-ink-2 hover:border-line-strong'
        }`}
      >
        MUTE
      </button>

      {/* 4. GAIN Knob */}
      <div className="flex flex-col items-center mb-3">
        <div 
          onMouseDown={(e) => handleKnobMouseDown(e, 'gain', gain, -24, 24, GAIN_SENSITIVITY)}
          className="relative h-8.5 w-8.5 rounded-full border border-line-strong bg-raised shadow-inner flex items-center justify-center cursor-ns-resize hover:border-cyan/50"
        >
          {/* Dial Pointer */}
          <div 
            className="absolute top-1 w-0.5 h-3 rounded-full bg-ink-2 origin-[center_13px]"
            style={{ transform: `rotate(${gainRotation}deg)` }}
          />
        </div>
        <span className="font-mono text-[7px] text-ink-3 uppercase mt-1">GAIN</span>
        <span className="font-mono text-[7px] text-cyan font-semibold leading-none">{gain > 0 ? `+${gain.toFixed(0)}` : gain.toFixed(0)}</span>
      </div>

      {/* 5. PAN Knob */}
      <div className="flex flex-col items-center mb-4">
        <div 
          onMouseDown={(e) => handleKnobMouseDown(e, 'pan', pan, -100, 100, PAN_SENSITIVITY)}
          className="relative h-8.5 w-8.5 rounded-full border border-line-strong bg-raised shadow-inner flex items-center justify-center cursor-ns-resize hover:border-cyan/50"
        >
          {/* Dial Pointer */}
          <div 
            className="absolute top-1 w-0.5 h-3 rounded-full bg-ink-2 origin-[center_13px]"
            style={{ transform: `rotate(${panRotation}deg)` }}
          />
        </div>
        <span className="font-mono text-[7px] text-ink-3 uppercase mt-1">PAN</span>
        <span className="font-mono text-[7px] text-ink font-semibold leading-none">
          {pan === 0 ? 'C' : pan > 0 ? `R${pan.toFixed(0)}` : `L${Math.abs(pan).toFixed(0)}`}
        </span>
      </div>

      {/* 6. Volume Fader */}
      <div className="relative flex flex-col items-center h-28 w-6 mb-3">
        {/* Track Backdrop */}
        <div className="absolute inset-y-0 w-1 rounded-full bg-black/60 border border-line" />
        
        {/* Active track color fill */}
        <div 
          className="absolute bottom-0 w-0.5 rounded-full transition-all duration-75"
          style={{
            height: `${faderPercentage}%`,
            backgroundColor: activeColor,
            boxShadow: `0 0 8px ${activeColor}`
          }}
        />

        {/* Transparent native range input placed vertically */}
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={volume}
          onChange={(e) => onParamChange('volume', Number(e.target.value))}
          className="absolute h-full w-full opacity-0 cursor-pointer pointer-events-auto z-20"
          style={{
            writingMode: 'vertical-lr',
            WebkitAppearance: 'slider-vertical',
          }}
        />

        {/* Custom glass fader knob thumb (rendered visually) */}
        <div 
          className="absolute w-5 h-3 rounded-sm border border-line bg-raised shadow flex items-center justify-center pointer-events-none transition-all duration-75 z-10"
          style={{
            bottom: `calc(${faderPercentage}% - 6px)`
          }}
        >
          {/* Notch line */}
          <div className="w-3 h-0.5 rounded-full bg-ink-3 opacity-80" />
        </div>
      </div>
    </div>
  );
}
