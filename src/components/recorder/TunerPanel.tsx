'use client';

import { ChevronDown, Gauge, Lock, Power, Ruler, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

import { Chip, Panel } from '@/components/ui/Panel';
import { useAnimationFrame } from '@/hooks/useAnimationFrame';
import {
  checkIntonation,
  CHROMATIC_ID,
  DEFAULT_A4_HZ,
  frequencyToMidi,
  IN_TUNE_CENTS,
  METER_RANGE_CENTS,
  midiToFrequency,
  midiToName,
  ordinal,
  REFERENCE_PITCHES,
  resolveTarget,
  SWEETENINGS,
  sweeteningById,
  TUNINGS,
  tuningById,
  tuningsFor,
  type InstrumentId,
  type IntonationResult,
  type Tuning,
} from '@/lib/tuner';
import type { TunerSnapshot } from '@/types/recorder';

import { TunerTrace, type TraceSample } from './TunerTrace';

interface TunerPanelProps {
  /** Latest pitch reading, mutated in place by the engine. */
  tunerRef: RefObject<TunerSnapshot>;
  isTuning: boolean;
  onToggle: () => void;
  /** Tells the engine what frequency range to listen for. */
  onRangeChange: (minHz: number, maxHz: number) => void;
  /** False until an input is armed — there is nothing to listen to. */
  isArmed: boolean;
  /** Input the tuner is hearing, for the source line. */
  sourceLabel: string;
  /** Negotiated rate. Low means a Bluetooth voice profile — see `SourceNote`. */
  sampleRate: number | null;
}

/**
 * How far above/below the outermost strings the detector still listens.
 *
 * Two semitones. A string that has gone slack reads flat and still has to be
 * found — that is the case you most need a tuner for — but widening this further
 * costs real time: the low bound is what sizes the analysis window, so an extra
 * octave of slack at the bottom doubles the cost of every detection.
 */
const RANGE_SLACK = 2 / 12;

/** After this long with no detection the display dims and stops claiming a note. */
const STALE_MS = 1500;

const INSTRUMENTS: { id: InstrumentId | 'chromatic'; label: string }[] = [
  { id: 'guitar', label: 'Guitar' },
  { id: 'bass', label: 'Bass' },
  { id: 'other', label: 'Other' },
  { id: 'chromatic', label: 'Chromatic' },
];

function rangeFor(tuning: Tuning | null): { minHz: number; maxHz: number } {
  if (!tuning || tuning.strings.length === 0) return { minHz: 27.5, maxHz: 1400 };

  const lowest = midiToFrequency(tuning.strings[0].midi);
  const highest = midiToFrequency(tuning.strings[tuning.strings.length - 1].midi);
  return { minHz: lowest * 2 ** -RANGE_SLACK, maxHz: highest * 2 ** RANGE_SLACK };
}

/** Which of the two intonation notes is being captured. */
type IntonationStep = 'off' | 'open' | 'twelfth';

/**
 * TunerPanel — pitch detection against a chosen tuning.
 *
 * Everything that moves is painted from refs inside one animation frame, the way
 * the meters are: a needle updated through React state would re-render the whole
 * dashboard several times a second while the user is doing something that demands
 * a steady display.
 *
 * ---------------------------------------------------------------------------
 * The live state is carried on **data attributes**, not by toggling classes.
 *
 * The first version had the frame loop call `classList.toggle` for each colour.
 * That fights React: the moment any state changes — locking a string, changing
 * the reference pitch — React rewrites `className` from its own template and
 * every class the loop had added disappears until the next frame. Worse, the two
 * sources disagree about who owns `border-line`, so a locked string could end up
 * with no border at all.
 *
 * Writing `data-live`, `data-tuned` and letting Tailwind's `data-[…]` variants do
 * the styling gives one owner for appearance (the class string, which React
 * controls) and one for state (the loop). They cannot conflict.
 * ---------------------------------------------------------------------------
 *
 * Three states, three hues, chosen so that no two things that mean different
 * things share a colour: **violet** is the string you locked, **cyan** is the
 * string currently sounding, **teal** is in tune. Red is not used at all — on
 * this page red means recording or broken, and an out-of-tune string is neither.
 */
export function TunerPanel({
  tunerRef,
  isTuning,
  onToggle,
  onRangeChange,
  isArmed,
  sourceLabel,
  sampleRate,
}: TunerPanelProps) {
  const [tuningId, setTuningId] = useState<string>(TUNINGS[0].id);
  /**
   * String the reading is forced against, or -1 for automatic.
   *
   * Locking exists for the case auto-matching is worst at: a string so flat that
   * it is nearer to its neighbour than to itself. That is exactly the situation
   * after fitting a new string, which is when tuning is hardest.
   */
  const [lockedString, setLockedString] = useState(-1);
  const [sweeteningId, setSweeteningId] = useState('equal');
  const [a4Hz, setA4Hz] = useState<number>(DEFAULT_A4_HZ);
  const [showSetup, setShowSetup] = useState(false);
  const [intonationStep, setIntonationStep] = useState<IntonationStep>('off');
  const [intonationOpenHz, setIntonationOpenHz] = useState(0);
  const [intonation, setIntonation] = useState<IntonationResult | null>(null);

  const tuning = tuningById(tuningId);
  const instrument: InstrumentId | 'chromatic' = tuning?.instrument ?? 'chromatic';
  const sweetening = sweeteningById(sweeteningId);
  const sweeteningFits = sweetening.offsets.length === (tuning?.strings.length ?? 0);

  const noteRef = useRef<HTMLDivElement>(null);
  const octaveRef = useRef<HTMLSpanElement>(null);
  const stringNameRef = useRef<HTMLDivElement>(null);
  const hzRef = useRef<HTMLSpanElement>(null);
  const centsRef = useRef<HTMLDivElement>(null);
  const needleRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  const flatRef = useRef<HTMLSpanElement>(null);
  const sharpRef = useRef<HTMLSpanElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const stringRefs = useRef<(HTMLButtonElement | null)[]>([]);
  /** Written every frame, read by the trace canvas in its own loop. */
  const traceRef = useRef<TraceSample>({ cents: 0, live: false, inTune: false });
  /** Latest stable reading, read by the intonation capture buttons on click. */
  const liveHzRef = useRef(0);

  useEffect(() => {
    const { minHz, maxHz } = rangeFor(tuning);
    onRangeChange(minHz, maxHz);
  }, [tuning, onRangeChange]);

  const selectTuning = useCallback((id: string) => {
    setTuningId(id);
    setLockedString(-1);
    setIntonationStep('off');
    setIntonation(null);
  }, []);

  const selectInstrument = useCallback(
    (id: InstrumentId | 'chromatic') => {
      selectTuning(id === 'chromatic' ? CHROMATIC_ID : tuningsFor(id)[0].id);
    },
    [selectTuning],
  );

  const captureIntonation = useCallback(() => {
    const hz = liveHzRef.current;
    if (hz <= 0) return;

    if (intonationStep === 'open') {
      setIntonationOpenHz(hz);
      setIntonationStep('twelfth');
      setIntonation(null);
      return;
    }
    if (intonationStep === 'twelfth' && intonationOpenHz > 0) {
      setIntonation(checkIntonation(intonationOpenHz, hz));
      setIntonationStep('off');
    }
  }, [intonationStep, intonationOpenHz]);

  useAnimationFrame(() => {
    const reading = tunerRef.current;
    if (!reading) return;

    const live = reading.hz > 0 && performance.now() - reading.at < STALE_MS;
    liveHzRef.current = live ? reading.hz : 0;

    if (!live) {
      traceRef.current.live = false;
      if (heroRef.current) heroRef.current.dataset.state = 'idle';
      if (statusRef.current) {
        statusRef.current.textContent = isTuning
          ? 'Listening — play one string on its own.'
          : 'Tuner is off.';
      }
      for (const node of stringRefs.current) {
        if (node) node.dataset.live = 'off';
      }
      return;
    }

    const target = resolveTarget(reading.hz, tuning, lockedString, a4Hz, sweetening);
    const clamped = Math.max(-METER_RANGE_CENTS, Math.min(METER_RANGE_CENTS, target.cents));
    const string = tuning?.strings[target.stringIndex];

    /**
     * Further from the target than any peg turn would sensibly cover.
     *
     * Only reachable with a string locked — automatic matching always picks the
     * nearest, so it cannot be more than half the gap between two strings away.
     * Locked, it can be an octave out, and then a cents readout is the wrong
     * answer to the wrong question: "−1347.8" is arithmetically correct and tells
     * a beginner nothing except that the tuner is broken. What they need to know
     * is that they are on a different string.
     */
    const offTarget = Math.abs(target.cents) > 120;

    traceRef.current.cents = target.cents;
    traceRef.current.live = true;
    traceRef.current.inTune = target.inTune;

    if (heroRef.current) {
      heroRef.current.dataset.state = offTarget ? 'off-target' : target.inTune ? 'tuned' : 'live';
    }
    if (noteRef.current) {
      // The name comes from the *target*, not from the nearest semitone: in a
      // tuning, "you are 40 cents flat of D3" is the useful reading, where
      // "that is a C#3" is a fact about a note nobody is aiming for.
      noteRef.current.textContent = target.label.replace(/-?\d+$/, '');
    }
    if (octaveRef.current) octaveRef.current.textContent = target.label.match(/-?\d+$/)?.[0] ?? '';
    if (stringNameRef.current) {
      stringNameRef.current.textContent = string ? `${ordinal(string.number)} string` : 'chromatic';
    }
    if (hzRef.current) hzRef.current.textContent = `${reading.hz.toFixed(2)} Hz`;
    if (centsRef.current) {
      // One decimal, because the detector genuinely resolves better than a whole
      // cent and rounding to integers makes a settled needle look jumpy as it
      // crosses a boundary. Past the meter's range the number stops being a
      // measurement anyone can act on, so it is replaced by the direction.
      centsRef.current.textContent = offTarget
        ? target.cents < 0
          ? 'far flat'
          : 'far sharp'
        : `${target.cents > 0 ? '+' : ''}${target.cents.toFixed(1)}`;
      centsRef.current.classList.toggle('text-3xl', !offTarget);
      centsRef.current.classList.toggle('sm:text-4xl', !offTarget);
      centsRef.current.classList.toggle('text-lg', offTarget);
    }

    if (needleRef.current) {
      // A percentage translate on a full-width layer, so the offset is measured
      // against the track rather than against the needle's own width.
      needleRef.current.style.transform = `translateX(${(clamped / METER_RANGE_CENTS) * 50}%)`;
    }

    // Direction lamps. Which way to turn the peg is the only thing being asked.
    if (flatRef.current) flatRef.current.dataset.on = target.cents < -IN_TUNE_CENTS ? 'yes' : 'no';
    if (sharpRef.current) sharpRef.current.dataset.on = target.cents > IN_TUNE_CENTS ? 'yes' : 'no';

    if (statusRef.current) {
      const sweetened =
        target.offsetCents !== 0
          ? ` (sweetened ${target.offsetCents > 0 ? '+' : ''}${target.offsetCents}¢)`
          : '';
      // Named by string number first. Someone who does not yet read note names
      // still knows which peg to turn, which is the only thing being asked.
      const who = string ? `${ordinal(string.number)} string (${string.label})` : target.label;

      if (offTarget && string) {
        // Name what is actually sounding, chromatically. Telling someone they are
        // 1347 cents from the string they locked is true and useless; telling them
        // they are playing a D3 is what lets them fix it.
        const heard = midiToName(Math.round(frequencyToMidi(reading.hz, a4Hz)));
        statusRef.current.textContent = `That sounds like ${heard}, not the ${ordinal(string.number)} string (${string.label}). Tap STR ${string.number} again to unlock, or tap the string you are actually on.`;
      } else {
        statusRef.current.textContent = target.inTune
          ? `${who} is in tune${sweetened}.`
          : target.cents < 0
            ? `${who} is flat — tighten it${sweetened}.`
            : `${who} is sharp — loosen it${sweetened}.`;
      }
    }

    for (let i = 0; i < stringRefs.current.length; i += 1) {
      const node = stringRefs.current[i];
      if (!node) continue;
      // Off target the locked string is not the one sounding, so lighting it up
      // would claim something false about which string is ringing.
      const sounding = i === target.stringIndex && !offTarget;
      node.dataset.live = sounding ? (target.inTune ? 'tuned' : 'on') : 'off';
    }
  }, isTuning && isArmed);

  const off = !isTuning || !isArmed;

  return (
    <Panel
      title="Tuner"
      icon={<Gauge aria-hidden className="h-3.5 w-3.5" />}
      actions={
        <>
          <Chip tone="muted" className="hidden sm:inline-flex">
            {tuning ? tuning.label : 'Chromatic'} · A={a4Hz}
          </Chip>
          <button
            type="button"
            onClick={onToggle}
            disabled={!isArmed}
            aria-pressed={isTuning}
            title={isTuning ? 'Stop listening' : 'Start listening'}
            className={`flex h-6 items-center gap-1.5 rounded-md border px-2 font-mono text-[10px] font-bold tracking-wider uppercase transition-colors duration-200 disabled:pointer-events-none disabled:opacity-40 ${
              isTuning
                ? 'border-teal/60 bg-teal/12 text-teal'
                : 'border-line text-ink-3 hover:border-line-strong hover:text-ink'
            }`}
          >
            <Power aria-hidden className="h-3 w-3" />
            {isTuning ? 'Listening' : 'Off'}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        {/* ---- Pickers ---------------------------------------------------------
            Instruments as a segmented control on an inset track, tunings as chips
            on one **non-wrapping** scroll row. Both were rows of chunky bordered
            pills that wrapped to two or three lines in a narrow panel, so the whole
            display below them moved down as you resized. A picker should not change
            the height of the thing it configures. */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex shrink-0 items-center gap-0.5 rounded-lg bg-inset p-0.5">
            {INSTRUMENTS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => selectInstrument(entry.id)}
                aria-pressed={instrument === entry.id}
                className={`h-6 rounded-[0.4rem] px-2.5 font-mono text-[10px] font-semibold tracking-wider uppercase transition-colors duration-200 ${
                  instrument === entry.id
                    ? 'bg-panel text-ink shadow-glow'
                    : 'text-ink-3 hover:text-ink-2'
                }`}
              >
                {entry.label}
              </button>
            ))}
          </div>

          {tuning ? (
            <div className="-mx-1 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-1 py-0.5">
              {tuningsFor(tuning.instrument).map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => selectTuning(entry.id)}
                  title={entry.hint}
                  aria-pressed={entry.id === tuningId}
                  className={`h-6 shrink-0 rounded-md px-2 text-[10px] font-medium whitespace-nowrap transition-colors duration-200 ${
                    entry.id === tuningId
                      ? 'bg-raised text-ink'
                      : 'text-ink-3 hover:bg-raised/60 hover:text-ink-2'
                  }`}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {/* ---- Readout, or the invitation to switch it on ----------------------
            Two states rather than one state with an overlay. The old panel always
            drew the full instrument — a 250px gauge, a 110px history strip and a
            "Tuner is off." line — then covered the gauge with a scrim when it had
            nothing to show. A switched-off tuner cost about 400px of panel to say
            one sentence. Off is now a single row; everything heavy mounts only when
            there is a reading to put in it.

            Unmounting is safe because the frame loop is gated on the same
            `isTuning && isArmed`: every ref below is attached whenever the loop
            that writes to it is running. */}
        {off ? (
          <div className="flex items-center gap-2 rounded-lg border border-line bg-inset px-2 py-1.5">
            {isArmed ? (
              <>
                <button
                  type="button"
                  onClick={onToggle}
                  className="flex h-7 shrink-0 touch-manipulation items-center gap-1.5 rounded-md border border-teal/60 bg-teal/10 px-2.5 font-mono text-[10px] font-bold tracking-wider uppercase text-teal transition-colors duration-200 hover:bg-teal/20 active:scale-95"
                >
                  <Power aria-hidden className="h-3 w-3" />
                  Start tuning
                </button>
                <p className="min-w-0 flex-1 truncate text-[11px] text-ink-3">
                  Then play one string on its own and let it ring.
                </p>
              </>
            ) : (
              <p className="text-[11px] text-ink-3">
                Open an input first — the tuner listens to whatever the recorder is armed to.
              </p>
            )}
          </div>
        ) : (
          <>
            {/* Hairline border and a tint, not a 2px frame: the state colour reads
                perfectly well at one pixel, and at two the frame competed with the
                number inside it. */}
            <div
              ref={heroRef}
              data-state="idle"
              className="group relative rounded-lg border border-line bg-inset px-2.5 py-2 transition-colors duration-300 data-[state=live]:border-cyan/50 data-[state=off-target]:border-violet/60 data-[state=tuned]:border-teal/70"
            >
              {/* Held to a readable measure: on a wide screen the note and the cents
                  were at opposite ends of a 1500px panel, which is two displays,
                  not one. */}
              <div className="mx-auto flex max-w-lg items-center justify-between gap-3">
                {/* Note */}
                <div className="flex min-w-0 flex-col">
                  <div
                    ref={stringNameRef}
                    className="font-mono text-[9px] font-semibold tracking-[0.16em] uppercase text-ink-3"
                  >
                    —
                  </div>
                  <div className="flex items-baseline gap-0.5">
                    {/* Dimmed while there is no reading, so the em dash reads as an
                        empty slot rather than as a loading bar. */}
                    <div
                      ref={noteRef}
                      className="font-numeric text-3xl leading-none font-semibold text-ink transition-opacity duration-300 group-data-[state=idle]:opacity-25 sm:text-4xl"
                    >
                      —
                    </div>
                    <span ref={octaveRef} className="font-numeric text-sm text-ink-3" />
                  </div>
                  <span ref={hzRef} className="font-numeric text-[10px] text-ink-3">
                    — Hz
                  </span>
                </div>

                {/* Direction + cents */}
                <div className="flex items-center gap-2">
                  <span
                    ref={flatRef}
                    data-on="no"
                    aria-hidden
                    className="font-mono text-base text-ink-3/50 transition-colors duration-150 data-[on=yes]:text-cyan"
                  >
                    ◀
                  </span>
                  <div className="flex flex-col items-center">
                    <div
                      ref={centsRef}
                      className="font-numeric text-2xl leading-none font-semibold text-ink"
                    >
                      —
                    </div>
                    <span className="font-mono text-[8px] tracking-[0.16em] uppercase text-ink-3">
                      cents
                    </span>
                  </div>
                  <span
                    ref={sharpRef}
                    data-on="no"
                    aria-hidden
                    className="font-mono text-base text-ink-3/50 transition-colors duration-150 data-[on=yes]:text-cyan"
                  >
                    ▶
                  </span>
                </div>
              </div>

              {/* Needle. ±50 cents full scale — one semitone across the whole width.
                  A 28px rule rather than a 48px boxed meter: it is a position
                  indicator, and the box around it was furniture. */}
              <div className="relative mx-auto mt-1.5 h-7 max-w-lg overflow-hidden rounded-md bg-panel">
                <div aria-hidden className="absolute inset-0">
                  {[-40, -30, -20, -10, 10, 20, 30, 40].map((mark) => (
                    <span
                      key={mark}
                      className="absolute top-1/2 h-1.5 w-px -translate-y-1/2 bg-ink-3/25"
                      style={{ left: `${50 + (mark / METER_RANGE_CENTS) * 50}%` }}
                    />
                  ))}
                  {[-25, 25].map((mark) => (
                    <span
                      key={mark}
                      className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-ink-3/40"
                      style={{ left: `${50 + (mark / METER_RANGE_CENTS) * 50}%` }}
                    />
                  ))}
                  {/* The in-tune window as a place, not a number */}
                  <span
                    className="absolute inset-y-0 bg-teal/12"
                    style={{
                      left: `${50 - (IN_TUNE_CENTS / METER_RANGE_CENTS) * 50}%`,
                      width: `${(IN_TUNE_CENTS / METER_RANGE_CENTS) * 100}%`,
                    }}
                  />
                  <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-teal/60" />
                </div>

                {/* The moving layer must span the **whole track**: a percentage
                    translate is relative to the translated element's own width, so
                    on a 4px-wide layer `translateX(-50%)` moved the needle two
                    pixels and it sat in the middle of the scale no matter how far
                    out the note was. The layer is the track; the needle is centred
                    inside it. Nothing here may set `transform` in a class either —
                    the frame loop writes `style.transform`, and an inline style
                    wins, silently dropping any `-translate-x-1/2` beside it. */}
                <div
                  ref={needleRef}
                  aria-hidden
                  className="absolute inset-0 transition-transform duration-75"
                >
                  <span className="absolute inset-y-1 left-1/2 w-1 -translate-x-1/2 rounded-full bg-ink" />
                </div>
              </div>

              {/* Two labels, not three: the tinted band in the middle already says
                  where in tune is, and naming it as well was the same information
                  twice. */}
              <div className="mx-auto flex max-w-lg justify-between font-mono text-[8px] tracking-wider text-ink-3">
                <span>−50¢</span>
                <span>+50¢</span>
              </div>
            </div>

            <TunerTrace sampleRef={traceRef} active={isTuning && isArmed} />

            <p
              ref={statusRef}
              role="status"
              className="text-center text-[11px] font-medium text-ink-2"
            >
              Listening…
            </p>
          </>
        )}

        {/* ---- Strings ---------------------------------------------------------
            Kept visible when the tuner is off: it doubles as a reference for what
            the selected tuning actually is. Slimmer cells, and the two explanatory
            paragraphs are gone — the numbering moved into the row's `title`, and the
            only line still worth its height is the one that appears when a string is
            locked, because that is a state the player has to be able to get out
            of. */}
        {tuning ? (
          <div className="flex flex-col gap-1">
            <div
              className="grid grid-cols-6 gap-1"
              title={`Strings are numbered the way players count them: 1 is the thinnest and highest, ${tuning.strings.length} the thickest and lowest. Shown low to high, left to right. Tap one to lock onto it.`}
            >
              {tuning.strings.map((string, index) => {
                const isLocked = lockedString === index;
                return (
                  <button
                    key={`${string.label}-${index}`}
                    type="button"
                    ref={(node) => {
                      stringRefs.current[index] = node;
                    }}
                    data-live="off"
                    onClick={() => setLockedString((current) => (current === index ? -1 : index))}
                    aria-pressed={isLocked}
                    aria-label={`${ordinal(string.number)} string, ${string.label}`}
                    title={`${ordinal(string.number)} string — ${string.label}, ${midiToFrequency(string.midi, a4Hz).toFixed(2)} Hz. Tap to tune this string only.`}
                    className={`relative flex h-9 touch-manipulation items-center justify-center gap-1 rounded-md border transition-colors duration-200 data-[live=on]:border-cyan/70 data-[live=on]:bg-cyan/10 data-[live=tuned]:border-teal/70 data-[live=tuned]:bg-teal/15 ${
                      isLocked
                        ? 'border-violet/70 bg-violet/12 text-violet'
                        : 'border-line bg-panel text-ink-2 hover:border-line-strong hover:text-ink'
                    }`}
                  >
                    <span aria-hidden className="font-mono text-[8px] leading-none opacity-50">
                      {string.number}
                    </span>
                    <span
                      aria-hidden
                      className="font-numeric text-[13px] leading-none font-semibold"
                    >
                      {string.label}
                    </span>
                    {isLocked ? (
                      <Lock aria-hidden className="absolute top-0.5 right-0.5 h-2.5 w-2.5" />
                    ) : null}
                  </button>
                );
              })}
            </div>

            {lockedString >= 0 ? (
              <p className="text-[10px] leading-snug text-violet">
                Locked to the {ordinal(tuning.strings[lockedString].number)} string (
                {tuning.strings[lockedString].label}) — everything is measured against it until you
                tap it again.
              </p>
            ) : null}
          </div>
        ) : null}

        {/* ---- Setup ---------------------------------------------------------
            Folded away by default. Reference pitch, sweetening and intonation are
            each worth having and none is worth reading past to reach the needle. */}
        <div className="border-t border-line pt-1.5">
          <button
            type="button"
            onClick={() => setShowSetup((current) => !current)}
            aria-expanded={showSetup}
            className="flex w-full items-center justify-between gap-2 rounded-md px-1 py-0.5 text-left font-mono text-[9px] font-semibold tracking-[0.16em] uppercase text-ink-3 transition-colors duration-200 hover:text-ink"
          >
            Reference pitch · sweetening · intonation
            <ChevronDown
              aria-hidden
              className={`h-3.5 w-3.5 transition-transform duration-200 ${showSetup ? 'rotate-180' : ''}`}
            />
          </button>

          {showSetup ? (
            <div className="mt-2 flex animate-rise-in flex-col gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Legend>Reference</Legend>
                  <div className="flex flex-wrap gap-1">
                    {REFERENCE_PITCHES.map((hz) => (
                      <button
                        key={hz}
                        type="button"
                        onClick={() => setA4Hz(hz)}
                        className={`rounded border px-1.5 py-0.5 font-numeric text-[10px] transition-colors duration-200 ${
                          hz === a4Hz
                            ? 'border-cyan bg-cyan/12 text-cyan'
                            : 'border-line bg-panel text-ink-3 hover:text-ink'
                        }`}
                      >
                        {hz}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1 text-[10px] leading-snug text-ink-3">
                    A4 = {a4Hz} Hz. Every target moves with it.
                  </p>
                </div>

                <div>
                  <Legend>Sweetening</Legend>
                  <div className="flex flex-wrap gap-1">
                    {SWEETENINGS.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={() => setSweeteningId(entry.id)}
                        title={entry.hint}
                        className={`rounded border px-1.5 py-0.5 text-[10px] transition-colors duration-200 ${
                          entry.id === sweeteningId
                            ? 'border-cyan bg-cyan/12 text-cyan'
                            : 'border-line bg-panel text-ink-3 hover:text-ink'
                        }`}
                      >
                        {entry.label}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1 text-[10px] leading-snug text-ink-3">
                    {sweeteningId !== 'equal' && !sweeteningFits
                      ? `Written for ${sweetening.offsets.length} strings — not applied to this tuning.`
                      : sweetening.hint}
                  </p>
                </div>
              </div>

              {tuning ? (
                <div>
                  <Legend>Intonation</Legend>
                  {intonationStep === 'off' ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={off}
                        onClick={() => {
                          setIntonation(null);
                          setIntonationStep('open');
                        }}
                        className="flex items-center gap-1.5 rounded-md border border-line bg-panel px-2.5 py-1 text-[11px] font-semibold tracking-wide text-ink-2 transition-colors duration-200 hover:text-ink disabled:pointer-events-none disabled:opacity-40"
                      >
                        <Ruler aria-hidden className="h-3 w-3" />
                        Check a string
                      </button>
                      {intonation ? (
                        <span
                          className={`font-numeric text-[11px] ${
                            intonation.verdict === 'ok' ? 'text-teal' : 'text-ink'
                          }`}
                        >
                          {intonation.deltaCents > 0 ? '+' : ''}
                          {intonation.deltaCents.toFixed(1)}¢ — {intonation.advice}
                        </span>
                      ) : (
                        <span className="text-[10px] text-ink-3">
                          Compares an open string against its 12th fret. The two should be exactly
                          an octave apart; if they are not, the saddle is in the wrong place.
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={captureIntonation}
                        className="rounded-md border border-cyan bg-cyan/12 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-cyan transition-colors duration-200"
                      >
                        {intonationStep === 'open' ? 'Capture open string' : 'Capture 12th fret'}
                      </button>
                      <span className="text-[10px] text-ink-3">
                        {intonationStep === 'open'
                          ? 'Play the open string, let it settle, then capture.'
                          : `Open string captured at ${intonationOpenHz.toFixed(2)} Hz. Now fret the 12th and capture again.`}
                      </span>
                      <button
                        type="button"
                        onClick={() => setIntonationStep('off')}
                        aria-label="Cancel intonation check"
                        className="rounded p-1 text-ink-3 transition-colors duration-150 hover:text-ink"
                      >
                        <X aria-hidden className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              ) : null}

              <SourceNote label={sourceLabel} sampleRate={sampleRate} isArmed={isArmed} />
            </div>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}

function Legend({ children }: { children: ReactNode }) {
  return (
    <p className="mb-1 font-mono text-[9px] font-semibold tracking-[0.18em] uppercase text-ink-3">
      {children}
    </p>
  );
}

/**
 * What the tuner is listening to, and whether that matters.
 *
 * The transport already warns that a low sample rate means a Bluetooth voice
 * profile rather than full-bandwidth audio, and for recording that warning is
 * right. For *tuning* the same fact has the opposite conclusion: every note this
 * app can tune has its fundamental under 700 Hz, so even an 8 kHz link carries it
 * with room to spare. Repeating the recording warning here would talk someone out
 * of an input that works perfectly for the job in front of them.
 */
function SourceNote({
  label,
  sampleRate,
  isArmed,
}: {
  label: string;
  sampleRate: number | null;
  isArmed: boolean;
}) {
  if (!isArmed) {
    return (
      <p className="text-[10px] leading-snug text-ink-3">
        No input open. Arm a device — a USB pedal, an interface, a Bluetooth link or the machine’s
        own microphone all work.
      </p>
    );
  }

  const narrowband = !!sampleRate && sampleRate < 32000;
  return (
    <p className="text-[10px] leading-snug text-ink-3">
      Listening to <span className="text-ink-2">{label}</span>
      {sampleRate ? ` at ${(sampleRate / 1000).toFixed(sampleRate % 1000 === 0 ? 0 : 1)} kHz` : ''}.
      {narrowband
        ? ' That is a Bluetooth/headset voice profile — too narrow to record with, but every string on a guitar or bass is well under half of it, so tuning is unaffected.'
        : ''}
    </p>
  );
}
