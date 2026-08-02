'use client';

import { Headphones, Radio } from 'lucide-react';

import { useMixerStudio, useRecorderStudio } from '@/components/providers/StudioProviders';
import { AmpRack } from '@/components/recorder/AmpRack';
import { LevelMeter } from '@/components/recorder/LevelMeter';
import { OutputPicker } from '@/components/recorder/OutputPicker';
import { Chip } from '@/components/ui/Panel';
import { useAccent } from '@/hooks/useAccent';
import { usePressAndHold } from '@/hooks/usePressAndHold';
import { MiniSlider } from '@/components/ui/Controls';
import { getEnabledSnapshot } from '@/lib/ampStore';
import type { Instrument } from '@/lib/rig';

import { BassRack } from './BassRack';
import { DrumRack } from './DrumRack';
import { VocalRack } from './VocalRack';
import { KeysRack } from './KeysRack';
import { BrassRack } from './BrassRack';
import { RigMixer } from './RigMixer';

/**
 * AmpWorkspace — the tone page: one input, three racks, all three live.
 *
 * ---------------------------------------------------------------------------
 * This file is deliberately a **shell**, not a rack.
 *
 * Each instrument's controls are their own file — `AmpRack` for the guitar, plus
 * `BassRack` and `DrumRack` beside this one — and this composes them. Three racks in
 * one file would be two thousand lines, and the one that is not on screen is the one
 * that quietly rots.
 *
 * What this file owns is what genuinely spans the three: the listening strip, the rig
 * mixer, and the fold that plays when a different rack is selected.
 *
 * **All three chains run at once.** The mixer is the bridge — each channel has its own
 * switch and its own level, so a bass sound dialled five minutes ago is still playing
 * while the drum rack is on screen. Selecting a rack changes what you see and nothing
 * you hear; the power button and the fader change what you hear and nothing you see.
 *
 * **Everything here is a view onto engines that live somewhere else.** The racks
 * write to the shared store in `lib/ampStore.ts`, which the recorder's monitor path
 * and the jam page's playback graph both subscribe to, so a knob moved here is heard
 * on the input being played now and printed into a jam mixdown later. The instrument
 * selection is in that store too, and so are the mixer's switches and levels.
 *
 * The strip along the top is what makes any of it usable: dialling a tone you cannot
 * hear is guesswork, so the armed state, the monitor switch and the input meters are
 * here rather than only on the recorder page. Same engine — pressing MONITOR here is
 * pressing it there.
 * ---------------------------------------------------------------------------
 */
export function AmpWorkspace() {
  const { recorder } = useRecorderStudio();
  /**
   * The desk, so one control can drive both engines.
   *
   * The rack *parameters* were always shared through `lib/ampStore.ts`; the **levels**
   * were not, and that was the collision: turning an instrument down on this page moved
   * the recorder's monitor while the mixer channel carrying the same rack stayed where it
   * was. Two numbers for one idea. The handlers below now write both — the recorder call
   * is untouched, the mixer call is added, and it is a no-op when no channel carries that
   * rack.
   */
  const mixer = useMixerStudio();
  const { accent } = useAccent();
  const isArmed = recorder.status !== 'idle' && recorder.status !== 'error';
  /**
   * Whether the racks on this page are being fed the input right now.
   *
   * Armed is not enough on its own: while the desk owns the live monitor this engine's
   * channels are held at zero, so the racks here really are acting on nothing and the row
   * below should keep saying so. Read from the store rather than assumed from the route —
   * the rule lives in one place (`lib/ampStore.ts`) and this is a view of it.
   */
  const hasLiveFeed = isArmed && recorder.monitorScope === 'recorder';

  const masterDecHandlers = usePressAndHold(() => {
    recorder.changeMasterVolume(Math.max(0, recorder.masterVolume - 0.01));
  });

  const masterIncHandlers = usePressAndHold(() => {
    recorder.changeMasterVolume(Math.min(1.5, recorder.masterVolume + 0.01));
  });

  const { instrument } = recorder;

  /** One instrument's level, on both the recorder's monitor and its mixer channels. */
  const handleLevel = (which: Instrument, value: number) => {
    recorder.setInstrumentLevel(which, value);
    mixer.setInsertLevel(which, value);
  };

  /**
   * One instrument's on/off, on both engines.
   *
   * The new value is read back **from the store**, not inferred from `recorder.enabled`.
   * That map comes from this render's closure, so inferring the inverse was wrong the
   * moment two clicks landed in one frame — or the moment anything else toggled the same
   * channel — and the two engines then disagreed: one muted, one not, with no way to tell
   * from the screen which was which. The store is the only thing that knows.
   */
  const handleToggle = (which: Instrument) => {
    recorder.toggleInstrument(which);
    mixer.setInsertEnabled(which, getEnabledSnapshot()[which]);
  };

  // The visible rack's header switch is that rack's channel — the same switch as the
  // mixer row above it, not a second, global one.
  const shared = {
    isEnabled: recorder.enabled[instrument],
    onToggle: () => handleToggle(instrument),
    limiterReductionRef: recorder.limiterReductionRef,
    gateReductionRef: recorder.gateReductionRef,
    isArmed,
  };

  return (
    <div className="flex min-h-full flex-col">
      <main className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-3 px-3 py-3.5 sm:px-5 sm:py-4 lg:gap-4">
        {/* ---- Listening strip ---------------------------------------------
            Not a duplicate transport: no record button, because recording belongs to
            the page that shows the takes. Only what is needed to hear the rack. */}
        <div className="flex animate-rise-in flex-wrap items-center gap-2 rounded-xl border border-line bg-panel px-3 py-2 shadow-panel">
          <Radio
            aria-hidden
            className={`h-4 w-4 shrink-0 ${isArmed ? 'text-cyan' : 'text-ink-3'}`}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-ink">{recorder.activeDeviceLabel}</p>
            <p className="font-mono text-[9px] tracking-[0.14em] uppercase text-ink-3">
              {isArmed ? 'signal open' : 'no input — open the recorder page to arm one'}
            </p>
          </div>

          {recorder.format ? (
            <Chip>
              {(recorder.format.sampleRate / 1000).toFixed(1)} kHz ·{' '}
              {recorder.format.channels === 2 ? 'stereo' : 'mono'}
            </Chip>
          ) : null}

          {/* The meters read the dry input, before the rack — the level that is
              written to disk, and the one worth protecting from clipping. */}
          <div className="w-64 shrink-0 sm:w-80">
            <LevelMeter
              meterRef={recorder.meterRef}
              channels={recorder.format?.channels ?? 1}
              active={isArmed}
            />
          </div>

          {/* Master Volume Slider with precise buttons */}
          {isArmed && (
            <div className="flex flex-col items-stretch select-none mx-2">
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-[9px] font-bold text-ink-3 uppercase mr-1">Master</span>
                <button
                  type="button"
                  disabled={!recorder.isMonitoring}
                  title="ลดเสียงมอนิเตอร์รวมทีละ 1%"
                  className="flex h-6.5 w-6.5 shrink-0 items-center justify-center rounded-lg border border-cyan/60 bg-cyan/20 hover:bg-cyan/35 active:scale-95 text-cyan hover:text-white transition-all duration-100 disabled:pointer-events-none disabled:opacity-20 font-mono text-[13px] font-bold shadow-md shadow-cyan/10"
                  {...masterDecHandlers}
                >
                  -
                </button>
                <div className="min-w-0 w-32 sm:w-56">
                  <MiniSlider
                    label=""
                    value={recorder.masterVolume}
                    min={0}
                    max={1.5}
                    step={0.01}
                    disabled={!recorder.isMonitoring}
                    inputClassName="fader-cyan"
                    onChange={recorder.changeMasterVolume}
                  />
                </div>
                <button
                  type="button"
                  disabled={!recorder.isMonitoring}
                  title="เพิ่มเสียงมอนิเตอร์รวมทีละ 1%"
                  className="flex h-6.5 w-6.5 shrink-0 items-center justify-center rounded-lg border border-cyan/60 bg-cyan/20 hover:bg-cyan/35 active:scale-95 text-cyan hover:text-white transition-all duration-100 disabled:pointer-events-none disabled:opacity-20 font-mono text-[13px] font-bold shadow-md shadow-cyan/10"
                  {...masterIncHandlers}
                >
                  +
                </button>
              </div>
              <span className={`text-center font-mono text-[9px] tabular-nums mt-0.5 select-none transition-colors duration-150 pl-10 ${recorder.isMonitoring ? 'text-ink-2' : 'text-ink-3/40'}`}>
                {Math.round(recorder.masterVolume * 100)}%
              </span>
            </div>
          )}

          <button
            type="button"
            onClick={recorder.toggleMonitoring}
            disabled={!isArmed}
            aria-pressed={recorder.isMonitoring}
            title={isArmed ? 'Hear the rack on your output' : 'Arm an input on the recorder page first'}
            className={`flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 font-mono text-[10px] font-bold tracking-wider uppercase transition-colors duration-200 disabled:pointer-events-none disabled:opacity-40 ${
              recorder.isMonitoring
                ? 'border-cyan/50 bg-cyan/12 text-cyan'
                : 'border-line text-ink-2 hover:text-ink'
            }`}
          >
            <Headphones aria-hidden className="h-3.5 w-3.5" />
            Monitor
          </button>

          {/* Second row of the same strip: the input's device picker has a counterpart at
              last. `basis-full` rather than a separate panel — it belongs to "what am I
              listening on", which is what this strip is. See `OutputPicker` for why a
              silent output is invisible from everywhere else on this page. */}
          <div className="basis-full">
            <OutputPicker
              devices={recorder.outputDevices}
              value={recorder.outputDeviceId}
              onChange={(deviceId) => void recorder.changeOutputDevice(deviceId)}
              onTest={recorder.playTestTone}
              onProbe={recorder.playProbeTone}
              disabled={!isArmed}
            />
          </div>
        </div>

        {/* This page owns the live monitor while it is on screen (see the route watcher in
            StudioProviders), so a muted monitor switch here means silence with no other
            explanation. Says so, and offers the one click that fixes it. */}
        {isArmed && !recorder.isMonitoring ? (
          <div
            role="status"
            className="flex animate-rise-in items-center gap-2 rounded-lg border border-line-strong bg-inset px-3 py-2 text-[11px] text-ink-2"
          >
            <Headphones aria-hidden className="h-3.5 w-3.5 shrink-0" />
            <p className="min-w-0 flex-1">
              หน้านี้เป็นเจ้าของเสียงสดอยู่ แต่ปุ่ม Monitor ปิด — จะไม่ได้ยินอะไรจนกดเปิด
            </p>
            <button
              type="button"
              onClick={recorder.toggleMonitoring}
              className="shrink-0 rounded border border-cyan/45 bg-cyan/10 px-2 py-1 font-mono text-[10px] font-semibold tracking-wider uppercase text-cyan"
            >
              เปิด Monitor
            </button>
          </div>
        ) : null}

        <div className="animate-rise-in" style={{ animationDelay: '30ms' }}>
          <RigMixer
            instrument={instrument}
            onSelect={recorder.selectInstrument}
            enabled={recorder.enabled}
            onToggle={handleToggle}
            level={recorder.level}
            onLevel={handleLevel}
            accent={accent.colour}
            isArmed={isArmed}
            channelsFor={mixer.channelsForInsert}
            onPutLive={mixer.putLiveOnInsert}
            hasLiveFeed={hasLiveFeed}
          />
        </div>

        {/* ---- The rack -----------------------------------------------------
            `key` is the instrument, so React unmounts one rack and mounts the other
            rather than reconciling twelve knobs into eleven different ones — and so
            the fold animation replays on every switch. It is a remount either way:
            the racks share no state, and the settings they edit live in the store.
            Nothing audible is unmounted with it — all three chains stay in the graph.

            `animate-fold-in` is the roll: the incoming rack unfolds from its top
            edge, which reads as one panel being swapped for another in the same
            slot. See `globals.css` — it is disabled under `prefers-reduced-motion`,
            where a 3D rotation is exactly the kind of movement that is being asked
            about. */}
        <div key={instrument} className="animate-fold-in origin-top">
          {instrument === 'guitar' ? (
            <AmpRack
              {...shared}
              amp={recorder.amp}
              onChange={recorder.changeAmp}
              scope="monitor"
            />
          ) : instrument === 'bass' ? (
            <BassRack {...shared} bass={recorder.bass} onChange={recorder.changeBass} />
          ) : instrument === 'drums' ? (
            <DrumRack {...shared} drums={recorder.drums} onChange={recorder.changeDrums} />
          ) : instrument === 'vocals' ? (
            <VocalRack {...shared} vocals={recorder.vocals} onChange={recorder.changeVocals} />
          ) : instrument === 'keys' ? (
            <KeysRack {...shared} keys={recorder.keys} onChange={recorder.changeKeys} />
          ) : (
            <BrassRack {...shared} brass={recorder.brass} onChange={recorder.changeBrass} />
          )}
        </div>
      </main>

      <footer className="border-t border-line px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
        <p className="mx-auto max-w-[1600px] text-center font-mono text-[9px] tracking-[0.16em] uppercase text-ink-3 sm:text-left sm:text-[10px] sm:tracking-[0.18em]">
          Tone · three racks live at once · shared with the recorder · takes stay dry
        </p>
      </footer>
    </div>
  );
}
