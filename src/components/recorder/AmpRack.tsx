'use client';

import { Check, Save, Speaker, Trash2, X, Zap } from 'lucide-react';
import { type RefObject, useCallback, useState } from 'react';

import { AccentRail } from '@/components/ui/AccentRail';
import { Chip, Panel } from '@/components/ui/Panel';
import { Knob } from '@/components/ui/Knob';
import { useAccent } from '@/hooks/useAccent';
import { useAmpPresets } from '@/hooks/useAmpPresets';
import { AMP_PRESETS, type AmpSettings } from '@/lib/ampFx';
import { deleteAmpPreset, matchingPresetId, saveAmpPreset } from '@/lib/ampPresets';
import { cabinetsFor } from '@/lib/cabinet';
import { GUITAR_LEXICON } from '@/lib/toneIntent';

import {
  Block,
  BypassSwitch,
  GainReduction,
  KnobRow,
  Legend,
  Row,
  signed,
} from '@/components/amp/RackParts';

import { ToneAssistant } from './ToneAssistant';

/** Note divisions offered for a tempo-synced delay. */
const DELAY_DIVISIONS: { label: string; beats: number }[] = [
  { label: '1/8', beats: 0.5 },
  { label: '1/8.', beats: 0.75 },
  { label: '1/4', beats: 1 },
  { label: '1/2', beats: 2 },
];

/**
 * What the amp is doing on the page that mounted it.
 *
 * Not decoration. On the recorder it shapes the monitor path and nothing else; on
 * the jam page the same chain also plays back every layer and is printed into the
 * mixdown. Both keep takes dry, but "monitor only" is false on one of them, and a
 * rack that lies about where its sound ends up is how someone exports a mix that
 * does not match what they heard.
 */
export type AmpScope = 'monitor' | 'mix';

const SCOPE: Record<AmpScope, { title: string; chip: string; chipHint: string; unarmed: string }> = {
  monitor: {
    title: 'Amp & Cabinet',
    chip: 'monitor only',
    chipHint: 'Monitoring only — takes stay dry and nothing here is printed into the WAV',
    unarmed:
      ' Select an input to hear any of this, and press MONITOR in the transport — the amp is on the monitoring path.',
  },
  mix: {
    // Shorter, because this one lives in a 240px rail: the header also has to fit
    // the scope chip, the GR readout and the bypass switch, and `Panel` clips
    // rather than wraps. The rack tab above it already says "Guitar".
    title: 'Amp',
    chip: 'in the mix',
    chipHint:
      'Monitoring, layer playback and the export all run through this — the captured takes themselves stay dry',
    unarmed:
      ' Select an input and press MONITOR to hear it while you play. Recorded layers run through the amp either way.',
  },
};

interface AmpRackProps {
  amp: AmpSettings;
  onChange: (amp: AmpSettings) => void;
  isEnabled: boolean;
  onToggle: () => void;
  /** Gain reduction from the limiter worklet, dB, <= 0. */
  limiterReductionRef: RefObject<number>;
  gateReductionRef: RefObject<number>;
  /** False until an input is armed. */
  isArmed: boolean;
  /** Where this rack's sound ends up. See `AmpScope`. */
  scope: AmpScope;
  /**
   * Detected tempo, for note-length delay times. Null where none is known — the
   * recorder has no backing track to detect one from.
   */
  bpm?: number | null;
}

/**
 * AmpRack — amplifier, cabinet and mastering. Shared by the recorder and the jam
 * page; `scope` says which, and it changes what the header claims.
 *
 * The one thing to understand before using it: **this is not the recording.** Takes
 * are captured dry, before any of this, so nothing here is printed into the WAV.
 * That is deliberate — an amp baked into a file can never be changed, and tone is
 * the thing you always want to change after a take. The meters in the transport
 * read the dry signal for the same reason: they show the level being written to
 * disk, which is the level that matters for clipping.
 *
 * Ordered top to bottom in signal order, because that is the only order in which
 * the controls explain each other.
 *
 * The controls are octagonal gauges rather than sliders. Fifteen horizontal
 * sliders in three columns gave every control the same silhouette, so finding one
 * meant reading labels; a gauge's pointer angle is recognisable without reading,
 * which is what makes a hardware amp usable without looking. See `ui/Knob`.
 */
export function AmpRack({
  amp,
  onChange,
  isEnabled,
  onToggle,
  limiterReductionRef,
  gateReductionRef,
  isArmed,
  scope,
  bpm = null,
}: AmpRackProps) {
  const patch = (change: Partial<AmpSettings>) => onChange({ ...amp, ...change });
  /**
   * Whether this chain is passing audio at all right now.
   *
   * On the jam page it is, armed or not: layers play through it. Dimming the rack
   * there would say these controls do nothing when they are shaping playback and
   * the export.
   */
  const isLive = isEnabled && (scope === 'mix' || isArmed);
  const off = !isLive;

  const { accent } = useAccent();
  const colour = accent.colour;

  /**
   * Tint for anything selected, in the chosen accent.
   *
   * Inline rather than Tailwind classes because the colour is a runtime value —
   * a class name cannot be composed from one, and enumerating four variants of
   * every state would put the palette in eight places instead of one.
   */
  const selected = {
    borderColor: colour,
    color: colour,
    backgroundColor: `color-mix(in srgb, ${colour} 14%, transparent)`,
  };

  const activePreset = AMP_PRESETS.find(
    (preset) => JSON.stringify(preset.settings) === JSON.stringify(amp),
  );

  const saved = useAmpPresets();
  const activeSavedId = matchingPresetId(amp, saved);
  /** Name being typed, or null when the save field is closed. */
  const [draftName, setDraftName] = useState<string | null>(null);

  const commitSave = useCallback(() => {
    if (draftName === null) return;
    saveAmpPreset(draftName, amp);
    setDraftName(null);
  }, [amp, draftName]);

  return (
    <Panel
      title={SCOPE[scope].title}
      icon={<Zap aria-hidden className="h-3.5 w-3.5" />}
      actions={
        <>
          <Chip tone={isEnabled ? 'strong' : 'muted'} title={SCOPE[scope].chipHint}>
            {SCOPE[scope].chip}
          </Chip>

          {/* One long colour rail, not a row of swatches. Global and remembered
              across reloads, so one page owns it — the jam rail has no room beside
              the scope chip, the GR readout and the bypass switch, and a second copy
              of a global preference is a place for the two to disagree. */}
          {scope === 'monitor' ? <AccentRail /> : null}

          <GainReduction
            label="GR"
            reductionRef={limiterReductionRef}
            active={isLive && amp.limiter.enabled}
          />
          <BypassSwitch isEnabled={isEnabled} onToggle={onToggle} accent={colour} />
        </>
      }
    >
      {/* A **container** query, not a viewport one. The same rack is full width on
          the recorder dashboard and 240px wide in the jam page's rack rail, and both
          are "lg" viewports — keying the columns to the viewport put three columns of
          knobs into a 240px rail. */}
      <div className={`@container flex flex-col gap-2.5 ${off ? 'opacity-45' : ''}`}>
        {/* ---- Column layout ------------------------------------------------
            Three columns that end level, which took three attempts and is worth
            recording so it is not "simplified" back:

            1. **Grid, one block per column.** Grid rows share a height, so the short
               front-end column left a third of the rack empty beside the cabinet.
            2. **Grid plus a hand-built flex column.** Moved the hole rather than
               closing it — the middle column became the short one.
            3. **CSS multi-column** (`columns-3`, `column-fill: balance`). The browser
               balances, but only by packing whole blocks in order, and the remainder
               always lands in the last column: measured 690 / 800 / 450 px.

            What works is balancing the *content* instead of the boxes. Six blocks,
            two per column, each pair within about a hundred pixels of the others —
            and the split points are ones the amp already had, so the layout did not
            have to be bent to fit the arithmetic.

            **Signal order is preserved, column-major** — down column one, then two,
            then three: input trim, gate, compressor, tone stack, drive, cabinet,
            delay, reverb, output, limiter. Moving a block between columns to chase a
            few pixels reorders the amp as the player reads it, which costs more than
            it buys.

            Both new splits are honest rather than cosmetic: the tone stack now sits
            **above** the drive instead of beside it inside one "Preamp" panel, which
            is where the signal puts it, and the output trim and limiter are their own
            block because mastering is not part of the speaker. */}
        <div className="grid items-start gap-2.5 @2xl:grid-cols-2 @5xl:grid-cols-3">
          {/* ---- Column 1: where you start, then the input and its EQ -------
              The two preset sections used to be a full-width strip above the
              columns. They are here because column one is otherwise ~160px shorter
              than the other two — five knobs against nine and eleven — and because
              "pick a starting point" belongs at the top left of a rack, before the
              chain it starts. Wrapping the preset chips into two rows in a narrower
              column costs nothing; the hole did. */}
          <div className="flex flex-col gap-2.5">
            {/* ---- Presets. A chain this size is unusable from its defaults. ------ */}
            <section>
              <Legend>Preset</Legend>
              <div className="flex flex-wrap gap-1.5">
                {AMP_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => onChange(preset.settings)}
                    title={preset.hint}
                    className="rounded-md border border-line bg-panel px-2.5 py-1 text-[11px] font-semibold tracking-wide uppercase text-ink-2 transition-colors duration-200 hover:text-ink"
                    style={activePreset?.id === preset.id ? selected : undefined}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[10px] leading-snug text-ink-3">
                {activePreset?.hint ??
                  (activeSavedId
                    ? 'One of your own presets.'
                    : 'Edited — no preset matches these settings. Save it below to come back to it.')}
              </p>
            </section>

            {/* ---- The user's own presets ---------------------------------------
                A tone that took ten minutes to dial in and cannot be recalled is a
                tone that gets dialled in again from scratch every session. These are
                stored in the browser, not on the server — see `lib/ampPresets`. */}
            <section>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <Legend>My presets</Legend>
                {draftName === null ? (
                  <button
                    type="button"
                    onClick={() => setDraftName('')}
                    title="Save the current settings under a name"
                    className="flex items-center gap-1.5 rounded-md border border-line bg-panel px-2 py-1 text-[10px] font-semibold tracking-wide uppercase text-ink-2 transition-colors duration-200 hover:text-ink"
                  >
                    <Save aria-hidden className="h-3 w-3" />
                    Save current
                  </button>
                ) : null}
              </div>

              {draftName !== null ? (
                <div className="mb-1.5 flex animate-rise-in items-center gap-1.5">
                  <input
                    autoFocus
                    value={draftName}
                    maxLength={32}
                    placeholder={`Preset ${saved.length + 1}`}
                    onChange={(event) => setDraftName(event.target.value)}
                    onKeyDown={(event) => {
                      // Enter saves, Escape abandons. A name field that can only be
                      // committed by finding a button is a field people abandon.
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        commitSave();
                      } else if (event.key === 'Escape') {
                        event.preventDefault();
                        setDraftName(null);
                      }
                    }}
                    aria-label="Preset name"
                    className="min-w-0 flex-1 rounded-md border border-line bg-inset px-2 py-1 text-[11px] text-ink outline-none focus:border-line-strong"
                  />
                  <button
                    type="button"
                    onClick={commitSave}
                    title="Save"
                    aria-label="Save preset"
                    className="rounded-md border p-1.5 transition-colors duration-200"
                    style={selected}
                  >
                    <Check aria-hidden className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDraftName(null)}
                    title="Cancel"
                    aria-label="Cancel saving"
                    className="rounded-md border border-line p-1.5 text-ink-3 transition-colors duration-200 hover:text-ink"
                  >
                    <X aria-hidden className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : null}

              {saved.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {saved.map((preset) => (
                    <div
                      key={preset.id}
                      className="flex items-stretch overflow-hidden rounded-md border border-line bg-panel"
                      style={activeSavedId === preset.id ? selected : undefined}
                    >
                      <button
                        type="button"
                        onClick={() => onChange(preset.settings)}
                        title={`Load ${preset.name}`}
                        className="px-2.5 py-1 text-[11px] font-semibold tracking-wide transition-colors duration-200"
                      >
                        {preset.name}
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteAmpPreset(preset.id)}
                        title={`Delete ${preset.name}`}
                        aria-label={`Delete ${preset.name}`}
                        className="border-l border-line/60 px-1.5 text-ink-3 transition-colors duration-200 hover:text-ink"
                      >
                        <Trash2 aria-hidden className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[10px] leading-snug text-ink-3">
                  Nothing saved yet. Dial in a sound, press <strong>Save current</strong>, and it will
                  be here next time you open the app — saving under a name you already used replaces
                  it.
                </p>
              )}
            </section>

            <Block name="Front end">
            <KnobRow>
              <Knob
                label="Input"
                value={amp.inputDb}
                min={-12}
                max={12}
                step={0.5}
                origin={0}
                accent={colour}
                readout={signed(amp.inputDb)}
                hint="Trim before the gain stages, so they are fed at a sane level."
                onChange={(inputDb) => patch({ inputDb })}
              />
            </KnobRow>

            <Row
              label="Gate"
              enabled={amp.gate.enabled}
              accent={colour}
              onToggle={() => patch({ gate: { ...amp.gate, enabled: !amp.gate.enabled } })}
              hint="Shuts the noise floor between phrases. Sits before the gain stages, where the hiss has not been amplified yet."
            >
              <GainReduction
                label=""
                reductionRef={gateReductionRef}
                active={isLive && amp.gate.enabled}
              />
            </Row>
            <KnobRow>
              <Knob
                label="Thresh"
                value={amp.gate.thresholdDb}
                min={-80}
                max={-20}
                step={1}
                accent={colour}
                disabled={!amp.gate.enabled}
                readout={`${amp.gate.thresholdDb}dB`}
                hint="Raise it if hum survives between notes; lower it if quiet notes are cut off."
                onChange={(thresholdDb) => patch({ gate: { ...amp.gate, thresholdDb } })}
              />
            </KnobRow>

            <Row
              label="Compressor"
              enabled={amp.comp.enabled}
              accent={colour}
              onToggle={() => patch({ comp: { ...amp.comp, enabled: !amp.comp.enabled } })}
              hint="Evens out picking before the amp, which is what gives sustain."
            />
            <KnobRow>
              <Knob
                label="Thresh"
                value={amp.comp.thresholdDb}
                min={-48}
                max={0}
                step={1}
                accent={colour}
                disabled={!amp.comp.enabled}
                readout={`${amp.comp.thresholdDb}dB`}
                onChange={(thresholdDb) => patch({ comp: { ...amp.comp, thresholdDb } })}
              />
              <Knob
                label="Ratio"
                value={amp.comp.ratio}
                min={1}
                max={12}
                step={0.5}
                accent={colour}
                disabled={!amp.comp.enabled}
                readout={`${amp.comp.ratio}:1`}
                onChange={(ratio) => patch({ comp: { ...amp.comp, ratio } })}
              />
            </KnobRow>
            </Block>

            {/* The old "Preamp" block drew the gain controls first and then explained
                in prose that the EQ was upstream of them. Reading order now matches
                the signal, so the note under it can be one line instead of three. */}
            <Block name="Tone stack">
            <KnobRow>
              <Knob
                label="Bass"
                value={amp.tone.bassDb}
                min={-12}
                max={12}
                step={0.5}
                origin={0}
                accent={colour}
                readout={signed(amp.tone.bassDb)}
                onChange={(bassDb) => patch({ tone: { ...amp.tone, bassDb } })}
              />
              <Knob
                label="Mid"
                value={amp.tone.midDb}
                min={-12}
                max={12}
                step={0.5}
                origin={0}
                accent={colour}
                readout={signed(amp.tone.midDb)}
                onChange={(midDb) => patch({ tone: { ...amp.tone, midDb } })}
              />
              <Knob
                label="Mid Hz"
                value={amp.tone.midHz}
                min={200}
                max={2000}
                step={10}
                accent={colour}
                readout={`${(amp.tone.midHz / 1000).toFixed(2)}k`}
                onChange={(midHz) => patch({ tone: { ...amp.tone, midHz } })}
              />
              <Knob
                label="Treble"
                value={amp.tone.trebleDb}
                min={-12}
                max={12}
                step={0.5}
                origin={0}
                accent={colour}
                readout={signed(amp.tone.trebleDb)}
                onChange={(trebleDb) => patch({ tone: { ...amp.tone, trebleDb } })}
              />
            </KnobRow>
            <p className="text-[9px] leading-snug text-ink-3">
              EQ here decides which harmonics the drive <em>generates</em>. After it, EQ can
              only filter ones that already exist.
            </p>
            </Block>
          </div>

          {/* ---- Column 2: the gain stages, then the speaker ----------------- */}
          <div className="flex flex-col gap-2.5">
            <Block name="Drive">
            <Row
              label="Drive"
              enabled={amp.drive.enabled}
              accent={colour}
              onToggle={() => patch({ drive: { ...amp.drive, enabled: !amp.drive.enabled } })}
              hint="Cascaded valve stages with a lowpass between them — that cascade is what separates an amp from a fuzz."
            />
            <KnobRow>
              <Knob
                label="Gain"
                value={amp.drive.amount}
                min={0}
                max={1}
                step={0.01}
                accent={colour}
                disabled={!amp.drive.enabled}
                readout={`${Math.round(amp.drive.amount * 100)}%`}
                onChange={(amount) => patch({ drive: { ...amp.drive, amount } })}
              />
              <Knob
                label="Bias"
                value={amp.drive.bias}
                min={0}
                max={0.4}
                step={0.01}
                accent={colour}
                disabled={!amp.drive.enabled}
                readout={amp.drive.bias === 0 ? 'sym' : amp.drive.bias.toFixed(2)}
                hint="Valve character. At 0 the clipping is symmetric — a fuzz. Raising it adds the even harmonics a biased triode makes."
                onChange={(bias) => patch({ drive: { ...amp.drive, bias } })}
              />
            </KnobRow>

            <div className="flex items-center gap-1.5">
              <span className="w-14 shrink-0 font-mono text-[9px] tracking-wider uppercase text-ink-3">
                Stages
              </span>
              {([1, 2, 3] as const).map((stages) => (
                <button
                  key={stages}
                  type="button"
                  disabled={!amp.drive.enabled}
                  onClick={() => patch({ drive: { ...amp.drive, stages } })}
                  title={`${stages} cascaded valve stage${stages === 1 ? '' : 's'}`}
                  className="flex-1 rounded border border-line px-1 py-0.5 font-mono text-[10px] text-ink-3 transition-colors duration-200 hover:text-ink disabled:pointer-events-none disabled:opacity-40"
                  style={amp.drive.stages === stages ? selected : undefined}
                >
                  {stages}
                </button>
              ))}
            </div>

            <p className="text-[9px] leading-snug text-ink-3">
              Measured: bias 0.22 puts the 2nd harmonic at −28&nbsp;dB. The 3rd stays at
              −9.8&nbsp;dB at every setting — bias adds even content without removing the odd
              content that makes a stage sound driven at all.
            </p>
            </Block>

            <Block name="Cabinet">
            <Row
              label="Cabinet"
              enabled={amp.cab.enabled}
              accent={colour}
              onToggle={() => patch({ cab: { ...amp.cab, enabled: !amp.cab.enabled } })}
              hint="The single biggest change to a direct USB guitar. Switch it off to hear what the raw signal actually sounds like."
            >
              <Speaker aria-hidden className="h-3 w-3 text-ink-3" />
            </Row>
            <div className="grid grid-cols-2 gap-1">
              {cabinetsFor('guitar').map((cabinet) => (
                <button
                  key={cabinet.id}
                  type="button"
                  disabled={!amp.cab.enabled}
                  onClick={() => patch({ cab: { ...amp.cab, model: cabinet.id } })}
                  title={cabinet.hint}
                  className="rounded border border-line px-1.5 py-1 text-[10px] font-medium text-ink-2 transition-colors duration-200 hover:text-ink disabled:pointer-events-none disabled:opacity-40"
                  style={amp.cab.model === cabinet.id ? selected : undefined}
                >
                  {cabinet.label}
                </button>
              ))}
            </div>
            <KnobRow>
              <Knob
                label="Presence"
                value={amp.cab.presenceDb}
                min={-6}
                max={6}
                step={0.5}
                origin={0}
                accent={colour}
                disabled={!amp.cab.enabled}
                readout={signed(amp.cab.presenceDb)}
                onChange={(presenceDb) => patch({ cab: { ...amp.cab, presenceDb } })}
              />
              <Knob
                label="Reso"
                value={amp.cab.resonanceDb}
                min={-6}
                max={6}
                step={0.5}
                origin={0}
                accent={colour}
                disabled={!amp.cab.enabled}
                readout={signed(amp.cab.resonanceDb)}
                onChange={(resonanceDb) => patch({ cab: { ...amp.cab, resonanceDb } })}
              />
              <Knob
                label="Width"
                value={amp.cab.width}
                min={0}
                max={1}
                step={0.01}
                accent={colour}
                disabled={!amp.cab.enabled}
                readout={`${Math.round(amp.cab.width * 100)}%`}
                onChange={(width) => patch({ cab: { ...amp.cab, width } })}
              />
            </KnobRow>
            </Block>
          </div>

          {/* ---- Column 3: the parallel sends, then mastering ---------------- */}
          <div className="flex flex-col gap-2.5">
            <Block name="Delay & reverb">
            <Row
              label="Delay"
              enabled={amp.delay.enabled}
              accent={colour}
              onToggle={() => patch({ delay: { ...amp.delay, enabled: !amp.delay.enabled } })}
              hint="Parallel send. Repeats darken as they decay, like tape."
            />
            <KnobRow>
              <Knob
                label="Time"
                value={amp.delay.timeSec}
                min={0.02}
                max={1.5}
                step={0.01}
                accent={colour}
                disabled={!amp.delay.enabled}
                readout={`${Math.round(amp.delay.timeSec * 1000)}ms`}
                onChange={(timeSec) => patch({ delay: { ...amp.delay, timeSec } })}
              />
              <Knob
                label="Repeats"
                value={amp.delay.feedback}
                min={0}
                max={0.9}
                step={0.01}
                accent={colour}
                disabled={!amp.delay.enabled}
                readout={`${Math.round(amp.delay.feedback * 100)}%`}
                onChange={(feedback) => patch({ delay: { ...amp.delay, feedback } })}
              />
              <Knob
                label="Mix"
                value={amp.delay.mix}
                min={0}
                max={1}
                step={0.01}
                accent={colour}
                disabled={!amp.delay.enabled}
                readout={`${Math.round(amp.delay.mix * 100)}%`}
                onChange={(mix) => patch({ delay: { ...amp.delay, mix } })}
              />
            </KnobRow>

            {/* Tempo-synced times, once a backing track's BPM is known. Guessing a
                delay time by ear against a known tempo is needless work — and the
                recorder, with no backing track, passes no bpm and gets no row. */}
            {bpm ? (
              <div className="flex flex-wrap items-center gap-1">
                <span className="w-14 shrink-0 font-mono text-[9px] tracking-wider uppercase text-ink-3">
                  Sync
                </span>
                {DELAY_DIVISIONS.map(({ label, beats }) => {
                  const timeSec = (60 / bpm) * beats;
                  const isActive = Math.abs(timeSec - amp.delay.timeSec) < 0.005;
                  return (
                    <button
                      key={label}
                      type="button"
                      disabled={!amp.delay.enabled}
                      onClick={() => patch({ delay: { ...amp.delay, timeSec } })}
                      title={`${label} note at ${Math.round(bpm)} BPM — ${Math.round(timeSec * 1000)}ms`}
                      className="flex-1 rounded border border-line px-1 py-0.5 font-mono text-[9px] text-ink-3 transition-colors duration-200 hover:text-ink disabled:pointer-events-none disabled:opacity-40"
                      style={isActive ? selected : undefined}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            ) : null}

            <Row
              label="Reverb"
              enabled={amp.reverb.enabled}
              accent={colour}
              onToggle={() => patch({ reverb: { ...amp.reverb, enabled: !amp.reverb.enabled } })}
              hint="Stereo convolution tail. Separate from the cabinet, which is short and mono."
            />
            <KnobRow>
              <Knob
                label="Size"
                value={amp.reverb.sizeSec}
                min={0.3}
                max={5}
                step={0.1}
                accent={colour}
                disabled={!amp.reverb.enabled}
                readout={`${amp.reverb.sizeSec.toFixed(1)}s`}
                onChange={(sizeSec) => patch({ reverb: { ...amp.reverb, sizeSec } })}
              />
              <Knob
                label="Mix"
                value={amp.reverb.mix}
                min={0}
                max={1}
                step={0.01}
                accent={colour}
                disabled={!amp.reverb.enabled}
                readout={`${Math.round(amp.reverb.mix * 100)}%`}
                onChange={(mix) => patch({ reverb: { ...amp.reverb, mix } })}
              />
            </KnobRow>
            </Block>

            <Block name="Output">
<div className="mt-1 rounded-lg border border-line bg-base p-2">
              <Row
                label="Limiter"
                enabled={amp.limiter.enabled}
                accent={colour}
                onToggle={() =>
                  patch({ limiter: { ...amp.limiter, enabled: !amp.limiter.enabled } })
                }
                hint="Look-ahead brickwall. This is what lets Output go up without the sound breaking — it reads 3 ms ahead, so the gain is already down before a peak arrives."
              />
              <KnobRow>
                <Knob
                  label="Output"
                  value={amp.outputDb}
                  min={-24}
                  max={24}
                  step={0.5}
                  origin={0}
                  accent={colour}
                  readout={signed(amp.outputDb)}
                  onChange={(outputDb) => patch({ outputDb })}
                />
                <Knob
                  label="Ceiling"
                  value={amp.limiter.ceilingDb}
                  min={-12}
                  max={0}
                  step={0.1}
                  accent={colour}
                  disabled={!amp.limiter.enabled}
                  readout={`${amp.limiter.ceilingDb.toFixed(1)}dB`}
                  onChange={(ceilingDb) => patch({ limiter: { ...amp.limiter, ceilingDb } })}
                />
              </KnobRow>
              <p className="mt-1 text-[9px] leading-snug text-ink-3">
                Push <strong className="font-semibold text-ink-2">Output</strong> up and watch GR
                in the header. Nothing crosses the ceiling, and no clipping distortion is
                produced — a compressor cannot promise that, because it only reacts after the
                peak has already gone out.
              </p>
            </div>
            </Block>
          </div>
        </div>

        {/* The tone assistant spans the full width below the columns.

            It is not a stage in the chain, so it does not belong in a column that
            reads as one — and at 420px tall in a 240px-wide column there is nothing
            to balance it against. Full width it also lays the twelve modes out six
            across instead of two, which is the difference between scanning them and
            reading them. */}
        <ToneAssistant
          settings={amp}
          onChange={onChange}
          lexicon={GUITAR_LEXICON}
          instrument="guitar"
          accent={colour}
          isLive={isLive}
        />

        <p className="text-[10px] text-ink-3">
          Drag a knob up or down; hold <kbd className="font-mono text-ink-2">Shift</kbd> for fine
          control, or focus one and use the arrow keys.
          {!isArmed ? SCOPE[scope].unarmed : ''}
        </p>
      </div>
    </Panel>
  );
}
