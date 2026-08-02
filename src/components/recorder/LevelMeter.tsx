'use client';

import { useRef, type RefObject } from 'react';

import { useAnimationFrame } from '@/hooks/useAnimationFrame';
import { amplitudeToDb, amplitudeToMeter, dbToMeter, formatDb } from '@/lib/audio';
import type { MeterSnapshot } from '@/types/recorder';

interface LevelMeterProps {
  /** Live meter snapshot, mutated in place by the engine each frame. */
  meterRef: RefObject<MeterSnapshot>;
  channels: number;
  /** Meters only run while an input stream is open. */
  active: boolean;
  compact?: boolean;
}

/** dB graduations drawn under the meter. Fewer on phones so they don't collide. */
const TICKS = [-60, -48, -36, -24, -12, -6, 0];
const MOBILE_TICKS = new Set([-60, -36, -12, 0]);

/** Channel captions; anything beyond stereo falls back to a number. */
const CHANNEL_LABELS = ['L', 'R'];

/**
 * LevelMeter — per-channel peak/RMS meter with peak-hold and clip indication.
 *
 * Painted imperatively from a single animation frame: each channel costs three
 * style writes per frame (RMS fill, peak fill, hold marker) with zero React
 * re-renders. The scale is linear-in-dB so it reads like hardware, and the
 * gradient runs grey -> light -> red, matching the restricted palette.
 */
export function LevelMeter({ meterRef, channels, active, compact }: LevelMeterProps) {
  const rmsRefs = useRef<(HTMLDivElement | null)[]>([]);
  const peakRefs = useRef<(HTMLDivElement | null)[]>([]);
  const holdRefs = useRef<(HTMLDivElement | null)[]>([]);
  const readoutRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const clipRef = useRef<HTMLDivElement>(null);
  const wasClipped = useRef(false);

  useAnimationFrame(() => {
    const meter = meterRef.current;
    if (!meter) return;

    for (let channel = 0; channel < channels; channel += 1) {
      const peak = meter.peak[channel] ?? 0;
      const rms = meter.rms[channel] ?? 0;
      const hold = meter.hold[channel] ?? 0;

      // `clip-path: inset()` keeps the full-width gradient in place while
      // revealing only the active portion — no gradient re-interpolation.
      const rmsNode = rmsRefs.current[channel];
      if (rmsNode) {
        rmsNode.style.clipPath = `inset(0 ${(100 - amplitudeToMeter(rms) * 100).toFixed(2)}% 0 0)`;
      }

      const peakNode = peakRefs.current[channel];
      if (peakNode) {
        peakNode.style.clipPath = `inset(0 ${(100 - amplitudeToMeter(peak) * 100).toFixed(2)}% 0 0)`;
      }

      const holdNode = holdRefs.current[channel];
      if (holdNode) {
        holdNode.style.left = `${(amplitudeToMeter(hold) * 100).toFixed(2)}%`;
        holdNode.style.opacity = hold > 0.001 ? '1' : '0';
      }

      const readout = readoutRefs.current[channel];
      if (readout) readout.textContent = formatDb(amplitudeToDb(hold));
    }

    // Clip LED stays lit for as long as the engine reports clipping.
    if (meter.clipped !== wasClipped.current) {
      wasClipped.current = meter.clipped;
      const node = clipRef.current;
      if (node) {
        node.classList.toggle('bg-rec', meter.clipped);
        node.classList.toggle('border-rec', meter.clipped);
        node.classList.toggle('text-white', meter.clipped);
        node.classList.toggle('animate-led-blink', meter.clipped);
      }
    }
  }, active);

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex flex-col gap-0.5">
          {Array.from({ length: Math.max(1, channels) }).map((_, channel) => (
            <div key={channel} className="flex items-center gap-1">
              <span className="w-2.5 shrink-0 font-mono text-[8px] font-bold text-ink-3">
                {channels === 1 ? 'M' : (CHANNEL_LABELS[channel] ?? channel + 1)}
              </span>

              <div className="relative h-1.5 w-16 overflow-hidden rounded-sm border border-line bg-inset sm:w-24">
                {/* Peak layer: full gradient, dimmed — shows transients */}
                <div
                  ref={(node) => {
                    peakRefs.current[channel] = node;
                  }}
                  aria-hidden
                  className="absolute inset-0 bg-linear-to-r from-meter-low via-meter-mid to-meter-high opacity-30"
                  style={{ clipPath: 'inset(0 100% 0 0)' }}
                />
                {/* RMS layer: same gradient at full opacity — perceived loudness */}
                <div
                  ref={(node) => {
                    rmsRefs.current[channel] = node;
                  }}
                  aria-hidden
                  className="absolute inset-0 bg-linear-to-r from-meter-low via-meter-mid to-meter-high"
                  style={{ clipPath: 'inset(0 100% 0 0)' }}
                />
                {/* Peak-hold marker */}
                <div
                  ref={(node) => {
                    holdRefs.current[channel] = node;
                  }}
                  aria-hidden
                  className="absolute top-0 bottom-0 w-0.5 -translate-x-full bg-ink opacity-0 transition-opacity duration-200"
                  style={{ left: '0%' }}
                />
              </div>

              <span
                ref={(node) => {
                  readoutRefs.current[channel] = node;
                }}
                className="w-8 shrink-0 text-right font-mono text-[8px] text-ink-2"
              >
                -∞
              </span>
            </div>
          ))}
        </div>

        <div
          ref={clipRef}
          className="rounded border border-line bg-raised px-1 py-0.5 font-mono text-[7px] font-bold tracking-wider uppercase text-ink-3 transition-colors duration-150"
        >
          Clip
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] font-semibold tracking-[0.18em] uppercase text-ink-3">
          Input Level
        </span>
        <div
          ref={clipRef}
          className="rounded border border-line bg-raised px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-wider uppercase text-ink-3 transition-colors duration-150"
        >
          Clip
        </div>
      </div>

      {/* One row per channel */}
      <div className="flex flex-col gap-1.5">
        {Array.from({ length: Math.max(1, channels) }).map((_, channel) => (
          <div key={channel} className="flex items-center gap-2">
            <span className="w-3 shrink-0 font-mono text-[10px] font-bold text-ink-3">
              {channels === 1 ? 'M' : (CHANNEL_LABELS[channel] ?? channel + 1)}
            </span>

            <div className="relative h-3 flex-1 overflow-hidden rounded-sm border border-line bg-inset">
              {/* Peak layer: full gradient, dimmed — shows transients */}
              <div
                ref={(node) => {
                  peakRefs.current[channel] = node;
                }}
                aria-hidden
                className="absolute inset-0 bg-linear-to-r from-meter-low via-meter-mid to-meter-high opacity-30"
                style={{ clipPath: 'inset(0 100% 0 0)' }}
              />
              {/* RMS layer: same gradient at full opacity — perceived loudness */}
              <div
                ref={(node) => {
                  rmsRefs.current[channel] = node;
                }}
                aria-hidden
                className="absolute inset-0 bg-linear-to-r from-meter-low via-meter-mid to-meter-high"
                style={{ clipPath: 'inset(0 100% 0 0)' }}
              />
              {/* LED segmentation drawn over both layers */}
              <div aria-hidden className="meter-segments absolute inset-0" />
              {/* Peak-hold marker */}
              <div
                ref={(node) => {
                  holdRefs.current[channel] = node;
                }}
                aria-hidden
                className="absolute top-0 bottom-0 w-0.5 -translate-x-full bg-ink opacity-0 transition-opacity duration-200"
                style={{ left: '0%' }}
              />
            </div>

            <span
              ref={(node) => {
                readoutRefs.current[channel] = node;
              }}
              className="w-10 shrink-0 text-right font-mono text-[10px] text-ink-2 sm:w-11"
            >
              -∞
            </span>
          </div>
        ))}
      </div>

      {/* dB scale */}
      <div className="relative mx-5 h-3">
        {TICKS.map((db) => (
          <span
            key={db}
            className={`absolute -translate-x-1/2 font-mono text-[9px] text-ink-3 ${
              MOBILE_TICKS.has(db) ? '' : 'hidden sm:inline'
            }`}
            style={{ left: `${dbToMeter(db) * 100}%` }}
          >
            {db === 0 ? '0' : db}
          </span>
        ))}
      </div>
    </div>
  );
}
