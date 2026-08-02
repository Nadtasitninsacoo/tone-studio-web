'use client';

import { AlertTriangle } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { useRecorderStudio } from '@/components/providers/StudioProviders';
import type { Take } from '@/types/recorder';

import { ampFilename, renderWithAmp } from '@/lib/ampRender';

import { ControlPanel } from './ControlPanel';
import { HeaderBar } from './HeaderBar';
import { TakeList } from './TakeList';
import { TakePlayer } from './TakePlayer';
import { TunerPanel } from './TunerPanel';

interface RecorderDashboardProps {
  /** Shown in the header. Would come from a project record once the API exists. */
  projectName: string;
}

/**
 * RecorderDashboard — the single stateful owner of the dashboard.
 *
 * Everything below it is presentational: it wires device discovery to the
 * recording engine, owns the take list, and handles global keyboard shortcuts.
 * Takes live in memory as WAV blobs for this session.
 */
export function RecorderDashboard({ projectName }: RecorderDashboardProps) {
  // The engine, the device list and the take library all live above the router now,
  // so leaving this page does not close the AudioContext. See `StudioProviders`.
  const { recorder, inputs, library, selectedTakeId, setSelectedTakeId, selectDevice } =
    useRecorderStudio();

  const { takes, remove: removeTake } = library;

  const [isRenderingAmp, setIsRenderingAmp] = useState(false);

  /**
   * Print the amp into a copy of a take.
   *
   * Reads the take's own bytes rather than re-capturing anything: the dry WAV is
   * the source of truth, so the render is repeatable and the original is never
   * touched. Errors surface through the recorder's own error channel so there is
   * one place failures appear.
   */
  const handleExportWithAmp = useCallback(
    async (take: Take) => {
      setIsRenderingAmp(true);
      try {
        const source = take.blob
          ? await take.blob.arrayBuffer()
          : await (await fetch(take.url)).arrayBuffer();
        const { blob } = await renderWithAmp(source, recorder.amp);
        return { blob, name: ampFilename(take.name) };
      } catch {
        // A decode or render failure is worth naming, not swallowing.
        return null;
      } finally {
        setIsRenderingAmp(false);
      }
    },
    [recorder.amp],
  );
  // Destructured because these are stable callbacks — the `recorder` object itself
  // is a new reference every render, which would thrash the effects below.
  const { start, stop, pause, resume, status, activeDeviceId } = recorder;
  const { permission, requestAccess, devices: availableDevices } = inputs;

  /** Record: resolve permission and arm first if there is no open input yet. */
  const handleStart = useCallback(async () => {
    if (status === 'idle' || status === 'error') {
      // No stream open: get access, then let the auto-arm effect open the device.
      // The user presses record again once the transport shows "Armed".
      if (permission !== 'granted') await requestAccess();
      return;
    }
    start();
  }, [status, permission, requestAccess, start]);

  const handleStop = useCallback(() => {
    void stop();
  }, [stop]);

  const handleDelete = useCallback(
    (id: string) => {
      void removeTake(id);
      // A plain value, not an updater: the setter comes from the provider, which
      // exposes it as `(id) => void` rather than React's own dispatch.
      if (selectedTakeId === id) setSelectedTakeId(null);
    },
    [removeTake, selectedTakeId, setSelectedTakeId],
  );

  /**
   * Transport shortcuts: R = record, S = stop, Space = pause/resume.
   * Ignored while a form control has focus so typing never triggers the transport.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        target?.isContentEditable ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '')
      ) {
        return;
      }

      const key = event.key.toLowerCase();

      if (key === 'r' && (status === 'ready' || status === 'idle')) {
        event.preventDefault();
        void handleStart();
        return;
      }
      if (key === 's' && (status === 'recording' || status === 'paused')) {
        event.preventDefault();
        handleStop();
        return;
      }
      if (event.key === ' ') {
        if (status === 'recording') {
          event.preventDefault();
          pause();
        } else if (status === 'paused') {
          event.preventDefault();
          resume();
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [status, handleStart, handleStop, pause, resume]);

  const selectedTake = takes.find((take) => take.id === selectedTakeId) ?? takes[0] ?? null;

  return (
    <div className="flex min-h-full flex-col">
      <HeaderBar
        projectName={projectName}
        status={status}
        format={recorder.format}
        devices={availableDevices}
        activeDeviceId={activeDeviceId}
        permission={permission}
        isBusy={inputs.isEnumerating || status === 'arming'}
        onSelectDevice={selectDevice}
        onRefreshDevices={inputs.refresh}
        onRequestAccess={() => void requestAccess()}
        meterRef={recorder.meterRef}
        channels={recorder.channels}
        masterVolume={recorder.masterVolume}
        onChangeMasterVolume={recorder.changeMasterVolume}
        isMonitoring={recorder.isMonitoring}
      />

      <main className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-3 px-3 py-3.5 sm:px-5 sm:py-4 lg:gap-4">
        {/* Device-permission gate: the one thing that must be resolved first */}
        {permission !== 'granted' ? (
          <div
            role="alert"
            className="flex animate-rise-in flex-col gap-2 rounded-xl border border-rec/30 bg-rec/6 px-3.5 py-3 sm:flex-row sm:items-center sm:gap-4"
          >
            <AlertTriangle aria-hidden className="h-5 w-5 shrink-0 text-rec" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">Input access required</p>
              <p className="mt-0.5 text-xs text-ink-2">
                {inputs.error ??
                  'Allow microphone access so the browser can expose your USB interface. Device names stay hidden until you do.'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void requestAccess()}
              className="shrink-0 touch-manipulation rounded-lg border border-rec/40 bg-rec/10 px-3 py-2 text-xs font-semibold tracking-wider uppercase text-rec transition-all duration-200 hover:bg-rec/20 active:scale-95 sm:py-1.5"
            >
              Enable Input
            </button>
          </div>
        ) : null}

        {/* Entrance stagger — panels arrive in reading order rather than all at once */}
        <div className="animate-rise-in" style={{ animationDelay: '40ms' }}>
          <ControlPanel
            recorder={recorder}
            onStart={() => void handleStart()}
            onStop={handleStop}
          />
        </div>

        {/* Tuning comes before tone, in the session and therefore on the page. */}
        <div className="animate-rise-in" style={{ animationDelay: '60ms' }}>
          <TunerPanel
            tunerRef={recorder.tunerRef}
            isTuning={recorder.isTuning}
            onToggle={recorder.toggleTuner}
            onRangeChange={recorder.setTunerRange}
            isArmed={recorder.status !== 'idle' && recorder.status !== 'error'}
            sourceLabel={recorder.activeDeviceLabel}
            sampleRate={recorder.format?.sampleRate ?? null}
          />
        </div>

        {/* Player + history: stacked on phones, side by side on studio screens */}
        <div
          className="grid flex-1 animate-rise-in gap-3 lg:grid-cols-2 lg:gap-4"
          style={{ animationDelay: '110ms' }}
        >
          {/* Keyed on the take so the player's transport state resets per take. */}
          <TakePlayer
            key={selectedTake?.id ?? 'empty'}
            take={selectedTake}
            onDelete={handleDelete}
            onExportWithAmp={handleExportWithAmp}
            isExporting={isRenderingAmp}
          />
          <TakeList
            takes={takes}
            selectedId={selectedTake?.id ?? null}
            onSelect={setSelectedTakeId}
            onDelete={handleDelete}
          />
        </div>
      </main>

      {/* Safe-area padding keeps the footer clear of the iOS home indicator */}
      <footer className="border-t border-line px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
        <p className="mx-auto max-w-[1600px] text-center font-mono text-[9px] tracking-[0.16em] uppercase text-ink-3 sm:text-left sm:text-[10px] sm:tracking-[0.18em]">
          Guitar Recorder · 16-bit PCM WAV · Takes are held in this session only
        </p>
      </footer>
    </div>
  );
}
