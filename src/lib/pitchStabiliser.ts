/**
 * Turning a stream of pitch measurements into a needle that can be read.
 *
 * Pure, stateful, no Web Audio: it takes what `lib/tuner.ts` measured and decides
 * what to display. Kept separate because the two answer different questions —
 * `detectPitch` answers "what frequency is in this window", and nothing here can
 * make a wrong measurement right. This file answers "what should the display say
 * now", which is a question about time, not about signal.
 *
 * ---------------------------------------------------------------------------
 * Three problems, none of which is solved by measuring more accurately.
 *
 * 1. **Pitch glide on the attack.** A freshly plucked string is measurably sharp
 *    for the first several tens of milliseconds. This is not detector error: the
 *    string genuinely is sharp, because its amplitude is large, the excursion
 *    stretches it, and tension sets pitch. The effect is 5–30 cents on a wound
 *    low string and dies away as the note settles. A tuner that displays the
 *    first reading after the pick therefore tells you to flatten a string that is
 *    already in tune. **Every reading inside the attack window is discarded.**
 *
 * 2. **Measurement noise.** Consecutive windows of the same note disagree by a
 *    fraction of a cent on a clean input and by several on a microphone. Averaging
 *    fixes it and adds lag; not averaging leaves a needle that will not settle.
 *
 * 3. **Genuine change.** While a peg is being turned the pitch really is moving,
 *    sometimes fast, and any smoothing tuned for problem 2 will lag behind it —
 *    which is exactly the moment the display has to be responsive.
 *
 * Problems 2 and 3 pull in opposite directions, and the resolution is that they
 * are distinguishable: noise is small and unbiased, a peg turn is large and
 * sustained. That is precisely the situation a **Kalman filter** is for, so the
 * smoothing is one — a scalar filter over pitch in cents, whose measurement
 * variance comes from the detector's own clarity and whose process variance says
 * how fast a peg can move. When measurements agree it trusts its model and the
 * needle is steady; when they disagree with the model consistently, the gain
 * rises and it follows.
 * ---------------------------------------------------------------------------
 */

import { medianHz, type Pitch } from './tuner';

/**
 * How long after an onset readings are thrown away, in ms.
 *
 * 70 ms. Long enough to cover the glide on a wound low string, short enough that
 * the needle still appears to respond to the pick rather than to the note.
 */
const ATTACK_MS = 70;

/** No reading for this long and the tracker goes idle, forgetting its state. */
const RELEASE_MS = 900;

/** A level jump this large means a new note, not the same one getting louder. */
const ONSET_RATIO = 2.2;

/** Readings the median runs over, before the filter sees them. */
const MEDIAN_SPAN = 5;

/**
 * Process noise, in cents² per update.
 *
 * How much the filter believes the pitch can drift between readings while nobody
 * is touching the peg. Small, because it should not: a string that is left alone
 * holds its pitch, so almost all the frame-to-frame variation is measurement
 * noise and should be smoothed away.
 *
 * Solving the steady-state recursion for this and `BASE_MEASUREMENT_VARIANCE`
 * gives a resting variance of 0.75 cents² and a Kalman gain of 0.25 — i.e. a
 * settled needle moves a quarter of the way toward each new reading. Raising this
 * to 4 (the first value tried) put the resting variance at 1.16, which never
 * crossed the "stable" threshold and left ±4 cents of input jitter showing as
 * 1.2 cents of needle movement.
 */
const PROCESS_VARIANCE = 0.25;

/**
 * Measurement noise at perfect clarity, in cents².
 *
 * The floor of the trust model. Measured on synthetic tones the detector is good
 * to ±0.02 cents, so this is far more pessimistic than the arithmetic — because
 * on a real instrument the *string* is not that stable, and a filter that trusts
 * each measurement completely reproduces the string's own wobble on the display.
 */
const BASE_MEASUREMENT_VARIANCE = 3;

/**
 * Innovation above which the filter stops believing its own model, in cents.
 *
 * The gain above is deliberately slow, which on its own would take nine readings
 * to follow a peg turn. Rather than compromise the resting steadiness to fix
 * that, a disagreement this large temporarily inflates the predicted variance, so
 * the filter re-weights almost entirely onto the measurement and catches up in
 * one step.
 *
 * This is safe *because of the median in front of it*: a single wild reading
 * never reaches the filter, so an innovation this large has already been
 * corroborated by three of the last five windows and is a real move.
 *
 * 8 cents is above anything the median leaves behind and well below the smallest
 * peg movement anyone makes on purpose.
 */
const INNOVATION_LIMIT_CENTS = 8;

export type PitchPhase =
  /** Nothing being played. */
  | 'idle'
  /** A note has just started; readings are being discarded on purpose. */
  | 'attack'
  /** Following the note, not yet settled. */
  | 'tracking'
  /** Settled — the reading is not moving beyond the filter's own uncertainty. */
  | 'stable';

export interface StabilisedPitch {
  /** Filtered frequency in Hz, or 0 when there is nothing to show. */
  hz: number;
  phase: PitchPhase;
  /**
   * How much to trust the display, 0..1, from the filter's own variance.
   *
   * This is the honest version of a confidence readout: it comes out of the
   * estimator rather than being a restatement of the last measurement's clarity.
   */
  confidence: number;
  /** Raw detector clarity of the most recent accepted reading. */
  clarity: number;
  /** Last reading's RMS, for level display. */
  rms: number;
}

export interface PitchStabiliser {
  /**
   * Feed one detection cycle.
   *
   * `pitch` is null when the detector found nothing, which is normal and is how
   * silence is signalled. `rms` is passed separately because it is known even
   * when detection fails, and onset detection needs it.
   */
  push(pitch: Pitch | null, rms: number, now: number): StabilisedPitch;
  /** Current output without advancing anything. */
  read(): StabilisedPitch;
  reset(): void;
}

/** Cents relative to an arbitrary fixed reference, so the filter runs in a linear space. */
function toCents(hz: number): number {
  return 1200 * Math.log2(hz / 100);
}

function fromCents(cents: number): number {
  return 100 * 2 ** (cents / 1200);
}

export function createPitchStabiliser(): PitchStabiliser {
  let phase: PitchPhase = 'idle';
  /** Kalman state: pitch in cents, and its variance. */
  let estimate = 0;
  let variance = Infinity;
  let lastReadingAt = 0;
  let attackStartedAt = 0;
  let smoothedRms = 0;
  let clarity = 0;
  let rmsOut = 0;
  const history: number[] = [];

  const output = (): StabilisedPitch => ({
    hz: Number.isFinite(variance) && variance < Infinity && phase !== 'idle' ? fromCents(estimate) : 0,
    phase,
    // Mapped from the filter's variance: at 1 cent² of uncertainty the reading is
    // worth about half its full confidence, which is roughly where a needle stops
    // being worth acting on.
    confidence: Number.isFinite(variance) ? 1 / (1 + variance) : 0,
    clarity,
    rms: rmsOut,
  });

  const reset = () => {
    phase = 'idle';
    estimate = 0;
    variance = Infinity;
    smoothedRms = 0;
    clarity = 0;
    rmsOut = 0;
    history.length = 0;
  };

  return {
    push(pitch, rms, now) {
      rmsOut = rms;

      // ---- Onset ----------------------------------------------------------
      // A level jump means a new note. Crucially this is checked *before* the
      // reading is used: the whole point is to reject what comes next.
      const isOnset = rms > Math.max(smoothedRms * ONSET_RATIO, 1e-6) && rms > 1e-4;
      // Asymmetric follower: rises with the note, falls slowly, so the decay of
      // one note does not read as the onset of the next.
      smoothedRms += (rms - smoothedRms) * (rms > smoothedRms ? 0.6 : 0.05);

      if (isOnset) {
        attackStartedAt = now;
        phase = 'attack';
        // The previous note's state is worse than no state: it will drag the
        // filter across the interval between two different notes.
        history.length = 0;
        variance = Infinity;
      }

      if (!pitch) {
        if (now - lastReadingAt > RELEASE_MS) reset();
        return output();
      }

      lastReadingAt = now;
      clarity = pitch.clarity;

      // ---- Attack window --------------------------------------------------
      // Discarded, not smoothed. A sharp reading averaged in is still a sharp
      // reading, and this one is systematically sharp rather than noisy — the
      // average of a biased sample is biased.
      if (phase === 'attack') {
        if (now - attackStartedAt < ATTACK_MS) return output();
        phase = 'tracking';
      }
      if (phase === 'idle') phase = 'tracking';

      // ---- Median ---------------------------------------------------------
      // Ahead of the filter, because the Kalman step assumes Gaussian noise and
      // an octave slip is not noise — it is a wrong answer, and feeding one to a
      // linear filter drags the estimate a long way for a long time.
      history.push(pitch.hz);
      if (history.length > MEDIAN_SPAN) history.shift();
      const measured = toCents(medianHz(history));

      // ---- Kalman update --------------------------------------------------
      // Measurement variance from clarity: a reading the detector is unsure of
      // moves the estimate less. Squared so the penalty grows sharply as clarity
      // falls, since clarity below ~0.9 usually means more than one note.
      const uncertainty = 1 - Math.min(1, Math.max(0, pitch.clarity));
      const measurementVariance = BASE_MEASUREMENT_VARIANCE + 400 * uncertainty * uncertainty;

      if (!Number.isFinite(variance)) {
        // First reading of a note: adopt it rather than converging toward it from
        // a stale estimate.
        estimate = measured;
        variance = measurementVariance;
      } else {
        const innovation = measured - estimate;
        // See `INNOVATION_LIMIT_CENTS`. Adding the innovation's own magnitude
        // squared makes the response proportional: a 10-cent move is followed
        // briskly, a 100-cent one almost instantly.
        const surprise =
          Math.abs(innovation) > INNOVATION_LIMIT_CENTS ? innovation * innovation : 0;
        const predicted = variance + PROCESS_VARIANCE + surprise;
        const gain = predicted / (predicted + measurementVariance);
        estimate += gain * innovation;
        variance = (1 - gain) * predicted;
      }

      // Settled once the filter's own uncertainty is below the tolerance the
      // display cares about. Derived from the estimator, not from a timer.
      phase = variance < 1 ? 'stable' : 'tracking';
      return output();
    },
    read: output,
    reset,
  };
}
