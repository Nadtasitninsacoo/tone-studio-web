/**
 * Vocal effects processor.
 *
 * ---------------------------------------------------------------------------
 * This is a **vocal channel strip**, designed for processing vocals to sit cleanly
 * in a mix. It includes:
 *
 * 1. **Noise Gate** - Clean up silences between phrases.
 * 2. **Split-band De-esser** - Sibilance frequencies (5 kHz - 8 kHz) are split and
 *    compressed separately using a fast dynamic compressor to reduce harsh 's' sounds.
 * 3. **EQ** - Low Cut (highpass) at 100 Hz to remove mud, plus low-shelf (body),
 *    peaking (presence/warmth), and high-shelf (air/shimmer).
 * 4. **Compressor** - Standard vocal compressor to even out dynamic performance.
 * 5. **Delay** - Tape-style feedback delay with a lowpass filter in the feedback loop.
 * 6. **Reverb** - Convolver-based reverb using the room impulse builder.
 * 7. **Limiter** - Look-ahead brickwall limiter for peak protection.
 * ---------------------------------------------------------------------------
 */

import { disconnectAll, makeParamSetter } from '@/lib/audioGraph';
import { roomImpulse } from '@/lib/cabinet';

export interface VocalSettings {
  inputDb: number;
  gate: { enabled: boolean; thresholdDb: number };
  deEsser: { enabled: boolean; thresholdDb: number; ratio: number };
  comp: { enabled: boolean; thresholdDb: number; ratio: number; attack: number; release: number };
  eq: { lowCutEnabled: boolean; bodyDb: number; presenceDb: number; airDb: number };
  delay: { enabled: boolean; timeMs: number; feedback: number; mix: number };
  reverb: { enabled: boolean; sizeSec: number; mix: number };
  outputDb: number;
  limiter: { enabled: boolean; ceilingDb: number };
}

export const DEFAULT_VOCALS: VocalSettings = {
  inputDb: 0,
  gate: { enabled: true, thresholdDb: -60 },
  deEsser: { enabled: true, thresholdDb: -32, ratio: 4.5 },
  comp: { enabled: true, thresholdDb: -18, ratio: 3.5, attack: 0.015, release: 0.2 },
  eq: { lowCutEnabled: true, bodyDb: 1, presenceDb: 2, airDb: 3 },
  delay: { enabled: false, timeMs: 400, feedback: 0.35, mix: 0.2 },
  reverb: { enabled: true, sizeSec: 1.8, mix: 0.18 },
  outputDb: 0,
  limiter: { enabled: true, ceilingDb: -0.3 },
};

export interface VocalPreset {
  id: string;
  label: string;
  latin: string;
  hint: string;
  keywords: readonly string[];
  settings: VocalSettings;
}

function withVocals(over: Partial<VocalSettings>): VocalSettings {
  return {
    ...DEFAULT_VOCALS,
    ...over,
    gate: { ...DEFAULT_VOCALS.gate, ...over.gate },
    deEsser: { ...DEFAULT_VOCALS.deEsser, ...over.deEsser },
    comp: { ...DEFAULT_VOCALS.comp, ...over.comp },
    eq: { ...DEFAULT_VOCALS.eq, ...over.eq },
    delay: { ...DEFAULT_VOCALS.delay, ...over.delay },
    reverb: { ...DEFAULT_VOCALS.reverb, ...over.reverb },
    limiter: { ...DEFAULT_VOCALS.limiter, ...over.limiter },
  };
}

export const VOCAL_PRESETS: readonly VocalPreset[] = [
  {
    id: 'natural',
    label: 'ธรรมชาติ',
    latin: 'Natural',
    hint: 'เสียงใสเป็นธรรมชาติ คอมเพรสเซอร์บางเบา สะท้อนห้องสั้นๆ',
    keywords: ['ธรรมชาติ', 'natural', 'ปกติ', 'acoustic', 'ใส', 'ใสๆ'],
    settings: withVocals({
      comp: { enabled: true, thresholdDb: -14, ratio: 2.5, attack: 0.02, release: 0.25 },
      eq: { lowCutEnabled: true, bodyDb: 0, presenceDb: 1, airDb: 1.5 },
      reverb: { enabled: true, sizeSec: 1.2, mix: 0.12 },
    }),
  },
  {
    id: 'pop',
    label: 'ร้องนำป็อป',
    latin: 'Pop Lead',
    hint: 'เสียงสว่างใสมีประกาย (Air) บีบกระชับ มิติมีชีวิตชีวาด้วย Reverb & Delay',
    keywords: ['ป๊อป', 'ป็อป', 'pop', 'lead', 'ร้องนำ', 'หวาน', 'สว่าง'],
    settings: withVocals({
      comp: { enabled: true, thresholdDb: -20, ratio: 4, attack: 0.012, release: 0.15 },
      eq: { lowCutEnabled: true, bodyDb: 1.5, presenceDb: 2.5, airDb: 4.5 },
      delay: { enabled: true, timeMs: 380, feedback: 0.28, mix: 0.15 },
      reverb: { enabled: true, sizeSec: 1.8, mix: 0.2 },
    }),
  },
  {
    id: 'ballad',
    label: 'เพลงร้องนุ่ม',
    latin: 'Warm Ballad',
    hint: 'ย่านล่างหนาอุ่น คอมเพรสเซอร์ช้าคุมไดนามิกเนียนตา ห้องกว้างโอบล้อม',
    keywords: ['หนา', 'นุ่ม', 'อุ่น', 'ballad', 'slow', 'warm', 'เพลงช้า'],
    settings: withVocals({
      comp: { enabled: true, thresholdDb: -16, ratio: 3, attack: 0.025, release: 0.32 },
      eq: { lowCutEnabled: true, bodyDb: 3, presenceDb: 1.5, airDb: 2 },
      reverb: { enabled: true, sizeSec: 2.4, mix: 0.22 },
    }),
  },
  {
    id: 'concert',
    label: 'เวทีคอนเสิร์ต',
    latin: 'Concert Hall',
    hint: 'มิติพื้นที่ขนาดใหญ่และหางเสียงยาว เหมาะกับเพลงชวนลอยฝัน',
    keywords: ['เวที', 'คอนเสิร์ต', 'concert', 'hall', 'space', 'ก้อง', 'อารีน่า'],
    settings: withVocals({
      comp: { enabled: true, thresholdDb: -22, ratio: 4.5, attack: 0.015, release: 0.22 },
      eq: { lowCutEnabled: true, bodyDb: 2, presenceDb: 2, airDb: 3.5 },
      delay: { enabled: true, timeMs: 440, feedback: 0.4, mix: 0.25 },
      reverb: { enabled: true, sizeSec: 3.2, mix: 0.28 },
    }),
  },
  {
    id: 'isan',
    label: 'หมอลำ / ลูกทุ่ง',
    latin: 'Morlam Echo',
    hint: 'เสียงพุ่งเด่นหน้าเวที ปรับดีเลย์สะท้อนซ้ำเร็วสไตล์ลูกทุ่งกลางแจ้ง',
    keywords: ['หมอลำ', 'ลูกทุ่ง', 'morlam', 'echo', 'slapback', 'ดีเลย์เยอะ', 'อีสาน'],
    settings: withVocals({
      comp: { enabled: true, thresholdDb: -24, ratio: 5, attack: 0.01, release: 0.18 },
      eq: { lowCutEnabled: true, bodyDb: 1, presenceDb: 4.5, airDb: 3 },
      delay: { enabled: true, timeMs: 250, feedback: 0.45, mix: 0.32 },
      reverb: { enabled: true, sizeSec: 1.5, mix: 0.15 },
      outputDb: 1,
    }),
  },
];

export interface VocalChain {
  readonly input: AudioNode;
  readonly output: AudioNode;
  update(settings: VocalSettings): void;
  onMeter(handler: (source: 'gate' | 'limiter', reductionDb: number) => void): void;
  disconnect(): void;
}

export function createVocalChain(ctx: BaseAudioContext, settings: VocalSettings): VocalChain {
  const setParam = makeParamSetter(ctx);

  const input = ctx.createGain();

  // DC offset removal
  const dcBlock = ctx.createBiquadFilter();
  dcBlock.type = 'highpass';
  dcBlock.frequency.value = 30; // Vocal sub-bass cutoff
  dcBlock.Q.value = 0.7;

  const trim = ctx.createGain();

  const gate = new AudioWorkletNode(ctx, 'gate-processor', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  });

  // ---- Low Cut (Vocal Highpass Filter) ----
  const lowCut = ctx.createBiquadFilter();
  lowCut.type = 'highpass';
  lowCut.frequency.value = 100;
  lowCut.Q.value = 0.707;

  // ---- Split-Band De-esser (crossover at 5 kHz) ----
  const dsSplit = ctx.createGain();
  const dsLow = ctx.createBiquadFilter();
  dsLow.type = 'lowpass';
  dsLow.frequency.value = 5000;

  const dsHigh = ctx.createBiquadFilter();
  dsHigh.type = 'highpass';
  dsHigh.frequency.value = 5000;

  const dsComp = ctx.createDynamicsCompressor();
  dsComp.knee.value = 4;
  dsComp.attack.value = 0.005; // Quick clamp on sibilants
  dsComp.release.value = 0.05; // Release fast before next vowel

  const dsSum = ctx.createGain();

  // ---- Vocal Compressor ----
  const comp = ctx.createDynamicsCompressor();
  comp.knee.value = 8; // Soft knee

  // ---- Vocal EQ ----
  // Low-shelf (Warmth / Body) around 200 Hz
  const eqBody = ctx.createBiquadFilter();
  eqBody.type = 'lowshelf';
  eqBody.frequency.value = 200;

  // Peaking (Presence) around 2.5 kHz
  const eqPresence = ctx.createBiquadFilter();
  eqPresence.type = 'peaking';
  eqPresence.frequency.value = 2500;
  eqPresence.Q.value = 0.8;

  // High-shelf (Air) around 12 kHz
  const eqAir = ctx.createBiquadFilter();
  eqAir.type = 'highshelf';
  eqAir.frequency.value = 12000;

  // ---- Delay (with feedback loop and damping filter) ----
  const delaySplit = ctx.createGain();
  const delayNode = ctx.createDelay(2.0); // 2 seconds max delay
  const delayFeedback = ctx.createGain();
  const delayDamp = ctx.createBiquadFilter(); // Tape-style damping
  delayDamp.type = 'lowpass';
  delayDamp.frequency.value = 2500;
  const delayWet = ctx.createGain();

  // ---- Reverb Convolver ----
  const reverbNode = ctx.createConvolver();
  reverbNode.normalize = true;
  const reverbWet = ctx.createGain();

  // ---- Sum and output ----
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
  gate.connect(lowCut);

  // De-esser split
  lowCut.connect(dsSplit);
  dsSplit.connect(dsLow);
  dsSplit.connect(dsHigh);
  dsHigh.connect(dsComp);

  dsLow.connect(dsSum);
  dsComp.connect(dsSum);

  // Compressor & EQ
  dsSum.connect(comp);
  comp.connect(eqBody);
  eqBody.connect(eqPresence);
  eqPresence.connect(eqAir);

  // FX split
  eqAir.connect(mixBus); // dry amped route

  // Delay loop: eqAir -> delaySplit -> delayNode -> delayDamp -> delayFeedback -> delayNode
  eqAir.connect(delaySplit);
  delaySplit.connect(delayNode);
  delayNode.connect(delayDamp);
  delayDamp.connect(delayFeedback);
  delayFeedback.connect(delayNode); // feedback loop
  delayDamp.connect(delayWet);
  delayWet.connect(mixBus);

  // Reverb path
  eqAir.connect(reverbNode);
  reverbNode.connect(reverbWet);
  reverbWet.connect(mixBus);

  // Output
  mixBus.connect(outputTrim);
  outputTrim.connect(limiter);
  limiter.connect(output);

  // ---- Parameters ----
  let currentRoomSeconds = -1;

  const gateThreshold = gate.parameters.get('threshold');
  const gateEnabled = gate.parameters.get('enabled');
  const limiterCeiling = limiter.parameters.get('ceiling');
  const limiterEnabled = limiter.parameters.get('enabled');

  const update = (next: VocalSettings) => {
    setParam(trim.gain, 10 ** (next.inputDb / 20));

    if (gateThreshold) setParam(gateThreshold, next.gate.thresholdDb);
    if (gateEnabled) gateEnabled.value = next.gate.enabled ? 1 : 0;

    // Toggle low cut
    setParam(lowCut.frequency, next.eq.lowCutEnabled ? 100 : 20); // bypass low cut by sliding below audibility

    // De-esser
    setParam(dsComp.threshold, next.deEsser.enabled ? next.deEsser.thresholdDb : 0);
    setParam(dsComp.ratio, next.deEsser.enabled ? next.deEsser.ratio : 1);

    // Compressor
    setParam(comp.threshold, next.comp.enabled ? next.comp.thresholdDb : 0);
    setParam(comp.ratio, next.comp.enabled ? next.comp.ratio : 1);
    setParam(comp.attack, next.comp.enabled ? next.comp.attack : 0.01);
    setParam(comp.release, next.comp.enabled ? next.comp.release : 0.1);

    // EQ
    setParam(eqBody.gain, next.eq.bodyDb);
    setParam(eqPresence.gain, next.eq.presenceDb);
    setParam(eqAir.gain, next.eq.airDb);

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
        lowCut,
        dsSplit,
        dsLow,
        dsHigh,
        dsComp,
        dsSum,
        comp,
        eqBody,
        eqPresence,
        eqAir,
        delaySplit,
        delayNode,
        delayFeedback,
        delayDamp,
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
