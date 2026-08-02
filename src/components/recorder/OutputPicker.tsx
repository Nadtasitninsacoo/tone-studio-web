'use client';

import { Speaker } from 'lucide-react';
import { useState } from 'react';

import type { OutputDevice, OutputDiagnostics } from '@/hooks/useRecorder';

interface OutputPickerProps {
  devices: OutputDevice[];
  value: string;
  onChange: (deviceId: string) => void;
  /** Plays a tone on the engine's context and returns its output path at that instant. */
  onTest: () => OutputDiagnostics | null;
  /** Plays the same tone on a fresh context that has never touched the mic. */
  onProbe: () => void;
  disabled?: boolean;
}

/**
 * OutputPicker — which socket the sound leaves by, and a tone to prove it.
 *
 * ---------------------------------------------------------------------------
 * This exists because of one failure that cost most of a day, and the shape of it is
 * worth keeping: **every control on the page can read correctly while the page is
 * silent.**
 *
 * A USB audio interface enumerates a playback endpoint as well as a capture one. When
 * Windows re-enumerates it — a driver reset, a hub blip, a replug — it commonly makes
 * that new endpoint the default playback device. From inside the app nothing looks wrong:
 * the input meters move, the gate and limiter report gain reduction, the racks are on,
 * the monitor switch is lit. The sound is simply being delivered to a socket with nothing
 * plugged into it.
 *
 * Nothing in the app could see that, and nothing could say it, so the debugging went
 * looking for a broken audio graph. Hence two controls rather than one:
 *
 * - **The picker** pins the output, so Windows moving its default cannot move ours. The
 *   pin is re-applied to every new context in `arm`, because a device recovery builds a
 *   new one and would otherwise silently hand the sound back.
 * - **The tone** goes straight to `destination`, around the monitor bus and around the
 *   amp. That is the whole point: it separates "this context does not reach the speakers"
 *   from "it reaches them and the monitor path is muted or unrouted", which are the same
 *   symptom and completely different problems.
 *
 * The readout appears only after the tone is pressed. Not decoration — it is deliberately
 * not rendered from live state, because every value in it (`ctx.state`, `sinkId`, two
 * `AudioParam`s) would differ between the prerender and the first client paint, and this
 * app prerenders every route. A press is a moment, and a moment can be reported honestly.
 * ---------------------------------------------------------------------------
 */
export function OutputPicker({
  devices,
  value,
  onChange,
  onTest,
  onProbe,
  disabled,
}: OutputPickerProps) {
  const [result, setResult] = useState<OutputDiagnostics | null>(null);
  const [hasTested, setHasTested] = useState(false);

  const runTest = () => {
    setResult(onTest());
    setHasTested(true);
  };

  return (
    <div className="flex w-full flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <Speaker aria-hidden className="h-3.5 w-3.5 shrink-0 text-ink-3" />
        <span className="font-mono text-[9px] font-bold tracking-[0.14em] uppercase text-ink-3">
          Output
        </span>

        <select
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          title="เลือกอุปกรณ์ที่จะให้เสียงออก — ตรึงไว้ ไม่ให้ Windows ย้ายเอง"
          className="min-w-0 max-w-88 flex-1 truncate rounded-lg border border-line bg-inset px-2 py-1 font-mono text-[10px] text-ink outline-none focus-visible:border-cyan/60 disabled:opacity-40"
        >
          <option value="">ตามค่าปริยายของ Windows</option>
          {devices.map((device) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={runTest}
          disabled={disabled}
          title="เล่นเสียง 440 Hz จาก AudioContext ของ engine — ตัวเดียวกับที่แอมป์ใช้"
          className="flex h-7 shrink-0 items-center rounded-lg border border-cyan/50 bg-cyan/12 px-2.5 font-mono text-[10px] font-bold tracking-wider uppercase text-cyan transition-colors duration-150 hover:bg-cyan/25 disabled:pointer-events-none disabled:opacity-40"
        >
          1 · Test engine
        </button>

        {/* Its own button, not a second tone on the first one's press. Asking a listener to
            tell two pitches a second apart and report which arrived returns "one beep",
            which measures nothing — see `playProbeTone`. Never disabled: it needs no
            engine, and "is Web Audio audible at all" is exactly the question worth asking
            when nothing is armed. */}
        <button
          type="button"
          onClick={onProbe}
          title="เล่นเสียง 660 Hz จาก AudioContext ใหม่ที่ไม่เคยแตะไมค์ — ตัวเปรียบเทียบ"
          className="flex h-7 shrink-0 items-center rounded-lg border border-line px-2.5 font-mono text-[10px] font-bold tracking-wider uppercase text-ink-2 transition-colors duration-150 hover:text-ink"
        >
          2 · Test fresh
        </button>
      </div>

      {/* Only after a press — see the note above about prerendering. */}
      {hasTested ? (
        result ? (
          <p className="font-mono text-[9px] leading-relaxed tracking-[0.08em] text-ink-3">
            ctx <span className={result.contextState === 'running' ? 'text-cyan' : 'text-rec'}>
              {result.contextState}
            </span>{' '}
            · {(result.sampleRate / 1000).toFixed(1)} kHz · sink{' '}
            <span className="text-ink-2">{result.sinkId || '(default)'}</span> · monitor bus{' '}
            <span className={result.monitorConnected ? 'text-cyan' : 'text-rec'}>
              {result.monitorConnected ? 'connected' : 'disconnected'}
            </span>{' '}
            · monitor gain{' '}
            <span className={result.monitorGain > 0 ? 'text-cyan' : 'text-rec'}>
              {result.monitorGain.toFixed(2)}
            </span>{' '}
            · rack gain{' '}
            <span className={result.instrumentGain > 0 ? 'text-cyan' : 'text-rec'}>
              {result.instrumentGain.toFixed(2)}
            </span>
            {/* One button, one tone, one question — see `playProbeTone` for why the two
                are not fired from a single press. */}
            <span className="block text-ink-3/70">
              กดปุ่ม 2 เทียบด้วย — ปุ่ม 1 คือ context ของ engine, ปุ่ม 2 คือ context ใหม่ที่ไม่แตะไมค์
            </span>
          </p>
        ) : (
          <p className="font-mono text-[9px] tracking-[0.08em] text-rec">
            ยังไม่มี engine — ต้อง arm อินพุตก่อน
          </p>
        )
      ) : null}
    </div>
  );
}
