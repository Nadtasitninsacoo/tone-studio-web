/**
 * Guitar cabinet simulation — synthesised impulse responses.
 *
 * Pure. No Web Audio, no DOM, so the response can be measured from Node with
 * `lib/fft.ts` rather than described in a comment and hoped for.
 *
 * ---------------------------------------------------------------------------
 * Why this is the single biggest thing missing from a USB guitar signal.
 *
 * A pedal's USB output is a **direct** signal. Nothing between the pickups and
 * the converter removes anything, so the capture contains the full 20 Hz–20 kHz
 * span of an electric guitar pickup — including the 6–16 kHz region that is pure
 * fizz, and the sub-80 Hz region that is pure cone-flap. That is what "thin and
 * harsh" actually means when someone plugs a modelling pedal straight into a
 * computer and dislikes the result.
 *
 * A real 12" guitar speaker in a closed cab is a violent bandpass. It is gone
 * below its cone resonance, gone above about 5–6 kHz, and has a strong presence
 * peak in the upper mids where a guitar's articulation lives. Convolving with that
 * response is not an effect — it is restoring the filter that every recorded
 * electric guitar in history was played through.
 *
 * These are **synthesised**, not measured. A measured IR from a real cabinet and
 * microphone would be better and there is no way to obtain one here without
 * shipping a binary asset. What is here is built from the documented behaviour of
 * a guitar speaker, and its magnitude response is asserted numerically — see the
 * cabinet checks run against `fft`.
 * ---------------------------------------------------------------------------
 */

/** Biquad shapes needed to build a cabinet curve. */
type BiquadKind = 'lowpass' | 'highpass' | 'peaking' | 'lowshelf' | 'highshelf';

interface BiquadSpec {
  kind: BiquadKind;
  /** Corner or centre frequency, Hz. */
  hz: number;
  q: number;
  /** Only used by peaking and shelf shapes. */
  gainDb?: number;
}

interface Coefficients {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/**
 * RBJ audio-EQ-cookbook coefficients, normalised by a0.
 *
 * The same formulas `BiquadFilterNode` uses, which is the point: the offline curve
 * built here and the live filters in `ampFx` come out of the same maths, so what
 * the IR measures is what the chain does.
 */
function coefficients(spec: BiquadSpec, sampleRate: number): Coefficients {
  const { kind, hz, q } = spec;
  const gainDb = spec.gainDb ?? 0;

  // Nyquist guard: a corner at or above Nyquist is not representable, and the
  // cookbook formulas go unstable rather than simply flat.
  const f0 = Math.min(Math.max(hz, 1), sampleRate * 0.49);
  const w0 = (2 * Math.PI * f0) / sampleRate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const alpha = sin / (2 * Math.max(q, 1e-4));
  const A = 10 ** (gainDb / 40);

  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;

  switch (kind) {
    case 'lowpass':
      b0 = (1 - cos) / 2;
      b1 = 1 - cos;
      b2 = (1 - cos) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
    case 'highpass':
      b0 = (1 + cos) / 2;
      b1 = -(1 + cos);
      b2 = (1 + cos) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
    case 'peaking':
      b0 = 1 + alpha * A;
      b1 = -2 * cos;
      b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      a1 = -2 * cos;
      a2 = 1 - alpha / A;
      break;
    case 'lowshelf': {
      const sqrtA2alpha = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 - (A - 1) * cos + sqrtA2alpha);
      b1 = 2 * A * (A - 1 - (A + 1) * cos);
      b2 = A * (A + 1 - (A - 1) * cos - sqrtA2alpha);
      a0 = A + 1 + (A - 1) * cos + sqrtA2alpha;
      a1 = -2 * (A - 1 + (A + 1) * cos);
      a2 = A + 1 + (A - 1) * cos - sqrtA2alpha;
      break;
    }
    case 'highshelf': {
      const sqrtA2alpha = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 + (A - 1) * cos + sqrtA2alpha);
      b1 = -2 * A * (A - 1 + (A + 1) * cos);
      b2 = A * (A + 1 + (A - 1) * cos - sqrtA2alpha);
      a0 = A + 1 - (A - 1) * cos + sqrtA2alpha;
      a1 = 2 * (A - 1 - (A + 1) * cos);
      a2 = A + 1 - (A - 1) * cos - sqrtA2alpha;
      break;
    }
  }

  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** Run one biquad over a buffer, in place. Direct form 1. */
function applyBiquad(data: Float32Array<ArrayBuffer>, spec: BiquadSpec, sampleRate: number): void {
  const { b0, b1, b2, a1, a2 } = coefficients(spec, sampleRate);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;

  for (let i = 0; i < data.length; i += 1) {
    const x0 = data[i];
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
    data[i] = y0;
  }
}

/** One cabinet's character, as a filter cascade plus a box reflection pattern. */
export interface CabinetModel {
  id: CabinetId;
  /** Guitar or bass. See `CabinetKind`. */
  kind: CabinetKind;
  label: string;
  /** One-line description of what it is for. */
  hint: string;
  /** Cone cannot move air below this. */
  highpassHz: number;
  /** Cone resonance bump. */
  resonanceHz: number;
  resonanceDb: number;
  /** The mid dip a close mic picks up off-axis. */
  scoopHz: number;
  scoopDb: number;
  /** Upper-mid presence peak — where pick attack and articulation live. */
  presenceHz: number;
  presenceDb: number;
  /** Top rolloff. Repeated to get a steep enough slope to kill fizz. */
  lowpassHz: number;
  lowpassStages: number;
  /**
   * Early reflections off the cab walls, as [delayMs, amplitude] pairs.
   *
   * Kept quiet on purpose. Reflections are what makes a cab sound like a box
   * rather than a filter, but they are comb filters: loud ones produce a hollow,
   * phasey tone that survives no amount of EQ afterwards.
   */
  reflections: readonly (readonly [number, number])[];
}

export type CabinetId = 'v30' | 'greenback' | 'american' | 'jazz' | 'b15' | 'b410';

/**
 * Which instrument a cabinet is for.
 *
 * The two are not interchangeable and the numbers say why: a guitar cab starts at
 * 65-90 Hz and gives up by 3.4-5.2 kHz, which throws away the bottom octave of a
 * bass and most of what a kick drum is. A bass cab reaches down to 40 Hz and rolls
 * off earlier at the top, because the string's harmonics above 5 kHz are fret noise.
 * Offering a 4x12 in the bass rack's picker would be offering a way to lose the
 * fundamental, so the racks filter on this.
 */
export type CabinetKind = 'guitar' | 'bass';

/**
 * Four cabinets, chosen to span the useful range rather than to be exhaustive.
 *
 * The numbers are the documented behaviour of the speaker families these are named
 * after: where the cone resonance sits, where the presence peak sits, and where the
 * top gives up. They are not measurements of specific cabinets.
 */
export const CABINETS: readonly CabinetModel[] = [
  {
    id: 'v30',
    kind: 'guitar',
    label: 'Modern 4×12',
    hint: 'Tight low end, aggressive upper mids. The default rock and metal voice.',
    highpassHz: 90,
    resonanceHz: 125,
    resonanceDb: 3.5,
    scoopHz: 500,
    scoopDb: -3.5,
    presenceHz: 2600,
    presenceDb: 6,
    lowpassHz: 5200,
    lowpassStages: 3,
    reflections: [
      [0.42, -0.14],
      [1.1, 0.08],
      [2.3, -0.05],
    ],
  },
  {
    id: 'greenback',
    kind: 'guitar',
    label: 'Vintage 4×12',
    hint: 'Softer top, mid-forward. Classic rock, crunch, anything that should sound old.',
    highpassHz: 80,
    resonanceHz: 105,
    resonanceDb: 4.5,
    scoopHz: 420,
    scoopDb: -2,
    presenceHz: 1700,
    presenceDb: 5,
    lowpassHz: 4200,
    lowpassStages: 3,
    reflections: [
      [0.55, -0.12],
      [1.4, 0.07],
      [2.8, -0.04],
    ],
  },
  {
    id: 'american',
    kind: 'guitar',
    label: 'American 1×12',
    hint: 'Flatter mids, extended low end. Cleans, blues, pedal platform.',
    highpassHz: 75,
    resonanceHz: 95,
    resonanceDb: 3,
    scoopHz: 700,
    scoopDb: -1.5,
    presenceHz: 3100,
    presenceDb: 4,
    // Measured at 2 stages and 6 kHz this left 10 kHz only 21.8 dB down — audibly
    // fizzy, and the whole point of a cab sim is that it is not. Three stages at a
    // slightly lower corner keeps it the brightest of the four without the wasp.
    lowpassHz: 5800,
    lowpassStages: 3,
    reflections: [
      [0.36, -0.1],
      [0.95, 0.06],
    ],
  },
  {
    id: 'jazz',
    kind: 'guitar',
    label: 'Jazz 1×15',
    hint: 'Warm and dark, early top rolloff. Clean chords, neck-pickup leads.',
    highpassHz: 65,
    resonanceHz: 85,
    resonanceDb: 4,
    scoopHz: 900,
    scoopDb: -1,
    // A dark cabinet still has a presence bump; at 1400 Hz / 2.5 dB the 3400 Hz
    // rolloff swallowed it entirely and the measured peak came out *below* the
    // 1 kHz reference, which means it was not a presence peak at all.
    presenceHz: 1600,
    presenceDb: 4.5,
    lowpassHz: 3400,
    lowpassStages: 3,
    reflections: [
      [0.7, -0.09],
      [1.9, 0.05],
    ],
  },

  /* ---- Bass -------------------------------------------------------------
     Both reach an octave lower than any guitar cab here and give up earlier at
     the top. The 1x15 is the vintage voice — a big cone that cannot follow a fast
     transient, which is why its top rolloff is the earliest of the six and its
     cone resonance the strongest. The 4x10 is the modern one: four small cones
     move less air each but start and stop, so it keeps the attack of a pick or a
     slap that the 15 rounds off. */
  {
    id: 'b15',
    kind: 'bass',
    label: 'Bass 1x15',
    hint: 'Vintage 15-inch. Round, heavy, early top rolloff. Fingerstyle and dub.',
    highpassHz: 38,
    resonanceHz: 62,
    resonanceDb: 5,
    scoopHz: 500,
    scoopDb: -2.5,
    presenceHz: 1200,
    presenceDb: 2,
    lowpassHz: 3000,
    lowpassStages: 3,
    reflections: [
      [0.9, -0.1],
      [2.4, 0.06],
    ],
  },
  {
    id: 'b410',
    kind: 'bass',
    label: 'Bass 4x10',
    hint: 'Modern 4x10. Keeps the attack — pick, slap and anything fast.',
    highpassHz: 45,
    resonanceHz: 80,
    resonanceDb: 3,
    scoopHz: 420,
    scoopDb: -1.5,
    // Higher and stronger than the 15's: this is where a pick or a slap lives, and
    // it is the whole reason to choose this cabinet over the other one.
    presenceHz: 2200,
    presenceDb: 4,
    lowpassHz: 5000,
    lowpassStages: 2,
    reflections: [
      [0.32, -0.12],
      [0.85, 0.07],
      [1.7, -0.04],
    ],
  },
];

/** Cabinets for one instrument, for a picker that must not offer the wrong ones. */
export function cabinetsFor(kind: CabinetKind): readonly CabinetModel[] {
  return CABINETS.filter((cab) => cab.kind === kind);
}

export const DEFAULT_CABINET: CabinetId = 'v30';
export const DEFAULT_BASS_CABINET: CabinetId = 'b410';

export function cabinetById(id: CabinetId): CabinetModel {
  return CABINETS.find((cab) => cab.id === id) ?? CABINETS[0];
}

/** Impulse length. 24 ms at 48 kHz — long enough for the box, short enough to be cheap. */
const IR_SECONDS = 0.024;

/* --------------------------------------------------------------------------
   Mic placement

   Where the microphone sits in front of the speaker, which on a real session is
   the single biggest tone decision after choosing the cabinet — and costs nothing
   here, because it is baked into the impulse rather than added as nodes. Three
   positions, no new convolvers, no new filters in the live graph.

   All three are level-matched by the 1 kHz normalisation at the end of
   `cabinetImpulse`, exactly as the cabinet models are: moving the mic is a change
   of tone and nothing else, which is the only way an A/B between them means
   anything. A Node check covers it.
-------------------------------------------------------------------------- */

export type MicPosition = 'center' | 'offAxis' | 'distant';

export const MIC_POSITIONS: readonly MicPosition[] = ['center', 'offAxis', 'distant'];

export const DEFAULT_MIC: MicPosition = 'center';

export interface MicPlacement {
  id: MicPosition;
  label: string;
  hint: string;
  /**
   * Multiplier on the model's presence peak.
   *
   * A speaker beams: the higher the frequency, the narrower the cone of it that
   * leaves the dust cap. Moving off the cap is the strongest single thing you can
   * do to a guitar cabinet's top end, and it is why "too bright" is a mic-position
   * problem far more often than an EQ problem.
   */
  presenceScale: number;
  /** Applied after the model's own curve, before the fizz-killing lowpass stages. */
  shelves: readonly BiquadSpec[];
}

/* --------------------------------------------------------------------------
   Why a placement is frequency response and nothing else.

   The first two attempts also scaled and stretched the model's box reflections, on
   the reasoning that stepping back raises the reflected sound against the direct
   one. Both were measured and both were wrong, in the same way and for the same
   underlying reason:

   - at 1.5× amplitude and 1.6× delay, the american's first reflection landed at
     0.58 ms — a comb notch at 868 Hz, beside the 1 kHz normalisation reference.
     Normalising pinned the notch to unity and lifted the whole curve with it, so
     `distant` measured **+2.5 dB brighter at 2.6 kHz than `center`**.
   - backing off to 1.15× and 1.4× only moved which cabinets broke: the v30 went
     +2.3 dB and the jazz +2.5 dB, because the stretch walks each model's own comb
     onto a different part of the reference.

   The physics says the same thing the measurement did. **Those reflections are off
   the cabinet's own walls — they belong to the box, not to the microphone.** Moving
   a mic back does not lengthen the inside of a 4x12. What distance really adds is
   *room*: later (5–30 ms), more diffuse, and entirely outside a 24 ms impulse with
   three taps in it. This model cannot represent a room, and pretending it can
   produces a comb filter that no EQ afterwards removes — which is what the field
   note above `reflections` has said all along.

   So a placement is a frequency response. Shelves and a presence scale are
   broadband and cannot notch, so they cannot do this. Room stays where it belongs:
   the reverb send, which exists and is designed for it.
-------------------------------------------------------------------------- */

/**
 * The three placements.
 *
 * **There is deliberately no pre-delay on the direct sound.** A mic half a metre
 * back really does arrive ~1.5 ms late, and modelling that honestly would put a
 * fixed 1.5 ms into the monitor path for a tone choice — latency the player pays
 * for on every note while playing. Distance is expressed as the things distance
 * actually changes in the frequency domain: proximity gone, air absorbed, room
 * risen. The arrival time is the one part of the physics left out, on purpose.
 */
export const MIC_PLACEMENTS: readonly MicPlacement[] = [
  {
    id: 'center',
    label: 'Center',
    hint: 'On the dust cap, close. The brightest and most direct — the default voicing.',
    presenceScale: 1,
    shelves: [],
  },
  {
    id: 'offAxis',
    label: 'Off-axis',
    hint: 'Angled at the cone edge. Softer top, same low end. The fix for a harsh amp.',
    presenceScale: 0.6,
    shelves: [{ kind: 'highshelf', hz: 3500, q: 0.7, gainDb: -4.5 }],
  },
  {
    id: 'distant',
    label: 'Distant',
    hint: 'Half a metre back. Less bass, more room, more open — for cleans and space.',
    /**
     * The numbers here were measured into place, and the first attempt was wrong in a
     * way worth recording: a −2.5 dB shelf at 6 kHz plus `presenceScale: 0.8` made
     * `distant` come out **brighter** than `center` in the upper mids on two of the six
     * cabinets — +0.3 dB at 2.6 kHz on the v30, +3.2 on the american.
     *
     * The cause is the 1 kHz normalisation, and it applies to anything added here. A
     * shelf that grazes the reference pulls it down, normalising lifts the whole curve
     * back, and everything *above* the shelf rises with it. So a placement is only as
     * dark as it is relative to 1 kHz — cutting energy somewhere else and expecting the
     * top to fall is exactly backwards. The corner came down to 4 kHz, where it acts on
     * the band a guitar cab still has, and the presence scale came down with it.
     */
    presenceScale: 0.7,
    shelves: [
      // Proximity effect is a close-mic artefact. Step back and the low end goes with it.
      { kind: 'lowshelf', hz: 150, q: 0.7, gainDb: -3 },
      // Air absorbed over distance. Low enough to survive the normalisation above.
      { kind: 'highshelf', hz: 4000, q: 0.7, gainDb: -3.5 },
    ],
  },
];

export function micPlacementById(id: MicPosition): MicPlacement {
  return MIC_PLACEMENTS.find((mic) => mic.id === id) ?? MIC_PLACEMENTS[0];
}

export interface CabinetTweaks {
  /** Extra presence, dB. Lets one model cover bright and dark rooms. */
  presenceDb?: number;
  /** Extra low-end resonance, dB. */
  resonanceDb?: number;
  /** Where the mic sits. Defaults to `center`, which is the models' own voicing. */
  mic?: MicPosition;
}

/** Frequency the models are level-matched at. Mid-band, and where a guitar sits. */
export const REFERENCE_HZ = 1000;

/**
 * Build a cabinet impulse response.
 *
 * Returns one channel, normalised to **unity gain at 1 kHz**.
 *
 * The first version peak-normalised in the time domain, on the reasoning that a
 * peak above 1 turns the cab into a gain stage. Measuring it showed that reasoning
 * was wrong: peak normalisation says nothing about gain, because a resonant impulse
 * concentrates its energy. The four models came out at +13.8, +16.4, +12.9 and
 * +18.5 dB at 1 kHz — so switching cabinets moved the level by up to 5.6 dB and
 * every model was loud enough to push the rest of the chain around.
 *
 * Normalising the *response* instead makes switching models a change of tone and
 * nothing else, which is the only way an A/B between them means anything.
 *
 * Consequence for the caller: `ConvolverNode.normalize` **must be false**. Left at
 * its default the node applies its own scaling on top and this work is discarded.
 */
export function cabinetImpulse(
  sampleRate: number,
  id: CabinetId,
  tweaks: CabinetTweaks = {},
): Float32Array<ArrayBuffer> {
  const cab = cabinetById(id);
  const mic = micPlacementById(tweaks.mic ?? DEFAULT_MIC);
  const length = Math.max(64, Math.floor(sampleRate * IR_SECONDS));
  const ir = new Float32Array(length);

  // Start from a unit impulse plus the box reflections, then filter. Filtering a
  // delta is exactly "sample the cascade's impulse response", so the measured
  // magnitude of the result is the cascade's magnitude by construction.
  ir[0] = 1;
  for (const [delayMs, amplitude] of cab.reflections) {
    const index = Math.round((delayMs / 1000) * sampleRate);
    if (index > 0 && index < length) ir[index] += amplitude;
  }

  applyBiquad(ir, { kind: 'highpass', hz: cab.highpassHz, q: 0.9 }, sampleRate);
  applyBiquad(
    ir,
    {
      kind: 'peaking',
      hz: cab.resonanceHz,
      q: 1.2,
      gainDb: cab.resonanceDb + (tweaks.resonanceDb ?? 0),
    },
    sampleRate,
  );
  applyBiquad(ir, { kind: 'peaking', hz: cab.scoopHz, q: 0.8, gainDb: cab.scoopDb }, sampleRate);
  applyBiquad(
    ir,
    {
      kind: 'peaking',
      hz: cab.presenceHz,
      q: 1.4,
      // The player's own presence tweak is *not* scaled by the mic. Scaling it would
      // make the same knob do different amounts depending on a separate control,
      // which is the thing a knob may never do.
      gainDb: cab.presenceDb * mic.presenceScale + (tweaks.presenceDb ?? 0),
    },
    sampleRate,
  );

  // Where the mic is, as the frequency response it produces. After the model's own
  // curve and before the rolloff, though the order is arithmetic rather than taste:
  // these are minimum-phase filters in series, so the magnitudes multiply whatever
  // order they run in.
  for (const shelf of mic.shelves) applyBiquad(ir, shelf, sampleRate);

  // The fizz killer. A single 2nd-order lowpass leaves far too much 8–16 kHz, and
  // that residue is the entire reason a direct signal sounds like a wasp.
  for (let stage = 0; stage < cab.lowpassStages; stage += 1) {
    applyBiquad(ir, { kind: 'lowpass', hz: cab.lowpassHz, q: 0.7 }, sampleRate);
  }

  // Fade the tail to zero so the IR ends on silence; a truncated ringing tail is a
  // click convolved into every note.
  const fade = Math.floor(length * 0.25);
  for (let i = 0; i < fade; i += 1) {
    const index = length - fade + i;
    ir[index] *= 1 - i / fade;
  }

  // Level-match on the response, not the peak. See the note above.
  const referenceDb = responseDbAt(ir, sampleRate, REFERENCE_HZ);
  if (Number.isFinite(referenceDb)) {
    const scale = 10 ** (-referenceDb / 20);
    for (let i = 0; i < length; i += 1) ir[i] *= scale;
  }

  return ir;
}

/**
 * Exponentially decaying noise, shaped for a room rather than a cabinet.
 *
 * Separate from the cabinet: a reverb tail wants to be long, diffuse and stereo,
 * where a cab IR wants to be short, deterministic and mono. Sharing one generator
 * for both is how reverbs end up sounding like a cardboard box.
 *
 * `random` is injectable so the tail can be made deterministic for a test.
 */
export function roomImpulse(
  sampleRate: number,
  seconds: number,
  channels = 2,
  random: () => number = Math.random,
): Float32Array<ArrayBuffer>[] {
  const length = Math.max(1, Math.floor(sampleRate * Math.max(0.05, seconds)));

  return Array.from({ length: channels }, () => {
    const data = new Float32Array(length);
    for (let i = 0; i < length; i += 1) {
      data[i] = (random() * 2 - 1) * (1 - i / length) ** 2.6;
    }
    // Roll the very top off the tail. Full-bandwidth noise reads as hiss on top of
    // the note rather than as a space around it.
    applyBiquad(data, { kind: 'lowpass', hz: 7000, q: 0.7 }, sampleRate);
    // And remove the rumble, which otherwise muddies every chord.
    applyBiquad(data, { kind: 'highpass', hz: 180, q: 0.7 }, sampleRate);
    return data;
  });
}

/**
 * Magnitude response of an impulse response at a given frequency, in dB.
 *
 * A direct DFT at one bin rather than a full FFT: the checks ask about a handful of
 * specific frequencies, and a single-bin evaluation is exact at any frequency
 * instead of snapping to the nearest FFT bin.
 */
export function responseDbAt(ir: Float32Array, sampleRate: number, hz: number): number {
  const w = (2 * Math.PI * hz) / sampleRate;
  let re = 0;
  let im = 0;
  for (let n = 0; n < ir.length; n += 1) {
    re += ir[n] * Math.cos(w * n);
    im -= ir[n] * Math.sin(w * n);
  }
  const magnitude = Math.hypot(re, im);
  return 20 * Math.log10(Math.max(magnitude, 1e-12));
}
