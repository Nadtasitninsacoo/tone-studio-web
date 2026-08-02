/**
 * Measuring what a filter actually does, instead of drawing what it should.
 *
 * ---------------------------------------------------------------------------
 * The DSP panel's crossover curve was computed from the textbook Linkwitz-Riley
 * expression, `-20·log₁₀(1 + (f/fc)⁴)`. That expression is correct — it gives exactly
 * −6.02 dB at the corner, which is what an LR4 does — and it is still not the same thing
 * as the filter in the signal path.
 *
 * A `BiquadFilterNode` is a **digital** filter. Its coefficients come from the bilinear
 * transform, which warps the frequency axis: the response is squeezed as it approaches
 * Nyquist, so a real biquad and its analogue prototype diverge in the top octave, and by
 * how much depends on the sample rate. A graph drawn from the ideal expression is a graph
 * of a filter this app does not contain, and it cannot be wrong in a way anyone would
 * notice — which is exactly what makes it worth replacing.
 *
 * `getFrequencyResponse` is the browser answering for its own implementation, at the
 * sample rate in use, including that warping. It also returns **phase**, which is what
 * makes an honest phase graph possible at all: the panel's phase curves were drawn from
 * numbers that were never connected to anything.
 *
 * The measurement nodes are built on a throwaway `OfflineAudioContext` and never
 * connected. Nothing here touches the audio path, so this cannot affect the sound — which
 * is the point of measuring this way rather than tapping the live graph.
 * ---------------------------------------------------------------------------
 */

/** One band's measured response over the plotted frequency axis. */
export interface BandResponse {
  /** The frequencies measured at, in Hz. Shared by both arrays. */
  frequencies: Float32Array<ArrayBuffer>;
  /** Magnitude in dB, one per frequency. */
  magnitudeDb: Float32Array<ArrayBuffer>;
  /** Phase in degrees, one per frequency. */
  phaseDeg: Float32Array<ArrayBuffer>;
}

/** A cascade to measure: each entry is one biquad section. */
export interface Section {
  type: BiquadFilterType;
  frequency: number;
  q: number;
  gainDb?: number;
}

/**
 * Log-spaced frequency axis, matching what the graphs plot.
 *
 * `Float32Array<ArrayBuffer>`, not the default `ArrayBufferLike`.
 *
 * `getFrequencyResponse` will not accept a view that might be backed by a
 * `SharedArrayBuffer`, and the same pin appears on the recorder's analyser buffers for the
 * same reason. Left off, this compiles everywhere except where it is used.
 */
export function logFrequencies(fMin: number, fMax: number, count: number): Float32Array<ArrayBuffer> {
  /**
   * Floored, and that is not defensive tidiness.
   *
   * Callers size this from a canvas, and `getBoundingClientRect().width` is fractional —
   * 396.5 on the display this was written on. `new Float32Array(n)` would have quietly
   * truncated; sizing the buffer explicitly does not, and `new ArrayBuffer(396.5 * 4)` is
   * 1586 bytes, which is not a multiple of 4, which is a `RangeError` at the first paint.
   *
   * Two, at minimum: the interpolation below divides by `n - 1`.
   */
  const n = Math.max(2, Math.floor(count));
  const out = new Float32Array(new ArrayBuffer(n * 4));
  const logMin = Math.log10(fMin);
  const logMax = Math.log10(fMax);
  for (let i = 0; i < n; i += 1) {
    out[i] = 10 ** (logMin + ((logMax - logMin) * i) / (n - 1));
  }
  return out;
}

/**
 * Measure a cascade of biquads.
 *
 * Cascading is multiplication of complex responses, which is addition in dB and addition
 * in phase — so the sections are summed rather than combined pairwise. That is also why an
 * LR4 is two identical Butterworth sections: the magnitudes add to −6 dB at the corner
 * where one alone would give −3.
 *
 * Returns null when there is no browser to ask. Callers draw nothing rather than falling
 * back to a formula, because a curve that silently changes meaning is worse than no curve.
 */
export function measureCascade(
  sections: readonly Section[],
  frequencies: Float32Array<ArrayBuffer>,
  sampleRate: number,
): BandResponse | null {
  if (typeof window === 'undefined' || typeof OfflineAudioContext === 'undefined') return null;
  if (sections.length === 0) return null;

  try {
    // One frame, one channel: nothing is rendered, the context exists only so the nodes
    // can be constructed and asked about themselves.
    const ctx = new OfflineAudioContext(1, 1, sampleRate);
    const bytes = frequencies.length * 4;
    const magnitudeDb = new Float32Array(new ArrayBuffer(bytes));
    const phaseDeg = new Float32Array(new ArrayBuffer(bytes));

    const mag = new Float32Array(new ArrayBuffer(bytes));
    const phase = new Float32Array(new ArrayBuffer(bytes));

    for (const section of sections) {
      const filter = ctx.createBiquadFilter();
      filter.type = section.type;
      filter.frequency.value = section.frequency;
      filter.Q.value = section.q;
      if (section.gainDb !== undefined) filter.gain.value = section.gainDb;
      filter.getFrequencyResponse(frequencies, mag, phase);

      for (let i = 0; i < frequencies.length; i += 1) {
        // `mag` is linear magnitude. Guarded because a response can reach exactly zero and
        // log10(0) is -Infinity, which would take the whole path off the canvas.
        magnitudeDb[i] += 20 * Math.log10(Math.max(mag[i], 1e-7));
        phaseDeg[i] += (phase[i] * 180) / Math.PI;
      }
    }

    return { frequencies, magnitudeDb, phaseDeg };
  } catch {
    // A browser without OfflineAudioContext, or one refusing this sample rate. Same answer
    // as no browser: draw nothing.
    return null;
  }
}

/**
 * The bass rig's crossover, exactly as `lib/bassFx.ts` builds it.
 *
 * Two sections per band at `Q = 1/√2`, which is what makes it Linkwitz-Riley rather than
 * Butterworth — and the reason is recorded in `AGENTS.md`: a single lowpass plus a single
 * highpass at one corner sums to a **null** there, verified rather than theoretical. If
 * `crossoverBand` ever changes, this has to change with it, and the graph is then the thing
 * that shows it did.
 */
export function crossoverSections(
  crossoverHz: number,
  band: 'low' | 'high',
): Section[] {
  const type: BiquadFilterType = band === 'low' ? 'lowpass' : 'highpass';
  return [
    { type, frequency: crossoverHz, q: Math.SQRT1_2 },
    { type, frequency: crossoverHz, q: Math.SQRT1_2 },
  ];
}
