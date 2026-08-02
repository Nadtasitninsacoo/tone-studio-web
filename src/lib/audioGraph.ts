/**
 * Small helpers shared by the effect chains.
 *
 * Both racks are built once and driven by parameter changes rather than by
 * reconnecting nodes, and both have to work in a live context and in an offline
 * render. Those two facts produce the same two helpers each time, so they live
 * here rather than in whichever file needed them first.
 */

/** True for an `OfflineAudioContext`. */
export function isOfflineContext(ctx: BaseAudioContext): boolean {
  return 'startRendering' in ctx;
}

/**
 * A parameter setter appropriate to the context.
 *
 * Live contexts ramp, so a slider drag does not click. Offline renders must not:
 * a ramp there starts from the node's default and sweeps every control into
 * place across the first milliseconds of the export, which is both audible and
 * not what was on screen.
 */
export function makeParamSetter(ctx: BaseAudioContext): (param: AudioParam, value: number) => void {
  if (isOfflineContext(ctx)) {
    return (param, value) => {
      param.value = value;
    };
  }
  return (param, value) => param.setTargetAtTime(value, ctx.currentTime, 0.01);
}

/** Disconnect a whole chain, tolerating nodes that are already detached. */
export function disconnectAll(nodes: AudioNode[]): void {
  for (const node of nodes) {
    try {
      node.disconnect();
    } catch {
      // Disposal races are harmless — the context is going away regardless.
    }
  }
}

/**
 * Symmetric soft clip, normalised so the curve always spans ±1.
 *
 * `tanh` rather than a polynomial: its knee stays smooth at every drive amount,
 * where polynomial shapers turn brittle and buzzy as the gain climbs.
 *
 * `hardness` sets how far into saturation full amount pushes — a guitar wants a
 * lot, a finished mix wants very little.
 */
export function saturationCurve(amount: number, hardness: number, points = 2048): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(points);
  const k = 1 + amount * hardness;
  const normalise = Math.tanh(k);

  for (let i = 0; i < points; i += 1) {
    const x = (i / (points - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / normalise;
  }
  return curve;
}

/**
 * How far a unit of `bias` shifts the operating point.
 *
 * Chosen by measurement, not taste. Swept against an FFT at `amount` 0.8, `bias`
 * 0.22 — the 2nd harmonic relative to the fundamental, and the ratio between the
 * positive and negative clipping rails:
 *
 *   scale 1.5 -> 2nd −32.4 dB, rails 0.59
 *   scale 2.0 -> 2nd −30.0 dB, rails 0.50
 *   scale 2.5 -> 2nd −28.0 dB, rails 0.41   <- here
 *   scale 3.0 -> 2nd −26.4 dB, rails 0.35
 *   scale 4.0 -> 2nd −23.9 dB, rails 0.24
 *
 * 2.5 gives a valve-like −28 dB of 2nd harmonic while keeping the two rails within
 * about 2.4:1; beyond 3 the waveform is closer to half-wave rectified than to a
 * biased triode. The 3rd harmonic measured −9.8 dB at *every* setting, which is the
 * property that matters: bias adds even content without taking away the odd content
 * that makes a stage sound driven at all.
 */
const BIAS_SCALE = 2.5;

/**
 * Asymmetric soft clip — a valve gain stage rather than a clipping diode.
 *
 * This is the difference between "distortion pedal" and "amplifier", and it is not
 * a subtlety. A symmetric transfer curve produces **odd harmonics only** (3rd, 5th,
 * 7th), which is the hollow, buzzy character of a cheap fuzz. A triode clips the
 * two halves of the waveform by different amounts, and that asymmetry generates
 * **even harmonics** (2nd, 4th) — the octave-up warmth and "thickness" that makes a
 * valve amp sound expensive.
 *
 * `bias` offsets the operating point, so the positive half saturates earlier than
 * the negative. The DC that the offset introduces is removed by the DC blocker at
 * the head of the chain and again between stages; leaving it in would push every
 * later stage off its own operating point and eventually silence the signal.
 *
 * Cascading two or three of these with a lowpass between them is what a real
 * preamp does. One stage at very high gain cannot sound the same, because a single
 * curve applied once cannot produce the intermodulation between stages that gives
 * a high-gain amp its density.
 */
export function tubeCurve(
  amount: number,
  hardness: number,
  bias = 0.18,
  points = 2048,
): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(points);
  const k = 1 + amount * hardness;

  /**
   * The offset is applied **after** the gain, not as a gain difference between the
   * two halves.
   *
   * The first version of this gave the positive half more gain, reasoning that it
   * would therefore round over first. Measured with an FFT, the 2nd harmonic came
   * out at −46.7 dB — effectively absent. The reason is that at any useful drive
   * setting `k` is large enough that *both* halves saturate completely, and a
   * fully-clipped waveform is symmetric again no matter how the two halves were
   * scaled on the way in. Asymmetric gain only bends the knee, and the knee is
   * where the signal is not.
   *
   * A valve is biased: the grid sits at a fixed offset, so the waveform is shifted
   * *into* one clipping rail and away from the other. The two halves then limit at
   * genuinely different amplitudes, which survives at any drive setting.
   *
   * The shift is specified post-gain so raising drive does not also swing the bias
   * — otherwise a high-gain setting degenerates into half-wave rectification.
   */
  const shift = bias * amount * BIAS_SCALE;

  // Subtracting the value at x = 0 keeps the curve through the origin, so the
  // shaper does not inject a DC step of its own. The residual asymmetry in the
  // peaks is the point and is what the DC blockers downstream are there for.
  const dc = Math.tanh(shift);
  const high = Math.tanh(k + shift) - dc;
  const low = Math.tanh(-k + shift) - dc;
  const normalise = Math.max(Math.abs(high), Math.abs(low), 1e-6);

  for (let i = 0; i < points; i += 1) {
    const x = (i / (points - 1)) * 2 - 1;
    curve[i] = (Math.tanh(k * x + shift) - dc) / normalise;
  }
  return curve;
}

