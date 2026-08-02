/**
 * Ranges, clamps and diffs for the bass rig and the drum bus.
 *
 * The sibling of `ampSchema.ts`, and it exists for exactly the same reason: a model
 * can now propose bass and drum settings, and `crush.ratio: 90` is not a bug report,
 * it is Tuesday. `clampBass` and `clampDrums` are the boundary — nothing reaches
 * `createBassChain` or `createDrumChain` without passing through one of them.
 *
 * Pure: types only from the chains, so this runs under Node like the rest of `lib/`.
 * Every number here is duplicated in the racks' knob `min`/`max`, and the Node checks
 * assert the two agree — a knob whose travel disagreed with the clamp would move and
 * then snap back, which is worse than either bound alone.
 */

import type { AmpChange } from './ampSchema';
import type { BassSettings } from './bassFx';
import type { DrumSettings } from './drumFx';
import type { VocalSettings } from './vocalFx';
import type { KeysSettings } from './keysFx';
import type { BrassSettings } from './brassFx';

export const BASS_RANGES = {
  inputDb: [-12, 12],
  gateThresholdDb: [-80, -20],
  compThresholdDb: [-48, 0],
  compRatio: [1, 12],
  /**
   * Compressor timing, in ms.
   *
   * 1 ms is faster than a bass transient (a low E's period is 24 ms), which is what
   * "tight" needs; 60 ms is slow enough to pass the whole attack untouched, which is what
   * "thunder" needs. Release from 40 ms — any shorter and it pumps on the note itself —
   * to 800 ms, about the length of a bass note's useful tail.
   */
  compAttackMs: [1, 60],
  compReleaseMs: [40, 800],
  crossoverHz: [80, 400],
  lowDb: [-12, 12],
  driveAmount: [0, 1],
  driveBias: [0, 0.4],
  eqDb: [-12, 12],
  presenceDb: [-6, 6],
  /**
   * Widened from ±6 for the thunder end.
   *
   * This is an offset on the cabinet's own resonance (3–5 dB depending on the model), so
   * ±9 lets a 1×15 be pushed to a genuinely booming peak or damped nearly flat. Not ±12:
   * past about +9 dB on top of the model's own figure the peak stops sounding like a
   * cabinet and starts sounding like a filter self-oscillating.
   */
  resonanceDb: [-9, 9],
  diMix: [0, 1],
  outputDb: [-24, 24],
  ceilingDb: [-12, 0],
} as const;

export const DRUM_RANGES = {
  inputDb: [-12, 12],
  gateThresholdDb: [-80, -20],
  eqDb: [-12, 12],
  driveAmount: [0, 1],
  crushThresholdDb: [-48, 0],
  crushRatio: [1, 20],
  punch: [0, 1],
  roomSizeSec: [0.3, 5],
  roomMix: [0, 1],
  glueThresholdDb: [-48, 0],
  glueRatio: [1, 12],
  outputDb: [-24, 24],
  ceilingDb: [-12, 0],
} as const;

export const VOCAL_RANGES = {
  inputDb: [-12, 12],
  gateThresholdDb: [-80, -20],
  deEsserThresholdDb: [-60, 0],
  deEsserRatio: [1, 10],
  compThresholdDb: [-60, 0],
  compRatio: [1, 10],
  compAttack: [0.001, 0.1],
  compRelease: [0.01, 1.0],
  bodyDb: [-12, 12],
  presenceDb: [-12, 12],
  airDb: [-12, 12],
  delayTimeMs: [50, 2000],
  delayFeedback: [0, 0.95],
  delayMix: [0, 1],
  reverbSizeSec: [0.3, 5],
  reverbMix: [0, 1],
  outputDb: [-24, 24],
  ceilingDb: [-12, 0],
} as const;

export const KEYS_RANGES = {
  inputDb: [-12, 12],
  gateThresholdDb: [-80, -20],
  chorusRateHz: [0.1, 5.0],
  chorusDepthMs: [0.1, 8.0],
  chorusMix: [0, 1],
  compThresholdDb: [-48, 0],
  compRatio: [1, 12],
  /**
   * Compressor timing, in ms.
   *
   * 1 ms is faster than a bass transient (a low E's period is 24 ms), which is what
   * "tight" needs; 60 ms is slow enough to pass the whole attack untouched, which is what
   * "thunder" needs. Release from 40 ms — any shorter and it pumps on the note itself —
   * to 800 ms, about the length of a bass note's useful tail.
   */
  compAttackMs: [1, 60],
  compReleaseMs: [40, 800],
  lowDb: [-12, 12],
  midDb: [-12, 12],
  highDb: [-12, 12],
  reverbSizeSec: [0.3, 5.0],
  reverbMix: [0, 1],
  outputDb: [-24, 24],
  ceilingDb: [-12, 0],
} as const;

export const BRASS_RANGES = {
  inputDb: [-12, 12],
  gateThresholdDb: [-80, -20],
  compThresholdDb: [-48, 0],
  compRatio: [1, 12],
  /**
   * Compressor timing, in ms.
   *
   * 1 ms is faster than a bass transient (a low E's period is 24 ms), which is what
   * "tight" needs; 60 ms is slow enough to pass the whole attack untouched, which is what
   * "thunder" needs. Release from 40 ms — any shorter and it pumps on the note itself —
   * to 800 ms, about the length of a bass note's useful tail.
   */
  compAttackMs: [1, 60],
  compReleaseMs: [40, 800],
  compAttack: [0.001, 0.1],
  compRelease: [0.01, 1.0],
  lowDb: [-12, 12],
  midDb: [-12, 12],
  highDb: [-12, 12],
  delayTimeMs: [50, 1500],
  delayFeedback: [0, 0.95],
  delayMix: [0, 1],
  reverbSizeSec: [0.3, 5.0],
  reverbMix: [0, 1],
  outputDb: [-24, 24],
  ceilingDb: [-12, 0],
} as const;

/** The bass cabinets, as a runtime list. `cabinet.ts` owns their voicings. */
const BASS_CABINETS = ['b15', 'b410'] as const;

function clamp(range: readonly [number, number], value: unknown, fallback: number): number {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(range[1], Math.max(range[0], number));
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/** Total: never throws, never partial, every field from `input` in range or `base`. */
export function clampBass(input: unknown, base: BassSettings): BassSettings {
  const raw = record(input);
  const gate = record(raw.gate);
  const comp = record(raw.comp);
  const drive = record(raw.drive);
  const eq = record(raw.eq);
  const cab = record(raw.cab);
  const limiter = record(raw.limiter);
  const R = BASS_RANGES;

  const model = (BASS_CABINETS as readonly string[]).includes(cab.model as string)
    ? (cab.model as BassSettings['cab']['model'])
    : base.cab.model;

  return {
    inputDb: clamp(R.inputDb, raw.inputDb, base.inputDb),
    gate: {
      enabled: bool(gate.enabled, base.gate.enabled),
      thresholdDb: clamp(R.gateThresholdDb, gate.thresholdDb, base.gate.thresholdDb),
    },
    comp: {
      enabled: bool(comp.enabled, base.comp.enabled),
      thresholdDb: clamp(R.compThresholdDb, comp.thresholdDb, base.comp.thresholdDb),
      ratio: clamp(R.compRatio, comp.ratio, base.comp.ratio),
      attackMs: clamp(R.compAttackMs, comp.attackMs, base.comp.attackMs),
      releaseMs: clamp(R.compReleaseMs, comp.releaseMs, base.comp.releaseMs),
    },
    crossoverHz: clamp(R.crossoverHz, raw.crossoverHz, base.crossoverHz),
    lowDb: clamp(R.lowDb, raw.lowDb, base.lowDb),
    drive: {
      enabled: bool(drive.enabled, base.drive.enabled),
      amount: clamp(R.driveAmount, drive.amount, base.drive.amount),
      bias: clamp(R.driveBias, drive.bias, base.drive.bias),
    },
    eq: {
      subDb: clamp(R.eqDb, eq.subDb, base.eq.subDb),
      lowMidDb: clamp(R.eqDb, eq.lowMidDb, base.eq.lowMidDb),
      midDb: clamp(R.eqDb, eq.midDb, base.eq.midDb),
      highDb: clamp(R.eqDb, eq.highDb, base.eq.highDb),
    },
    cab: {
      enabled: bool(cab.enabled, base.cab.enabled),
      model,
      presenceDb: clamp(R.presenceDb, cab.presenceDb, base.cab.presenceDb),
      resonanceDb: clamp(R.resonanceDb, cab.resonanceDb, base.cab.resonanceDb),
    },
    diMix: clamp(R.diMix, raw.diMix, base.diMix),
    outputDb: clamp(R.outputDb, raw.outputDb, base.outputDb),
    limiter: {
      enabled: bool(limiter.enabled, base.limiter.enabled),
      ceilingDb: clamp(R.ceilingDb, limiter.ceilingDb, base.limiter.ceilingDb),
    },
  };
}

export function clampDrums(input: unknown, base: DrumSettings): DrumSettings {
  const raw = record(input);
  const gate = record(raw.gate);
  const eq = record(raw.eq);
  const drive = record(raw.drive);
  const crush = record(raw.crush);
  const room = record(raw.room);
  const glue = record(raw.glue);
  const limiter = record(raw.limiter);
  const R = DRUM_RANGES;

  return {
    inputDb: clamp(R.inputDb, raw.inputDb, base.inputDb),
    gate: {
      enabled: bool(gate.enabled, base.gate.enabled),
      thresholdDb: clamp(R.gateThresholdDb, gate.thresholdDb, base.gate.thresholdDb),
    },
    eq: {
      kickDb: clamp(R.eqDb, eq.kickDb, base.eq.kickDb),
      boxDb: clamp(R.eqDb, eq.boxDb, base.eq.boxDb),
      snapDb: clamp(R.eqDb, eq.snapDb, base.eq.snapDb),
    },
    drive: {
      enabled: bool(drive.enabled, base.drive.enabled),
      amount: clamp(R.driveAmount, drive.amount, base.drive.amount),
    },
    crush: {
      enabled: bool(crush.enabled, base.crush.enabled),
      thresholdDb: clamp(R.crushThresholdDb, crush.thresholdDb, base.crush.thresholdDb),
      ratio: clamp(R.crushRatio, crush.ratio, base.crush.ratio),
    },
    punch: clamp(R.punch, raw.punch, base.punch),
    room: {
      enabled: bool(room.enabled, base.room.enabled),
      sizeSec: clamp(R.roomSizeSec, room.sizeSec, base.room.sizeSec),
      mix: clamp(R.roomMix, room.mix, base.room.mix),
    },
    glue: {
      enabled: bool(glue.enabled, base.glue.enabled),
      thresholdDb: clamp(R.glueThresholdDb, glue.thresholdDb, base.glue.thresholdDb),
      ratio: clamp(R.glueRatio, glue.ratio, base.glue.ratio),
    },
    outputDb: clamp(R.outputDb, raw.outputDb, base.outputDb),
    limiter: {
      enabled: bool(limiter.enabled, base.limiter.enabled),
      ceilingDb: clamp(R.ceilingDb, limiter.ceilingDb, base.limiter.ceilingDb),
    },
  };
}

export function clampVocals(input: unknown, base: VocalSettings): VocalSettings {
  const raw = record(input);
  const gate = record(raw.gate);
  const deEsser = record(raw.deEsser);
  const comp = record(raw.comp);
  const eq = record(raw.eq);
  const delay = record(raw.delay);
  const reverb = record(raw.reverb);
  const limiter = record(raw.limiter);
  const R = VOCAL_RANGES;

  return {
    inputDb: clamp(R.inputDb, raw.inputDb, base.inputDb),
    gate: {
      enabled: bool(gate.enabled, base.gate.enabled),
      thresholdDb: clamp(R.gateThresholdDb, gate.thresholdDb, base.gate.thresholdDb),
    },
    deEsser: {
      enabled: bool(deEsser.enabled, base.deEsser.enabled),
      thresholdDb: clamp(R.deEsserThresholdDb, deEsser.thresholdDb, base.deEsser.thresholdDb),
      ratio: clamp(R.deEsserRatio, deEsser.ratio, base.deEsser.ratio),
    },
    comp: {
      enabled: bool(comp.enabled, base.comp.enabled),
      thresholdDb: clamp(R.compThresholdDb, comp.thresholdDb, base.comp.thresholdDb),
      ratio: clamp(R.compRatio, comp.ratio, base.comp.ratio),
      attack: clamp(R.compAttack, comp.attack, base.comp.attack),
      release: clamp(R.compRelease, comp.release, base.comp.release),
    },
    eq: {
      lowCutEnabled: bool(eq.lowCutEnabled, base.eq.lowCutEnabled),
      bodyDb: clamp(R.bodyDb, eq.bodyDb, base.eq.bodyDb),
      presenceDb: clamp(R.presenceDb, eq.presenceDb, base.eq.presenceDb),
      airDb: clamp(R.airDb, eq.airDb, base.eq.airDb),
    },
    delay: {
      enabled: bool(delay.enabled, base.delay.enabled),
      timeMs: clamp(R.delayTimeMs, delay.timeMs, base.delay.timeMs),
      feedback: clamp(R.delayFeedback, delay.feedback, base.delay.feedback),
      mix: clamp(R.delayMix, delay.mix, base.delay.mix),
    },
    reverb: {
      enabled: bool(reverb.enabled, base.reverb.enabled),
      sizeSec: clamp(R.reverbSizeSec, reverb.sizeSec, base.reverb.sizeSec),
      mix: clamp(R.reverbMix, reverb.mix, base.reverb.mix),
    },
    outputDb: clamp(R.outputDb, raw.outputDb, base.outputDb),
    limiter: {
      enabled: bool(limiter.enabled, base.limiter.enabled),
      ceilingDb: clamp(R.ceilingDb, limiter.ceilingDb, base.limiter.ceilingDb),
    },
  };
}

export function clampKeys(input: unknown, base: KeysSettings): KeysSettings {
  const raw = record(input);
  const gate = record(raw.gate);
  const chorus = record(raw.chorus);
  const comp = record(raw.comp);
  const eq = record(raw.eq);
  const reverb = record(raw.reverb);
  const limiter = record(raw.limiter);
  const R = KEYS_RANGES;

  return {
    inputDb: clamp(R.inputDb, raw.inputDb, base.inputDb),
    gate: {
      enabled: bool(gate.enabled, base.gate.enabled),
      thresholdDb: clamp(R.gateThresholdDb, gate.thresholdDb, base.gate.thresholdDb),
    },
    chorus: {
      enabled: bool(chorus.enabled, base.chorus.enabled),
      rateHz: clamp(R.chorusRateHz, chorus.rateHz, base.chorus.rateHz),
      depthMs: clamp(R.chorusDepthMs, chorus.depthMs, base.chorus.depthMs),
      mix: clamp(R.chorusMix, chorus.mix, base.chorus.mix),
    },
    comp: {
      enabled: bool(comp.enabled, base.comp.enabled),
      thresholdDb: clamp(R.compThresholdDb, comp.thresholdDb, base.comp.thresholdDb),
      ratio: clamp(R.compRatio, comp.ratio, base.comp.ratio),
    },
    eq: {
      lowDb: clamp(R.lowDb, eq.lowDb, base.eq.lowDb),
      midDb: clamp(R.midDb, eq.midDb, base.eq.midDb),
      highDb: clamp(R.highDb, eq.highDb, base.eq.highDb),
    },
    reverb: {
      enabled: bool(reverb.enabled, base.reverb.enabled),
      sizeSec: clamp(R.reverbSizeSec, reverb.sizeSec, base.reverb.sizeSec),
      mix: clamp(R.reverbMix, reverb.mix, base.reverb.mix),
    },
    outputDb: clamp(R.outputDb, raw.outputDb, base.outputDb),
    limiter: {
      enabled: bool(limiter.enabled, base.limiter.enabled),
      ceilingDb: clamp(R.ceilingDb, limiter.ceilingDb, base.limiter.ceilingDb),
    },
  };
}

export function clampBrass(input: unknown, base: BrassSettings): BrassSettings {
  const raw = record(input);
  const gate = record(raw.gate);
  const comp = record(raw.comp);
  const eq = record(raw.eq);
  const delay = record(raw.delay);
  const reverb = record(raw.reverb);
  const limiter = record(raw.limiter);
  const R = BRASS_RANGES;

  return {
    inputDb: clamp(R.inputDb, raw.inputDb, base.inputDb),
    gate: {
      enabled: bool(gate.enabled, base.gate.enabled),
      thresholdDb: clamp(R.gateThresholdDb, gate.thresholdDb, base.gate.thresholdDb),
    },
    comp: {
      enabled: bool(comp.enabled, base.comp.enabled),
      thresholdDb: clamp(R.compThresholdDb, comp.thresholdDb, base.comp.thresholdDb),
      ratio: clamp(R.compRatio, comp.ratio, base.comp.ratio),
      attack: clamp(R.compAttack, comp.attack, base.comp.attack),
      release: clamp(R.compRelease, comp.release, base.comp.release),
    },
    eq: {
      lowDb: clamp(R.lowDb, eq.lowDb, base.eq.lowDb),
      midDb: clamp(R.midDb, eq.midDb, base.eq.midDb),
      highDb: clamp(R.highDb, eq.highDb, base.eq.highDb),
    },
    delay: {
      enabled: bool(delay.enabled, base.delay.enabled),
      timeMs: clamp(R.delayTimeMs, delay.timeMs, base.delay.timeMs),
      feedback: clamp(R.delayFeedback, delay.feedback, base.delay.feedback),
      mix: clamp(R.delayMix, delay.mix, base.delay.mix),
    },
    reverb: {
      enabled: bool(reverb.enabled, base.reverb.enabled),
      sizeSec: clamp(R.reverbSizeSec, reverb.sizeSec, base.reverb.sizeSec),
      mix: clamp(R.reverbMix, reverb.mix, base.reverb.mix),
    },
    outputDb: clamp(R.outputDb, raw.outputDb, base.outputDb),
    limiter: {
      enabled: bool(limiter.enabled, base.limiter.enabled),
      ceilingDb: clamp(R.ceilingDb, limiter.ceilingDb, base.limiter.ceilingDb),
    },
  };
}

/* --------------------------------------------------------------------------
   Diffs. Same contract as `ampDiff`: every field that differs, in signal order,
   labelled the way the rack prints it. This is what makes a suggestion reviewable
   and what the undo button restores.
-------------------------------------------------------------------------- */

function db(value: number): string {
  return `${value > 0 ? '+' : ''}${value}`;
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function onOff(value: boolean): string {
  return value ? 'on' : 'off';
}

function differ(changes: AmpChange[]) {
  return (label: string, from: string, to: string) => {
    if (from !== to) changes.push({ label, from, to });
  };
}

export function bassDiff(before: BassSettings, after: BassSettings): AmpChange[] {
  const changes: AmpChange[] = [];
  const add = differ(changes);

  add('INPUT', db(before.inputDb), db(after.inputDb));
  add('GATE', onOff(before.gate.enabled), onOff(after.gate.enabled));
  add('GATE THR', `${before.gate.thresholdDb}`, `${after.gate.thresholdDb}`);
  add('COMP', onOff(before.comp.enabled), onOff(after.comp.enabled));
  add('COMP THR', `${before.comp.thresholdDb}`, `${after.comp.thresholdDb}`);
  add('RATIO', `${before.comp.ratio}:1`, `${after.comp.ratio}:1`);
  add('SPLIT', `${before.crossoverHz}Hz`, `${after.crossoverHz}Hz`);
  add('LOW', db(before.lowDb), db(after.lowDb));
  add('DRIVE', onOff(before.drive.enabled), onOff(after.drive.enabled));
  add('AMOUNT', pct(before.drive.amount), pct(after.drive.amount));
  add('BIAS', before.drive.bias.toFixed(2), after.drive.bias.toFixed(2));
  add('SUB', db(before.eq.subDb), db(after.eq.subDb));
  add('LOW MID', db(before.eq.lowMidDb), db(after.eq.lowMidDb));
  add('MID', db(before.eq.midDb), db(after.eq.midDb));
  add('HIGH', db(before.eq.highDb), db(after.eq.highDb));
  add('CAB', onOff(before.cab.enabled), onOff(after.cab.enabled));
  add('CAB MODEL', before.cab.model, after.cab.model);
  add('PRESENCE', db(before.cab.presenceDb), db(after.cab.presenceDb));
  add('RESO', db(before.cab.resonanceDb), db(after.cab.resonanceDb));
  add('DI', pct(before.diMix), pct(after.diMix));
  add('OUTPUT', db(before.outputDb), db(after.outputDb));
  add('LIMITER', onOff(before.limiter.enabled), onOff(after.limiter.enabled));
  add('CEILING', before.limiter.ceilingDb.toFixed(1), after.limiter.ceilingDb.toFixed(1));

  return changes;
}

export function drumDiff(before: DrumSettings, after: DrumSettings): AmpChange[] {
  const changes: AmpChange[] = [];
  const add = differ(changes);

  add('INPUT', db(before.inputDb), db(after.inputDb));
  add('GATE', onOff(before.gate.enabled), onOff(after.gate.enabled));
  add('GATE THR', `${before.gate.thresholdDb}`, `${after.gate.thresholdDb}`);
  add('KICK', db(before.eq.kickDb), db(after.eq.kickDb));
  add('BOX', db(before.eq.boxDb), db(after.eq.boxDb));
  add('SNAP', db(before.eq.snapDb), db(after.eq.snapDb));
  add('SAT', onOff(before.drive.enabled), onOff(after.drive.enabled));
  add('AMOUNT', pct(before.drive.amount), pct(after.drive.amount));
  add('CRUSH', onOff(before.crush.enabled), onOff(after.crush.enabled));
  add('CRUSH THR', `${before.crush.thresholdDb}`, `${after.crush.thresholdDb}`);
  add('CRUSH RATIO', `${before.crush.ratio}:1`, `${after.crush.ratio}:1`);
  add('PUNCH', pct(before.punch), pct(after.punch));
  add('ROOM', onOff(before.room.enabled), onOff(after.room.enabled));
  add('SIZE', `${before.room.sizeSec.toFixed(1)}s`, `${after.room.sizeSec.toFixed(1)}s`);
  add('ROOM MIX', pct(before.room.mix), pct(after.room.mix));
  add('GLUE', onOff(before.glue.enabled), onOff(after.glue.enabled));
  add('GLUE THR', `${before.glue.thresholdDb}`, `${after.glue.thresholdDb}`);
  add('GLUE RATIO', `${before.glue.ratio}:1`, `${after.glue.ratio}:1`);
  add('OUTPUT', db(before.outputDb), db(after.outputDb));
  add('LIMITER', onOff(before.limiter.enabled), onOff(after.limiter.enabled));
  add('CEILING', before.limiter.ceilingDb.toFixed(1), after.limiter.ceilingDb.toFixed(1));

  return changes;
}

export function vocalDiff(before: VocalSettings, after: VocalSettings): AmpChange[] {
  const changes: AmpChange[] = [];
  const add = differ(changes);

  add('INPUT', db(before.inputDb), db(after.inputDb));
  add('GATE', onOff(before.gate.enabled), onOff(after.gate.enabled));
  add('GATE THR', `${before.gate.thresholdDb}`, `${after.gate.thresholdDb}`);
  add('DE-ESSER', onOff(before.deEsser.enabled), onOff(after.deEsser.enabled));
  add('DE-ESS THR', `${before.deEsser.thresholdDb}`, `${after.deEsser.thresholdDb}`);
  add('COMP', onOff(before.comp.enabled), onOff(after.comp.enabled));
  add('COMP THR', `${before.comp.thresholdDb}`, `${after.comp.thresholdDb}`);
  add('COMP RATIO', `${before.comp.ratio}:1`, `${after.comp.ratio}:1`);
  add('LOW CUT', onOff(before.eq.lowCutEnabled), onOff(before.eq.lowCutEnabled));
  add('BODY', db(before.eq.bodyDb), db(after.eq.bodyDb));
  add('PRESENCE', db(before.eq.presenceDb), db(after.eq.presenceDb));
  add('AIR', db(before.eq.airDb), db(after.eq.airDb));
  add('DELAY', onOff(before.delay.enabled), onOff(before.delay.enabled));
  add('DELAY TIME', `${before.delay.timeMs}ms`, `${before.delay.timeMs}ms`);
  add('DELAY MIX', pct(before.delay.mix), pct(after.delay.mix));
  add('REVERB', onOff(before.reverb.enabled), onOff(before.reverb.enabled));
  add('REVERB MIX', pct(before.reverb.mix), pct(after.reverb.mix));
  add('OUTPUT', db(before.outputDb), db(after.outputDb));
  add('LIMITER', onOff(before.limiter.enabled), onOff(after.limiter.enabled));
  add('CEILING', before.limiter.ceilingDb.toFixed(1), after.limiter.ceilingDb.toFixed(1));

  return changes;
}

export function keysDiff(before: KeysSettings, after: KeysSettings): AmpChange[] {
  const changes: AmpChange[] = [];
  const add = differ(changes);

  add('INPUT', db(before.inputDb), db(after.inputDb));
  add('GATE', onOff(before.gate.enabled), onOff(after.gate.enabled));
  add('GATE THR', `${before.gate.thresholdDb}`, `${after.gate.thresholdDb}`);
  add('CHORUS', onOff(before.chorus.enabled), onOff(after.chorus.enabled));
  add('CHORUS RATE', `${before.chorus.rateHz.toFixed(1)}Hz`, `${after.chorus.rateHz.toFixed(1)}Hz`);
  add('CHORUS DEPTH', `${before.chorus.depthMs}ms`, `${after.chorus.depthMs}ms`);
  add('CHORUS MIX', pct(before.chorus.mix), pct(after.chorus.mix));
  add('COMP', onOff(before.comp.enabled), onOff(before.comp.enabled));
  add('COMP THR', `${before.comp.thresholdDb}`, `${after.comp.thresholdDb}`);
  add('COMP RATIO', `${before.comp.ratio}:1`, `${after.comp.ratio}:1`);
  add('LOW', db(before.eq.lowDb), db(before.eq.lowDb));
  add('MID', db(before.eq.midDb), db(before.eq.midDb));
  add('HIGH', db(before.eq.highDb), db(before.eq.highDb));
  add('REVERB', onOff(before.reverb.enabled), onOff(before.reverb.enabled));
  add('REVERB MIX', pct(before.reverb.mix), pct(after.reverb.mix));
  add('OUTPUT', db(before.outputDb), db(after.outputDb));
  add('LIMITER', onOff(before.limiter.enabled), onOff(before.limiter.enabled));
  add('CEILING', before.limiter.ceilingDb.toFixed(1), after.limiter.ceilingDb.toFixed(1));

  return changes;
}

export function brassDiff(before: BrassSettings, after: BrassSettings): AmpChange[] {
  const changes: AmpChange[] = [];
  const add = differ(changes);

  add('INPUT', db(before.inputDb), db(after.inputDb));
  add('GATE', onOff(before.gate.enabled), onOff(after.gate.enabled));
  add('GATE THR', `${before.gate.thresholdDb}`, `${after.gate.thresholdDb}`);
  add('COMP', onOff(before.comp.enabled), onOff(before.comp.enabled));
  add('COMP THR', `${before.comp.thresholdDb}`, `${after.comp.thresholdDb}`);
  add('COMP RATIO', `${before.comp.ratio}:1`, `${after.comp.ratio}:1`);
  add('LOW', db(before.eq.lowDb), db(before.eq.lowDb));
  add('MID', db(before.eq.midDb), db(before.eq.midDb));
  add('HIGH', db(before.eq.highDb), db(before.eq.highDb));
  add('DELAY', onOff(before.delay.enabled), onOff(before.delay.enabled));
  add('DELAY TIME', `${before.delay.timeMs}ms`, `${before.delay.timeMs}ms`);
  add('DELAY MIX', pct(before.delay.mix), pct(after.delay.mix));
  add('REVERB', onOff(before.reverb.enabled), onOff(before.reverb.enabled));
  add('REVERB MIX', pct(before.reverb.mix), pct(after.reverb.mix));
  add('OUTPUT', db(before.outputDb), db(after.outputDb));
  add('LIMITER', onOff(before.limiter.enabled), onOff(before.limiter.enabled));
  add('CEILING', before.limiter.ceilingDb.toFixed(1), after.limiter.ceilingDb.toFixed(1));

  return changes;
}
