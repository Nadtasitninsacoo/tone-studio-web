/**
 * Brass & Woodwinds effects processor.
 *
 * Optimized for wind instruments (Saxophone, Trumpet, Flute, etc.).
 * Includes:
 * 1. **Input Trim**
 * 2. **Gate**
 * 3. **Compressor** - Standard compression to control intense horn peaks.
 * 4. **3-Band EQ** - Low Shelf (350 Hz - Warmth), Peaking (3.2 kHz - Bite), High Shelf (8.5 kHz - Air).
 * 5. **Delay** - Slapback delay for depth.
 * 6. **Reverb** - Convolver space reverb.
 * 7. **Limiter** - final brickwall peak protector.
 */

import { disconnectAll, makeParamSetter } from '@/lib/audioGraph';
import { roomImpulse } from '@/lib/cabinet';

export interface BrassSettings {
  inputDb: number;
  gate: { enabled: boolean; thresholdDb: number };
  comp: { enabled: boolean; thresholdDb: number; ratio: number; attack: number; release: number };
  eq: { lowDb: number; midDb: number; highDb: number };
  delay: { enabled: boolean; timeMs: number; feedback: number; mix: number };
  reverb: { enabled: boolean; sizeSec: number; mix: number };
  outputDb: number;
  limiter: { enabled: boolean; ceilingDb: number };
}

export const DEFAULT_BRASS: BrassSettings = {
  inputDb: 0,
  gate: { enabled: true, thresholdDb: -60 },
  comp: { enabled: true, thresholdDb: -16, ratio: 3.5, attack: 0.008, release: 0.22 },
  eq: { lowDb: 1, midDb: 2, highDb: 2 },
  delay: { enabled: false, timeMs: 300, feedback: 0.3, mix: 0.15 },
  reverb: { enabled: true, sizeSec: 2.2, mix: 0.18 },
  outputDb: 0,
  limiter: { enabled: true, ceilingDb: -0.3 },
};

export interface BrassPreset {
  id: string;
  label: string;
  latin: string;
  hint: string;
  keywords: readonly string[];
  settings: BrassSettings;
}

function withBrass(over: Partial<BrassSettings>): BrassSettings {
  return {
    ...DEFAULT_BRASS,
    ...over,
    gate: { ...DEFAULT_BRASS.gate, ...over.gate },
    comp: { ...DEFAULT_BRASS.comp, ...over.comp },
    eq: { ...DEFAULT_BRASS.eq, ...over.eq },
    delay: { ...DEFAULT_BRASS.delay, ...over.delay },
    reverb: { ...DEFAULT_BRASS.reverb, ...over.reverb },
    limiter: { ...DEFAULT_BRASS.limiter, ...over.limiter },
  };
}

export const BRASS_PRESETS: readonly BrassPreset[] = [
  {
    id: 'sax_solo',
    label: 'โซโล่แซก',
    latin: 'Sax Solo',
    hint: 'เสียงแซกโซโฟนพริ้วไหว โทนอุ่นหนาพุ่งเด่น ผสานรีเวิร์บมิติโถงและดีเลย์นุ่มนวล',
    keywords: ['แซก', 'แซกโซโฟน', 'sax', 'saxophone', 'solo', 'โซโล่'],
    settings: withBrass({
      comp: { enabled: true, thresholdDb: -18, ratio: 3, attack: 0.012, release: 0.2 },
      eq: { lowDb: 2.5, midDb: 3, highDb: 1 },
      delay: { enabled: true, timeMs: 350, feedback: 0.25, mix: 0.12 },
      reverb: { enabled: true, sizeSec: 2.4, mix: 0.2 },
    }),
  },
  {
    id: 'pop_horns',
    label: 'เครื่องเป่าป็อป',
    latin: 'Pop Horns',
    hint: 'เสียงทรัมเป็ต/กลุ่มแตรที่บีบอัดกระชับ กัดย่านกลาง คมชัดสไตล์เพลงป็อป/ลูกทุ่ง',
    keywords: ['เครื่องเป่า', 'แตร', 'trumpet', 'horns', 'pop', 'ลูกทุ่ง', 'คม'],
    settings: withBrass({
      comp: { enabled: true, thresholdDb: -22, ratio: 4, attack: 0.005, release: 0.15 },
      eq: { lowDb: 1, midDb: 4.5, highDb: 3.5 },
      delay: { enabled: true, timeMs: 200, feedback: 0.35, mix: 0.18 },
      reverb: { enabled: true, sizeSec: 1.4, mix: 0.12 },
    }),
  },
  {
    id: 'soft_flute',
    label: 'ขลุ่ยอุ่นนุ่ม',
    latin: 'Soft Wind',
    hint: 'เสียงขลุ่ยหรือเครื่องลมไม้อุ่นละมุน ตัดย่านแหลมสากหู หางยาวก้องดั่งหุบเขา',
    keywords: ['ขลุ่ย', 'flute', 'wind', 'นุ่ม', 'เบาๆ', 'ขลุ่ยอุ่น', 'ก้องๆ'],
    settings: withBrass({
      comp: { enabled: true, thresholdDb: -14, ratio: 2, attack: 0.02, release: 0.3 },
      eq: { lowDb: 1.5, midDb: 1, highDb: -3 },
      reverb: { enabled: true, sizeSec: 3.0, mix: 0.24 },
    }),
  },
];

export interface BrassChain {
  readonly input: AudioNode;
  readonly output: AudioNode;
  update(settings: BrassSettings): void;
  onMeter(handler: (source: 'gate' | 'limiter', reductionDb: number) => void): void;
  disconnect(): void;
}

export function createBrassChain(ctx: BaseAudioContext, settings: BrassSettings): BrassChain {
  const setParam = makeParamSetter(ctx);

  const input = ctx.createGain();

  const dcBlock = ctx.createBiquadFilter();
  dcBlock.type = 'highpass';
  dcBlock.frequency.value = 25;
  dcBlock.Q.value = 0.7;

  const trim = ctx.createGain();

  const gate = new AudioWorkletNode(ctx, 'gate-processor', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  });

  // ---- Compressor ----
  const comp = ctx.createDynamicsCompressor();
  comp.knee.value = 8;

  // ---- 3-Band EQ ----
  const eqLow = ctx.createBiquadFilter();
  eqLow.type = 'lowshelf';
  eqLow.frequency.value = 350;

  const eqMid = ctx.createBiquadFilter();
  eqMid.type = 'peaking';
  eqMid.frequency.value = 3200;
  eqMid.Q.value = 0.85;

  const eqHigh = ctx.createBiquadFilter();
  eqHigh.type = 'highshelf';
  eqHigh.frequency.value = 8500;

  // ---- Slapback Delay ----
  const delaySplit = ctx.createGain();
  const delayNode = ctx.createDelay(1.5);
  const delayFeedback = ctx.createGain();
  const delayWet = ctx.createGain();

  // ---- Convolver Reverb ----
  const reverbNode = ctx.createConvolver();
  reverbNode.normalize = true;
  const reverbWet = ctx.createGain();

  // ---- Output Trim & Limiter ----
  const mixBus = ctx.createGain();
  const outputTrim = ctx.createGain();

  const limiter = new AudioWorkletNode(ctx, 'limiter-processor', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  });

  const output = ctx.createGain();

  // ---- Wiring ----
  input.connect(dcBlock);
  dcBlock.connect(trim);
  trim.connect(gate);

  gate.connect(comp);
  comp.connect(eqLow);
  eqLow.connect(eqMid);
  eqMid.connect(eqHigh);

  eqHigh.connect(mixBus);

  // Delay
  eqHigh.connect(delaySplit);
  delaySplit.connect(delayNode);
  delayNode.connect(delayFeedback);
  delayFeedback.connect(delayNode); // feedback
  delayNode.connect(delayWet);
  delayWet.connect(mixBus);

  // Reverb
  eqHigh.connect(reverbNode);
  reverbNode.connect(reverbWet);
  reverbWet.connect(mixBus);

  mixBus.connect(outputTrim);
  outputTrim.connect(limiter);
  limiter.connect(output);

  // ---- Parameters ----
  let currentRoomSeconds = -1;

  const gateThreshold = gate.parameters.get('threshold');
  const gateEnabled = gate.parameters.get('enabled');
  const limiterCeiling = limiter.parameters.get('ceiling');
  const limiterEnabled = limiter.parameters.get('enabled');

  const update = (next: BrassSettings) => {
    setParam(trim.gain, 10 ** (next.inputDb / 20));

    if (gateThreshold) setParam(gateThreshold, next.gate.thresholdDb);
    if (gateEnabled) gateEnabled.value = next.gate.enabled ? 1 : 0;

    // Compressor
    setParam(comp.threshold, next.comp.enabled ? next.comp.thresholdDb : 0);
    setParam(comp.ratio, next.comp.enabled ? next.comp.ratio : 1);
    setParam(comp.attack, next.comp.enabled ? next.comp.attack : 0.01);
    setParam(comp.release, next.comp.enabled ? next.comp.release : 0.15);

    // EQ
    setParam(eqLow.gain, next.eq.lowDb);
    setParam(eqMid.gain, next.eq.midDb);
    setParam(eqHigh.gain, next.eq.highDb);

    // Delay
    setParam(delayNode.delayTime, next.delay.enabled ? next.delay.timeMs / 1000 : 0);
    setParam(delayFeedback.gain, next.delay.enabled ? next.delay.feedback : 0);
    setParam(delayWet.gain, next.delay.enabled ? next.delay.mix : 0);

    // Reverb
    if (next.reverb.enabled && Math.abs(next.reverb.sizeSec - currentRoomSeconds) > 0.05) {
      currentRoomSeconds = next.reverb.sizeSec;
      const tail = roomImpulse(ctx.sampleRate, next.reverb.sizeSec, 2);
      const buffer = ctx.createBuffer(2, tail[0].length, ctx.sampleRate);
      buffer.copyToChannel(tail[0], 0);
      buffer.copyToChannel(tail[1], 1);
      reverbNode.buffer = buffer;
    }
    setParam(reverbWet.gain, next.reverb.enabled && reverbNode.buffer ? next.reverb.mix : 0);

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
        eqLow,
        eqMid,
        eqHigh,
        delaySplit,
        delayNode,
        delayFeedback,
        delayWet,
        reverbNode,
        reverbWet,
        mixBus,
        outputTrim,
        limiter,
        output,
      ]);
    },
  };
}
