/**
 * The channel strip — what every console channel has before anything is inserted
 * into it.
 *
 * Pure: settings, ranges and a total clamp. No Web Audio, so it compiles with
 * `npx tsc --outDir <tmp> --module commonjs` and is checked from plain Node like
 * the rest of `lib/`.
 *
 * ---------------------------------------------------------------------------
 * Why this is separate from the insert, and why that separation is the whole
 * point.
 *
 * A desk channel today is `insert: Instrument | null` — a whole rig chain, or
 * nothing at all. That is fine for eight strips carrying one guitar and is the
 * ceiling on everything else: an instrument rack is a cabinet convolution, an
 * oversampled waveshaper and **two AudioWorklet processors**, so thirty-two
 * channels of it is sixty-four worklets on one render thread. This app has already
 * watched an output stream give up under six chains at a small buffer; sixty-four
 * is not a tuning problem, it is a different order of magnitude.
 *
 * So the strip is deliberately built out of the cheap primitives — biquads and a
 * native `DynamicsCompressorNode`, both hand-optimised C++ inside the browser — and
 * the expensive rack stays what it is: an insert, on the few channels that want an
 * instrument's voice rather than a channel's shaping. Five biquads across
 * thirty-two channels is a hundred and sixty biquads, which is nothing.
 *
 * **There is deliberately no gate here**, and that is the sharpest consequence of
 * the split. Web Audio has no native gate — `DynamicsCompressorNode` only
 * compresses — so a per-channel gate would have to be the worklet the racks already
 * use, which is exactly the cost this file exists to avoid. It is also the mistake
 * AGENTS.md names in another form: the racks that need gating (drums, vocals) have
 * a proper hysteresis gate already, and adding a second one is two chains on one
 * signal. A channel that needs a gate gets the rack that has one.
 * ---------------------------------------------------------------------------
 */

export interface ChannelStrip {
  /**
   * Polarity invert, before everything.
   *
   * One line of DSP (a gain of −1) and the reason multi-mic sources are possible at
   * all: two mics on one drum at different distances partially cancel, and no EQ
   * afterwards recovers what the cancellation removed. Its own control rather than
   * a negative trim, because it is not a level.
   */
  invert: boolean;
  /**
   * Low cut. On every live channel, and the first thing an engineer reaches for.
   *
   * Stage rumble, handling noise and a floor's worth of sub content sit under
   * everything and are pure headroom loss — nothing above 80 Hz on a vocal mic is
   * the singer.
   */
  hpf: { enabled: boolean; hz: number };
  /**
   * Four bands: two shelves and two sweepable peaks.
   *
   * The mids sweep because a fixed mid is a guess about where the problem is, and
   * on a live channel the problem moves with the room, the mic and the player.
   * Shelves at the ends do not need to sweep — there is only one direction left to
   * go by the time you are there.
   */
  eq: {
    lowDb: number;
    lowMidHz: number;
    lowMidDb: number;
    highMidHz: number;
    highMidDb: number;
    highDb: number;
  };
  /**
   * Native compressor. Threshold, ratio, and the two times.
   *
   * `DynamicsCompressorNode`, not the rack's worklet — see the note at the top.
   * Switched off it is neutralised in place at ratio 1 rather than removed, which
   * is the same rule the amp's compressor follows and is what keeps a rebuild out
   * of a switch.
   */
  comp: {
    enabled: boolean;
    thresholdDb: number;
    ratio: number;
    attack: number;
    release: number;
  };
  /**
   * Alignment delay, in milliseconds.
   *
   * For time-aligning microphones at different distances from one source — a
   * millisecond is a foot of air. **Not** a monitor delay and not an effect: the
   * range stops at 50 ms because anything beyond that is not alignment, it is a
   * slap, and this sits on a monitor path where every millisecond is already paid
   * for once by the 30 ms buffer.
   */
  delayMs: number;
}

export const DEFAULT_STRIP: ChannelStrip = {
  invert: false,
  // On, at 30 Hz. Not off: an unfiltered channel is the wrong default on a desk,
  // and 30 Hz is below the fundamental of every instrument here — a bass low B is
  // 31 Hz — so it removes only what nothing is using.
  hpf: { enabled: true, hz: 30 },
  eq: {
    lowDb: 0,
    lowMidHz: 250,
    lowMidDb: 0,
    highMidHz: 2500,
    highMidDb: 0,
    highDb: 0,
  },
  comp: { enabled: false, thresholdDb: -18, ratio: 3, attack: 0.01, release: 0.15 },
  delayMs: 0,
};

/**
 * Inclusive bounds for every numeric field.
 *
 * Exported so the ranges live in one place: `clampStrip` enforces them, the UI
 * draws them, and — as with `AMP_RANGES` — anything that eventually describes this
 * to a model generates its text from here rather than restating it and drifting.
 */
export const STRIP_RANGES = {
  hpfHz: [20, 400],
  lowDb: [-15, 15],
  lowMidHz: [80, 1000],
  lowMidDb: [-15, 15],
  highMidHz: [800, 8000],
  highMidDb: [-15, 15],
  highDb: [-15, 15],
  thresholdDb: [-60, 0],
  ratio: [1, 20],
  attack: [0.001, 0.2],
  release: [0.02, 1],
  delayMs: [0, 50],
} as const satisfies Record<string, readonly [number, number]>;

export type StripRangeKey = keyof typeof STRIP_RANGES;

/**
 * Where the two shelves turn over.
 *
 * Named constants because the graph and the graph-builder both need them, and a
 * curve drawn at 100 Hz for a shelf built at 120 is a picture of something else.
 */
export const LOW_SHELF_HZ = 120;
export const HIGH_SHELF_HZ = 8000;

/** Q for both shelves. Gentle — a resonant shelf is a peak with extra steps. */
export const SHELF_Q = 0.7;

/**
 * Q for the two sweepable peaks.
 *
 * Wide enough to be musical and narrow enough to find a resonance. A console's
 * mid Q is usually around 1; anything much higher belongs to a notch filter,
 * which is a different tool with a different job.
 */
export const PEAK_Q = 1.1;

/* --------------------------------------------------------------------------
   Clamping
-------------------------------------------------------------------------- */

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function num(key: StripRangeKey, value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const [min, max] = STRIP_RANGES[key];
  return Math.min(max, Math.max(min, value));
}

/**
 * Bring any untrusted object into range. Total, on purpose.
 *
 * Same contract as `clampAmp`, and for the same reasons: this sits between the
 * graph and everything that is not this app — a stored scene, a preset written by
 * an older version, eventually a model's reply. **Never throws, never returns a
 * partial object, falls back per field.** A single bad number must cost that one
 * field, not the channel.
 */
export function clampStrip(input: unknown, base: ChannelStrip = DEFAULT_STRIP): ChannelStrip {
  const raw = record(input);
  const hpf = record(raw.hpf);
  const eq = record(raw.eq);
  const comp = record(raw.comp);

  return {
    invert: bool(raw.invert, base.invert),
    hpf: {
      enabled: bool(hpf.enabled, base.hpf.enabled),
      hz: num('hpfHz', hpf.hz, base.hpf.hz),
    },
    eq: {
      lowDb: num('lowDb', eq.lowDb, base.eq.lowDb),
      lowMidHz: num('lowMidHz', eq.lowMidHz, base.eq.lowMidHz),
      lowMidDb: num('lowMidDb', eq.lowMidDb, base.eq.lowMidDb),
      highMidHz: num('highMidHz', eq.highMidHz, base.eq.highMidHz),
      highMidDb: num('highMidDb', eq.highMidDb, base.eq.highMidDb),
      highDb: num('highDb', eq.highDb, base.eq.highDb),
    },
    comp: {
      enabled: bool(comp.enabled, base.comp.enabled),
      thresholdDb: num('thresholdDb', comp.thresholdDb, base.comp.thresholdDb),
      ratio: num('ratio', comp.ratio, base.comp.ratio),
      attack: num('attack', comp.attack, base.comp.attack),
      release: num('release', comp.release, base.comp.release),
    },
    delayMs: num('delayMs', raw.delayMs, base.delayMs),
  };
}

/* --------------------------------------------------------------------------
   What the graph needs to know
-------------------------------------------------------------------------- */

/**
 * Whether a strip change needs new nodes.
 *
 * **It never does, and that is a promise this function exists to keep.** Every
 * field above is an `AudioParam` or a settable property: the HPF and the EQ are
 * biquads, the compressor is neutralised at ratio 1 rather than unhooked, the
 * polarity is a gain of ±1, and the delay is a `DelayNode`'s `delayTime`. A fader
 * drag at 60 fps that rebuilt a graph would click on every frame, which is the rule
 * `needsRebuild` already enforces for the desk.
 *
 * Returning a constant looks like a function that should not exist. It is here so
 * that the day someone adds a field that *does* need nodes, they have to come and
 * change this — and the checks below will tell them the promise broke.
 */
export function stripNeedsRebuild(): false {
  return false;
}

/**
 * The strip's filters, as a cascade anything can measure.
 *
 * The point is that there is **one** description. `mixGraph` builds the nodes from
 * the same numbers a graph plots the curve from, so the picture cannot drift from
 * the sound — the failure this codebase has already met twice as two answers to one
 * question, in `deskOwnsSound` and in the rig row's carrier line.
 *
 * The compressor is not here and cannot be: its curve is a level map, not a
 * frequency one, and drawing it on the same axes would be a different measurement
 * wearing this one's clothes. Nor is the delay, for the same reason — it moves
 * phase, and this is a magnitude plot.
 *
 * A disabled low cut is emitted at the bottom of its own range rather than dropped,
 * exactly as `applyStrip` writes it, so the plotted cascade has the same number of
 * sections whatever is switched on.
 */
export function stripSections(strip: ChannelStrip): {
  type: 'highpass' | 'lowshelf' | 'peaking' | 'highshelf';
  frequency: number;
  q: number;
  gainDb?: number;
}[] {
  return [
    {
      type: 'highpass',
      frequency: strip.hpf.enabled ? strip.hpf.hz : STRIP_RANGES.hpfHz[0],
      q: SHELF_Q,
    },
    { type: 'lowshelf', frequency: LOW_SHELF_HZ, q: SHELF_Q, gainDb: strip.eq.lowDb },
    { type: 'peaking', frequency: strip.eq.lowMidHz, q: PEAK_Q, gainDb: strip.eq.lowMidDb },
    { type: 'peaking', frequency: strip.eq.highMidHz, q: PEAK_Q, gainDb: strip.eq.highMidDb },
    { type: 'highshelf', frequency: HIGH_SHELF_HZ, q: SHELF_Q, gainDb: strip.eq.highDb },
  ];
}

/**
 * Whether a strip is doing anything at all.
 *
 * Lets the graph skip building the nodes for a channel nobody has touched, and lets
 * the UI show a strip as inert rather than drawing six controls at zero and letting
 * the player wonder which of them is the one doing nothing. The HPF is not counted:
 * it is on by default at 30 Hz, so counting it would make every channel look busy.
 */
export function isStripActive(strip: ChannelStrip): boolean {
  if (strip.invert) return true;
  if (strip.hpf.enabled && strip.hpf.hz > DEFAULT_STRIP.hpf.hz) return true;
  if (strip.comp.enabled) return true;
  if (strip.delayMs > 0) return true;
  return (
    strip.eq.lowDb !== 0 ||
    strip.eq.lowMidDb !== 0 ||
    strip.eq.highMidDb !== 0 ||
    strip.eq.highDb !== 0
  );
}
