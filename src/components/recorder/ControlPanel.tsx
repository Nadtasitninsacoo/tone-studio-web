'use client';

import { AlertTriangle, Headphones, Info, RefreshCw, Sliders, X } from 'lucide-react';
import { useHudColor } from '@/hooks/useHudColor';

import { Chip, Panel } from '@/components/ui/Panel';
import type { RecorderApi } from '@/hooks/useRecorder';
import { formatChannels, formatSampleRate } from '@/lib/format';

import { InputGain } from './InputGain';
import { LevelMeter } from './LevelMeter';
import { LiveWaveform } from './LiveWaveform';
import { TimeCode } from './TimeCode';
import { TransportControls } from './TransportControls';

interface ControlPanelProps {
  recorder: RecorderApi;
  onStart: () => void;
  onStop: () => void;
}

/**
 * ControlPanel — the transport module.
 *
 * Composes the record buttons, timecode, trim and visualisers onto one surface.
 * Three columns on desktop (transport | timecode + trim | meters); on phones it
 * stacks with the timecode first, then the transport, then the meters — the order
 * you actually look at them in when tracking on a small screen.
 */
export function ControlPanel({ recorder, onStart, onStop }: ControlPanelProps) {
  const {
    status,
    error,
    notice,
    inputHealth,
    retryInput,
    format,
    channels,
    meterRef,
    elapsedRef,
    gainDb,
    isMonitoring,
    pause,
    resume,
    discard,
    changeGain,
    toggleMonitoring,
  } = recorder;

  /**
   * `recovering` is live. The device dropped out and is being reopened; the graph,
   * the trim and the meters are all still there, so nothing should grey out or
   * unmount for it — that flicker is what made a momentary glitch read as a crash.
   */
  const isLive =
    status === 'ready' ||
    status === 'recording' ||
    status === 'paused' ||
    status === 'recovering';

  /**
   * A dropout being worked on, as opposed to one that has been given up on.
   *
   * The `lost` state has its own message in `error` — red, with the retry button
   * below — so showing it here as well would say the same thing twice.
   */
  const isRecovering = inputHealth.state === 'recovering' || inputHealth.state === 'muted';

  /**
   * Authoritative low-bandwidth check.
   *
   * Device names are only a hint, but the negotiated sample rate is evidence: a
   * Bluetooth headset profile opens at 8–16 kHz, where a wired interface gives
   * 44.1/48 kHz. Anything this low means the signal path is throwing away most of
   * the guitar's frequency range, so say so before the take is wasted.
   */
  const isLowBandwidth = isLive && !!format && format.sampleRate < 32000;

  // Custom HUD color from external store
  const hudColor = useHudColor();

  const themeColors: Record<string, string> = {
    green: 'rgba(34,197,94,0.15)',
    cyan: 'rgba(18,127,144,0.15)',
    violet: 'rgba(122,24,248,0.15)',
    amber: 'rgba(245,158,11,0.15)',
    pink: 'rgba(236,72,153,0.15)'
  };
  const activeGlow = themeColors[hudColor] || 'rgba(34,197,94,0.15)';

  return (
    <Panel
      title="Transport"
      live={status === 'recording'}
      icon={<Sliders aria-hidden className="h-3.5 w-3.5" />}
      actions={
        <>
          {format ? (
            <Chip tone="muted" className="hidden sm:inline-flex">
              {formatSampleRate(format.sampleRate)} · {formatChannels(format.channels)}
            </Chip>
          ) : null}
          <Chip tone={status === 'recording' ? 'danger' : isLive ? 'strong' : 'muted'}>
            {status === 'recording' ? 'On Air' : isLive ? 'Signal Open' : 'Standby'}
          </Chip>
        </>
      }
    >
      {/* Device / engine failures surface here rather than in a toast, so the
          message stays next to the control that caused it. */}
      {error ? (
        <div
          role="alert"
          className="mb-4 flex animate-rise-in items-start gap-2.5 rounded-lg border border-rec/40 bg-rec/8 px-3 py-2.5 text-xs text-rec"
        >
          <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="flex-1">{error}</p>
          {/* A device that stopped answering is the one failure with something to
              press: reopening it keeps the graph, so the tone survives the retry. */}
          {inputHealth.state === 'lost' ? (
            <button
              type="button"
              onClick={retryInput}
              className="shrink-0 touch-manipulation rounded-md border border-rec/40 bg-rec/10 px-2 py-1 font-semibold tracking-wider uppercase transition-colors duration-150 hover:bg-rec/20 active:scale-95"
            >
              Retry
            </button>
          ) : null}
          <button
            type="button"
            onClick={recorder.clearError}
            aria-label="Dismiss error"
            className="-m-1 shrink-0 rounded p-1 transition-colors duration-150 hover:bg-rec/15"
          >
            <X aria-hidden className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      {/* A dropout being reopened. Greyscale, because nothing is broken and nothing
          needs doing — red here would claim the session had ended, which is exactly
          the wrong thing to say while the device is coming back by itself. */}
      {isRecovering ? (
        <div
          role="status"
          aria-live="polite"
          className="mb-4 flex animate-rise-in items-start gap-2.5 rounded-lg border border-line-strong bg-inset px-3 py-2.5 text-xs text-ink-2"
        >
          <RefreshCw aria-hidden className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
          <p className="flex-1">{inputHealth.message}</p>
        </div>
      ) : null}

      {/* Neutral acknowledgements — currently "your interrupted take was kept". */}
      {notice ? (
        <div
          role="status"
          className="mb-4 flex animate-rise-in items-start gap-2.5 rounded-lg border border-line-strong bg-raised px-3 py-2.5 text-xs text-ink-2"
        >
          <Info aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="flex-1">{notice}</p>
          <button
            type="button"
            onClick={recorder.clearNotice}
            aria-label="Dismiss message"
            className="-m-1 shrink-0 rounded p-1 transition-colors duration-150 hover:bg-line/40"
          >
            <X aria-hidden className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      {/* Low sample rate almost always means a Bluetooth headset profile. */}
      {isLowBandwidth ? (
        <div
          role="alert"
          className="mb-4 flex animate-rise-in items-start gap-2.5 rounded-lg border border-rec/40 bg-rec/8 px-3 py-2.5 text-xs text-rec"
        >
          <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="flex-1">
            Input opened at {formatSampleRate(format!.sampleRate)} — this is a Bluetooth/headset
            voice profile, not full-bandwidth audio. Connect the interface over USB for 48 kHz
            capture.
          </p>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[auto_minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-8">
        {/* Timecode + trim fader. First on mobile, middle column on desktop. */}
        <div className="order-1 flex flex-col justify-between gap-4 lg:order-2">
          <TimeCode elapsedRef={elapsedRef} status={status} />
          
          <InputGain
            gainDb={gainDb}
            disabled={!isLive}
            onGainChange={changeGain}
            hudColor={hudColor}
          />

          {/* Bottom row: Monitor (left) & Record Mode (right) */}
          <div className="grid grid-cols-2 gap-2 mt-1">
            <button
              type="button"
              onClick={toggleMonitoring}
              disabled={!isLive}
              className={`flex h-11.5 items-center justify-between rounded-lg border-2 px-3.5 transition-all duration-200 active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none ${
                isMonitoring
                  ? `border-${hudColor} bg-${hudColor}/12 text-${hudColor}`
                  : 'border-line bg-raised text-ink-2 hover:border-line-strong hover:text-ink'
              }`}
              style={{
                boxShadow: isMonitoring ? `0 0 10px ${activeGlow}` : 'none'
              }}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`h-2 w-2 rounded-full transition-colors duration-200 ${
                    isMonitoring ? `bg-${hudColor} animate-pulse shadow-[0_0_8px_var(--c-${hudColor})]` : 'bg-ink-3/40'
                  }`}
                />
                <span className="font-mono text-[9px] font-bold tracking-[0.14em] uppercase">
                  MONITOR
                </span>
              </div>
              <Headphones className="h-4 w-4 shrink-0 opacity-80" />
            </button>

            <div className="relative flex flex-col justify-between border border-line bg-inset/20 rounded-lg p-1.5">
              <span className="absolute -top-1.5 left-2 bg-base px-1 font-mono text-[6px] text-ink-3 uppercase tracking-widest leading-none select-none">
                RECORD MODE
              </span>
              
              <div className="grid grid-cols-2 gap-1.5 h-full pt-1">
                <button
                  type="button"
                  onClick={() => recorder.changeRecordSource('dry')}
                  disabled={!isLive}
                  className={`flex h-7 items-center justify-center rounded border text-[8px] font-bold uppercase tracking-wider transition-all duration-150 disabled:opacity-45 disabled:pointer-events-none ${
                    recorder.recordSource === 'dry'
                      ? `border-${hudColor}/50 bg-${hudColor}/12 text-${hudColor}`
                      : 'border-transparent text-ink-3 hover:text-ink-2 hover:bg-raised/10'
                  }`}
                >
                  DRY DI
                </button>
                <button
                  type="button"
                  onClick={() => recorder.changeRecordSource('wet')}
                  disabled={!isLive}
                  className={`flex h-7 items-center justify-center rounded border text-[8px] font-bold uppercase tracking-wider transition-all duration-150 disabled:opacity-45 disabled:pointer-events-none ${
                    recorder.recordSource === 'wet'
                      ? `border-${hudColor}/50 bg-${hudColor}/12 text-${hudColor}`
                      : 'border-transparent text-ink-3 hover:text-ink-2 hover:bg-raised/10'
                  }`}
                >
                  WET MIX
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Transport buttons. Second on mobile, leftmost on desktop. */}
        <div className="order-2 flex items-center justify-center lg:order-1 lg:border-r lg:border-line lg:pr-8">
          <TransportControls
            status={status}
            canRecord={status === 'ready'}
            onStart={onStart}
            onStop={onStop}
            onPause={pause}
            onResume={resume}
            onDiscard={discard}
          />
        </div>

        {/* Metering + live waveform. */}
        <div className="order-3 flex flex-col gap-3.5 lg:gap-4">
          <LevelMeter meterRef={meterRef} channels={channels} active={isLive} />
          <LiveWaveform
            meterRef={meterRef}
            status={status}
            active={isLive}
            getAnalyserNode={recorder.getAnalyserNode}
          />
        </div>
      </div>
    </Panel>
  );
}
