/**
 * Tuning memory — saving where the player put each string, and measuring the way
 * back to it.
 *
 * Pure: no Web Audio, no DOM, no clock of its own. Every reading carries its own
 * timestamp so this compiles with `npx tsc --outDir <tmp> --module commonjs` and
 * runs under plain Node like the rest of `lib/`.
 *
 * ---------------------------------------------------------------------------
 * Why this is not the needle again.
 *
 * The needle answers "is this string at concert pitch". This answers a different
 * question: **"how far is this string from where you left it"**. Those come apart
 * the moment a player deliberately sits a string three cents sharp, which is
 * ordinary — a tracker that reported that as an error would be arguing with a
 * decision.
 *
 * **The baseline is saved on a press, never inferred.** The first version
 * baselined automatically once a string had held still for eight readings, and
 * carried three constants — a jump threshold, a rate threshold and a minimum span —
 * whose only job was guessing whether a change in pitch was the player tuning or the
 * string drifting. Every one of them was a number nobody could verify against a real
 * guitar, and they were wrong in the case that matters most: while you turn a peg
 * back toward a saved tuning, the "that's a retune" heuristic fires and erases the
 * very target you are aiming at.
 *
 * With `save()` there is nothing to guess. A 40-cent gap is not ambiguous and not an
 * error — it is the distance home, and it counts down as you turn. That is the same
 * choice `MonitorHandover` made about the live monitor, for the same reason:
 * navigating, or playing, is not a request to change what the app believes.
 *
 * Two rules follow, and both are load-bearing:
 *
 * 1. **Drift is measured in absolute cents, never against the target.** The target
 *    moves when concert pitch or the sweetening changes; the string does not.
 *    Measuring against the target would turn 440 -> 442 into a phantom 8-cent drift
 *    on all six strings at once.
 * 2. **Nothing is claimed about a string that has not been heard.** The detector
 *    only knows a string moved if it is played, so `unheard` is a real state with
 *    its own display, not an absence. A grid that quietly showed "in tune" for a
 *    string nobody had touched would be inventing a measurement.
 * ---------------------------------------------------------------------------
 *
 * What it deliberately does not do: attribute a cause. New strings stretch flat over
 * their first hour, and that is usually larger than anything temperature does and in
 * the opposite direction. `stringsSettling` names that one pattern because it is
 * detectable — every measured string sagging together — and says nothing about why
 * any single string moved.
 */

// Relative, not aliased: this module is pure, so it can be compiled and checked
// from plain Node, which `@/` paths break — nothing rewrites them in the emitted
// `require`. Same rule as `lib/ampGraph.ts`.
import type { PitchPhase } from './pitchStabiliser';
import {
  DEFAULT_A4_HZ,
  IN_TUNE_CENTS,
  METER_RANGE_CENTS,
  resolveTarget,
  type Sweetening,
  type Tuning,
  type TuningString,
} from './tuner';

/* --------------------------------------------------------------------------
   Constants
-------------------------------------------------------------------------- */

/**
 * How far from its reference a reading may sit and still count as that string, in
 * cents.
 *
 * This is the fretted-note filter, and it is the reason the tracker can run while
 * someone is playing rather than only while they are tuning. `nearestStringIndex`
 * always returns *something*: a C at the 3rd fret of the A string is 200 cents from
 * the open D and would be logged as the D string having collapsed. The nearest
 * fretted note to any open string is a semitone away, so half a semitone rejects
 * every one of them.
 *
 * It is `METER_RANGE_CENTS` on purpose rather than a new number: it makes the rule
 * "if the needle can show it, the tracker counts it".
 *
 * **The window is centred on the saved baseline once there is one**, not on the
 * target — see `reference` in `push`. Centring it on the target would blind the
 * tracker at exactly the moment it is most useful: a string 40 cents below a saved
 * baseline is the case you most want guiding back, and a target-centred window drops
 * it as soon as the two references disagree.
 *
 * What it cannot filter, and nothing working from pitch alone could: a fretted note
 * that lands on another *open* string's pitch — the 5th fret of the low E is the
 * open A. Played while the E is nine cents flat, the note is nine cents flat too,
 * and it is logged against the A string. The median over the buffer is the only
 * defence, and it is a real one — one such note among a run of open strings is
 * outvoted, and `RECENT_MS` retires it. A player who fingers that note repeatedly
 * and never sounds the open A will get a wrong figure for the A string.
 */
export const ACCEPT_WINDOW_CENTS = METER_RANGE_CENTS;

/**
 * Stable readings needed before a string can be saved or measured.
 *
 * Detection runs no faster than every 60 ms (`detectionIntervalMs`), and the
 * stabiliser discards the first 70 ms after an onset, so eight readings is roughly
 * one sustained note. That is the right unit: a baseline should come from a note the
 * player let ring, not from a spread of unrelated plucks.
 */
export const MIN_SAMPLES = 8;

/** Below this the estimator does not trust itself, so neither do we. */
const MIN_CONFIDENCE = 0.5;

/**
 * Age limit on the rolling buffer, in milliseconds.
 *
 * Readings only accumulate while a string is sounding, so this is not a window over
 * the session — it is "the last couple of plucks". It has to expire: without it,
 * playing a string, waiting ten minutes and playing it again leaves one median
 * straddling the gap, which reads as half the movement that actually happened. The
 * long-term reference is the saved baseline, which is exactly what does not expire.
 */
const RECENT_MS = 20_000;

/** Hard cap on buffered readings per string, so a long sustain cannot grow it. */
const RECENT_MAX = 32;

/**
 * Elapsed time below which `centsPerHour` is withheld, in milliseconds.
 *
 * A rate extrapolated from three seconds is not a rate, and this number feeds the
 * per-guitar profile — "which string on this instrument moves fastest" — where one
 * noisy extrapolation would outrank an hour of real observation.
 */
const MIN_RATE_ELAPSED_MS = 60_000;

/** Strings that must agree before a whole-instrument sag is called. */
const SETTLING_MIN_STRINGS = 3;

/** Mean sag across measured strings that counts as new strings settling, in cents. */
const SETTLING_MEAN_CENTS = -5;

/* --------------------------------------------------------------------------
   Types
-------------------------------------------------------------------------- */

/** One detection cycle, as the stabiliser produces it. */
export interface DriftReading {
  /** Filtered frequency in Hz. */
  hz: number;
  phase: PitchPhase;
  /** The estimator's own confidence, 0..1. */
  confidence: number;
  /** Milliseconds, from any monotonic source. Passed in so this module is pure. */
  at: number;
}

/**
 * What the readings are being compared against.
 *
 * All three participate in the identity: changing the tuning remaps which string a
 * frequency belongs to, and 432 Hz to 444 Hz moves every target by 47 cents. Either
 * is a different instrument as far as a saved baseline is concerned, which is why
 * `snapshot` carries this identity and `restore` refuses a mismatch.
 */
export interface DriftContext {
  tuning: Tuning | null;
  a4Hz?: number;
  sweetening?: Sweetening | null;
}

/** Which way to turn the peg. `null` when the string is where it was left. */
export type DriftAction = 'up' | 'down' | null;

export type DriftState =
  /** Not played since the tracker was reset. Nothing is known and nothing is shown. */
  | 'unheard'
  /** Being played, but not yet enough of it to save. */
  | 'listening'
  /** Held still long enough to save. Nothing saved yet, so no figure is claimed. */
  | 'ready'
  /** A baseline was saved for this string. */
  | 'saved';

export interface StringDrift {
  /** Index into the tuning's strings, in pitch order. */
  index: number;
  /** The string's number as players count it — 1 is the thinnest. */
  number: number;
  label: string;
  state: DriftState;
  /**
   * Cents from the saved baseline. Positive is sharp.
   *
   * `null` unless the string is saved **and** currently sounding — a saved string
   * nobody has played since is `state: 'saved'` with no figure, which is the honest
   * reading and the one the grid shows as "play it".
   */
  driftCents: number | null;
  /** `down` for a sharp string. Never derived at the call site — see `actionFor`. */
  action: DriftAction;
  /** Inside `IN_TUNE_CENTS` of where it was left. `false` whenever unmeasured. */
  held: boolean;
  /** Enough buffered readings right now to save this string. */
  savable: boolean;
  /** Drift rate, for the per-guitar profile. `null` until the baseline has age. */
  centsPerHour: number | null;
  savedAt: number | null;
  lastHeardAt: number | null;
  /** Buffered stable readings backing the current figure. */
  samples: number;
}

export interface DriftSummary {
  strings: StringDrift[];
  /**
   * How well the instrument has held, 0..100, or `null` before anything is measured.
   *
   * The worst string sets it. An average would call one string half a semitone out
   * and five perfect "94%", which is the number a player would most like to believe
   * and the one most likely to be wrong.
   */
  score: number | null;
  /** The measured string furthest from where it was left, or `null`. */
  worst: StringDrift | null;
  savedCount: number;
  /** Strings with a saved baseline *and* a current reading to compare against it. */
  measuredCount: number;
  /** Strings that could be saved right now. What the save button counts. */
  savableCount: number;
  /** Every string in the tuning has a saved baseline. */
  allSaved: boolean;
  /**
   * Every measured string sagging together — new strings still stretching.
   *
   * The one pattern worth naming, because it is the common cause, it is detectable,
   * and it is the opposite direction from what a player expects when told the room
   * is warm.
   */
  stringsSettling: boolean;
}

/** A saved tuning, in a form that survives `JSON.stringify`. */
export interface DriftSnapshot {
  /** Identity of the comparison these baselines were taken under. */
  key: string;
  /** One entry per string in pitch order; `null` where nothing was saved. */
  baselines: ({ cents: number; at: number } | null)[];
}

export interface DriftTracker {
  /** Feed one detection cycle. Returns the current summary. */
  push(reading: DriftReading, context: DriftContext): DriftSummary;
  /** Current summary without advancing anything. */
  read(): DriftSummary;
  /**
   * Save where every currently-sounding string sits. "I have just tuned it."
   *
   * Returns how many strings were saved. Strings that have not been played are left
   * alone rather than invented at their target pitch — a partial save is a real
   * state, and the grid says which strings are still missing.
   */
  save(at: number): number;
  /** Everything saved so far, for persisting between sessions. */
  snapshot(): DriftSnapshot;
  /**
   * Load saved baselines. Returns false, changing nothing, if they were taken under
   * a different tuning, concert pitch or sweetening.
   */
  restore(snapshot: DriftSnapshot, context: DriftContext): boolean;
  /** Forget everything. A different guitar, or a fresh set of strings. */
  reset(): void;
}

/* --------------------------------------------------------------------------
   Helpers
-------------------------------------------------------------------------- */

/**
 * Absolute pitch in cents above a fixed 100 Hz reference.
 *
 * A linear space no setting can move, which is the whole point — see rule 1 at the
 * top. The reference is arbitrary; only differences are ever used.
 */
export function absoluteCents(hz: number): number {
  return 1200 * Math.log2(hz / 100);
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Which way to turn the peg for a given drift.
 *
 * Its own function, exported, and checked on its own, because this is the one place
 * in the file where a flipped sign is completely silent: every reading, every
 * threshold and every colour would still be right, and the arrow would point the
 * wrong way for every player forever. **A sharp string (positive drift) is tuned
 * down.**
 */
export function actionFor(driftCents: number): DriftAction {
  if (Math.abs(driftCents) <= IN_TUNE_CENTS) return null;
  return driftCents > 0 ? 'down' : 'up';
}

/**
 * Score for one string's drift, 0..100.
 *
 * Flat at 100 across the in-tune window rather than falling from the first cent: the
 * panel already draws that window as a place, and a score reading 90% for a string
 * the needle calls in tune would be two parts of one screen disagreeing.
 */
export function holdScore(driftCents: number): number {
  const excess = Math.max(0, Math.abs(driftCents) - IN_TUNE_CENTS);
  const span = METER_RANGE_CENTS - IN_TUNE_CENTS;
  return Math.round(100 * (1 - Math.min(1, excess / span)));
}

/** Identity of the comparison. Baselines are only meaningful within one. */
export function driftContextKey(context: DriftContext): string {
  const tuningId = context.tuning?.id ?? 'none';
  const a4 = context.a4Hz ?? DEFAULT_A4_HZ;
  const sweetening = context.sweetening?.id ?? 'equal';
  return `${tuningId}|${a4}|${sweetening}`;
}

/* --------------------------------------------------------------------------
   Tracker
-------------------------------------------------------------------------- */

interface StringState {
  /** Recent stable readings in absolute cents, oldest first. */
  recent: number[];
  /** Timestamps parallel to `recent`. */
  times: number[];
  /** Absolute cents the player saved, or null. */
  saved: number | null;
  savedAt: number | null;
  lastHeardAt: number | null;
}

function emptyString(): StringState {
  return { recent: [], times: [], saved: null, savedAt: null, lastHeardAt: null };
}

/**
 * Where the string is *now*: the median of the newest `MIN_SAMPLES` readings.
 *
 * Not the median of the whole buffer, which was the first version and lagged badly.
 * The buffer spans twenty seconds, so a peg turn left the figure sitting half-way
 * between the old pitch and the new one for the whole of that — measured at 15 cents
 * for a 30-cent turn. A readout that reports the average of where a string used to
 * be and where it is now is describing a moment that never happened, and it is worse
 * than useless beside a needle that is already tracking correctly.
 *
 * `MIN_SAMPLES` is the right window because it is already this file's unit of "one
 * sustained note" — the figure is the last note the player let ring, and at 60 ms a
 * reading it catches up within half a second. A median over eight still outvotes the
 * stray fretted note the accept window cannot catch.
 *
 * The buffer stays long for a different job: deciding whether the string has been
 * heard recently enough to claim anything at all.
 */
function currentCents(state: StringState): number {
  return median(state.recent.slice(-MIN_SAMPLES));
}

export function createDriftTracker(): DriftTracker {
  let key = '';
  let strings: TuningString[] = [];
  let states: StringState[] = [];

  function reset(): void {
    states = strings.map(() => emptyString());
  }

  function adopt(context: DriftContext): void {
    const next = driftContextKey(context);
    if (next === key) return;
    key = next;
    strings = context.tuning ? [...context.tuning.strings] : [];
    reset();
  }

  /** Drop buffered readings too old or too many to still be "now". */
  function trim(state: StringState, now: number): void {
    while (state.times.length > 0 && now - state.times[0] > RECENT_MS) {
      state.times.shift();
      state.recent.shift();
    }
    while (state.recent.length > RECENT_MAX) {
      state.times.shift();
      state.recent.shift();
    }
  }

  function describe(state: StringState, string: TuningString, index: number): StringDrift {
    const savable = state.recent.length >= MIN_SAMPLES;
    const base: StringDrift = {
      index,
      number: string.number,
      label: string.label,
      state: 'unheard',
      driftCents: null,
      action: null,
      held: false,
      savable,
      centsPerHour: null,
      savedAt: state.savedAt,
      lastHeardAt: state.lastHeardAt,
      samples: state.recent.length,
    };

    if (state.saved === null) {
      if (state.lastHeardAt === null) return base;
      return { ...base, state: savable ? 'ready' : 'listening' };
    }

    // Saved but not currently sounding: the baseline stands, there is just nothing
    // to compare it against yet.
    if (!savable) return { ...base, state: 'saved' };

    const driftCents = currentCents(state) - state.saved;
    const elapsed = state.savedAt === null ? 0 : (state.lastHeardAt ?? 0) - state.savedAt;

    return {
      ...base,
      state: 'saved',
      driftCents,
      action: actionFor(driftCents),
      held: Math.abs(driftCents) <= IN_TUNE_CENTS,
      centsPerHour: elapsed >= MIN_RATE_ELAPSED_MS ? (driftCents / elapsed) * 3_600_000 : null,
    };
  }

  function summarise(): DriftSummary {
    const list = states.map((state, index) => describe(state, strings[index], index));
    const measured = list.filter((entry) => entry.driftCents !== null);
    const savedCount = list.filter((entry) => entry.state === 'saved').length;

    let worst: StringDrift | null = null;
    for (const entry of measured) {
      if (worst === null || Math.abs(entry.driftCents!) > Math.abs(worst.driftCents!)) {
        worst = entry;
      }
    }

    const sagging = measured.filter((entry) => entry.driftCents! < 0);
    const mean =
      measured.length === 0
        ? 0
        : measured.reduce((total, entry) => total + entry.driftCents!, 0) / measured.length;

    return {
      strings: list,
      score: worst === null ? null : holdScore(worst.driftCents!),
      worst,
      savedCount,
      measuredCount: measured.length,
      savableCount: list.filter((entry) => entry.savable).length,
      allSaved: list.length > 0 && savedCount === list.length,
      stringsSettling:
        measured.length >= SETTLING_MIN_STRINGS &&
        sagging.length === measured.length &&
        mean <= SETTLING_MEAN_CENTS,
    };
  }

  return {
    push(reading, context) {
      adopt(context);
      if (strings.length === 0) return summarise();

      if (
        reading.phase !== 'stable' ||
        reading.confidence < MIN_CONFIDENCE ||
        !Number.isFinite(reading.hz) ||
        reading.hz <= 0
      ) {
        return summarise();
      }

      // The target picks the string. That is all it is used for — the measurement
      // below is absolute, and the gate after it prefers the saved baseline.
      const target = resolveTarget(
        reading.hz,
        context.tuning,
        -1,
        context.a4Hz ?? DEFAULT_A4_HZ,
        context.sweetening ?? null,
      );
      if (target.stringIndex < 0) return summarise();

      const state = states[target.stringIndex];
      if (!state) return summarise();

      const cents = absoluteCents(reading.hz);
      // Once saved, the window follows the baseline: a string 40 cents below where
      // you left it is the case this exists for, and a target-centred window would
      // discard it right when the readout matters.
      const reference = state.saved ?? absoluteCents(target.hz);
      if (Math.abs(cents - reference) > ACCEPT_WINDOW_CENTS) return summarise();

      state.recent.push(cents);
      state.times.push(reading.at);
      state.lastHeardAt = reading.at;
      trim(state, reading.at);

      return summarise();
    },

    read: summarise,

    save(at) {
      let saved = 0;
      for (const state of states) {
        if (state.recent.length < MIN_SAMPLES) continue;
        state.saved = currentCents(state);
        state.savedAt = at;
        saved += 1;
      }
      return saved;
    },

    snapshot() {
      return {
        key,
        baselines: states.map((state) =>
          state.saved === null ? null : { cents: state.saved, at: state.savedAt ?? 0 },
        ),
      };
    },

    restore(snapshot, context) {
      adopt(context);
      if (snapshot.key !== key) return false;
      if (snapshot.baselines.length !== states.length) return false;

      snapshot.baselines.forEach((entry, index) => {
        const state = states[index];
        if (!entry || !Number.isFinite(entry.cents)) return;
        state.saved = entry.cents;
        state.savedAt = entry.at;
      });
      return true;
    },

    reset,
  };
}
