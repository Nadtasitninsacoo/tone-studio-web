/**
 * The amp's parameter ranges, and the clamp that enforces them.
 *
 * Pure: no Web Audio, no DOM, no React. `AmpSettings` is imported as a **type
 * only**, so this module — and everything that imports it — runs in Node. That is
 * load-bearing, not tidiness: `/api/tone/route.ts` runs on the server and must be
 * able to validate a settings object without dragging `createAmpChain` and its
 * `AudioWorkletNode` references into a Node process.
 *
 * ---------------------------------------------------------------------------
 * Why the ranges live here rather than in the rack that draws them.
 *
 * They were in `AmpRack`'s knob props, which was fine while a human dragging a
 * knob was the only way to change a setting. It stopped being fine the moment a
 * language model could propose one: a model that returns `drive.amount: 4` or
 * `reverb.sizeSec: 30` is not a bug to be debugged, it is Tuesday, and the graph
 * has to survive it. `clampAmp` is the boundary — nothing reaches `createAmpChain`
 * without passing through it.
 *
 * The numbers are duplicated in the rack's `min`/`max` props on purpose. A knob
 * whose travel disagreed with the clamp would move and then snap back, which is
 * worse than either bound alone; the Node checks assert the two agree.
 * ---------------------------------------------------------------------------
 */

import type { AmpSettings } from './ampFx';
import { MIC_POSITIONS, type CabinetId, type MicPosition } from './cabinet';

/** Inclusive `[min, max]` for every numeric parameter, keyed by a flat name. */
export const AMP_RANGES = {
  inputDb: [-12, 12],
  gateThresholdDb: [-80, -20],
  compThresholdDb: [-48, 0],
  compRatio: [1, 12],
  bassDb: [-12, 12],
  midDb: [-12, 12],
  midHz: [200, 2000],
  trebleDb: [-12, 12],
  driveAmount: [0, 1],
  driveBias: [0, 0.4],
  presenceDb: [-6, 6],
  resonanceDb: [-6, 6],
  width: [0, 1],
  delayTimeSec: [0.02, 1.5],
  delayFeedback: [0, 0.9],
  delayMix: [0, 1],
  reverbSizeSec: [0.3, 5],
  reverbMix: [0, 1],
  outputDb: [-24, 24],
  ceilingDb: [-12, 0],
} as const satisfies Record<string, readonly [number, number]>;

export type AmpRangeKey = keyof typeof AMP_RANGES;

/** Cabinet ids, as a runtime list. `cabinet.ts` owns the voicings; this is the enum. */
export const CABINET_IDS: readonly CabinetId[] = ['v30', 'greenback', 'american', 'jazz'];

/** Clamp one value into its documented range. NaN and Infinity fall back. */
export function clampTo(key: AmpRangeKey, value: unknown, fallback: number): number {
  const [min, max] = AMP_RANGES[key];
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

/** Read a boolean without coercing `undefined` to `false`. */
function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/**
 * Coerce anything into a valid `AmpSettings`.
 *
 * **Total**: never throws, never returns a partial object, and every field either
 * comes from `input` inside its range or from `base`. A model's reply, a stale
 * `localStorage` preset and a hand-written JSON body all arrive through the same
 * door, and all three can be wrong in the same ways.
 *
 * `base` defaults to the settings being replaced rather than to `DEFAULT_AMP`, so
 * a suggestion that only mentions the drive leaves the cabinet where the player
 * put it.
 */
export function clampAmp(input: unknown, base: AmpSettings): AmpSettings {
  const raw = record(input);
  const gate = record(raw.gate);
  const comp = record(raw.comp);
  const tone = record(raw.tone);
  const drive = record(raw.drive);
  const cab = record(raw.cab);
  const delay = record(raw.delay);
  const reverb = record(raw.reverb);
  const limiter = record(raw.limiter);

  // Stages is an enum, not a range: 1, 2 or 3. Rounding first means 2.7 becomes a
  // usable 3 rather than being discarded as "not one of the three".
  const stagesRaw = Math.round(Number(drive.stages));
  const stages: 1 | 2 | 3 = stagesRaw === 1 || stagesRaw === 2 || stagesRaw === 3
    ? stagesRaw
    : base.drive.stages;

  const model = CABINET_IDS.includes(cab.model as CabinetId)
    ? (cab.model as CabinetId)
    : base.cab.model;
  // Same treatment as the model: an unknown placement falls back to the one already
  // in use rather than to a constant, so a reply that got this field wrong leaves the
  // player's mic where they put it instead of moving it to `center`.
  const mic = MIC_POSITIONS.includes(cab.mic as MicPosition)
    ? (cab.mic as MicPosition)
    : base.cab.mic;

  return {
    inputDb: clampTo('inputDb', raw.inputDb, base.inputDb),
    gate: {
      enabled: bool(gate.enabled, base.gate.enabled),
      thresholdDb: clampTo('gateThresholdDb', gate.thresholdDb, base.gate.thresholdDb),
    },
    comp: {
      enabled: bool(comp.enabled, base.comp.enabled),
      thresholdDb: clampTo('compThresholdDb', comp.thresholdDb, base.comp.thresholdDb),
      ratio: clampTo('compRatio', comp.ratio, base.comp.ratio),
    },
    tone: {
      bassDb: clampTo('bassDb', tone.bassDb, base.tone.bassDb),
      midDb: clampTo('midDb', tone.midDb, base.tone.midDb),
      midHz: clampTo('midHz', tone.midHz, base.tone.midHz),
      trebleDb: clampTo('trebleDb', tone.trebleDb, base.tone.trebleDb),
    },
    drive: {
      enabled: bool(drive.enabled, base.drive.enabled),
      amount: clampTo('driveAmount', drive.amount, base.drive.amount),
      stages,
      bias: clampTo('driveBias', drive.bias, base.drive.bias),
    },
    cab: {
      enabled: bool(cab.enabled, base.cab.enabled),
      model,
      presenceDb: clampTo('presenceDb', cab.presenceDb, base.cab.presenceDb),
      resonanceDb: clampTo('resonanceDb', cab.resonanceDb, base.cab.resonanceDb),
      mic,
      width: clampTo('width', cab.width, base.cab.width),
    },
    delay: {
      enabled: bool(delay.enabled, base.delay.enabled),
      timeSec: clampTo('delayTimeSec', delay.timeSec, base.delay.timeSec),
      feedback: clampTo('delayFeedback', delay.feedback, base.delay.feedback),
      mix: clampTo('delayMix', delay.mix, base.delay.mix),
    },
    reverb: {
      enabled: bool(reverb.enabled, base.reverb.enabled),
      sizeSec: clampTo('reverbSizeSec', reverb.sizeSec, base.reverb.sizeSec),
      mix: clampTo('reverbMix', reverb.mix, base.reverb.mix),
    },
    outputDb: clampTo('outputDb', raw.outputDb, base.outputDb),
    limiter: {
      enabled: bool(limiter.enabled, base.limiter.enabled),
      ceilingDb: clampTo('ceilingDb', limiter.ceilingDb, base.limiter.ceilingDb),
    },
  };
}

/* --------------------------------------------------------------------------
   Describing a change.

   A tone suggestion that just swaps the settings is unreviewable: the player
   hears something different and has no idea which of fifteen controls moved. The
   diff is what makes it a suggestion rather than a surprise, and it is also the
   undo record.
-------------------------------------------------------------------------- */

export interface AmpChange {
  /** Short uppercase label, as the rack prints it. */
  label: string;
  from: string;
  to: string;
}

/** dB with an explicit sign. */
function db(value: number): string {
  return `${value > 0 ? '+' : ''}${value}`;
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function onOff(value: boolean): string {
  return value ? 'on' : 'off';
}

/**
 * Every field that differs, in signal order.
 *
 * Signal order rather than alphabetical: "GATE, TONE, DRIVE, CAB" reads as a
 * path through the amp, which is how the change is heard.
 */
export function ampDiff(before: AmpSettings, after: AmpSettings): AmpChange[] {
  const changes: AmpChange[] = [];
  const add = (label: string, from: string, to: string) => {
    if (from !== to) changes.push({ label, from, to });
  };

  add('INPUT', db(before.inputDb), db(after.inputDb));
  add('GATE', onOff(before.gate.enabled), onOff(after.gate.enabled));
  add('GATE THR', `${before.gate.thresholdDb}`, `${after.gate.thresholdDb}`);
  add('COMP', onOff(before.comp.enabled), onOff(after.comp.enabled));
  add('COMP THR', `${before.comp.thresholdDb}`, `${after.comp.thresholdDb}`);
  add('RATIO', `${before.comp.ratio}:1`, `${after.comp.ratio}:1`);
  add('BASS', db(before.tone.bassDb), db(after.tone.bassDb));
  add('MID', db(before.tone.midDb), db(after.tone.midDb));
  add('MID HZ', `${before.tone.midHz}`, `${after.tone.midHz}`);
  add('TREBLE', db(before.tone.trebleDb), db(after.tone.trebleDb));
  add('DRIVE', onOff(before.drive.enabled), onOff(after.drive.enabled));
  add('GAIN', pct(before.drive.amount), pct(after.drive.amount));
  add('STAGES', `${before.drive.stages}`, `${after.drive.stages}`);
  add('BIAS', before.drive.bias.toFixed(2), after.drive.bias.toFixed(2));
  add('CAB', onOff(before.cab.enabled), onOff(after.cab.enabled));
  add('CAB MODEL', before.cab.model, after.cab.model);
  add('MIC', before.cab.mic, after.cab.mic);
  add('PRESENCE', db(before.cab.presenceDb), db(after.cab.presenceDb));
  add('RESO', db(before.cab.resonanceDb), db(after.cab.resonanceDb));
  add('WIDTH', pct(before.cab.width), pct(after.cab.width));
  add('DELAY', onOff(before.delay.enabled), onOff(after.delay.enabled));
  add('TIME', `${Math.round(before.delay.timeSec * 1000)}ms`, `${Math.round(after.delay.timeSec * 1000)}ms`);
  add('REPEATS', pct(before.delay.feedback), pct(after.delay.feedback));
  add('DLY MIX', pct(before.delay.mix), pct(after.delay.mix));
  add('REVERB', onOff(before.reverb.enabled), onOff(after.reverb.enabled));
  add('SIZE', `${before.reverb.sizeSec.toFixed(1)}s`, `${after.reverb.sizeSec.toFixed(1)}s`);
  add('RVB MIX', pct(before.reverb.mix), pct(after.reverb.mix));
  add('OUTPUT', db(before.outputDb), db(after.outputDb));
  add('LIMITER', onOff(before.limiter.enabled), onOff(after.limiter.enabled));
  add('CEILING', before.limiter.ceilingDb.toFixed(1), after.limiter.ceilingDb.toFixed(1));

  return changes;
}
