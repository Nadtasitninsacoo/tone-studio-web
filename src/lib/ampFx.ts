/**
 * The amp — a full guitar amplifier and cabinet.
 *
 * The one guitar chain in the app: the recorder monitors through it, the jam page
 * plays every layer through it and prints it into the mixdown, and `ampRender`
 * commits it to a second copy of a take. It is the signal path a direct USB guitar
 * actually needs before it sounds like a record.
 *
 * There used to be a second, smaller chain (`guitarFx.ts` — drive, EQ, comp, delay,
 * reverb) for the jam page, on the assumption that the guitar arrived from a
 * multi-FX pedal with its cabinet already printed. Deleted: feed a **dry** DI into a
 * waveshaper with no speaker downstream and the result is fizz, and a shelf at
 * 3.2 kHz is not an impulse response. Anything that wants a sweetener instead of an
 * amp switches `cab` and `drive` off here.
 *
 * ---------------------------------------------------------------------------
 * Why it is built out of native Web Audio nodes and two AudioWorklets, and not
 * out of WebAssembly.
 *
 * The expensive parts of this chain are convolution, biquad filtering and
 * oversampled waveshaping. All three are already implemented as hand-optimised
 * C++ inside the browser, reachable as `ConvolverNode`, `BiquadFilterNode` and
 * `WaveShaperNode`. A WASM convolver would have to beat `ConvolverNode` at its own
 * job with the same instruction set and less tuning; it would not.
 *
 * Exactly two things in this chain have no node, and both are in
 * `public/worklets/amp-dsp-processor.js`: a **hysteresis noise gate** and a
 * **look-ahead brickwall limiter**. An AudioWorkletProcessor runs on the same
 * real-time render thread WASM would, so the language buys nothing there either —
 * what buys something is having the right algorithm, which is why the limiter reads
 * the future instead of reacting to the past.
 * ---------------------------------------------------------------------------
 *
 * Order, and the reason for each position:
 *
 *   in → dcBlock → trim → GATE → comp → tone stack
 *      → stage1 → lp → stage2 → lp → stage3 → post
 *      → cabinet L / cabinet R (dual mono, for width)
 *      → depth + presence
 *      ├→ dry ─────────────────→ mix
 *      ├→ delay ⇄ feedback ────→ mix
 *      └→ reverb ──────────────→ mix
 *      → output trim → LIMITER → out
 *
 * - The **gate goes before the gain stages.** After them it would be gating a noise
 *   floor that has already been amplified by 40 dB, which is far too late.
 * - The **tone stack goes before the distortion**, as it does in a real amp. EQ
 *   after distortion only filters harmonics that already exist; EQ before it
 *   decides which harmonics get generated at all. This one ordering choice is most
 *   of why an amp sim sounds like an amp.
 * - The **cabinet goes after the distortion.** It is the loudspeaker; nothing
 *   downstream of a speaker feeds back into the preamp.
 * - The **limiter goes last**, after the output trim, so "turn it up" is a
 *   guarantee rather than a hope. See the worklet for why a compressor cannot do
 *   this job.
 */

import { disconnectAll, makeParamSetter, tubeCurve } from '@/lib/audioGraph';
import { cabinetImpulse, roomImpulse, type CabinetId, DEFAULT_CABINET } from '@/lib/cabinet';

/** Module URL for the gate and limiter processors. */
export const AMP_WORKLET_URL = '/worklets/amp-dsp-processor.js';

/** Hardness fed to `tubeCurve`. Guitar wants a lot of saturation available. */
const STAGE_HARDNESS = 14;

/** Interstage lowpass. Stops each stage handing the next one fizz to multiply. */
const INTERSTAGE_HZ = 6200;

/** Longest delay the node will allocate for. */
const MAX_DELAY_SEC = 2;

export interface AmpSettings {
  /** Trim before everything, so the gain stages are fed at a sane level. */
  inputDb: number;
  gate: { enabled: boolean; thresholdDb: number };
  comp: { enabled: boolean; thresholdDb: number; ratio: number };
  /** Pre-distortion tone stack, exactly where a real amp puts it. */
  tone: { bassDb: number; midDb: number; midHz: number; trebleDb: number };
  drive: {
    enabled: boolean;
    /** 0..1 per stage. */
    amount: number;
    /** 1, 2 or 3 cascaded valve stages. */
    stages: 1 | 2 | 3;
    /** Asymmetry. 0 is a symmetric fuzz, 0.3 is a hot-biased valve. */
    bias: number;
  };
  cab: {
    enabled: boolean;
    model: CabinetId;
    presenceDb: number;
    resonanceDb: number;
    /** 0 = dual mono summed to centre, 1 = fully spread. */
    width: number;
  };
  delay: { enabled: boolean; timeSec: number; feedback: number; mix: number };
  reverb: { enabled: boolean; sizeSec: number; mix: number };
  outputDb: number;
  limiter: { enabled: boolean; ceilingDb: number };
}

export const DEFAULT_AMP: AmpSettings = {
  inputDb: 0,
  gate: { enabled: true, thresholdDb: -58 },
  comp: { enabled: false, thresholdDb: -20, ratio: 3 },
  tone: { bassDb: 2, midDb: 0, midHz: 700, trebleDb: 2 },
  drive: { enabled: true, amount: 0.35, stages: 2, bias: 0.18 },
  cab: { enabled: true, model: DEFAULT_CABINET, presenceDb: 0, resonanceDb: 0, width: 0.35 },
  delay: { enabled: false, timeSec: 0.34, feedback: 0.28, mix: 0.22 },
  reverb: { enabled: true, sizeSec: 1.6, mix: 0.18 },
  outputDb: 0,
  limiter: { enabled: true, ceilingDb: -0.3 },
};

export interface AmpPreset {
  id: string;
  label: string
  hint: string;
  settings: AmpSettings;
}

/** Deep-ish clone so a preset cannot be mutated by the UI editing live settings. */
function withAmp(over: Partial<AmpSettings>): AmpSettings {
  return {
    ...DEFAULT_AMP,
    ...over,
    gate: { ...DEFAULT_AMP.gate, ...over.gate },
    comp: { ...DEFAULT_AMP.comp, ...over.comp },
    tone: { ...DEFAULT_AMP.tone, ...over.tone },
    drive: { ...DEFAULT_AMP.drive, ...over.drive },
    cab: { ...DEFAULT_AMP.cab, ...over.cab },
    delay: { ...DEFAULT_AMP.delay, ...over.delay },
    reverb: { ...DEFAULT_AMP.reverb, ...over.reverb },
    limiter: { ...DEFAULT_AMP.limiter, ...over.limiter },
  };
}

/**
 * Starting points, not decoration.
 *
 * A chain with this many controls is unusable from its defaults — the first thing
 * anyone needs is a sound that already works, to hear what the controls do *to*.
 * Each of these is a different set of decisions about gain staging, not the same
 * sound with the drive knob moved.
 */
export const AMP_PRESETS: readonly AmpPreset[] = [
  {
    id: 'clean',
    label: 'Clean',
    hint: 'American 1×12, one gentle stage, compressor on for even chords.',
    settings: withAmp({
      comp: { enabled: true, thresholdDb: -24, ratio: 3 },
      tone: { bassDb: 1.5, midDb: -1, midHz: 600, trebleDb: 3 },
      drive: { enabled: true, amount: 0.12, stages: 1, bias: 0.1 },
      cab: { enabled: true, model: 'american', presenceDb: 1, resonanceDb: 0, width: 0.3 },
      reverb: { enabled: true, sizeSec: 1.9, mix: 0.22 },
    }),
  },
  {
    id: 'crunch',
    label: 'Crunch',
    hint: 'Vintage 4×12, two stages. Edge-of-breakup rhythm.',
    settings: withAmp({
      tone: { bassDb: 2, midDb: 1.5, midHz: 750, trebleDb: 2 },
      drive: { enabled: true, amount: 0.38, stages: 2, bias: 0.2 },
      cab: { enabled: true, model: 'greenback', presenceDb: 1, resonanceDb: 1, width: 0.35 },
      reverb: { enabled: true, sizeSec: 1.4, mix: 0.16 },
    }),
  },
  {
    id: 'lead',
    label: 'Lead',
    hint: 'Three stages, mid push, delay on. Sustain and articulation.',
    settings: withAmp({
      comp: { enabled: true, thresholdDb: -22, ratio: 4 },
      tone: { bassDb: 0, midDb: 4, midHz: 900, trebleDb: 2.5 },
      drive: { enabled: true, amount: 0.55, stages: 3, bias: 0.22 },
      cab: { enabled: true, model: 'v30', presenceDb: 1.5, resonanceDb: 0, width: 0.45 },
      delay: { enabled: true, timeSec: 0.38, feedback: 0.32, mix: 0.26 },
      reverb: { enabled: true, sizeSec: 2.1, mix: 0.2 },
    }),
  },
  {
    id: 'metal',
    label: 'Metal',
    hint: 'Scooped mids, three hot stages, gate up. Tight and dry.',
    settings: withAmp({
      gate: { enabled: true, thresholdDb: -48 },
      tone: { bassDb: 4, midDb: -5, midHz: 650, trebleDb: 3.5 },
      drive: { enabled: true, amount: 0.78, stages: 3, bias: 0.14 },
      cab: { enabled: true, model: 'v30', presenceDb: 2, resonanceDb: 1.5, width: 0.5 },
      reverb: { enabled: false, sizeSec: 1.2, mix: 0.1 },
    }),
  },
  {
    id: 'ambient',
    label: 'Ambient',
    hint: 'Jazz 1×15, barely driven, long room. Chords and texture.',
    settings: withAmp({
      comp: { enabled: true, thresholdDb: -26, ratio: 2.5 },
      tone: { bassDb: 1, midDb: -2, midHz: 500, trebleDb: 1.5 },
      drive: { enabled: true, amount: 0.08, stages: 1, bias: 0.1 },
      cab: { enabled: true, model: 'jazz', presenceDb: 2, resonanceDb: 0, width: 0.6 },
      delay: { enabled: true, timeSec: 0.52, feedback: 0.42, mix: 0.3 },
      reverb: { enabled: true, sizeSec: 3.4, mix: 0.35 },
    }),
  },
];

export interface AmpChain {
  readonly input: AudioNode;
  readonly output: AudioNode;
  /** Cheap and click-free; safe to call on every pointer move. */
  update(settings: AmpSettings): void;
  /** Gate and limiter meter reports, for a gain-reduction display. */
  onMeter(handler: (source: 'gate' | 'limiter', reductionDb: number) => void): void;
  disconnect(): void;
}

/**
 * Build the amp.
 *
 * `ctx.audioWorklet.addModule(AMP_WORKLET_URL)` must have resolved first. Kept out
 * of here on purpose: this function is synchronous so it can be called from an
 * offline render setup without threading a promise through the mixdown.
 */
export function createAmpChain(ctx: BaseAudioContext, settings: AmpSettings): AmpChain {
  const setParam = makeParamSetter(ctx);

  const input = ctx.createGain();

  // DC blocker. A converter offset, and the asymmetric valve curves further down,
  // both put DC on the signal; DC eats headroom and pushes later stages off their
  // operating point until the sound thins out or disappears.
  const dcBlock = ctx.createBiquadFilter();
  dcBlock.type = 'highpass';
  dcBlock.frequency.value = 22;
  dcBlock.Q.value = 0.7;

  const trim = ctx.createGain();

  const gate = new AudioWorkletNode(ctx, 'gate-processor', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  });

  const comp = ctx.createDynamicsCompressor();
  comp.knee.value = 10;
  comp.attack.value = 0.004;
  comp.release.value = 0.2;

  // ---- Tone stack, PRE-distortion -----------------------------------------
  const bass = ctx.createBiquadFilter();
  bass.type = 'lowshelf';
  bass.frequency.value = 180;

  const mid = ctx.createBiquadFilter();
  mid.type = 'peaking';
  mid.Q.value = 0.9;

  const treble = ctx.createBiquadFilter();
  treble.type = 'highshelf';
  treble.frequency.value = 2400;

  // ---- Cascaded valve stages ----------------------------------------------
  // Always three, always connected. Unused stages get a null curve, which is a
  // true bypass — rebuilding the graph when the stage count changes would click
  // and would fight the "build once, drive by parameters" rule the racks share.
  const stages = [ctx.createWaveShaper(), ctx.createWaveShaper(), ctx.createWaveShaper()];
  for (const stage of stages) stage.oversample = '4x';

  const interstage = [ctx.createBiquadFilter(), ctx.createBiquadFilter()];
  for (const filter of interstage) {
    filter.type = 'lowpass';
    filter.frequency.value = INTERSTAGE_HZ;
    filter.Q.value = 0.7;
  }

  // Between stages the asymmetry has added DC again. Removing it here is what lets
  // three stages cascade without the third one going quiet.
  const interDc = [ctx.createBiquadFilter(), ctx.createBiquadFilter()];
  for (const filter of interDc) {
    filter.type = 'highpass';
    filter.frequency.value = 30;
    filter.Q.value = 0.7;
  }

  /** Makeup after the stages: saturation raises average level a long way. */
  const postGain = ctx.createGain();

  // ---- Cabinet: dual mono for width ---------------------------------------
  // Two convolvers with slightly different voicings, panned apart. Not a delay:
  // a Haas-style widener comb-filters the moment anything sums it to mono, and a
  // guitar track gets summed to mono constantly. Two different EQ curves sum to a
  // third EQ curve, which is merely a tone change.
  const cabSplit = ctx.createGain();
  const cabL = ctx.createConvolver();
  const cabR = ctx.createConvolver();
  // Critical: the node's own normalisation would discard the level-matching done
  // in `cabinetImpulse`, and switching models would jump in volume again.
  cabL.normalize = false;
  cabR.normalize = false;

  const panL = ctx.createStereoPanner();
  const panR = ctx.createStereoPanner();
  const cabBypass = ctx.createGain();
  const cabSum = ctx.createGain();

  // ---- Post-cab voicing ---------------------------------------------------
  const depth = ctx.createBiquadFilter();
  depth.type = 'lowshelf';
  depth.frequency.value = 120;

  const presence = ctx.createBiquadFilter();
  presence.type = 'highshelf';
  presence.frequency.value = 3200;

  // ---- Sends -------------------------------------------------------------
  const dry = ctx.createGain();
  dry.gain.value = 1;

  const delay = ctx.createDelay(MAX_DELAY_SEC);
  const feedback = ctx.createGain();
  const delayWet = ctx.createGain();
  // Guitar delay repeats should get darker, as tape and analogue delays do.
  const delayTone = ctx.createBiquadFilter();
  delayTone.type = 'lowpass';
  delayTone.frequency.value = 3200;
  delayTone.Q.value = 0.7;

  const reverb = ctx.createConvolver();
  reverb.normalize = true;
  const reverbWet = ctx.createGain();

  const mixBus = ctx.createGain();
  const outputTrim = ctx.createGain();

  const limiter = new AudioWorkletNode(ctx, 'limiter-processor', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  });

  const output = ctx.createGain();

  // ---- Wiring -------------------------------------------------------------
  input.connect(dcBlock);
  dcBlock.connect(trim);
  trim.connect(gate);
  gate.connect(comp);
  comp.connect(bass);
  bass.connect(mid);
  mid.connect(treble);

  treble.connect(stages[0]);
  stages[0].connect(interstage[0]);
  interstage[0].connect(interDc[0]);
  interDc[0].connect(stages[1]);
  stages[1].connect(interstage[1]);
  interstage[1].connect(interDc[1]);
  interDc[1].connect(stages[2]);
  stages[2].connect(postGain);

  postGain.connect(cabSplit);
  cabSplit.connect(cabL);
  cabSplit.connect(cabR);
  cabL.connect(panL);
  cabR.connect(panR);
  panL.connect(cabSum);
  panR.connect(cabSum);
  // Parallel dry-of-the-cab path, so "cab off" is a gain change rather than a
  // reconnection. A ConvolverNode with a null buffer outputs silence, so bypassing
  // it by emptying the buffer would mute the amp.
  cabSplit.connect(cabBypass);
  cabBypass.connect(cabSum);

  cabSum.connect(depth);
  depth.connect(presence);

  presence.connect(dry);
  dry.connect(mixBus);

  presence.connect(delay);
  delay.connect(delayTone);
  delayTone.connect(feedback);
  feedback.connect(delay);
  delayTone.connect(delayWet);
  delayWet.connect(mixBus);

  presence.connect(reverb);
  reverb.connect(reverbWet);
  reverbWet.connect(mixBus);

  mixBus.connect(outputTrim);
  outputTrim.connect(limiter);
  limiter.connect(output);

  // ---- Parameter application ---------------------------------------------
  let currentCab = '';
  let currentReverbSeconds = -1;
  let currentDrive = -1;
  let currentStages = -1;
  let currentBias = -1;

  const gateThreshold = gate.parameters.get('threshold');
  const gateEnabled = gate.parameters.get('enabled');
  const limiterCeiling = limiter.parameters.get('ceiling');
  const limiterEnabled = limiter.parameters.get('enabled');

  const update = (next: AmpSettings) => {
    setParam(trim.gain, 10 ** (next.inputDb / 20));

    if (gateThreshold) setParam(gateThreshold, next.gate.thresholdDb);
    if (gateEnabled) gateEnabled.value = next.gate.enabled ? 1 : 0;

    // Ratio 1 at a 0 dB threshold is a no-op, so the node stays in the graph.
    setParam(comp.threshold, next.comp.enabled ? next.comp.thresholdDb : 0);
    setParam(comp.ratio, next.comp.enabled ? next.comp.ratio : 1);

    setParam(bass.gain, next.tone.bassDb);
    setParam(mid.gain, next.tone.midDb);
    setParam(mid.frequency, next.tone.midHz);
    setParam(treble.gain, next.tone.trebleDb);

    // ---- Valve stages ----------------------------------------------------
    const amount = next.drive.enabled ? next.drive.amount : 0;
    const stageCount = next.drive.enabled ? next.drive.stages : 0;
    if (amount !== currentDrive || stageCount !== currentStages || next.drive.bias !== currentBias) {
      currentDrive = amount;
      currentStages = stageCount;
      currentBias = next.drive.bias;

      for (let i = 0; i < stages.length; i += 1) {
        // A null curve is a true bypass, not an identity approximation.
        stages[i].curve =
          i < stageCount && amount > 0 ? tubeCurve(amount, STAGE_HARDNESS, next.drive.bias) : null;
      }
    }

    // Makeup gain. Saturation raises average level steeply and each extra stage
    // compounds it, so without this every drive change is mostly a volume change
    // and the limiter ends up doing all the work.
    const compensation = 1 / (1 + amount * 1.6 * Math.max(1, stageCount));
    setParam(postGain.gain, compensation);

    // ---- Cabinet ---------------------------------------------------------
    const cabKey = `${next.cab.model}:${next.cab.presenceDb}:${next.cab.resonanceDb}`;
    if (next.cab.enabled && cabKey !== currentCab) {
      currentCab = cabKey;
      const left = cabinetImpulse(ctx.sampleRate, next.cab.model, {
        presenceDb: next.cab.presenceDb,
        resonanceDb: next.cab.resonanceDb,
      });
      // The right channel is the same cabinet heard slightly off-axis: a little
      // less presence. Two different curves, no delay, so a mono sum is a tone
      // change and never a cancellation.
      const right = cabinetImpulse(ctx.sampleRate, next.cab.model, {
        presenceDb: next.cab.presenceDb - 2.5,
        resonanceDb: next.cab.resonanceDb + 0.5,
      });

      const bufferL = ctx.createBuffer(1, left.length, ctx.sampleRate);
      bufferL.copyToChannel(left, 0);
      const bufferR = ctx.createBuffer(1, right.length, ctx.sampleRate);
      bufferR.copyToChannel(right, 0);
      cabL.buffer = bufferL;
      cabR.buffer = bufferR;
    }

    const cabOn = next.cab.enabled && cabL.buffer !== null;
    setParam(cabBypass.gain, cabOn ? 0 : 1);
    // Halved because the two cab paths sum.
    setParam(panL.pan, cabOn ? -next.cab.width : 0);
    setParam(panR.pan, cabOn ? next.cab.width : 0);
    setParam(cabSum.gain, cabOn ? 0.5 : 1);

    setParam(depth.gain, next.cab.resonanceDb * 0.5);
    setParam(presence.gain, next.cab.presenceDb * 0.5);

    // ---- Sends -----------------------------------------------------------
    const delayOn = next.delay.enabled;
    setParam(delay.delayTime, Math.min(MAX_DELAY_SEC, Math.max(0.001, next.delay.timeSec)));
    // Clamped below 1: at or above it the loop never decays and runs away.
    setParam(feedback.gain, delayOn ? Math.min(0.9, Math.max(0, next.delay.feedback)) : 0);
    setParam(delayWet.gain, delayOn ? next.delay.mix : 0);

    if (next.reverb.enabled && Math.abs(next.reverb.sizeSec - currentReverbSeconds) > 0.05) {
      currentReverbSeconds = next.reverb.sizeSec;
      const tail = roomImpulse(ctx.sampleRate, next.reverb.sizeSec, 2);
      const buffer = ctx.createBuffer(2, tail[0].length, ctx.sampleRate);
      buffer.copyToChannel(tail[0], 0);
      buffer.copyToChannel(tail[1], 1);
      reverb.buffer = buffer;
    }
    setParam(reverbWet.gain, next.reverb.enabled && reverb.buffer ? next.reverb.mix : 0);

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
        bass,
        mid,
        treble,
        ...stages,
        ...interstage,
        ...interDc,
        postGain,
        cabSplit,
        cabL,
        cabR,
        panL,
        panR,
        cabBypass,
        cabSum,
        depth,
        presence,
        dry,
        delay,
        delayTone,
        feedback,
        delayWet,
        reverb,
        reverbWet,
        mixBus,
        outputTrim,
        limiter,
        output,
      ]);
    },
  };
}
