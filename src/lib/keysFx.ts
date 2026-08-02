/**
 * Keyboard / Piano / Synthesizer effects processor.
 *
 * Includes:
 * 1. **Input Trim**
 * 2. **Gate**
 * 3. **Stereo Chorus** - Uses modulated delay lines with an LFO to create width and depth.
 * 4. **Compressor** - Balances velocity and expression.
 * 5. **3-Band EQ** - Low Shelf (180 Hz), Peaking (1.2 kHz), High Shelf (10 kHz).
 * 6. **Reverb** - Convolver space reverb.
 * 7. **Limiter** - Final brickwall peak protector.
 */

import { disconnectAll, makeParamSetter } from '@/lib/audioGraph';
import { makeBypass, type RigQuality } from '@/lib/bypass';
import { roomImpulse } from '@/lib/cabinet';

export interface KeysSettings {
  inputDb: number;
  gate: { enabled: boolean; thresholdDb: number };
  chorus: { enabled: boolean; rateHz: number; depthMs: number; mix: number };
  comp: { enabled: boolean; thresholdDb: number; ratio: number };
  eq: { lowDb: number; midDb: number; highDb: number };
  reverb: { enabled: boolean; sizeSec: number; mix: number };
  outputDb: number;
  limiter: { enabled: boolean; ceilingDb: number };
}

export const DEFAULT_KEYS: KeysSettings = {
  inputDb: 0,
  gate: { enabled: false, thresholdDb: -60 },
  chorus: { enabled: true, rateHz: 0.8, depthMs: 2.5, mix: 0.25 },
  comp: { enabled: true, thresholdDb: -16, ratio: 2.5 },
  eq: { lowDb: 0, midDb: 0, highDb: 1.5 },
  reverb: { enabled: true, sizeSec: 2.0, mix: 0.15 },
  outputDb: 0,
  limiter: { enabled: true, ceilingDb: -0.3 },
};

export interface KeysPreset {
  id: string;
  label: string;
  latin: string;
  hint: string;
  keywords: readonly string[];
  settings: KeysSettings;
}

function withKeys(over: Partial<KeysSettings>): KeysSettings {
  return {
    ...DEFAULT_KEYS,
    ...over,
    gate: { ...DEFAULT_KEYS.gate, ...over.gate },
    chorus: { ...DEFAULT_KEYS.chorus, ...over.chorus },
    comp: { ...DEFAULT_KEYS.comp, ...over.comp },
    eq: { ...DEFAULT_KEYS.eq, ...over.eq },
    reverb: { ...DEFAULT_KEYS.reverb, ...over.reverb },
    limiter: { ...DEFAULT_KEYS.limiter, ...over.limiter },
  };
}

export const KEYS_PRESETS: readonly KeysPreset[] = [
  {
    id: 'stereo_piano',
    label: 'เปียโนกว้าง',
    latin: 'Wide Stereo',
    hint: 'เสียงเปียโนสเตอริโอกว้างขวาง โครัสละเอียดนุ่มนวล พร้อมรีเวิร์บมิติโอบล้อม',
    keywords: ['เปียโน', 'เปียโนกว้าง', 'กว้าง', 'stereo', 'acoustic piano', 'ก้อง'],
    settings: withKeys({
      chorus: { enabled: true, rateHz: 0.6, depthMs: 2.0, mix: 0.2 },
      eq: { lowDb: 1, midDb: -1, highDb: 2.5 },
      reverb: { enabled: true, sizeSec: 2.2, mix: 0.22 },
    }),
  },
  {
    id: 'warm_rhodes',
    label: 'คลาสสิกอุ่น',
    latin: 'Warm Rhodes',
    hint: 'เสียงเปียโนไฟฟ้าอุ่นกลมมน โครัสชัดเจนเพิ่มประกายหางเสียงสไตล์วินเทจ',
    keywords: ['อุ่น', 'rhodes', 'คลาสสิก', 'vintage', 'โรดส์', 'เปียโนไฟฟ้า'],
    settings: withKeys({
      chorus: { enabled: true, rateHz: 1.1, depthMs: 3.5, mix: 0.45 },
      eq: { lowDb: 2, midDb: 1, highDb: -1 },
      reverb: { enabled: true, sizeSec: 1.6, mix: 0.15 },
    }),
  },
  {
    id: 'synth_lead',
    label: 'ซินธ์นำพุ่ง',
    latin: 'Synth Lead',
    hint: 'เสียงคีย์บอร์ดซินธ์ลีดโดดเด่น คอมเพรสเซอร์แน่นหนา EQ กลางชัดให้ท่วงทำนองนำวง',
    keywords: ['ซินธ์', 'synth', 'lead', 'โซโล่', 'ลีด', 'พุ่ง', 'หนา'],
    settings: withKeys({
      chorus: { enabled: true, rateHz: 1.5, depthMs: 1.5, mix: 0.18 },
      comp: { enabled: true, thresholdDb: -22, ratio: 4 },
      eq: { lowDb: -2, midDb: 3.5, highDb: 2 },
      reverb: { enabled: true, sizeSec: 1.2, mix: 0.1 },
    }),
  },
  {
    id: 'ambient_pad',
    label: 'แอมเบียนต์ลอย',
    latin: 'Ambient Pad',
    hint: 'เสียงคีย์บอร์ดแบ็คกราวด์กว้างและฟุ้ง ลอยละล่อง หางยาวหนาพิเศษ',
    keywords: ['ลอย', 'ฟุ้ง', 'ambient', 'pad', 'แอมเบียนต์', 'ยาวๆ', 'อวกาศ'],
    settings: withKeys({
      chorus: { enabled: true, rateHz: 0.4, depthMs: 4.0, mix: 0.35 },
      comp: { enabled: true, thresholdDb: -26, ratio: 3.5 },
      eq: { lowDb: 2, midDb: -1.5, highDb: 3 },
      reverb: { enabled: true, sizeSec: 4.2, mix: 0.38 },
    }),
  },
];

export interface KeysChain {
  readonly input: AudioNode;
  readonly output: AudioNode;
  update(settings: KeysSettings): void;
  /** Route the worklet processors out of the path, or back in. See lib/bypass.ts. */
  setQuality(quality: RigQuality): void;
  onMeter(handler: (source: 'gate' | 'limiter', reductionDb: number) => void): void;
  disconnect(): void;
}

export function createKeysChain(ctx: BaseAudioContext, settings: KeysSettings): KeysChain {
  const setParam = makeParamSetter(ctx);

  const input = ctx.createGain();

  const dcBlock = ctx.createBiquadFilter();
  dcBlock.type = 'highpass';
  dcBlock.frequency.value = 20;
  dcBlock.Q.value = 0.7;

  const trim = ctx.createGain();

  const gate = new AudioWorkletNode(ctx, 'gate-processor', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  });

  // ---- Stereo Chorus ----
  // Split signal into dry path and modulated delay paths (left & right modulated by LFO)
  const chorusSplit = ctx.createGain();
  const chorusDry = ctx.createGain();
  const chorusWetL = ctx.createDelay(0.1);
  const chorusWetR = ctx.createDelay(0.1);

  // LFO modulation: Sine oscillator for stereo widening (inverted phase on right)
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';

  const lfoGainL = ctx.createGain();
  const lfoGainR = ctx.createGain();

  const chorusWetSum = ctx.createGain();
  const chorusSum = ctx.createGain();

  // ---- Compressor ----
  const comp = ctx.createDynamicsCompressor();
  comp.knee.value = 10;
  comp.attack.value = 0.015;
  comp.release.value = 0.2;

  // ---- 3-Band EQ ----
  const eqLow = ctx.createBiquadFilter();
  eqLow.type = 'lowshelf';
  eqLow.frequency.value = 180;

  const eqMid = ctx.createBiquadFilter();
  eqMid.type = 'peaking';
  eqMid.frequency.value = 1200;
  eqMid.Q.value = 0.8;

  const eqHigh = ctx.createBiquadFilter();
  eqHigh.type = 'highshelf';
  eqHigh.frequency.value = 10000;

  // ---- Convolver Reverb ----
  const reverbNode = ctx.createConvolver();
  reverbNode.normalize = true;
  const reverbWet = ctx.createGain();

  // ---- Output & Limiter ----
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

  // Chorus wiring
  gate.connect(chorusSplit);
  chorusSplit.connect(chorusDry);
  chorusSplit.connect(chorusWetL);
  chorusSplit.connect(chorusWetR);

  // LFO modulation setup
  lfo.connect(lfoGainL);
  lfo.connect(lfoGainR);
  lfoGainL.connect(chorusWetL.delayTime);
  lfoGainR.connect(chorusWetR.delayTime);

  // Re-sum chorus outputs (left & right outputs go to summing bus)
  // Web Audio merges stereo outputs automatically, but we model as stereo chain
  chorusDry.connect(chorusSum);
  chorusWetL.connect(chorusWetSum);
  chorusWetR.connect(chorusWetSum);
  chorusWetSum.connect(chorusSum);

  // Route chorus sum to Compressor, EQ, and Reverb
  chorusSum.connect(comp);
  comp.connect(eqLow);
  eqLow.connect(eqMid);
  eqMid.connect(eqHigh);

  // Mix output
  eqHigh.connect(mixBus);

  // Reverb path
  eqHigh.connect(reverbNode);
  reverbNode.connect(reverbWet);
  reverbWet.connect(mixBus);

  // Final trim and safety limiter
  mixBus.connect(outputTrim);
  outputTrim.connect(limiter);
  limiter.connect(output);

  // Start LFO
  lfo.start();

  // ---- Parameters ----
  let currentRoomSeconds = -1;

  const gateThreshold = gate.parameters.get('threshold');
  const gateEnabled = gate.parameters.get('enabled');
  const limiterCeiling = limiter.parameters.get('ceiling');
  const limiterEnabled = limiter.parameters.get('enabled');

  const update = (next: KeysSettings) => {
    setParam(trim.gain, 10 ** (next.inputDb / 20));

    if (gateThreshold) setParam(gateThreshold, next.gate.thresholdDb);
    if (gateEnabled) gateEnabled.value = next.gate.enabled ? 1 : 0;

    // Chorus LFO configuration
    lfo.frequency.value = next.chorus.rateHz;
    // Set base delay offset (e.g. 20ms) and depth
    const chorusOn = next.chorus.enabled;
    const depthSec = next.chorus.depthMs / 1000;
    chorusWetL.delayTime.value = 0.02;
    chorusWetR.delayTime.value = 0.02;

    setParam(lfoGainL.gain, chorusOn ? depthSec : 0);
    setParam(lfoGainR.gain, chorusOn ? -depthSec : 0); // inverted phase for width
    setParam(chorusDry.gain, chorusOn ? 1.0 - next.chorus.mix * 0.5 : 1.0);
    setParam(chorusWetSum.gain, chorusOn ? next.chorus.mix : 0);

    // Compressor
    setParam(comp.threshold, next.comp.enabled ? next.comp.thresholdDb : 0);
    setParam(comp.ratio, next.comp.enabled ? next.comp.ratio : 1);

    // EQ
    setParam(eqLow.gain, next.eq.lowDb);
    setParam(eqMid.gain, next.eq.midDb);
    setParam(eqHigh.gain, next.eq.highDb);

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

  /**
   * The two worklets, and the only two things `light` takes out. See `lib/bypass.ts`.
   *
   * Everything else here is native: convolvers, biquads and waveshapers are C++ inside the
   * browser, and a neutralised one costs a few multiplies. These two are JavaScript called
   * every 128 samples whether or not they are doing anything, and there are two per rack.
   */
  const gateBypass = makeBypass(trim, gate, chorusSplit);
  const limiterBypass = makeBypass(outputTrim, limiter, output);

  return {
    input,
    output,
    update,
    setQuality(quality: RigQuality) {
      gateBypass(quality === 'full');
      limiterBypass(quality === 'full');
    },
    onMeter(handler) {
      gate.port.onmessage = (event) => {
        if (event.data?.type === 'meter') handler('gate', event.data.reductionDb);
      };
      limiter.port.onmessage = (event) => {
        if (event.data?.type === 'meter') handler('limiter', event.data.reductionDb);
      };
    },
    disconnect() {
      try {
        lfo.stop();
      } catch {
        // Safe to ignore if already stopped
      }
      gate.port.onmessage = null;
      limiter.port.onmessage = null;
      disconnectAll([
        input,
        dcBlock,
        trim,
        gate,
        chorusSplit,
        chorusDry,
        chorusWetL,
        chorusWetR,
        lfo,
        lfoGainL,
        lfoGainR,
        chorusWetSum,
        chorusSum,
        comp,
        eqLow,
        eqMid,
        eqHigh,
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
