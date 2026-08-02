/**
 * Pitch detection and tuning references.
 *
 * Pure: no Web Audio, no DOM. It takes a block of samples and returns a
 * frequency, so the whole thing compiles and runs under plain Node and its
 * accuracy can be asserted against synthesised tones rather than described in a
 * comment and hoped for.
 *
 * ---------------------------------------------------------------------------
 * Why this is not an FFT peak-picker.
 *
 * The obvious implementation — take the FFT already used by the beat tracker and
 * report the loudest bin — cannot tune a guitar, for two independent reasons.
 *
 * 1. **Resolution.** A 2048-point FFT at 48 kHz has 23.4 Hz bins. The gap between
 *    a low E (82.41 Hz) and the F above it (87.31 Hz) is 4.9 Hz — a fifth of one
 *    bin. A tuner needs to resolve a *cent*, which at that pitch is 0.048 Hz.
 * 2. **The loudest partial is usually not the fundamental.** On a low bass string
 *    the 2nd or 3rd harmonic is routinely stronger than the fundamental, so a peak
 *    picker reports the octave or the twelfth above the note being played. That is
 *    the single most common way a naive tuner is wrong, and it is wrong by an
 *    amount no amount of interpolation fixes.
 *
 * So this uses the **McLeod Pitch Method**: the normalised square difference
 * function (NSDF), with key-maximum picking and parabolic interpolation. It works
 * on the period rather than the spectrum, so resolution is set by interpolation
 * accuracy (fractions of a sample) instead of by bin width, and the key-maximum
 * rule is specifically the part that rejects the octave errors above.
 *
 * The autocorrelation inside it is computed **through the FFT** (Wiener–Khinchin)
 * rather than directly. Direct NSDF over an 8192-sample window with lags out to
 * 1600 is ~13 M multiply-adds per detection; via two transforms it is ~3 M, and
 * `lib/fft.ts` is already here.
 * ---------------------------------------------------------------------------
 *
 * Window length matters and is the caller's problem: the NSDF needs at least two
 * periods of the lowest note in the window. A 5-string bass low B is 30.87 Hz —
 * 32.4 ms per period — so 8192 samples at 48 kHz (170 ms, five periods) is the
 * right size, and 2048 samples (43 ms) cannot detect that note at all.
 */

import { fft } from './fft';

/** Concert pitch. Everything else is derived from it. */
export const DEFAULT_A4_HZ = 440;

/** MIDI note number of A4. */
const A4_MIDI = 69;

/** Sharp spelling throughout. A tuner has no key signature to disambiguate with. */
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

/**
 * How close counts as in tune, in cents.
 *
 * ±5 is the usual figure for a pedal tuner and is about the limit of what is
 * audible as beating against a reference within a couple of seconds. Tighter than
 * that and a guitar cannot hold it anyway — string tension drifts by more with
 * temperature.
 */
export const IN_TUNE_CENTS = 5;

/** Full-scale deflection of the meter, in cents. A semitone is 100. */
export const METER_RANGE_CENTS = 50;

/* --------------------------------------------------------------------------
   Note maths
-------------------------------------------------------------------------- */

/** Continuous MIDI number for a frequency — fractional between semitones. */
export function frequencyToMidi(hz: number, a4Hz = DEFAULT_A4_HZ): number {
  return A4_MIDI + 12 * Math.log2(hz / a4Hz);
}

export function midiToFrequency(midi: number, a4Hz = DEFAULT_A4_HZ): number {
  return a4Hz * 2 ** ((midi - A4_MIDI) / 12);
}

/** Scientific pitch name for a whole MIDI number, e.g. 40 -> `E2`. */
export function midiToName(midi: number): string {
  const rounded = Math.round(midi);
  // Floor division, so negative MIDI numbers (below C-1) still name correctly.
  const octave = Math.floor(rounded / 12) - 1;
  return `${NOTE_NAMES[((rounded % 12) + 12) % 12]}${octave}`;
}

/** Note name without the octave, for compact displays. */
export function midiToPitchClass(midi: number): string {
  return NOTE_NAMES[((Math.round(midi) % 12) + 12) % 12];
}

/**
 * Deviation of `hz` from a reference, in cents.
 *
 * Cents rather than Hz because the ear works in ratios: 1 Hz flat is inaudible on
 * the top string and a quarter-tone on a bass low B. One number that means the
 * same thing everywhere is the only way one meter can serve both.
 */
export function centsBetween(hz: number, referenceHz: number): number {
  return 1200 * Math.log2(hz / referenceHz);
}

/* --------------------------------------------------------------------------
   Tunings
-------------------------------------------------------------------------- */

export type InstrumentId = 'guitar' | 'bass' | 'other';

export interface TuningString {
  /** Display label, e.g. `E2`. Derived from `midi`, kept explicit for clarity. */
  label: string;
  /** Whole MIDI note number the string should sound. */
  midi: number;
  /**
   * The string's number as players count them — 1 is the thinnest/highest.
   *
   * Stored rather than derived from position, because on two of the instruments
   * here the numbering is *not* the pitch order. See `renumber`.
   */
  number: number;
}

export interface Tuning {
  id: string;
  instrument: InstrumentId;
  label: string;
  /** One line on what it is for, shown under the picker. */
  hint: string;
  /**
   * Strings from lowest to highest **pitch**, not from lowest to highest string
   * number. Guitarists count the high E as the 1st string; a tuner that lists
   * them in that order puts the string you tune first at the far right of the row
   * and reverses on a bass. Pitch order is the same for every instrument.
   */
  strings: TuningString[];
}

/**
 * Build a string list from MIDI numbers, lowest pitch first.
 *
 * Numbering is assigned on the assumption that the highest string is the 1st,
 * which is true of every guitar and bass tuning here. Where it is not — see
 * `renumber` — the list is corrected afterwards rather than the assumption being
 * dropped, because the assumption holds for fifteen of the seventeen tunings.
 */
function strings(...midis: number[]): TuningString[] {
  return midis.map((midi, index) => ({
    label: midiToName(midi),
    midi,
    number: midis.length - index,
  }));
}

/**
 * Override the string numbers for an instrument whose numbering is not its
 * pitch order.
 *
 * Two here need it, and both would otherwise mislabel the string a beginner is
 * most likely to be confused by already:
 *
 * - **Banjo.** The 5th string is a short drone that sounds *higher* than three of
 *   the others. Numbering by pitch would call it the 1st.
 * - **Ukulele.** Standard tuning is re-entrant: the 4th string is a high G that
 *   sounds above the 3rd and 2nd. This is the single most confusing thing about
 *   a ukulele, and a tuner that renumbers it is teaching the confusion.
 */
function renumber(list: TuningString[], numbers: number[]): TuningString[] {
  return list.map((string, index) => ({ ...string, number: numbers[index] ?? string.number }));
}

/** `1st`, `2nd`, `3rd`, `4th`… for a string number. */
export function ordinal(value: number): string {
  const lastTwo = value % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${value}th`;
  const suffix = ['th', 'st', 'nd', 'rd'][value % 10] ?? 'th';
  return `${value}${value % 10 <= 3 ? suffix : 'th'}`;
}

/**
 * The tunings, grouped by instrument.
 *
 * Chosen to cover what someone actually plugs in and plays rather than to be
 * exhaustive: standard first for each instrument, then the alternates that change
 * only the low strings (which is the case where auto-detection needs help), then
 * the open tunings.
 */
export const TUNINGS: readonly Tuning[] = [
  // ---- Guitar -------------------------------------------------------------
  {
    id: 'guitar-standard',
    instrument: 'guitar',
    label: 'Standard',
    hint: 'E A D G B E — standard concert tuning.',
    strings: strings(40, 45, 50, 55, 59, 64),
  },
  {
    id: 'guitar-drop-d',
    instrument: 'guitar',
    label: 'Drop D',
    hint: 'D A D G B E — the low string down a tone.',
    strings: strings(38, 45, 50, 55, 59, 64),
  },
  {
    id: 'guitar-eb',
    instrument: 'guitar',
    label: 'E♭ (half step)',
    hint: 'Everything down a semitone. Slacker strings, darker tone.',
    strings: strings(39, 44, 49, 54, 58, 63),
  },
  {
    id: 'guitar-d',
    instrument: 'guitar',
    label: 'D (whole step)',
    hint: 'Everything down a tone.',
    strings: strings(38, 43, 48, 53, 57, 62),
  },
  {
    id: 'guitar-drop-c',
    instrument: 'guitar',
    label: 'Drop C',
    hint: 'C G C F A D — down a tone, then the low string down again.',
    strings: strings(36, 43, 48, 53, 57, 62),
  },
  {
    id: 'guitar-dadgad',
    instrument: 'guitar',
    label: 'DADGAD',
    hint: 'Modal open tuning. Folk, Celtic, and a lot of acoustic writing.',
    strings: strings(38, 45, 50, 55, 57, 62),
  },
  {
    id: 'guitar-open-g',
    instrument: 'guitar',
    label: 'Open G',
    hint: 'D G D G B D — a G chord open. Slide and blues.',
    strings: strings(38, 43, 50, 55, 59, 62),
  },
  {
    id: 'guitar-open-d',
    instrument: 'guitar',
    label: 'Open D',
    hint: 'D A D F♯ A D — a D chord open.',
    strings: strings(38, 45, 50, 54, 57, 62),
  },
  {
    id: 'guitar-7-string',
    instrument: 'guitar',
    label: '7-string',
    hint: 'B E A D G B E — standard with a low B below.',
    strings: strings(35, 40, 45, 50, 55, 59, 64),
  },

  // ---- Bass ---------------------------------------------------------------
  {
    id: 'bass-standard',
    instrument: 'bass',
    label: '4-string',
    hint: 'E A D G — standard bass, an octave below the guitar’s low four.',
    strings: strings(28, 33, 38, 43),
  },
  {
    id: 'bass-5-string',
    instrument: 'bass',
    label: '5-string',
    hint: 'B E A D G — standard with a low B. 30.87 Hz, the lowest note here.',
    strings: strings(23, 28, 33, 38, 43),
  },
  {
    id: 'bass-drop-d',
    instrument: 'bass',
    label: 'Drop D',
    hint: 'D A D G — the low string down a tone.',
    strings: strings(26, 33, 38, 43),
  },
  {
    id: 'bass-6-string',
    instrument: 'bass',
    label: '6-string',
    hint: 'B E A D G C — a low B and a high C.',
    strings: strings(23, 28, 33, 38, 43, 48),
  },

  // ---- Everything else ----------------------------------------------------
  {
    id: 'ukulele',
    instrument: 'other',
    label: 'Ukulele',
    hint: 'G C E A — soprano/concert. The 4th string is a high G, above the 3rd and 2nd.',
    // C4 E4 G4 A4 by pitch; by number that is the 3rd, 2nd, 4th and 1st.
    strings: renumber(strings(60, 64, 67, 69), [3, 2, 4, 1]),
  },
  {
    id: 'ukulele-baritone',
    instrument: 'other',
    label: 'Baritone uke',
    hint: 'D G B E — the guitar’s top four strings.',
    strings: strings(50, 55, 59, 64),
  },
  {
    id: 'mandolin',
    instrument: 'other',
    label: 'Mandolin / violin',
    hint: 'G D A E — fifths. Both instruments tune to the same four notes.',
    strings: strings(55, 62, 69, 76),
  },
  {
    id: 'banjo',
    instrument: 'other',
    label: 'Banjo (open G)',
    hint: 'g D G B D — the 5th string is a short high drone, above all the others.',
    // D3 G3 B3 D4 G4 by pitch; the top one is the 5th string, not the 1st.
    strings: renumber(strings(50, 55, 59, 62, 67), [4, 3, 2, 1, 5]),
  },
];

/**
 * Chromatic mode: no fixed targets, every semitone is a valid one.
 *
 * Kept out of `TUNINGS` because it is a different *mode* rather than a different
 * set of strings — matching, string locking and the "which string is this" logic
 * all take a different branch. Modelling it as a tuning with 128 strings would
 * make the string row meaningless.
 */
export const CHROMATIC_ID = 'chromatic';

export function tuningById(id: string): Tuning | null {
  return TUNINGS.find((tuning) => tuning.id === id) ?? null;
}

export function tuningsFor(instrument: InstrumentId): Tuning[] {
  return TUNINGS.filter((tuning) => tuning.instrument === instrument);
}

/* --------------------------------------------------------------------------
   Sweetening and reference pitch
-------------------------------------------------------------------------- */

/**
 * Reference pitches worth offering.
 *
 * 440 is the standard. 432 has no acoustic justification but is asked for often
 * enough that refusing to offer it just sends people to another tuner. 442/443
 * are what a lot of European orchestras actually play at, which is the case where
 * a guitarist has a real reason to move.
 */
export const REFERENCE_PITCHES = [432, 435, 438, 440, 442, 444] as const;

export interface Sweetening {
  id: string;
  label: string;
  hint: string;
  /**
   * Cents added to each string's target, by position, lowest string first.
   *
   * Applied only when the length matches the tuning's string count — an offset
   * table written for six strings means nothing on a four-string bass, and
   * silently applying the first four entries would detune it for no reason.
   */
  offsets: readonly number[];
}

/**
 * Offsets that make a guitar sound better in tune than being *exactly* in tune
 * does.
 *
 * The problem is real and is not about the instrument. Equal temperament's major
 * third is 400 cents; the interval the ear hears as consonant, the just 5:4, is
 * 386.3. Every equal-tempered major third is therefore **13.7 cents sharp**, and
 * on a guitar the notes carrying those thirds in open position sit on
 * specific strings — which means the error can be partly absorbed by tuning
 * those strings flat.
 *
 * That is the whole idea behind every "sweetened" tuning sold on a pedal tuner.
 *
 * These are derived from that arithmetic and from where the thirds fall in open
 * position; they are **not** any manufacturer's proprietary table, and the values
 * are deliberately conservative — a sweetening large enough to obviously fix one
 * chord is large enough to obviously break another. Anyone who wants a specific
 * commercial curve can type it in, which is why the offsets are data.
 */
export const SWEETENINGS: readonly Sweetening[] = [
  {
    id: 'equal',
    label: 'Equal',
    hint: 'Equal temperament. Every string exactly on its note.',
    offsets: [],
  },
  {
    id: 'open-chords',
    label: 'Open chords',
    hint: 'G and B pulled slightly flat — the strings that carry the thirds in open E, G and C.',
    offsets: [0, 0, 0, -3, -4, -1],
  },
  {
    id: 'just-thirds',
    label: 'Sweet thirds',
    hint: 'Further toward just intonation. Sweeter open chords, less happy up the neck.',
    offsets: [0, -1, -2, -6, -8, -2],
  },
  {
    id: 'heavy-low',
    label: 'Heavy strings',
    hint: 'Low strings a touch sharp, to offset how far a thick wound string is pulled by fretting.',
    offsets: [2, 1.5, 1, 0, 0, 0],
  },
];

export function sweeteningById(id: string): Sweetening {
  return SWEETENINGS.find((entry) => entry.id === id) ?? SWEETENINGS[0];
}

/** The offset for one string, or 0 when the table does not fit this tuning. */
export function sweeteningFor(
  sweetening: Sweetening | null,
  stringIndex: number,
  stringCount: number,
): number {
  if (!sweetening || sweetening.offsets.length !== stringCount) return 0;
  return sweetening.offsets[stringIndex] ?? 0;
}

/**
 * The string a detected pitch is nearest to, by cents.
 *
 * By cents rather than by Hz: in Hz the gap between the two lowest strings of a
 * bass (28 → 33 MIDI, 41 → 55 Hz) is 14 Hz while the gap between the top two of a
 * guitar (59 → 64, 247 → 330 Hz) is 83 Hz, so a Hz-nearest match applies wildly
 * different tolerances to different strings of the same instrument.
 *
 * Returns -1 for an empty tuning.
 */
export function nearestStringIndex(hz: number, tuning: Tuning, a4Hz = DEFAULT_A4_HZ): number {
  let best = -1;
  let bestDistance = Infinity;

  for (let i = 0; i < tuning.strings.length; i += 1) {
    const distance = Math.abs(centsBetween(hz, midiToFrequency(tuning.strings[i].midi, a4Hz)));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

export interface TuningTarget {
  /** Index into the tuning's strings, or -1 in chromatic mode. */
  stringIndex: number;
  /** MIDI number being aimed at. */
  midi: number;
  /** Its frequency at the current concert pitch. */
  hz: number;
  label: string;
  /** Deviation of the played note from the target, in cents. */
  cents: number;
  /** Sweetening applied to this string, in cents. 0 in equal temperament. */
  offsetCents: number;
  /** True once inside `IN_TUNE_CENTS`. */
  inTune: boolean;
}

/**
 * Resolve what a detected frequency is being compared against.
 *
 * `lockedIndex` forces a string, which matters more than it looks: a string
 * tuned a semitone flat is *nearer* to its neighbour than to itself, so
 * auto-matching alone makes restringing — the one time tuning is hard — the case
 * it handles worst. Locking is how you say "this is the D string, tell me how far
 * off it is", and the answer is then allowed to exceed a semitone.
 */
export function resolveTarget(
  hz: number,
  tuning: Tuning | null,
  lockedIndex = -1,
  a4Hz = DEFAULT_A4_HZ,
  sweetening: Sweetening | null = null,
): TuningTarget {
  if (tuning && tuning.strings.length > 0) {
    const index =
      lockedIndex >= 0 && lockedIndex < tuning.strings.length
        ? lockedIndex
        : nearestStringIndex(hz, tuning, a4Hz);
    const string = tuning.strings[index];
    const offset = sweeteningFor(sweetening, index, tuning.strings.length);
    // The offset moves the *target*, not the reading. A sweetened tuning is a
    // decision about where the string should sit, so it has to be visible as the
    // needle being centred somewhere other than the equal-tempered pitch —
    // subtracting it from the measurement instead would hide what was chosen.
    const targetHz = midiToFrequency(string.midi, a4Hz) * 2 ** (offset / 1200);
    const cents = centsBetween(hz, targetHz);

    return {
      stringIndex: index,
      midi: string.midi,
      hz: targetHz,
      label: string.label,
      cents,
      offsetCents: offset,
      inTune: Math.abs(cents) <= IN_TUNE_CENTS,
    };
  }

  // Chromatic: the target is whatever semitone is nearest.
  const midi = Math.round(frequencyToMidi(hz, a4Hz));
  const targetHz = midiToFrequency(midi, a4Hz);
  const cents = centsBetween(hz, targetHz);

  return {
    stringIndex: -1,
    midi,
    hz: targetHz,
    label: midiToName(midi),
    cents,
    offsetCents: 0,
    inTune: Math.abs(cents) <= IN_TUNE_CENTS,
  };
}

/* --------------------------------------------------------------------------
   Intonation
-------------------------------------------------------------------------- */

/** Intonation tolerance, in cents. Inside this, moving a saddle makes it worse. */
export const INTONATION_TOLERANCE_CENTS = 2;

export interface IntonationResult {
  /** How far the 12th fret is from a true octave above the open string, in cents. */
  deltaCents: number;
  verdict: 'ok' | 'sharp' | 'flat';
  /** Which way the saddle has to move. */
  advice: string;
}

/**
 * Compare an open string against the same string fretted at the 12th.
 *
 * The 12th fret is the halfway point of the string, so the note there should be
 * exactly an octave above the open note. It usually is not, because fretting
 * *stretches* the string and sharpens it, by an amount that depends on the string
 * gauge and the action. Setting intonation means moving the saddle until the
 * played length compensates for that stretch.
 *
 * The measurement is deliberately **relative**: the delta is against an octave
 * above the open string as actually measured, not against the note the string is
 * supposed to be. Intonation and tuning are independent problems, and a check
 * that compares both against the target cannot tell you which of the two is
 * wrong — the classic way to spend an afternoon moving saddles to correct a
 * guitar that was simply tuned flat.
 *
 * Comparing octaves also makes the result immune to the reference pitch and to
 * any sweetening, since both move the two notes by the same ratio.
 */
export function checkIntonation(openHz: number, twelfthHz: number): IntonationResult {
  const deltaCents = centsBetween(twelfthHz, openHz * 2);

  if (Math.abs(deltaCents) <= INTONATION_TOLERANCE_CENTS) {
    return { deltaCents, verdict: 'ok', advice: 'Intonation is good on this string.' };
  }
  if (deltaCents > 0) {
    return {
      deltaCents,
      verdict: 'sharp',
      // Sharp at the 12th means the played length is too short.
      advice: 'The 12th fret is sharp — move the saddle back, away from the neck.',
    };
  }
  return {
    deltaCents,
    verdict: 'flat',
    advice: 'The 12th fret is flat — move the saddle forward, toward the neck.',
  };
}

/* --------------------------------------------------------------------------
   Detection
-------------------------------------------------------------------------- */

/* --------------------------------------------------------------------------
   Band limiting
-------------------------------------------------------------------------- */

/** Butterworth Q, for a maximally flat passband. */
const FILTER_Q = Math.SQRT1_2;

/**
 * One RBJ biquad, applied in place. Direct form 1.
 *
 * The same cookbook formulas `BiquadFilterNode` uses — see `lib/cabinet.ts`,
 * which needs them for the same reason: this file must run under Node, where
 * there is no Web Audio to borrow a filter from.
 */
function biquadInPlace(
  data: Float32Array,
  sampleRate: number,
  kind: 'lowpass' | 'highpass',
  hz: number,
): void {
  const f0 = Math.min(Math.max(hz, 1), sampleRate * 0.49);
  const w0 = (2 * Math.PI * f0) / sampleRate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * FILTER_Q);

  let b0: number, b1: number, b2: number;
  if (kind === 'lowpass') {
    b0 = (1 - cos) / 2;
    b1 = 1 - cos;
    b2 = (1 - cos) / 2;
  } else {
    b0 = (1 + cos) / 2;
    b1 = -(1 + cos);
    b2 = (1 + cos) / 2;
  }
  const a0 = 1 + alpha;
  const a1 = -2 * cos;
  const a2 = 1 - alpha;

  const nb0 = b0 / a0;
  const nb1 = b1 / a0;
  const nb2 = b2 / a0;
  const na1 = a1 / a0;
  const na2 = a2 / a0;

  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;

  for (let i = 0; i < data.length; i += 1) {
    const x0 = data[i];
    const y0 = nb0 * x0 + nb1 * x1 + nb2 * x2 - na1 * y1 - na2 * y2;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
    data[i] = y0;
  }
}

/**
 * Band-limit a block to the range a string can actually be in, in place.
 *
 * Two cascaded sections each side — 24 dB/octave — because one is not enough
 * against the two things that break a tuner on a microphone:
 *
 * - **Rumble.** A laptop's own fan, a desk knock, traffic and the room's own
 *   modes all live below 60 Hz, where they are *louder* than a guitar's low E and
 *   just as periodic. A 12 dB/octave slope leaves a 30 Hz thump only 12 dB down at
 *   the low E, which is not enough to stop it dominating the autocorrelation.
 * - **Hiss.** A Bluetooth link's codec noise and a mic preamp's own floor are
 *   broadband. It does not fool the detector, but it lowers the clarity of every
 *   reading, and clarity is what decides whether a reading is used at all.
 *
 * The passband is deliberately generous at the top — four times the highest
 * string — because the NSDF wants the harmonics. Filtering down to the
 * fundamental alone leaves a near-sine, which is detectable but throws away the
 * evidence that distinguishes a note from a whistle.
 *
 * ---------------------------------------------------------------------------
 * **Filter a longer block than you analyse.** `settlingSamplesFor` says how much
 * longer. An IIR filter started from zero state rings for several time constants
 * and that ringing lands on the front of the block, which is precisely where the
 * autocorrelation is most sensitive — every lag reads from there.
 *
 * Measured: band-limiting a clean 110 Hz sine in place, then analysing the same
 * block, moved the reported pitch by 0.95 cents. A linear filter cannot change a
 * periodic signal's period, so all of that was settling transient. For a tuner
 * claiming sub-cent resolution it is not a rounding error, it is the whole
 * specification.
 *
 * Warming the filter up on the block's own tail first was tried and is worse
 * (8.0 cents): the tail does not end on a period boundary, so it leaves the state
 * wrong by a phase offset instead of right. Real preceding audio is the only
 * thing that settles a filter correctly, and the analyser buffer has plenty.
 * ---------------------------------------------------------------------------
 */
export function bandLimitInPlace(
  data: Float32Array,
  sampleRate: number,
  minHz: number,
  maxHz: number,
): void {
  const low = Math.max(20, minHz * 0.8);
  const high = Math.min(sampleRate * 0.45, maxHz * 4);

  biquadInPlace(data, sampleRate, 'highpass', low);
  biquadInPlace(data, sampleRate, 'highpass', low);
  if (high > low * 2) {
    biquadInPlace(data, sampleRate, 'lowpass', high);
    biquadInPlace(data, sampleRate, 'lowpass', high);
  }
}

/**
 * How many samples of audio must precede the analysis window for the filters in
 * `bandLimitInPlace` to have settled by the time it starts.
 *
 * Six periods of the highpass corner, which is the slowest thing in the cascade.
 *
 * Measured on a clean low B — an 8192-sample window and a 22 Hz corner — the
 * residual shift against an unfiltered analysis of the same audio is 0.0199 cents
 * at one period and 0.0004 at two, so three looks like ample margin.
 *
 * It is not, and the reason is worth keeping: **settling time depends on how much
 * out-of-band energy the filter is removing, not only on its corner.** Cutting
 * this to three periods left 4.0 cents of error on a block carrying a 24 Hz
 * rumble four times louder than the note — the case the filter exists for. The
 * transient is the filter's response to what it is rejecting, so the harder it
 * works, the longer it rings.
 *
 * Six costs nothing in practice: the engine's pre-roll is whatever is left of its
 * buffer after the window, which is 8192 samples at worst and 14336 for a guitar.
 */
export function settlingSamplesFor(minHz: number, sampleRate: number): number {
  return Math.ceil((6 * sampleRate) / Math.max(20, minHz * 0.8));
}

export interface PitchOptions {
  /** Lowest frequency to look for. Default 27.5 Hz (A0), under any bass string. */
  minHz?: number;
  /** Highest. Default 1400 Hz, well above a mandolin's top string fretted high. */
  maxHz?: number;
  /** Signal below this RMS is treated as silence. Default ≈ −54 dBFS. */
  minRms?: number;
  /**
   * Lowest NSDF peak value accepted, 0..1. Default 0.8.
   *
   * This is the confidence knob. A cleanly plucked string reads above 0.95; a
   * chord, a muted string or room noise reads well below, and reporting a
   * confident-looking note for a strummed chord is worse than reporting nothing.
   */
  minClarity?: number;
}

export interface Pitch {
  hz: number;
  /** NSDF peak height, 0..1. How periodic the window was. */
  clarity: number;
  /** RMS of the window, 0..1 linear. */
  rms: number;
  /**
   * True when the spectrum overruled the time domain about the octave.
   *
   * A diagnostic, not a quality signal. If this is ever true in normal playing it
   * is worth knowing, because it means the primary method was wrong.
   */
  crossChecked: boolean;
}

/**
 * Fraction of the strongest key maximum that a *earlier* maximum must reach to be
 * preferred over it.
 *
 * This one constant is the octave-error defence. The NSDF of a note rich in
 * harmonics has near-equal maxima at the period and at twice the period; taking
 * the tallest picks between them essentially at random, one window to the next,
 * and the display flickers between E2 and E1. Taking the *first* one that comes
 * within 90% of the tallest resolves it downward-consistently, which is what MPM
 * specifies and what makes it usable on a bass.
 */
const KEY_MAX_RATIO = 0.9;

interface Scratch {
  re: Float32Array<ArrayBuffer>;
  im: Float32Array<ArrayBuffer>;
  nsdf: Float32Array<ArrayBuffer>;
  /** Working copy of the window, so band limiting cannot alter the caller's data. */
  block: Float32Array<ArrayBuffer>;
  /** Magnitude spectrum, retained for the harmonic cross-check. */
  magnitude: Float32Array<ArrayBuffer>;
}

/** Scratch buffers cached per transform size, as `lib/fft.ts` caches its tables. */
const scratches = new Map<number, Scratch>();

function scratchFor(size: number): Scratch {
  const cached = scratches.get(size);
  if (cached) return cached;

  // Sized from the transform, not from the window that happened to be first:
  // `size` is the next power of two above `2n`, so no window reaching this size
  // can exceed `size / 2`. Sizing these to the first caller's `n` would leave
  // them short for a later, longer window that rounds up to the same transform.
  const half = size >> 1;
  const built: Scratch = {
    re: new Float32Array(size),
    im: new Float32Array(size),
    nsdf: new Float32Array(half + 1),
    block: new Float32Array(half),
    magnitude: new Float32Array(half + 1),
  };
  scratches.set(size, built);
  return built;
}

/**
 * Harmonic Product Spectrum estimate, in Hz, or 0 if there is nothing to see.
 *
 * Multiplies the spectrum by decimated copies of itself: a true fundamental has
 * energy at every multiple of itself, so the product reinforces there and
 * collapses everywhere else. It is the classic cheap way to find a fundamental
 * that is not the loudest partial.
 *
 * Used here **only as a second opinion**, never as the answer. HPS on its own is
 * poor at exactly what this tuner needs most — its resolution is one FFT bin
 * (5.9 Hz at a 4096-point window, or 120 cents at the low E), which is useless
 * for a cents readout, and it has a documented weakness for reporting a
 * *subharmonic* when several harmonics are strong. What it is good at is telling
 * you whether the time-domain answer is in the right octave.
 */
function harmonicProductHz(
  magnitude: Float32Array,
  bins: number,
  binHz: number,
  minHz: number,
  maxHz: number,
  harmonics = 4,
): number {
  const first = Math.max(1, Math.floor(minHz / binHz));
  const last = Math.min(bins - 1, Math.ceil(maxHz / binHz));
  if (last <= first) return 0;

  let bestBin = -1;
  let bestValue = 0;

  for (let bin = first; bin <= last; bin += 1) {
    let product = magnitude[bin];
    for (let harmonic = 2; harmonic <= harmonics; harmonic += 1) {
      const index = bin * harmonic;
      if (index > bins) break;
      product *= magnitude[index];
    }
    if (product > bestValue) {
      bestValue = product;
      bestBin = bin;
    }
  }

  return bestBin > 0 ? bestBin * binHz : 0;
}

/** Smallest power of two greater than or equal to `value`. */
function nextPowerOfTwo(value: number): number {
  let size = 1;
  while (size < value) size <<= 1;
  return size;
}

/**
 * Shortest window that can detect `minHz`, as a power of two.
 *
 * Cost is the reason this exists rather than one window big enough for anything.
 * Detection is two FFTs of twice the window length, and it runs on the same main
 * thread that is painting meters at 60 fps: measured, a 8192-sample window costs
 * ~8.7 ms per detection and a 2048-sample one ~0.9 ms. Sizing the window to the
 * lowest note actually selected means a guitar pays a guitar's price, and only a
 * 5-string bass pays for a 30 Hz window.
 *
 * The floor is two full periods of `minHz` — below that the NSDF peak for the
 * note is past the end of the window and the detector reports the octave above.
 * A third period of margin is added because a window with exactly two is
 * intolerant of the note decaying inside it.
 */
export function windowLengthFor(minHz: number, sampleRate: number, maximum = 16384): number {
  const periods = 3;
  return Math.min(maximum, nextPowerOfTwo(Math.ceil((sampleRate / minHz) * periods)));
}

/**
 * How often detection should run, for a given window.
 *
 * Not every frame. A window of W samples does not contain any new information
 * until W/rate seconds have passed, so re-running at 60 fps analyses the same
 * audio five to ten times over — at a measured 3.9 ms (4096) to 7.7 ms (8192) per
 * detection, that is most of a frame's budget spent to produce the same answer.
 *
 * A little over half a window is the most that can tell you anything new; the
 * 60 ms floor stops short windows from running detection more often than a needle
 * can usefully move. The result holds the tuner under a tenth of the main thread
 * at every window size — measured, including the 8192 case.
 */
export function detectionIntervalMs(windowLength: number, sampleRate: number): number {
  return Math.max(60, (windowLength / sampleRate) * 1000 * 0.6);
}

/**
 * Detect the fundamental of one window of samples.
 *
 * Returns `null` when the window is too quiet, too short for the requested range,
 * or not periodic enough to be a note — all three are ordinary and none is an
 * error. A tuner that guesses when it does not know is worse than one that says
 * nothing, because the guess is indistinguishable from a reading.
 */
export function detectPitch(
  samples: Float32Array,
  sampleRate: number,
  options: PitchOptions = {},
): Pitch | null {
  const minHz = options.minHz ?? 27.5;
  const maxHz = options.maxHz ?? 1400;
  const minRms = options.minRms ?? 0.002;
  const minClarity = options.minClarity ?? 0.8;

  const n = samples.length;
  if (n < 64) return null;

  const maxLag = Math.min(n - 1, Math.floor(sampleRate / minHz));
  const minLag = Math.max(2, Math.floor(sampleRate / maxHz));
  // Two periods of the lowest note have to fit, or its NSDF peak is off the end
  // of the window and the detector would report the octave above instead.
  if (maxLag * 2 > n || minLag >= maxLag) return null;

  // Zero-padded to at least 2n so the circular correlation the FFT computes
  // equals the linear one over the lags we read.
  const size = nextPowerOfTwo(n * 2);
  const { re, im, nsdf, block, magnitude } = scratchFor(size);

  // ---- Working copy -------------------------------------------------------
  // The mean removal below is destructive, and the caller's buffer is an
  // analyser's, reused every frame.
  for (let i = 0; i < n; i += 1) block[i] = samples[i];

  // ---- Level gate, and the DC offset --------------------------------------
  // The mean is removed rather than assumed to be zero: a converter offset is a
  // constant added to every lag of the autocorrelation, which lifts the whole
  // NSDF and can invent a peak where the signal has no period at all.
  let sum = 0;
  for (let i = 0; i < n; i += 1) sum += block[i];
  const mean = sum / n;

  let energy = 0;
  for (let i = 0; i < n; i += 1) {
    const centred = block[i] - mean;
    block[i] = centred;
    energy += centred * centred;
  }
  const rms = Math.sqrt(energy / n);
  if (rms < minRms) return null;

  // ---- Autocorrelation, through the FFT -----------------------------------
  re.fill(0);
  im.fill(0);
  for (let i = 0; i < n; i += 1) re[i] = block[i];

  fft(re, im);
  // Power spectrum. Its inverse transform is the autocorrelation
  // (Wiener–Khinchin), and because the spectrum of a real signal is even, the
  // inverse is the forward transform over n — no separate inverse is needed.
  const bins = size >> 1;
  for (let k = 0; k < size; k += 1) {
    const power = re[k] * re[k] + im[k] * im[k];
    // Kept before the second transform overwrites it: the harmonic cross-check
    // below needs the spectrum, and computing it again would mean a third FFT.
    if (k <= bins) magnitude[k] = Math.sqrt(power);
    re[k] = power;
    im[k] = 0;
  }
  fft(re, im);

  // ---- NSDF ---------------------------------------------------------------
  // n(τ) = 2·r(τ) / m(τ), where m(τ) sums the energy of both windows being
  // compared. The normalisation is the whole point: a raw autocorrelation decays
  // with τ purely because fewer terms overlap, which biases every peak picker
  // toward short lags — that is, toward the octave above.
  let headEnergy = energy; // Σ x², indices 0 .. n-1-τ
  let tailEnergy = energy; // Σ x², indices τ .. n-1
  nsdf[0] = 1;

  for (let lag = 1; lag <= maxLag; lag += 1) {
    // `block` is already mean-removed in place, above.
    const dropHead = block[n - lag];
    const dropTail = block[lag - 1];
    headEnergy -= dropHead * dropHead;
    tailEnergy -= dropTail * dropTail;

    const denominator = headEnergy + tailEnergy;
    nsdf[lag] = denominator > 1e-12 ? (2 * (re[lag] / size)) / denominator : 0;
  }

  // ---- Key maxima ---------------------------------------------------------
  // Skip the peak at τ = 0, which is always 1 and is not a period. The scan
  // starts from the first lag where the NSDF goes negative, so the descending
  // shoulder of that peak cannot be mistaken for a maximum of its own.
  let lag = 1;
  while (lag < maxLag && nsdf[lag] > 0) lag += 1;
  while (lag < maxLag && nsdf[lag] <= 0) lag += 1;

  let bestLag = -1;
  let bestValue = -Infinity;
  // Candidates are collected in lag order; the pick below wants the *earliest*
  // one that is tall enough, so they cannot simply be reduced to the maximum.
  const candidateLags: number[] = [];
  const candidateValues: number[] = [];

  while (lag < maxLag) {
    if (nsdf[lag] > 0) {
      let peakLag = lag;
      let peakValue = nsdf[lag];
      while (lag < maxLag && nsdf[lag] > 0) {
        if (nsdf[lag] > peakValue) {
          peakValue = nsdf[lag];
          peakLag = lag;
        }
        lag += 1;
      }
      if (peakLag >= minLag) {
        candidateLags.push(peakLag);
        candidateValues.push(peakValue);
        if (peakValue > bestValue) {
          bestValue = peakValue;
          bestLag = peakLag;
        }
      }
    } else {
      lag += 1;
    }
  }

  if (bestLag < 0 || bestValue < minClarity) return null;

  // The first maximum within `KEY_MAX_RATIO` of the tallest. See the constant.
  const cutoff = bestValue * KEY_MAX_RATIO;
  let chosenLag = bestLag;
  for (let i = 0; i < candidateLags.length; i += 1) {
    if (candidateValues[i] >= cutoff) {
      chosenLag = candidateLags[i];
      break;
    }
  }

  // ---- Harmonic cross-check ------------------------------------------------
  // The one failure the time-domain method has left: picking a *subharmonic*,
  // reporting a note an octave or a twelfth below the one played. Key-maximum
  // picking is specifically designed against it and, measured, does not make the
  // error on anything this suite throws at it — so this is a guard, not a stage
  // the answer normally passes through.
  //
  // It fires only on agreement about the ratio *and* corroboration in the time
  // domain: the spectrum must say the fundamental is 2×, 3× or 4× higher, and
  // the NSDF must already have nearly as strong a peak there. Either condition
  // alone is not enough — HPS is bin-limited and biased low, and NSDF peaks at
  // harmonics of the true period regardless.
  const spectrumHz = harmonicProductHz(magnitude, bins, sampleRate / size, minHz, maxHz);
  let crossChecked = false;

  if (spectrumHz > 0) {
    const ratio = spectrumHz / (sampleRate / chosenLag);
    const multiple = Math.round(ratio);
    if (multiple >= 2 && multiple <= 4 && Math.abs(ratio - multiple) < 0.06) {
      const shorter = Math.round(chosenLag / multiple);
      if (shorter >= minLag && nsdf[shorter] >= nsdf[chosenLag] * 0.85) {
        chosenLag = shorter;
        crossChecked = true;
      }
    }
  }

  // ---- Sub-sample refinement ----------------------------------------------
  // Without this the resolution is one whole sample of period: at the top E of a
  // guitar (330 Hz, 145 samples at 48 kHz) one sample is 12 cents, so the reading
  // would step in 12-cent jumps and could never show "in tune".
  const left = nsdf[chosenLag - 1] ?? 0;
  const centre = nsdf[chosenLag];
  const right = nsdf[chosenLag + 1] ?? 0;
  const denominator = 2 * (2 * centre - left - right);
  const shift = denominator !== 0 ? (right - left) / denominator : 0;
  // A parabola fitted to three points cannot legitimately peak outside them;
  // anything further means the neighbourhood was not peak-shaped.
  const refinedLag = chosenLag + (Math.abs(shift) <= 1 ? shift : 0);
  const clarity = Math.min(1, centre + 0.25 * (right - left) * shift);

  const hz = sampleRate / refinedLag;
  if (!Number.isFinite(hz) || hz < minHz || hz > maxHz) return null;

  return { hz, clarity, rms, crossChecked };
}

/** RMS of a block, DC removed. Cheap; the detector's own gate needs it too. */
export function rmsOf(samples: Float32Array): number {
  const n = samples.length;
  if (n === 0) return 0;

  let sum = 0;
  for (let i = 0; i < n; i += 1) sum += samples[i];
  const mean = sum / n;

  let energy = 0;
  for (let i = 0; i < n; i += 1) {
    const centred = samples[i] - mean;
    energy += centred * centred;
  }
  return Math.sqrt(energy / n);
}

export interface NoiseFloor {
  /** Feed one block's RMS. Returns the level a note must now exceed. */
  update(rms: number): number;
  /** Current estimate of the floor, 0..1 linear. */
  level(): number;
  reset(): void;
}

/**
 * How far above the noise floor a signal has to sit to count as a note. ~11 dB.
 *
 * Below this the detector is being asked to find a pitch in something that is
 * mostly whatever the room, the cable or the radio link is doing on its own.
 */
const SIGNAL_OVER_FLOOR = 3.5;

/** Absolute floor, ~−60 dBFS. Stops a silent digital input from gating itself open. */
const ABSOLUTE_FLOOR = 0.001;

/**
 * How many blocks the running minimum looks back over. At 60–100 ms per block
 * this is 4–6 seconds.
 *
 * The length is a direct trade: shorter and a sustained note eventually becomes
 * its own noise floor and gates itself off mid-decay; longer and the estimate
 * takes that long to notice a genuinely noisier input. Longer than any note
 * sustains, shorter than someone's patience, is the target.
 */
const FLOOR_HISTORY = 64;

/**
 * Adaptive noise-floor tracker.
 *
 * A fixed level gate is wrong for anything but a direct line input, and this
 * tuner has to work from three sources that differ by 40 dB of noise floor: a USB
 * pedal (silent), a Bluetooth link (compressed, hissy, with its own comfort
 * noise), and a laptop's built-in microphone in a room (fans, traffic, mains).
 *
 * The failure it exists to prevent is specific and otherwise invisible: **mains
 * hum is periodic**. At 50 Hz it sits between a bass low B and low E, it is a
 * clean sine, and the NSDF scores it at a confidence a real note would envy. A
 * detector gated on absolute level and clarity alone will happily report G1 from a
 * guitar nobody is touching. A gate defined *relative to what the input does when
 * nothing is played* rejects it, because in that case the hum is the floor.
 *
 * The estimator is **minimum statistics** — the quietest block in the recent
 * past — not a smoothed average of the level.
 *
 * The first version here was a one-pole average that fell fast and rose slowly.
 * Measured, it failed the case it was written for: starting from the −60 dBFS
 * default it took hundreds of blocks to climb to a −47 dBFS hum, and reported
 * that hum as a note twice in the first sixty. Making it rise faster fixes that
 * and breaks the opposite case, where a sustained note drags the floor up behind
 * itself until it is gated off mid-decay. No single rate satisfies both, because
 * the two requirements are about different statistics of the signal.
 *
 * A running minimum has neither problem: a note *never* lowers the minimum, so it
 * cannot gate itself off, while a continuous hum *is* the minimum from the very
 * first quiet block and is rejected immediately.
 */
export function createNoiseFloor(): NoiseFloor {
  const history = new Float32Array(FLOOR_HISTORY);
  let filled = 0;
  let cursor = 0;

  return {
    update(rms) {
      // Seeded from the first observation rather than from a constant: an input
      // whose noise floor is above the default would otherwise be trusted for the
      // whole length of the history before the estimate caught up.
      if (filled === 0) history.fill(rms);
      history[cursor] = rms;
      cursor = (cursor + 1) % FLOOR_HISTORY;
      filled = Math.min(FLOOR_HISTORY, filled + 1);

      return Math.max(ABSOLUTE_FLOOR, this.level() * SIGNAL_OVER_FLOOR);
    },
    level() {
      if (filled === 0) return ABSOLUTE_FLOOR;
      // A full scan of 64 floats, once per detection. A monotonic deque would be
      // O(1) and is not worth the state machine next to two FFTs.
      let lowest = Infinity;
      for (let i = 0; i < FLOOR_HISTORY; i += 1) {
        if (history[i] < lowest) lowest = history[i];
      }
      return lowest;
    },
    reset() {
      filled = 0;
      cursor = 0;
      history.fill(0);
    },
  };
}

/**
 * Median of the recent readings.
 *
 * A single detection is occasionally an octave out even with key-maximum
 * picking — a pick scrape, the moment a note dies into the noise floor. A median
 * over a short history rejects those outright, where a moving average would drag
 * the needle a third of the way to the wrong octave and hold it there.
 *
 * Returns 0 for an empty history.
 */
export function medianHz(history: readonly number[]): number {
  if (history.length === 0) return 0;
  const sorted = [...history].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
