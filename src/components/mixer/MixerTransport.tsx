'use client';

import {
  AlertTriangle,
  Download,
  Info,
  Pause,
  Play,
  Power,
  RefreshCw,
  Radio,
  Shield,
  SkipBack,
  Volume2,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useMixerStudio, useRecorderStudio } from '@/components/providers/StudioProviders';
import { DeviceSelect } from '@/components/recorder/DeviceSelect';
import { Chip } from '@/components/ui/Panel';
import { useAnimationFrame } from '@/hooks/useAnimationFrame';
import { amplitudeToDb } from '@/lib/audio';
import { formatTimecode } from '@/lib/format';

/**
 * SignalPath — where the audio actually is, updated every frame.
 *
 * Painted straight into DOM nodes from an animation frame, like the meters: it reads
 * five values sixty times a second and putting any of them in React state would
 * re-render the whole console for each one.
 *
 * Read left to right, it localises silence in one glance. `ENGINE suspended` means
 * nothing will be heard whatever the faders do. `DEVICE none` means no input is held.
 * `LIVE 0` means no channel is set to the input, so the device is open and connected to
 * nothing. Signal at `IN` but none at `OUT` means the strip ate it — a gate in the
 * insert, a mute, a group fader down. Nothing at `IN` means it never got that far.
 */
function SignalPath() {
  const mixer = useMixerStudio();
  const engineRef = useRef<HTMLSpanElement | null>(null);
  const deviceRef = useRef<HTMLSpanElement | null>(null);
  const liveRef = useRef<HTMLSpanElement | null>(null);
  const inRef = useRef<HTMLSpanElement | null>(null);
  const outRef = useRef<HTMLSpanElement | null>(null);
  const chainsRef = useRef<HTMLSpanElement | null>(null);

  useAnimationFrame(() => {
    const d = mixer.getDiagnostics();
    if (engineRef.current) engineRef.current.textContent = d.context;
    if (deviceRef.current) {
      deviceRef.current.textContent = d.attached ? d.device : `${d.device} (detached)`;
    }
    if (liveRef.current) liveRef.current.textContent = `${d.liveChannels}`;
    // −∞ rather than a made-up floor: an empty meter is not "very quiet".
    if (inRef.current) {
      inRef.current.textContent = d.inputPeak > 0 ? `${amplitudeToDb(d.inputPeak).toFixed(1)}` : '−∞';
    }
    if (outRef.current) {
      outRef.current.textContent =
        d.masterPeak > 0 ? `${amplitudeToDb(d.masterPeak).toFixed(1)}` : '−∞';
    }
    if (chainsRef.current) chainsRef.current.textContent = `${d.rigChains}`;
  });

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[9px] tracking-[0.12em] uppercase text-ink-3">
      <span>
        engine <span ref={engineRef} className="text-ink-2">none</span>
      </span>
      <span aria-hidden>·</span>
      <span>
        device <span ref={deviceRef} className="text-ink-2">none</span>
      </span>
      <span aria-hidden>·</span>
      <span>
        live ch <span ref={liveRef} className="text-ink-2">0</span>
      </span>
      <span aria-hidden>·</span>
      <span>
        in <span ref={inRef} className="text-ink-2">−∞</span> db
      </span>
      <span aria-hidden>·</span>
      <span>
        out <span ref={outRef} className="text-ink-2">−∞</span> db
      </span>
      <span aria-hidden>·</span>
      {/* The load. Each rack is a convolver plus two worklet processors; the recorder is
          running its own set on another context at the same time. */}
      <span title="Instrument racks running in the mixer graph">
        racks <span ref={chainsRef} className="text-ink-2">0</span>
      </span>
    </div>
  );
}

/**
 * MixerTransport — the bar that makes the console audible.
 *
 * It exists because a desk with no transport, no input picker and no output is a
 * picture of a desk: the strips were adjustable before this and *nothing they did
 * could be heard*, which is exactly what "I connected Bluetooth and adjusting had no
 * effect" means. Four things are gathered here, and each one closes one gap:
 *
 * 1. **The input picker**, so this page can open a device instead of inheriting
 *    whatever the recorder happened to arm. It is the same `DeviceSelect` and the same
 *    shared device session, so choosing here does not fight the recorder for the
 *    hardware.
 * 2. **A Bluetooth warning that names the reason.** A headset-profile input opens at
 *    8–16 kHz mono, and on Windows connecting one also moves the *output*, which
 *    suspends the context. Both are worth saying out loud on the page where someone is
 *    wondering why a fader does nothing.
 * 3. **Play, stop and a playhead**, because a channel holding a take makes no sound
 *    until something starts it. Live channels are audible without this; clips are not.
 * 4. **Render out.** WAV or MP3, offline, through the same graph — so what is exported
 *    is what was heard.
 */
export function MixerTransport() {
  const mixer = useMixerStudio();
  const { inputs } = useRecorderStudio();
  const [download, setDownload] = useState<{ url: string; name: string } | null>(null);

  const {
    state,
    status,
    error,
    notice,
    duration,
    isPlaying,
    playhead,
    togglePlay,
    seek,
    activeDeviceId,
    activeDeviceLabel,
    inputHealth,
    armInput,
    retryInput,
    soloActive,
    clearSolos,
    toggleLimiter,
    toggleMasterMute,
    toggleTestTone,
    isTestTone,
    events,
    outputs,
    activeOutputId,
    refreshOutputs,
    setOutputDevice,
    exportWav,
    exportMp3,
  } = mixer;

  const isRendering = status === 'rendering';
  const hasClips = state.channels.some((channel) => channel.source.kind === 'clip');
  const liveCount = state.channels.filter((channel) => channel.source.kind === 'live').length;

  /**
   * Bluetooth is a guess from the label until the stream opens, so both signals are
   * used: the device list's own heuristic, and the fact that a headset profile cannot
   * be the wired interface anyone wants for an instrument.
   */
  const activeDevice = inputs.devices.find((device) => device.deviceId === activeDeviceId) ?? null;
  const isBluetooth = activeDevice?.isBluetooth === true;

  /**
   * Enumerate the outputs once, and keep the list live.
   *
   * In an effect rather than during render — the repo's lint forbids reading a ref there,
   * and rightly: a fetch fired from a render body runs again on every re-render. The
   * `devicechange` listener is what keeps the list honest when a pedal or a headset is
   * plugged in while the page is open, which is exactly when the output moves.
   */
  useEffect(() => {
    void refreshOutputs();
    const media = navigator.mediaDevices;
    if (!media?.addEventListener) return;
    const onChange = () => void refreshOutputs();
    media.addEventListener('devicechange', onChange);
    return () => media.removeEventListener('devicechange', onChange);
  }, [refreshOutputs]);

  const handleExport = async (kind: 'wav' | 'mp3') => {
    const result = kind === 'wav' ? await exportWav() : await exportMp3();
    if (result) setDownload(result);
  };

  return (
    /**
     * `min-w-0` on the column, not just on the text inside it.
     *
     * A flex item's default `min-width: auto` means it refuses to shrink below its
     * content's intrinsic width — so one long sentence or one wide `<select>` stretches
     * this column, the column stretches the panel, and the panel's own border ends up
     * *inside* its content. That is the overflow: not a spacing problem, a shrinking one.
     */
    <div className="flex min-w-0 flex-col gap-2">
      {/* --- Failures first, next to the controls that caused them ------------- */}
      {error ? (
        <div
          role="alert"
          className="flex animate-rise-in items-start gap-2 rounded-lg border border-rec/40 bg-rec/8 px-3 py-2 text-[11px] text-rec"
        >
          <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p className="min-w-0 flex-1 break-words">{error}</p>
          {inputHealth.state === 'lost' ? (
            <button
              type="button"
              onClick={retryInput}
              className="shrink-0 rounded border border-rec/40 bg-rec/10 px-1.5 py-0.5 font-semibold tracking-wider uppercase hover:bg-rec/20"
            >
              Retry
            </button>
          ) : null}
          <button type="button" onClick={mixer.clearError} aria-label="Dismiss" className="shrink-0">
            <X aria-hidden className="h-3 w-3" />
          </button>
        </div>
      ) : null}

      {/* The device is being reopened. Greyscale: nothing is broken. */}
      {inputHealth.state === 'recovering' || inputHealth.state === 'muted' ? (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-2 rounded-lg border border-line-strong bg-inset px-3 py-2 text-[11px] text-ink-2"
        >
          <RefreshCw aria-hidden className="h-3.5 w-3.5 shrink-0 animate-spin" />
          <p className="min-w-0 flex-1">{inputHealth.message}</p>
        </div>
      ) : null}

      {notice ? (
        <div
          role="status"
          className="flex animate-rise-in items-start gap-2 rounded-lg border border-line-strong bg-raised px-3 py-2 text-[11px] text-ink-2"
        >
          <Info aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p className="min-w-0 flex-1 break-words">{notice}</p>
          <button type="button" onClick={mixer.clearNotice} aria-label="Dismiss" className="shrink-0">
            <X aria-hidden className="h-3 w-3" />
          </button>
        </div>
      ) : null}

      {/* A headset-profile input is the one device that cannot do this job. */}
      {isBluetooth ? (
        <div
          role="alert"
          className="flex animate-rise-in items-start gap-2 rounded-lg border border-rec/40 bg-rec/8 px-3 py-2 text-[11px] text-rec"
        >
          <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p className="min-w-0 flex-1 break-words">
            <strong>{activeDeviceLabel}</strong> looks like a Bluetooth headset. Its input is a
            telephone profile — 8–16 kHz mono, 100–300 ms late — and on Windows connecting one
            also moves the system <em>output</em>, which suspends the audio engine. Use the USB
            interface for anything you intend to keep.
          </p>
        </div>
      ) : null}

      {/* --- The bar ----------------------------------------------------------
          One row, wrapping. `gap-x-4` rather than `gap-2`: at 8px the eleven controls read
          as a single undifferentiated strip. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {/* This page's output switch. Red when off, because a desk that is not making a
            sound is the one state that must never look normal. */}
        <button
          type="button"
          onClick={toggleMasterMute}
          aria-pressed={!state.master.muted}
          title={state.master.muted ? 'Turn this page on' : 'Silence this page'}
          className={`flex h-9 items-center gap-2 rounded-lg border px-3 text-[11px] font-semibold tracking-wider uppercase transition-colors active:scale-95 ${
            state.master.muted
              ? 'border-rec/50 bg-rec/10 text-rec'
              : 'border-cyan/50 bg-cyan/12 text-cyan'
          }`}
        >
          <Power aria-hidden className="h-4 w-4" />
          {state.master.muted ? 'Off' : 'On'}
        </button>

        <DeviceSelect
          devices={inputs.devices}
          activeDeviceId={activeDeviceId}
          permission={inputs.permission}
          isBusy={inputs.isEnumerating}
          onSelect={(device) => void armInput(device.deviceId, device.label)}
          onRefresh={inputs.refresh}
          onRequestAccess={() => void inputs.requestAccess()}
        />

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => seek(0)}
            aria-label="Back to start"
            disabled={!hasClips}
            className="flex h-9 w-9 touch-manipulation items-center justify-center rounded-lg border border-line bg-raised text-ink-2 transition-colors hover:border-line-strong hover:text-ink active:scale-95 disabled:opacity-40"
          >
            <SkipBack aria-hidden className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={togglePlay}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            // Not disabled without clips: pressing play is also how the engine is
            // started, which is what a live channel needs to become audible.
            className={`flex h-9 items-center gap-2 rounded-lg border px-3 text-[11px] font-semibold tracking-wider uppercase transition-colors active:scale-95 ${
              isPlaying
                ? 'border-cyan/50 bg-cyan/12 text-cyan'
                : 'border-line bg-raised text-ink-2 hover:text-ink'
            }`}
          >
            {isPlaying ? (
              <Pause aria-hidden className="h-4 w-4" />
            ) : (
              <Play aria-hidden className="h-4 w-4" />
            )}
            {isPlaying ? 'Playing' : 'Play'}
          </button>

          <span className="ml-1 font-mono text-[11px] tabular-nums text-ink-2">
            {formatTimecode(playhead)}{' '}
            <span className="text-ink-3">/ {formatTimecode(duration)}</span>
          </span>
        </div>

        {liveCount > 0 ? (
          <Chip tone={inputHealth.state === 'live' && activeDeviceId ? 'strong' : 'muted'}>
            <Radio aria-hidden className="mr-1 inline h-3 w-3" />
            {liveCount} live
          </Chip>
        ) : null}

        {/* One button to undo every solo, because a solo left on somewhere else is the
            classic "why is half my mix missing". */}
        {soloActive ? (
          <button
            type="button"
            onClick={clearSolos}
            className="rounded-lg border border-line-strong bg-inset px-2 py-1.5 text-[10px] font-semibold tracking-wider uppercase text-ink-2 hover:text-ink"
          >
            Clear solo
          </button>
        ) : null}

        {/* Halves the search when nothing is heard: it enters at the master, so hearing
            it clears the engine and the output in one press. */}
        <button
          type="button"
          onClick={() => void toggleTestTone()}
          aria-pressed={isTestTone}
          title="440 Hz into the master, bypassing every channel. Stays on until switched off."
          className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[10px] font-semibold tracking-wider uppercase transition-colors ${
            isTestTone
              ? 'border-cyan/50 bg-cyan/12 text-cyan'
              : 'border-line bg-raised text-ink-2 hover:text-ink'
          }`}
        >
          <Volume2 aria-hidden className="h-3.5 w-3.5" />
          {isTestTone ? 'Tone on' : 'Test tone'}
        </button>

        <button
          type="button"
          onClick={toggleLimiter}
          aria-pressed={state.master.limiter}
          title={`Master limiter, ceiling ${state.master.ceilingDb.toFixed(1)} dBFS`}
          className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[10px] font-semibold tracking-wider uppercase transition-colors ${
            state.master.limiter
              ? 'border-cyan/50 bg-cyan/12 text-cyan'
              : 'border-line bg-raised text-ink-3 hover:text-ink-2'
          }`}
        >
          <Shield aria-hidden className="h-3.5 w-3.5" />
          Limiter
        </button>

        {/* Where the mix comes OUT. On Windows a USB interface becomes the default
            output when it is plugged in, so the browser plays into the pedal's headphone
            socket while the player listens to the laptop — a healthy input meter and
            silence, which looks exactly like a broken mixer. */}
        {outputs.length > 0 ? (
          <label className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wider uppercase text-ink-3">
            out
            <select
              aria-label="Audio output"
              value={activeOutputId}
              onChange={(event) => void setOutputDevice(event.target.value)}
              className="min-w-0 max-w-44 rounded-lg border border-line bg-raised px-2 py-1.5 font-mono text-[10px] text-ink-2 outline-none focus-visible:border-cyan/50"
            >
              <option value="">system default</option>
              {outputs.map((output) => (
                <option key={output.deviceId} value={output.deviceId}>
                  {output.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleExport('wav')}
            disabled={isRendering || !hasClips}
            className="rounded-lg border border-line bg-raised px-2.5 py-1.5 text-[10px] font-semibold tracking-wider uppercase text-ink-2 transition-colors hover:text-ink disabled:opacity-40"
          >
            {isRendering ? 'Rendering…' : 'Render WAV'}
          </button>
          <button
            type="button"
            onClick={() => void handleExport('mp3')}
            disabled={isRendering || !hasClips}
            className="rounded-lg border border-line bg-raised px-2.5 py-1.5 text-[10px] font-semibold tracking-wider uppercase text-ink-2 transition-colors hover:text-ink disabled:opacity-40"
          >
            MP3
          </button>
          {download ? (
            <a
              href={download.url}
              download={download.name}
              className="flex items-center gap-1.5 rounded-lg border border-cyan/45 bg-cyan/10 px-2.5 py-1.5 text-[10px] font-semibold tracking-wider uppercase text-cyan"
            >
              <Download aria-hidden className="h-3.5 w-3.5" />
              {download.name}
            </a>
          ) : null}
        </div>
      </div>

      <SignalPath />

      {/* The last few transitions. A silence with no history has cost this project several
          rounds of guessing between two people; this is what turns "it went quiet" into
          "it went quiet right after the device was reset". */}
      {events.length > 0 ? (
        <details className="rounded-lg border border-line bg-inset px-2.5 py-1.5">
          <summary className="cursor-pointer font-mono text-[9px] tracking-[0.14em] uppercase text-ink-3">
            audio log · {events.length}
          </summary>
          <ul className="mt-1.5 flex flex-col gap-0.5">
            {events.map((event) => (
              <li
                key={event.id}
                className="flex gap-2 font-mono text-[9px] leading-relaxed text-ink-2"
              >
                <span className="shrink-0 text-ink-3">
                  {new Date(event.at).toLocaleTimeString(undefined, { hour12: false })}
                </span>
                <span className="min-w-0 flex-1">{event.text}</span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(
                events
                  .map(
                    (event) =>
                      `${new Date(event.at).toLocaleTimeString(undefined, { hour12: false })} ${event.text}`,
                  )
                  .join(String.fromCharCode(10)),
              );
            }}
            className="mt-1.5 rounded border border-line bg-raised px-2 py-1 font-mono text-[9px] tracking-wider uppercase text-ink-3 hover:text-ink-2"
          >
            copy
          </button>
        </details>
      ) : null}
    </div>
  );
}
