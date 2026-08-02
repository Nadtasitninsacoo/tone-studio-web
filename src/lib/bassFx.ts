/**
 * The bass rig.
 *
 * ---------------------------------------------------------------------------
 * A bass is not a guitar with thicker strings, and this chain is not the guitar
 * amp with different numbers. Three decisions make it a bass rig:
 *
 * 1. **The lows are never driven.** The signal is split at a crossover; the low
 *    band goes to the mix clean and only the high band reaches the waveshaper.
 *    Distorting a 41 Hz fundamental does not make it growl, it replaces it with
 *    harmonics — the note gets *smaller*, and on a phone speaker it disappears
 *    while sounding fine on headphones. Every bass amp that can be driven does this
 *    split, and it is the one thing a guitar amp fed a bass cannot do.
 * 2. **The crossover is Linkwitz-Riley**, two cascaded Butterworth sections per
 *    band, exactly as `songFx.ts` does it. A single lowpass plus a single highpass
 *    at one corner sums to a **complete null** at that corner — verified there, not
 *    theoretical — and a bass rig with a hole at 150 Hz is a broken bass rig.
 * 3. **There is a DI blend.** Tapped after the compressor and before the drive and
 *    the cabinet, which is where a real DI box sits. It is how a recorded bass keeps
 *    its definition: the amp gives it weight, the DI gives it the string.
 *
 * The EQ is a four-band graphic, not the guitar's three-knob tone stack, because it
 * sits **after** the drive. Bass players reach for a graphic EQ, and the frequencies
 * are named for what they do to a bass rather than for their band: 60 Hz is the
 * fundamental, 250 Hz is where a room turns it to cardboard, 800 Hz is the note you
 * hear on a small speaker, 2.5 kHz is the pick and the fret.
 * ---------------------------------------------------------------------------
 *
 * Built from the same primitives as the guitar amp: stock Web Audio nodes plus the
 * gate and look-ahead limiter from `public/worklets/amp-dsp-processor.js`. The
 * worklet module must already be loaded in the context — `createBassChain` is
 * synchronous so it can be called from an offline render setup.
 */

import { disconnectAll, makeParamSetter, tubeCurve } from '@/lib/audioGraph';
import { cabinetImpulse, DEFAULT_BASS_CABINET, type CabinetId } from '@/lib/cabinet';

/** Hardness fed to `tubeCurve`. Lower than the guitar's 14: a bass wants grind. */
const STAGE_HARDNESS = 9;

/** Fixed EQ centres. Named for what they do to a bass, not for their band. */
export const BASS_EQ_HZ = { sub: 60, lowMid: 250, mid: 800, high: 2500 } as const;

export interface BassSettings {
  inputDb: number;
  gate: { enabled: boolean; thresholdDb: number };
  /**
   * Slower than the guitar's by default: a bass note takes longer to develop.
   *
   * `attackMs` and `releaseMs` are exposed because they are the difference between the
   * three characters a bass player actually asks for, and no combination of threshold and
   * ratio reaches them: **tight** is a fast attack that catches the pick and a short
   * release that stops the note swelling, **thunder** is a slow attack that lets the
   * fundamental through untouched and a long release that keeps the tail moving air.
   * Locked at 12 ms / 280 ms, only one of those was possible.
   */
  comp: {
    enabled: boolean;
    thresholdDb: number;
    ratio: number;
    attackMs: number;
    releaseMs: number;
  };
  /** Where the clean low band ends and the drivable high band begins. */
  crossoverHz: number;
  /** Level of the clean low band, dB. The weight control. */
  lowDb: number;
  /** Drive, on the high band only. */
  drive: { enabled: boolean; amount: number; bias: number };
  /** Four-band graphic, after the drive. */
  eq: { subDb: number; lowMidDb: number; midDb: number; highDb: number };
  cab: { enabled: boolean; model: CabinetId; presenceDb: number; resonanceDb: number };
  /** Dry DI against the amped path, 0..1. Tapped after the compressor. */
  diMix: number;
  outputDb: number;
  limiter: { enabled: boolean; ceilingDb: number };
}

export const DEFAULT_BASS: BassSettings = {
  inputDb: 0,
  gate: { enabled: true, thresholdDb: -62 },
  // 12 / 280 is what the chain was fixed at before these were adjustable, kept as the
  // default so nothing about the existing sound changes.
  comp: { enabled: true, thresholdDb: -18, ratio: 3, attackMs: 12, releaseMs: 280 },
  crossoverHz: 160,
  lowDb: 0,
  drive: { enabled: false, amount: 0.25, bias: 0.2 },
  eq: { subDb: 1.5, lowMidDb: -1.5, midDb: 1, highDb: 1 },
  cab: { enabled: true, model: DEFAULT_BASS_CABINET, presenceDb: 0, resonanceDb: 0 },
  diMix: 0.25,
  outputDb: 0,
  limiter: { enabled: true, ceilingDb: -0.3 },
};

export interface BassPreset {
  id: string;
  label: string;
  latin: string;
  hint: string;
  /**
   * Words that select this preset from a typed request.
   *
   * Read by `matchPreset` through the instrument's lexicon, and matched fuzzily for
   * Thai. Generous on purpose: someone asking for "อีสาน" wants a family of sounds,
   * and landing on the closest one beats "ไม่เข้าใจ".
   */
  keywords: readonly string[];
  settings: BassSettings;
}

/**
 * A preset's overrides: shallow on the top level, partial inside each block.
 *
 * Needed because a preset says "compressor at 4:1" without restating the attack and the
 * release it is happy with. Before the timing fields existed every preset happened to
 * write the whole `comp` object, so `Partial<BassSettings>` was enough by accident.
 */
type BassOverride = Partial<Omit<BassSettings, 'gate' | 'comp' | 'drive' | 'eq' | 'cab' | 'limiter'>> & {
  gate?: Partial<BassSettings['gate']>;
  comp?: Partial<BassSettings['comp']>;
  drive?: Partial<BassSettings['drive']>;
  eq?: Partial<BassSettings['eq']>;
  cab?: Partial<BassSettings['cab']>;
  limiter?: Partial<BassSettings['limiter']>;
};

function withBass(over: BassOverride): BassSettings {
  return {
    ...DEFAULT_BASS,
    ...over,
    gate: { ...DEFAULT_BASS.gate, ...over.gate },
    comp: { ...DEFAULT_BASS.comp, ...over.comp },
    drive: { ...DEFAULT_BASS.drive, ...over.drive },
    eq: { ...DEFAULT_BASS.eq, ...over.eq },
    cab: { ...DEFAULT_BASS.cab, ...over.cab },
    limiter: { ...DEFAULT_BASS.limiter, ...over.limiter },
  };
}

/**
 * Starting points, by what the part has to do rather than by genre.
 *
 * A bass part is defined by its job in the arrangement more than by the style on
 * top of it: holding the root under a wall of guitars, carrying a melody, or being
 * the loudest thing at a parade.
 */
export const BASS_PRESETS: readonly BassPreset[] = [
  {
    id: 'finger',
    label: 'นิ้ว',
    latin: 'Fingerstyle',
    hint: 'อุ่น กลม เน้นเนื้อเสียง ไม่แตก DI ผสมพอให้ได้ตัวโน้ต',
    keywords: ['นิ้ว', 'fingerstyle', 'finger', 'ดีดนิ้ว', 'อุ่นๆ'],
    settings: withBass({
      comp: { enabled: true, thresholdDb: -20, ratio: 3.5 },
      crossoverHz: 140,
      eq: { subDb: 2, lowMidDb: -2, midDb: 1, highDb: 0 },
      cab: { enabled: true, model: 'b15', presenceDb: 0, resonanceDb: 1.5 },
      diMix: 0.2,
    }),
  },
  {
    id: 'pick',
    label: 'ปิ๊ก',
    latin: 'Pick',
    hint: 'คมขึ้น มีเสียงปิ๊กชัด ตู้ 4×10 เก็บหัวโน้ตได้',
    keywords: ['ปิ๊ก', 'pick', 'plectrum', 'ดีดปิ๊ก'],
    settings: withBass({
      comp: { enabled: true, thresholdDb: -18, ratio: 3 },
      crossoverHz: 170,
      eq: { subDb: 1, lowMidDb: -2.5, midDb: 1.5, highDb: 3 },
      cab: { enabled: true, model: 'b410', presenceDb: 2, resonanceDb: 0 },
      diMix: 0.35,
    }),
  },
  {
    id: 'slap',
    label: 'สแลป',
    latin: 'Slap',
    hint: 'ตัดกลาง เปิดหัวและท้าย คอมป์เร็ว DI เยอะเพื่อความคม',
    keywords: ['สแลป', 'slap', 'ตบ', 'ดีดตบ', 'funk', 'ฟังก์'],
    settings: withBass({
      // The classic slap shape: both ends up, the middle out of the way. It is the
      // one bass EQ that really is a smiley face, because the thumb makes the lows
      // and the fingers make the highs and nothing useful happens between them.
      comp: { enabled: true, thresholdDb: -22, ratio: 4 },
      crossoverHz: 200,
      eq: { subDb: 3, lowMidDb: -5, midDb: -1, highDb: 4 },
      cab: { enabled: true, model: 'b410', presenceDb: 3, resonanceDb: 0.5 },
      diMix: 0.45,
    }),
  },
  {
    id: 'tight',
    label: 'แน่น',
    latin: 'Tight',
    hint: 'คอมป์เร็ว คลายสั้น ตัดซับที่บวม เก็บหัวโน้ตให้ตรงจังหวะ เล่นเร็วไม่เลอะ',
    // Every Thai keyword is three characters or more, deliberately: a two-character word
    // is a substring of ordinary Thai (there are no spaces to anchor on), and a short one
    // once made a greeting select a whole drum voicing. "คม" became "คมชัด" for that reason.
    keywords: ['แน่น', 'กระชับ', 'ตึง', 'tight', 'punchy', 'เก็บ', 'คมชัด', 'ไม่บวม'],
    settings: withBass({
      // Tight is a compressor setting first and an EQ second: 3 ms catches the pick
      // itself and 90 ms is over before the next note, so nothing swells. Then the sub
      // comes down — a bloomed 60 Hz is what "not tight" sounds like on a real speaker —
      // and the low-mid stays up, because that is where a note's *edge* lives.
      comp: { enabled: true, thresholdDb: -24, ratio: 6, attackMs: 3, releaseMs: 90 },
      crossoverHz: 190,
      lowDb: -1.5,
      eq: { subDb: -3, lowMidDb: 1.5, midDb: 2.5, highDb: 1.5 },
      cab: { enabled: true, model: 'b410', presenceDb: 2, resonanceDb: -4 },
      diMix: 0.5,
      gate: { enabled: true, thresholdDb: -54 },
    }),
  },
  {
    id: 'float',
    label: 'ลอย',
    latin: 'Float',
    hint: 'โน้ตลอยขึ้นมาเหนือมิกซ์ กลางสูงเปิด DI เยอะ ได้ยินชัดบนลำโพงเล็ก',
    keywords: ['ลอย', 'โปร่ง', 'ลอยขึ้น', 'float', 'open', 'airy', 'ชัด', 'เด่น'],
    settings: withBass({
      // "Floating" is not more treble, it is more of the 800 Hz band — the frequency a
      // phone speaker can actually reproduce, so the note is audible where the
      // fundamental is not. Half DI keeps the string, and the cabinet's resonance comes
      // down so the weight does not drag the note back under the mix.
      comp: { enabled: true, thresholdDb: -20, ratio: 2.5, attackMs: 18, releaseMs: 220 },
      crossoverHz: 150,
      lowDb: -1,
      eq: { subDb: -1, lowMidDb: -2, midDb: 5, highDb: 4 },
      cab: { enabled: true, model: 'b410', presenceDb: 4, resonanceDb: -2 },
      diMix: 0.55,
    }),
  },
  {
    id: 'thunder',
    label: 'กระหึ่ม',
    latin: 'Thunder',
    hint: 'ซับหนัก หางยาว คอมป์ช้าไม่กดหัวโน้ต ตู้ 1×15 เปิดเรโซแรง',
    keywords: ['กระหึ่ม', 'หนัก', 'ตูม', 'thunder', 'huge', 'massive', 'ตุบ', 'อึ้ม'],
    settings: withBass({
      // The opposite setting on every axis that matters, and the compressor is the reason
      // it works: a 40 ms attack lets the fundamental through before any gain reduction
      // arrives, and a 600 ms release keeps the tail moving air instead of pumping it
      // shut. The clean low band is lifted rather than the sub EQ alone, so the weight
      // comes from the part of the signal that was never distorted.
      comp: { enabled: true, thresholdDb: -14, ratio: 2, attackMs: 40, releaseMs: 600 },
      crossoverHz: 110,
      lowDb: 5,
      eq: { subDb: 6, lowMidDb: -1, midDb: -1.5, highDb: -2 },
      cab: { enabled: true, model: 'b15', presenceDb: -3, resonanceDb: 6 },
      diMix: 0.1,
      // A gate this low would cut a decaying tail, which is the whole point of this one.
      gate: { enabled: true, thresholdDb: -70 },
    }),
  },
  {
    id: 'grind',
    label: 'แตกหยาบ',
    latin: 'Grind',
    hint: 'ขับย่านกลาง-สูง ส่วนเบสยังใส กลายเป็นเบสร็อคที่ยังได้ยินโน้ต',
    keywords: ['แตกหยาบ', 'grind', 'growl', 'เบสร็อค', 'ร็อค', 'rock', 'เมทัล', 'metal'],
    settings: withBass({
      comp: { enabled: true, thresholdDb: -16, ratio: 3 },
      // The crossover moves *up* with the drive: more of the note stays clean, so
      // the grind sits on top of the fundamental instead of replacing it.
      crossoverHz: 240,
      drive: { enabled: true, amount: 0.55, bias: 0.18 },
      eq: { subDb: 2, lowMidDb: -1, midDb: 2.5, highDb: 1.5 },
      cab: { enabled: true, model: 'b410', presenceDb: 1.5, resonanceDb: 1 },
      diMix: 0.15,
    }),
  },
  {
    id: 'isan',
    label: 'อีสาน',
    latin: 'Isan / morlam',
    hint: 'เบสหมอลำ เดินเร็ว ต้องได้ยินทุกตัวโน้ต ตัด 250 ทิ้งให้พ้นทางกลอง',
    keywords: ['อีสาน', 'isan', 'หมอลำ', 'morlam', 'ลูกทุ่ง', 'luk thung', 'เบสหมอลำ'],
    settings: withBass({
      // A morlam bass line moves constantly and shares the stage with a klong yao,
      // so definition beats weight: the compressor is quick, the low-mid is cut hard
      // to get out of the drum's way, and 800 Hz is up because that is the band a
      // PA in a field actually reproduces.
      comp: { enabled: true, thresholdDb: -24, ratio: 4.5 },
      crossoverHz: 180,
      eq: { subDb: 0.5, lowMidDb: -4, midDb: 3, highDb: 2 },
      cab: { enabled: true, model: 'b410', presenceDb: 2.5, resonanceDb: -1 },
      diMix: 0.4,
      outputDb: 1,
    }),
  },
  {
    id: 'sub',
    label: 'ซับ',
    latin: 'Sub / dub',
    hint: 'หนักที่สุด ปลายตัดทิ้ง เหลือแต่ย่านต่ำที่รู้สึกได้',
    keywords: ['ซับ', 'sub', 'ดับ', 'dub', 'เร็กเก้', 'reggae', 'หนักๆ'],
    settings: withBass({
      comp: { enabled: true, thresholdDb: -26, ratio: 5 },
      crossoverHz: 110,
      lowDb: 3,
      eq: { subDb: 4, lowMidDb: 0, midDb: -3, highDb: -6 },
      cab: { enabled: true, model: 'b15', presenceDb: -3, resonanceDb: 3 },
      diMix: 0.1,
    }),
  },
];

export interface BassChain {
  readonly input: AudioNode;
  readonly output: AudioNode;
  update(settings: BassSettings): void;
  onMeter(handler: (source: 'gate' | 'limiter', reductionDb: number) => void): void;
  disconnect(): void;
}

/**
 * One Linkwitz-Riley band: two identical Butterworth sections in series.
 *
 * Two, not one. A single 2nd-order section per band leaves the two halves 90° apart
 * at the corner and they sum to a null; cascading a pair puts them 180° apart, which
 * sums flat. This is the same construction `songFx.ts` uses for the bass tightener
 * and the same reason.
 */
function crossoverBand(ctx: BaseAudioContext, type: 'lowpass' | 'highpass'): BiquadFilterNode[] {
  return [0, 1].map(() => {
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = Math.SQRT1_2;
    return filter;
  });
}

function chain(nodes: AudioNode[]): void {
  for (let i = 0; i < nodes.length - 1; i += 1) nodes[i].connect(nodes[i + 1]);
}

export function createBassChain(ctx: BaseAudioContext, settings: BassSettings): BassChain {
  const setParam = makeParamSetter(ctx);

  const input = ctx.createGain();

  // A bass converter offset is worth removing before anything else: at 40 Hz the
  // difference between DC and the note is not much, and the asymmetric curve below
  // adds more of its own.
  const dcBlock = ctx.createBiquadFilter();
  dcBlock.type = 'highpass';
  dcBlock.frequency.value = 18;
  dcBlock.Q.value = 0.7;

  const trim = ctx.createGain();

  const gate = new AudioWorkletNode(ctx, 'gate-processor', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  });

  const comp = ctx.createDynamicsCompressor();
  // Slower than the guitar's 4 ms / 200 ms. A bass note's attack *is* the note, and
  // a fast attack flattens it into a click followed by a swell.
  comp.knee.value = 12;
  comp.attack.value = settings.comp.attackMs / 1000;
  comp.release.value = settings.comp.releaseMs / 1000;

  /** The split point, and the DI tap. */
  const split = ctx.createGain();

  const lowBand = crossoverBand(ctx, 'lowpass');
  const highBand = crossoverBand(ctx, 'highpass');
  const lowGain = ctx.createGain();
  const highGain = ctx.createGain();

  const shaper = ctx.createWaveShaper();
  shaper.oversample = '2x';
  /** Makeup after the shaper: saturation raises average level. */
  const driveTrim = ctx.createGain();
  // The asymmetric curve puts DC back on the band; left there it walks the cabinet
  // convolver off its operating point.
  const driveDc = ctx.createBiquadFilter();
  driveDc.type = 'highpass';
  driveDc.frequency.value = 30;
  driveDc.Q.value = 0.7;

  const ampSum = ctx.createGain();

  // ---- Four-band graphic, after the drive ---------------------------------
  const sub = ctx.createBiquadFilter();
  sub.type = 'lowshelf';
  sub.frequency.value = BASS_EQ_HZ.sub;

  const lowMid = ctx.createBiquadFilter();
  lowMid.type = 'peaking';
  lowMid.frequency.value = BASS_EQ_HZ.lowMid;
  lowMid.Q.value = 0.9;

  const mid = ctx.createBiquadFilter();
  mid.type = 'peaking';
  mid.frequency.value = BASS_EQ_HZ.mid;
  mid.Q.value = 0.8;

  const high = ctx.createBiquadFilter();
  high.type = 'highshelf';
  high.frequency.value = BASS_EQ_HZ.high;

  // ---- Cabinet -------------------------------------------------------------
  // Mono, unlike the guitar's dual-mono pair. A bass is the one thing in a mix that
  // has to survive a mono fold-down intact, and width is what a mono sum destroys.
  const cab = ctx.createConvolver();
  cab.normalize = false;
  const cabBypass = ctx.createGain();
  const cabSum = ctx.createGain();

  const ampOut = ctx.createGain();
  const diGain = ctx.createGain();
  const mixBus = ctx.createGain();
  const outputTrim = ctx.createGain();

  const limiter = new AudioWorkletNode(ctx, 'limiter-processor', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  });

  const output = ctx.createGain();

  // ---- Wiring -------------------------------------------------------------
  chain([input, dcBlock, trim, gate, comp, split]);

  // Low band: clean, always.
  chain([split, lowBand[0], lowBand[1], lowGain, ampSum]);
  // High band: the only one that can be driven.
  chain([split, highBand[0], highBand[1], shaper, driveTrim, driveDc, highGain, ampSum]);

  chain([ampSum, sub, lowMid, mid, high]);
  high.connect(cab);
  cab.connect(cabSum);
  // Parallel bypass rather than a reconnection: a ConvolverNode with a null buffer
  // outputs silence, so emptying the buffer to bypass it would mute the rig.
  high.connect(cabBypass);
  cabBypass.connect(cabSum);

  chain([cabSum, ampOut, mixBus]);

  // The DI is tapped at the split — after the gate and compressor, before the drive,
  // the EQ and the cabinet. That is where the box sits on a real stage.
  chain([split, diGain, mixBus]);

  chain([mixBus, outputTrim, limiter, output]);

  // ---- Parameters ---------------------------------------------------------
  let currentCab = '';
  let currentDrive = -1;
  let currentBias = -1;

  const gateThreshold = gate.parameters.get('threshold');
  const gateEnabled = gate.parameters.get('enabled');
  const limiterCeiling = limiter.parameters.get('ceiling');
  const limiterEnabled = limiter.parameters.get('enabled');

  const update = (next: BassSettings) => {
    setParam(trim.gain, 10 ** (next.inputDb / 20));

    if (gateThreshold) setParam(gateThreshold, next.gate.thresholdDb);
    if (gateEnabled) gateEnabled.value = next.gate.enabled ? 1 : 0;

    setParam(comp.threshold, next.comp.enabled ? next.comp.thresholdDb : 0);
    setParam(comp.ratio, next.comp.enabled ? next.comp.ratio : 1);
    // Ramped like every other param here. A compressor's attack is not something the
    // spec lets you change per sample anyway, so a short glide is the honest behaviour.
    setParam(comp.attack, next.comp.attackMs / 1000);
    setParam(comp.release, next.comp.releaseMs / 1000);

    for (const filter of lowBand) setParam(filter.frequency, next.crossoverHz);
    for (const filter of highBand) setParam(filter.frequency, next.crossoverHz);
    setParam(lowGain.gain, 10 ** (next.lowDb / 20));

    const amount = next.drive.enabled ? next.drive.amount : 0;
    if (amount !== currentDrive || next.drive.bias !== currentBias) {
      currentDrive = amount;
      currentBias = next.drive.bias;
      // A null curve is a true bypass, not an identity approximation.
      shaper.curve = amount > 0 ? tubeCurve(amount, STAGE_HARDNESS, next.drive.bias) : null;
    }
    setParam(driveTrim.gain, 1 / (1 + amount * 1.4));
    setParam(highGain.gain, 1);

    setParam(sub.gain, next.eq.subDb);
    setParam(lowMid.gain, next.eq.lowMidDb);
    setParam(mid.gain, next.eq.midDb);
    setParam(high.gain, next.eq.highDb);

    const cabKey = `${next.cab.model}:${next.cab.presenceDb}:${next.cab.resonanceDb}`;
    if (next.cab.enabled && cabKey !== currentCab) {
      currentCab = cabKey;
      const ir = cabinetImpulse(ctx.sampleRate, next.cab.model, {
        presenceDb: next.cab.presenceDb,
        resonanceDb: next.cab.resonanceDb,
      });
      const buffer = ctx.createBuffer(1, ir.length, ctx.sampleRate);
      buffer.copyToChannel(ir, 0);
      cab.buffer = buffer;
    }
    const cabOn = next.cab.enabled && cab.buffer !== null;
    setParam(cabBypass.gain, cabOn ? 0 : 1);
    setParam(cabSum.gain, 1);

    // Equal-power blend, not a linear one: at 50/50 a linear crossfade of two
    // correlated paths is ~3 dB down, and the DI knob would dip in the middle.
    const di = Math.min(1, Math.max(0, next.diMix));
    setParam(diGain.gain, Math.sin((di * Math.PI) / 2));
    setParam(ampOut.gain, Math.cos((di * Math.PI) / 2));

    setParam(outputTrim.gain, 10 ** (next.outputDb / 20));
    if (limiterCeiling) setParam(limiterCeiling, next.limiter.ceilingDb);
    if (limiterEnabled) limiterEnabled.value = next.limiter.enabled ? 1 : 0;
  };

  update(settings);

  return {
    input,
    output,
    update,
    onMeter(handler) {
      gate.port.onmessage = (event) => {
        if (event.data?.type === 'meter') handler('gate', event.data.reductionDb);
      };
      limiter.port.onmessage = (event) => {
        if (event.data?.type === 'meter') handler('limiter', event.data.reductionDb);
      };
    },
    disconnect() {
      gate.port.onmessage = null;
      limiter.port.onmessage = null;
      disconnectAll([
        input,
        dcBlock,
        trim,
        gate,
        comp,
        split,
        ...lowBand,
        ...highBand,
        lowGain,
        highGain,
        shaper,
        driveTrim,
        driveDc,
        ampSum,
        sub,
        lowMid,
        mid,
        high,
        cab,
        cabBypass,
        cabSum,
        ampOut,
        diGain,
        mixBus,
        outputTrim,
        limiter,
        output,
      ]);
    },
  };
}
