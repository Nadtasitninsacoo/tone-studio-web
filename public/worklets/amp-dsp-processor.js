/**
 * amp-dsp-processor.js — the two things Web Audio has no node for.
 *
 * Both run on the real-time audio render thread. This is the one place in this app
 * where hand-written DSP is the right answer rather than a native node: everything
 * else in the amp chain (biquads, oversampled waveshaping, convolution) is already
 * implemented in optimised C++ inside the browser, and no hand-rolled version —
 * JavaScript or WebAssembly — would beat `ConvolverNode` at its own job. A
 * look-ahead limiter and a hysteresis gate simply do not exist as nodes.
 *
 * Two processors are registered from one module so the chain needs a single
 * `addModule` call.
 *
 *   gate-processor     -> before the gain stages
 *   limiter-processor  -> last thing before the output
 *
 * Protocol (worklet -> main thread), both processors, ~20/sec:
 *   { type: 'meter', reductionDb: number, open?: boolean }
 */

/** How often to report state upward. 1024 frames ≈ 21 ms at 48 kHz. */
const METER_INTERVAL = 1024;

/** Linear gain from dB, guarding against -Infinity. */
function fromDb(db) {
  return db <= -120 ? 0 : Math.pow(10, db / 20);
}

/**
 * One-pole smoothing coefficient for a given time constant.
 *
 * The standard `exp(-1 / (seconds * rate))` form. A coefficient rather than a
 * per-sample division keeps the inner loops free of transcendentals.
 */
function coefficient(seconds, sampleRate) {
  if (seconds <= 0) return 0;
  return Math.exp(-1 / Math.max(1, seconds * sampleRate));
}

/**
 * GateProcessor — a noise gate with hysteresis and a hold time.
 *
 * High gain amplifies the noise floor as much as the guitar, so a gate is not a
 * luxury once there are cascaded gain stages: without one, silence between phrases
 * is a wall of hiss at the same level as the quiet notes.
 *
 * Two details that separate a usable gate from a chattering one:
 *
 * 1. **Hysteresis.** It opens at `threshold` but only closes at `threshold - 6 dB`.
 *    A single threshold makes the gate stutter on and off through the decay of
 *    every note that happens to sit near it.
 * 2. **Hold.** Once open it stays open for a minimum time. Guitar signal crosses
 *    zero constantly; a gate that reacts to the instantaneous envelope alone
 *    chops the waveform into fragments and sounds like a broken cable.
 */
class GateProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'threshold', defaultValue: -55, minValue: -100, maxValue: 0, automationRate: 'k-rate' },
      { name: 'enabled', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    /** Envelope follower state, one per channel, tracked as a shared maximum. */
    this.envelope = 0;
    /** Current gate gain, smoothed. */
    this.gain = 0;
    /** Frames remaining on the hold timer. */
    this.hold = 0;
    this.sinceReport = 0;

    // 1 ms attack: fast enough that a pick attack is never softened. 120 ms
    // release so a note's tail fades out rather than being cut off.
    this.attackCoefficient = coefficient(0.001, sampleRate);
    this.releaseCoefficient = coefficient(0.12, sampleRate);
    this.envelopeCoefficient = coefficient(0.004, sampleRate);
    // 150 ms hold. Guitar signal crosses zero constantly, so the hold — not the
    // envelope — is what stops the gate reacting per waveform cycle. Short enough
    // that a fast palm-muted passage is not held open between notes.
    this.holdFrames = Math.floor(0.15 * sampleRate);
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0) return true;

    const enabled = parameters.enabled[0] >= 0.5;
    const openAt = fromDb(parameters.threshold[0]);
    // The hysteresis window. 6 dB is wide enough to stop chatter without making
    // the gate feel like it is hanging open.
    const closeAt = openAt * 0.501;
    const frames = input[0].length;

    for (let i = 0; i < frames; i += 1) {
      // Peak across channels, so a gate never opens for one side only and pans
      // the noise floor.
      let peak = 0;
      for (let c = 0; c < input.length; c += 1) {
        const magnitude = Math.abs(input[c][i]);
        if (magnitude > peak) peak = magnitude;
      }

      // Rectified peak with a fast release — tracks the note envelope, not the
      // waveform.
      this.envelope =
        peak > this.envelope
          ? peak
          : this.envelope * this.envelopeCoefficient + peak * (1 - this.envelopeCoefficient);

      if (this.envelope >= openAt) this.hold = this.holdFrames;
      else if (this.hold > 0) this.hold -= 1;

      const shouldBeOpen = this.hold > 0 || this.envelope >= closeAt;

      if (!enabled) {
        // Bypass has to be bit-exact, not a 1 ms fade up from wherever the gain
        // happened to be. Measured: smoothing toward 1 here left the first
        // millisecond of a bypassed signal attenuated by up to 3.7e-3.
        this.gain = 1;
      } else {
        const target = shouldBeOpen ? 1 : 0;
        const c = target > this.gain ? this.attackCoefficient : this.releaseCoefficient;
        this.gain = target + (this.gain - target) * c;
      }

      for (let ch = 0; ch < output.length; ch += 1) {
        const source = input[Math.min(ch, input.length - 1)];
        output[ch][i] = source[i] * this.gain;
      }
    }

    this.sinceReport += frames;
    if (this.sinceReport >= METER_INTERVAL) {
      this.sinceReport = 0;
      this.port.postMessage({
        type: 'meter',
        reductionDb: this.gain > 0.0001 ? 20 * Math.log10(this.gain) : -80,
        open: this.gain > 0.5,
      });
    }

    return true;
  }
}

/**
 * LimiterProcessor — a look-ahead brickwall limiter.
 *
 * This is what makes "turn it up without it breaking up" a solvable problem rather
 * than a wish. A compressor cannot do it: it reacts *after* a peak has arrived, so
 * the transient that caused the gain reduction has already gone out of the output
 * clipped. A limiter with look-ahead delays the signal by a few milliseconds and
 * computes the gain from the future, so the gain is already down by the time the
 * peak reaches the output. Nothing ever exceeds the ceiling, and no clipping
 * distortion is produced at all.
 *
 * Web Audio has no such node. `DynamicsCompressor` has a fixed internal
 * look-ahead it does not expose, a soft knee that cannot be flattened, and no
 * guaranteed ceiling — it is a compressor, and using it as a limiter is how output
 * stages end up clipping on the loudest chord.
 *
 * Design notes:
 *
 * - The gain envelope is computed from the **maximum peak inside the look-ahead
 *   window**, tracked with a sliding maximum, not from the delayed sample.
 * - Attack is not a coefficient but a linear ramp over the whole look-ahead
 *   window, so the gain reaches its target exactly as the peak arrives. Slower and
 *   it clips; faster and it audibly ducks ahead of the note.
 * - Release is program-dependent: a short stage recovers quickly for articulation,
 *   a long stage prevents pumping on sustained chords. Two-stage release is what
 *   keeps a limiter transparent when it is working hard.
 * - A hard clamp guards the ceiling after all the smoothing. It should never
 *   engage; if the maths is right it is dead code, and it costs one comparison to
 *   be certain rather than hopeful.
 */
class LimiterProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'ceiling', defaultValue: -0.3, minValue: -24, maxValue: 0, automationRate: 'k-rate' },
      { name: 'enabled', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    /** 3 ms. Long enough to catch a pick attack, short enough not to smear timing. */
    this.lookahead = Math.max(8, Math.floor(0.003 * sampleRate));
    this.channels = 2;
    this.delay = [new Float32Array(this.lookahead), new Float32Array(this.lookahead)];
    /** Sliding-maximum window over the same span as the delay. */
    this.window = new Float32Array(this.lookahead);
    this.cursor = 0;

    /**
     * Scratch for the delayed sample of each channel.
     *
     * Preallocated because this is read once per *sample*. The first version
     * allocated a fresh array here — 48,000 allocations per second, on the
     * real-time render thread, where a garbage collection pause is a dropout. The
     * one place in this file where an allocation is genuinely forbidden.
     */
    this.delayed = new Float32Array(8);

    /**
     * Monotonic deque of absolute sample indices, values decreasing.
     *
     * This replaces a full rescan of the window per sample — 144 comparisons at
     * 48 kHz, 6.9 M/second, which the original comment dismissed as "not where the
     * time goes". It is O(1) amortised and produces the identical sliding maximum;
     * verified against the scan on random and worst-case input.
     *
     * Capacity is the window **plus two**, and both are load-bearing. The deque
     * holds at most `size` positions, but a sample is pushed *before* the
     * expired front is dropped, so it briefly holds `size + 1`; a ring can only
     * distinguish `capacity - 1` entries from empty. At `size + 1` the deque
     * wrapped exactly onto its own head on a falling signal and reported the
     * newest sample as the window maximum instead of the oldest — caught by
     * comparing against the rescan it replaces, not by reading the code.
     *
     * `Float64Array`, not `Int32Array`: these are absolute sample positions, and
     * an int32 overflows after 12 hours of audio at 48 kHz. A double holds them
     * exactly for longer than the hardware will last.
     */
    this.deque = new Float64Array(this.lookahead + 2);
    this.dequeHead = 0;
    this.dequeTail = 0;
    /** Absolute sample counter, for window membership. */
    this.position = 0;

    this.gain = 1;
    this.fastRelease = coefficient(0.05, sampleRate);
    this.slowRelease = coefficient(0.35, sampleRate);
    /** Slow-stage gain, which trails the fast stage and sets the floor. */
    this.slowGain = 1;

    this.maxReduction = 0;
    this.sinceReport = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0) return true;

    const enabled = parameters.enabled[0] >= 0.5;
    const ceiling = fromDb(parameters.ceiling[0]);
    const frames = input[0].length;
    const outChannels = output.length;
    const window = this.window;
    const size = this.lookahead;

    for (let i = 0; i < frames; i += 1) {
      // Peak of the incoming frame across channels.
      let peak = 0;
      for (let c = 0; c < input.length; c += 1) {
        const magnitude = Math.abs(input[c][i]);
        if (magnitude > peak) peak = magnitude;
      }

      // Write into the ring buffers, read out what is `lookahead` frames old.
      const cursor = this.cursor;
      const delayed = this.delayed;
      const channels = Math.min(outChannels, delayed.length);
      for (let ch = 0; ch < channels; ch += 1) {
        const source = input[Math.min(ch, input.length - 1)];
        if (!this.delay[ch]) this.delay[ch] = new Float32Array(size);
        delayed[ch] = this.delay[ch][cursor];
        this.delay[ch][cursor] = source[i];
      }
      window[cursor] = peak;
      this.cursor = (cursor + 1) % size;

      // ---- Sliding maximum over the look-ahead window --------------------
      // Monotonic deque: drop anything at the back that this sample dominates
      // (it can never be the maximum again while this one is in the window),
      // push this sample, then drop the front if it has aged out.
      const position = this.position;
      const deque = this.deque;
      const capacity = deque.length;

      while (this.dequeTail !== this.dequeHead) {
        const back = deque[(this.dequeTail - 1 + capacity) % capacity];
        if (window[back % size] > peak) break;
        this.dequeTail = (this.dequeTail - 1 + capacity) % capacity;
      }
      deque[this.dequeTail] = position;
      this.dequeTail = (this.dequeTail + 1) % capacity;

      const oldest = position - size + 1;
      while (this.dequeTail !== this.dequeHead && deque[this.dequeHead] < oldest) {
        this.dequeHead = (this.dequeHead + 1) % capacity;
      }
      this.position = position + 1;

      const windowPeak = window[deque[this.dequeHead] % size];

      // Target gain: exactly enough to bring the loudest coming peak to the
      // ceiling, never above unity.
      const target = windowPeak > ceiling ? ceiling / windowPeak : 1;

      if (target < this.gain) {
        // Attack: ramp linearly so the gain arrives with the peak, not after it.
        this.gain -= Math.min(this.gain - target, (1 - target) / size + 1e-6);
        this.slowGain = Math.min(this.slowGain, this.gain);
      } else {
        // Two-stage release. The slow stage trails and clamps the fast one, which
        // is what stops a busy passage from pumping.
        this.gain = target + (this.gain - target) * this.fastRelease;
        this.slowGain = target + (this.slowGain - target) * this.slowRelease;
        if (this.slowGain < this.gain) this.gain = this.slowGain;
      }

      const applied = enabled ? this.gain : 1;
      if (applied < 1 - this.maxReduction) this.maxReduction = 1 - applied;

      // Bounded by the same count that was written above, so a hypothetical
      // >8-channel output can never read past the scratch buffer and emit NaN.
      for (let ch = 0; ch < channels; ch += 1) {
        let value = delayed[ch] * applied;
        // Belt and braces on the ceiling. Should never fire.
        if (enabled) {
          if (value > ceiling) value = ceiling;
          else if (value < -ceiling) value = -ceiling;
        }
        output[ch][i] = value;
      }
    }

    this.sinceReport += frames;
    if (this.sinceReport >= METER_INTERVAL) {
      this.sinceReport = 0;
      const reduction = this.maxReduction;
      this.maxReduction = 0;
      this.port.postMessage({
        type: 'meter',
        reductionDb: reduction > 0 ? 20 * Math.log10(Math.max(1 - reduction, 1e-6)) : 0,
      });
    }

    return true;
  }
}

registerProcessor('gate-processor', GateProcessor);
registerProcessor('limiter-processor', LimiterProcessor);
