/**
 * The drum bus.
 *
 * ---------------------------------------------------------------------------
 * This is a **bus processor, not an amp**, and the difference decides the whole
 * shape of it. A guitar amp and a bass rig make a sound; a drum chain is handed one
 * that already exists — a kit through a pair of mics, a room mic, a machine — and
 * its job is to make it hit harder and sit together. So there is no cabinet, no
 * valve cascade and no tone stack. There is a gate, an EQ, glue, and a parallel
 * path.
 *
 * The one thing worth knowing before turning knobs: **the punch comes from the
 * parallel path, not from the compressor in series.** Squashing a kit's dynamics to
 * make it louder makes it quieter — the transients are what "loud" means on a drum,
 * and a compressor across the bus removes exactly those. The classic move instead is
 * to crush a *copy* of the signal and blend it underneath: the copy supplies the
 * body and the room, the untouched original keeps every stick hit intact. That is
 * what `crush` and `punch` are, and it is why the compressor doing the crushing is
 * set far harder than anything in the other two racks.
 *
 * The EQ bands are named for the problem they solve on a kit rather than for their
 * frequency: 60 Hz is whether the kick is felt, 400 Hz is the cardboard box a small
 * room puts around a snare, 3.8 kHz is the stick hitting the head.
 * ---------------------------------------------------------------------------
 *
 * Same primitives as the other two racks — stock Web Audio plus the gate and
 * look-ahead limiter worklets from `public/worklets/amp-dsp-processor.js`, whose
 * module must already be loaded in the context.
 */

import { disconnectAll, makeParamSetter, saturationCurve } from '@/lib/audioGraph';
import { makeBypass, type RigQuality } from '@/lib/bypass';
import { roomImpulse } from '@/lib/cabinet';

/** How hard full saturation pushes. Gentler than a guitar: this is glue, not fuzz. */
const DRIVE_HARDNESS = 18;

/** Fixed EQ centres. Named for the problem, not the band. */
export const DRUM_EQ_HZ = { kick: 60, box: 400, snap: 3800 } as const;

export interface DrumSettings {
  inputDb: number;
  /** Shuts the room down between hits. Useful on a bleeding overhead pair. */
  gate: { enabled: boolean; thresholdDb: number };
  eq: { kickDb: number; boxDb: number; snapDb: number };
  /** Saturation across the bus, for glue rather than for dirt. */
  drive: { enabled: boolean; amount: number };
  /** The crushed parallel copy: how hard it is squashed, and how much is blended. */
  crush: { enabled: boolean; thresholdDb: number; ratio: number };
  punch: number;
  /** Short room, in parallel. A kit with no room sounds like samples. */
  room: { enabled: boolean; sizeSec: number; mix: number };
  /** Gentle bus compression, in series, after the blend. */
  glue: { enabled: boolean; thresholdDb: number; ratio: number };
  outputDb: number;
  limiter: { enabled: boolean; ceilingDb: number };
}

export const DEFAULT_DRUMS: DrumSettings = {
  inputDb: 0,
  gate: { enabled: false, thresholdDb: -54 },
  eq: { kickDb: 2, boxDb: -2, snapDb: 2 },
  drive: { enabled: true, amount: 0.15 },
  crush: { enabled: true, thresholdDb: -32, ratio: 10 },
  punch: 0.3,
  room: { enabled: true, sizeSec: 0.8, mix: 0.14 },
  glue: { enabled: true, thresholdDb: -14, ratio: 2 },
  outputDb: 0,
  limiter: { enabled: true, ceilingDb: -0.3 },
};

export interface DrumPreset {
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
  settings: DrumSettings;
}

function withDrums(over: Partial<DrumSettings>): DrumSettings {
  return {
    ...DEFAULT_DRUMS,
    ...over,
    gate: { ...DEFAULT_DRUMS.gate, ...over.gate },
    eq: { ...DEFAULT_DRUMS.eq, ...over.eq },
    drive: { ...DEFAULT_DRUMS.drive, ...over.drive },
    crush: { ...DEFAULT_DRUMS.crush, ...over.crush },
    room: { ...DEFAULT_DRUMS.room, ...over.room },
    glue: { ...DEFAULT_DRUMS.glue, ...over.glue },
    limiter: { ...DEFAULT_DRUMS.limiter, ...over.limiter },
  };
}

export const DRUM_PRESETS: readonly DrumPreset[] = [
  {
    id: 'natural',
    label: 'ธรรมชาติ',
    latin: 'Natural',
    hint: 'เกลี่ยเบาๆ ห้องพอได้บรรยากาศ ไม่บีบให้เสียไดนามิก',
    keywords: ['ธรรมชาติ', 'natural', 'acoustic', 'ปกติ', 'สดๆ'],
    settings: withDrums({
      eq: { kickDb: 1.5, boxDb: -1.5, snapDb: 1.5 },
      drive: { enabled: true, amount: 0.08 },
      crush: { enabled: true, thresholdDb: -30, ratio: 6 },
      punch: 0.18,
      room: { enabled: true, sizeSec: 0.9, mix: 0.16 },
      glue: { enabled: true, thresholdDb: -12, ratio: 1.6 },
    }),
  },
  {
    id: 'punch',
    label: 'ตึบ',
    latin: 'Punch',
    hint: 'ทางขนานหนักมือ หัวไม้ชัด กลองเตะรู้สึกได้',
    keywords: ['ตึบ', 'punch', 'punchy', 'ร็อค', 'rock', 'หนักแน่น'],
    settings: withDrums({
      eq: { kickDb: 3.5, boxDb: -3, snapDb: 3 },
      drive: { enabled: true, amount: 0.2 },
      crush: { enabled: true, thresholdDb: -36, ratio: 14 },
      punch: 0.45,
      room: { enabled: true, sizeSec: 0.7, mix: 0.12 },
      glue: { enabled: true, thresholdDb: -14, ratio: 2 },
    }),
  },
  {
    id: 'tight',
    label: 'แห้งแน่น',
    latin: 'Tight & dry',
    hint: 'เกตปิดห้องทิ้ง ตัด 400 ออก เหมาะกับห้องเล็กและกลองที่รั่วกันเยอะ',
    keywords: ['แห้งแน่น', 'tight', 'dry', 'gated', 'เกต', 'ห้องเล็ก'],
    settings: withDrums({
      gate: { enabled: true, thresholdDb: -46 },
      eq: { kickDb: 2.5, boxDb: -5, snapDb: 3 },
      drive: { enabled: true, amount: 0.12 },
      crush: { enabled: true, thresholdDb: -30, ratio: 8 },
      punch: 0.25,
      room: { enabled: false, sizeSec: 0.5, mix: 0.06 },
      glue: { enabled: true, thresholdDb: -12, ratio: 2.5 },
    }),
  },
  {
    id: 'room',
    label: 'ห้องกว้าง',
    latin: 'Big room',
    hint: 'ห้องยาว ผสมเยอะ ชุดกลองฟังใหญ่ขึ้นทั้งชุด',
    keywords: ['ห้องกว้าง', 'big room', 'room', 'ก้อง', 'ambient', 'แอมเบียนต์'],
    settings: withDrums({
      eq: { kickDb: 2, boxDb: -1, snapDb: 2.5 },
      drive: { enabled: true, amount: 0.18 },
      crush: { enabled: true, thresholdDb: -34, ratio: 10 },
      punch: 0.4,
      room: { enabled: true, sizeSec: 1.9, mix: 0.34 },
      glue: { enabled: true, thresholdDb: -15, ratio: 2 },
    }),
  },
  {
    id: 'isan',
    label: 'กลองยาว',
    latin: 'Klong yao',
    hint: 'ย่านต่ำเปิด กลางกลวงออก เสียงหนังกลองสด เหมือนตีกลางแจ้ง',
    keywords: ['กลองยาว', 'klong yao', 'kong yao', 'อีสาน', 'isan', 'หมอลำ', 'morlam', 'ขบวน'],
    settings: withDrums({
      // A klong yao is a hand drum with a huge low fundamental and a slap on the
      // rim; the useful information is at the two ends and the middle is the shell
      // ringing. Almost no gate: the decay of the head *is* the instrument.
      eq: { kickDb: 4, boxDb: -4, snapDb: 3.5 },
      drive: { enabled: true, amount: 0.24 },
      crush: { enabled: true, thresholdDb: -32, ratio: 8 },
      punch: 0.35,
      room: { enabled: true, sizeSec: 1.3, mix: 0.22 },
      glue: { enabled: true, thresholdDb: -13, ratio: 1.8 },
      outputDb: 1,
    }),
  },
  {
    id: 'lofi',
    label: 'โลไฟ',
    latin: 'Lo-fi',
    hint: 'อัดจนแบน ขับให้เพี้ยน ปลายตัด เหมือนหลุดมาจากเทป',
    keywords: ['โลไฟ', 'lofi', 'lo-fi', 'เทป', 'tape', 'vintage', 'ย้อนยุค'],
    settings: withDrums({
      eq: { kickDb: 1, boxDb: 1.5, snapDb: -4 },
      drive: { enabled: true, amount: 0.55 },
      crush: { enabled: true, thresholdDb: -40, ratio: 20 },
      punch: 0.7,
      room: { enabled: true, sizeSec: 0.6, mix: 0.1 },
      glue: { enabled: true, thresholdDb: -18, ratio: 4 },
    }),
  },
];

export interface DrumChain {
  readonly input: AudioNode;
  readonly output: AudioNode;
  update(settings: DrumSettings): void;
  /** Route the worklet processors out of the path, or back in. See lib/bypass.ts. */
  setQuality(quality: RigQuality): void;
  onMeter(handler: (source: 'gate' | 'limiter', reductionDb: number) => void): void;
  disconnect(): void;
}

export function createDrumChain(ctx: BaseAudioContext, settings: DrumSettings): DrumChain {
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

  // ---- EQ, before everything that reacts to level -------------------------
  // A compressor listens to what it is fed, so cutting the 400 Hz box *first* means
  // the crushed copy is not triggered by the problem being removed.
  const kick = ctx.createBiquadFilter();
  kick.type = 'lowshelf';
  kick.frequency.value = DRUM_EQ_HZ.kick;

  const box = ctx.createBiquadFilter();
  box.type = 'peaking';
  box.frequency.value = DRUM_EQ_HZ.box;
  box.Q.value = 1.1;

  const snap = ctx.createBiquadFilter();
  snap.type = 'highshelf';
  snap.frequency.value = DRUM_EQ_HZ.snap;

  const shaper = ctx.createWaveShaper();
  shaper.oversample = '2x';
  const driveTrim = ctx.createGain();

  /** Where the three parallel paths are taken from. */
  const split = ctx.createGain();

  const dry = ctx.createGain();
  dry.gain.value = 1;

  // ---- The crushed copy ---------------------------------------------------
  const crush = ctx.createDynamicsCompressor();
  // Fast attack and a short release, unlike the bass rig's: on a drum bus the point
  // is to catch the transient and then let go before the next hit, which is what
  // pulls the room and the decay up underneath the original.
  crush.knee.value = 3;
  crush.attack.value = 0.002;
  crush.release.value = 0.12;
  const crushGain = ctx.createGain();

  const room = ctx.createConvolver();
  room.normalize = true;
  const roomGain = ctx.createGain();

  const mixBus = ctx.createGain();

  // ---- Glue, in series, after the blend -----------------------------------
  const glue = ctx.createDynamicsCompressor();
  glue.knee.value = 8;
  glue.attack.value = 0.02;
  glue.release.value = 0.22;

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
  gate.connect(kick);
  kick.connect(box);
  box.connect(snap);
  snap.connect(shaper);
  shaper.connect(driveTrim);
  driveTrim.connect(split);

  split.connect(dry);
  dry.connect(mixBus);

  split.connect(crush);
  crush.connect(crushGain);
  crushGain.connect(mixBus);

  split.connect(room);
  room.connect(roomGain);
  roomGain.connect(mixBus);

  mixBus.connect(glue);
  glue.connect(outputTrim);
  outputTrim.connect(limiter);
  limiter.connect(output);

  // ---- Parameters ---------------------------------------------------------
  let currentRoomSeconds = -1;
  let currentDrive = -1;

  const gateThreshold = gate.parameters.get('threshold');
  const gateEnabled = gate.parameters.get('enabled');
  const limiterCeiling = limiter.parameters.get('ceiling');
  const limiterEnabled = limiter.parameters.get('enabled');

  const update = (next: DrumSettings) => {
    setParam(trim.gain, 10 ** (next.inputDb / 20));

    if (gateThreshold) setParam(gateThreshold, next.gate.thresholdDb);
    if (gateEnabled) gateEnabled.value = next.gate.enabled ? 1 : 0;

    setParam(kick.gain, next.eq.kickDb);
    setParam(box.gain, next.eq.boxDb);
    setParam(snap.gain, next.eq.snapDb);

    const amount = next.drive.enabled ? next.drive.amount : 0;
    if (amount !== currentDrive) {
      currentDrive = amount;
      shaper.curve = amount > 0 ? saturationCurve(amount, DRIVE_HARDNESS) : null;
    }
    setParam(driveTrim.gain, 1 / (1 + amount * 1.1));

    setParam(crush.threshold, next.crush.enabled ? next.crush.thresholdDb : 0);
    setParam(crush.ratio, next.crush.enabled ? next.crush.ratio : 1);

    // The dry path stays at unity and the copy is added underneath it, rather than
    // crossfading between them. That is what parallel compression is: the original
    // transients are never attenuated, so `punch` can only add.
    const punch = next.crush.enabled ? Math.min(1, Math.max(0, next.punch)) : 0;
    setParam(crushGain.gain, punch);

    if (next.room.enabled && Math.abs(next.room.sizeSec - currentRoomSeconds) > 0.05) {
      currentRoomSeconds = next.room.sizeSec;
      const tail = roomImpulse(ctx.sampleRate, next.room.sizeSec, 2);
      const buffer = ctx.createBuffer(2, tail[0].length, ctx.sampleRate);
      buffer.copyToChannel(tail[0], 0);
      buffer.copyToChannel(tail[1], 1);
      room.buffer = buffer;
    }
    setParam(roomGain.gain, next.room.enabled && room.buffer ? next.room.mix : 0);

    setParam(glue.threshold, next.glue.enabled ? next.glue.thresholdDb : 0);
    setParam(glue.ratio, next.glue.enabled ? next.glue.ratio : 1);

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
  const gateBypass = makeBypass(trim, gate, kick);
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
      gate.port.onmessage = null;
      limiter.port.onmessage = null;
      disconnectAll([
        input,
        dcBlock,
        trim,
        gate,
        kick,
        box,
        snap,
        shaper,
        driveTrim,
        split,
        dry,
        crush,
        crushGain,
        room,
        roomGain,
        mixBus,
        glue,
        outputTrim,
        limiter,
        output,
      ]);
    },
  };
}
