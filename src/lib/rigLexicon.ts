/**
 * What the tone words mean on a bass and on a drum kit.
 *
 * ---------------------------------------------------------------------------
 * The same vocabulary, three different sets of controls.
 *
 * "หนาขึ้น" is one request, and it is three different edits. On a guitar it is the
 * bass shelf. On a bass rig it is the sub shelf *and* the clean low band, because
 * that rig has a dedicated level for the undistorted bottom and moving the EQ alone
 * would leave it behind. On a drum bus it is the kick shelf, and nothing else —
 * a drum kit has no fundamental to thicken, it has a kick drum.
 *
 * That is the whole reason the lexicon is a parameter rather than a constant: the
 * machinery in `toneIntent.ts` (normalisation, fuzzy genre matching, clause
 * splitting, direction, magnitude, residue) has no instrument in it, and the part
 * that does is a table of words against controls. This file is two of those tables.
 *
 * A few rules here have no guitar equivalent at all, and they are the interesting
 * ones — they encode a rig's own logic rather than a generic tone adjective:
 *
 * - **Bass drive raises the crossover with it.** More drive with the split left
 *   where it was pushes distortion further down into the fundamental, which is the
 *   one thing the rig is built to avoid. Asking for grind should move both.
 * - **Bass "definition" reaches for the DI**, not for treble. The clean signal from
 *   before the drive and the cabinet is where a bass's articulation actually lives.
 * - **Drum "punch" is the parallel blend**, which can only add. There is no rule here
 *   that reaches for the glue compressor to make a kit hit harder, because that is
 *   the move that makes it hit softer.
 * ---------------------------------------------------------------------------
 *
 * Pure and deterministic, like everything it imports. Checked from Node.
 */

import type { BassSettings } from './bassFx';
import { BASS_PRESETS } from './bassFx';
import type { DrumSettings } from './drumFx';
import { DRUM_PRESETS } from './drumFx';
import type { VocalSettings } from './vocalFx';
import { VOCAL_PRESETS } from './vocalFx';
import type { KeysSettings } from './keysFx';
import { KEYS_PRESETS } from './keysFx';
import type { BrassSettings } from './brassFx';
import { BRASS_PRESETS } from './brassFx';
import {
  bassDiff,
  clampBass,
  clampDrums,
  drumDiff,
  clampVocals,
  vocalDiff,
  clampKeys,
  keysDiff,
  clampBrass,
  brassDiff,
} from './rigSchema';
import type { Lexicon, ToneRule } from './toneIntent';

/** Nudge by `gain` steps of `size`; the clamp bounds it afterwards. */
function step(value: number, gain: number, size: number): number {
  return value + gain * size;
}

/** Round to something a knob can land on, so a readout is not 2.4999. */
function q(value: number, grid: number): number {
  return Math.round(value / grid) * grid;
}

/* ==========================================================================
   Bass
========================================================================== */

const BASS_RULES: readonly ToneRule<BassSettings>[] = [
  {
    id: 'thick',
    words: ['หนา', 'อ้วน', 'เนื้อ', 'อิ่ม', 'thick', 'fat', 'body', 'full', 'weight'],
    label: 'ความหนา',
    bias: 1,
    apply: (s, gain) => ({
      ...s,
      eq: { ...s.eq, subDb: q(step(s.eq.subDb, gain, 2), 0.5) },
      // The clean low band moves too. On this rig the bottom is a level as well as an
      // EQ band, and raising only the shelf leaves half the request behind.
      lowDb: q(step(s.lowDb, gain, 1), 0.5),
    }),
  },
  {
    id: 'thin',
    words: ['บาง', 'ผอม', 'เบาบาง', 'thin', 'skinny'],
    label: 'ความบาง',
    bias: -1,
    apply: (s, gain) => ({
      ...s,
      eq: { ...s.eq, subDb: q(step(s.eq.subDb, gain, 2), 0.5) },
      lowDb: q(step(s.lowDb, gain, 1), 0.5),
    }),
  },
  {
    id: 'bright',
    words: ['ใส', 'สว่าง', 'แหลม', 'คม', 'bright', 'clear', 'crisp', 'treble'],
    label: 'ความใส',
    bias: 1,
    apply: (s, gain) => ({
      ...s,
      eq: { ...s.eq, highDb: q(step(s.eq.highDb, gain, 2.5), 0.5) },
    }),
  },
  {
    id: 'dark',
    words: ['ทึบ', 'มืด', 'อู้', 'ขุ่น', 'dark', 'dull', 'muffled', 'muddy'],
    label: 'ความทึบ',
    bias: -1,
    apply: (s, gain) => ({
      ...s,
      eq: { ...s.eq, highDb: q(step(s.eq.highDb, gain, 2.5), 0.5) },
    }),
  },
  {
    id: 'warm',
    words: ['นุ่ม', 'อุ่น', 'หวาน', 'กลม', 'warm', 'smooth', 'round'],
    label: 'ความนุ่ม',
    bias: 1,
    apply: (s, gain) => ({
      ...s,
      eq: {
        ...s.eq,
        highDb: q(step(s.eq.highDb, -gain, 1.5), 0.5),
        lowMidDb: q(step(s.eq.lowMidDb, gain, 1), 0.5),
      },
    }),
  },
  {
    id: 'drive',
    words: ['แตก', 'ซ่า', 'กร่าง', 'ดิสทอร์ต', 'drive', 'dist', 'gain', 'dirty', 'grind', 'growl'],
    label: 'ความแตก',
    bias: 1,
    apply: (s, gain) => {
      const amount = step(s.drive.amount, gain, 0.15);
      return {
        ...s,
        drive: { ...s.drive, enabled: amount > 0, amount: q(amount, 0.01) },
        // The split follows the drive. Leaving it put would push distortion down into
        // the fundamental, which is exactly what this rig exists to prevent.
        crossoverHz: q(step(s.crossoverHz, gain, 20), 5),
      };
    },
  },
  {
    id: 'clean',
    words: ['คลีน', 'ไม่แตก', 'สะอาด', 'clean'],
    label: 'คลีน',
    bias: 1,
    apply: (s) => ({ ...s, drive: { ...s.drive, enabled: false, amount: 0 } }),
  },
  {
    id: 'definition',
    words: ['ชัด', 'ได้ตัวโน้ต', 'กัด', 'definition', 'articulate', 'attack', 'pick'],
    label: 'ความชัด',
    bias: 1,
    apply: (s, gain) => ({
      ...s,
      // The DI, not the treble. The clean pre-drive signal is where a bass's
      // articulation lives — turning the top up on the amped path adds fret noise.
      diMix: q(Math.min(1, Math.max(0, step(s.diMix, gain, 0.12))), 0.01),
      eq: { ...s.eq, midDb: q(step(s.eq.midDb, gain, 1), 0.5) },
    }),
  },
  {
    id: 'tight',
    words: ['แน่น', 'กระชับ', 'ตึง', 'tight', 'punch', 'punchy', 'focused'],
    label: 'ความแน่น',
    bias: 1,
    apply: (s, gain) => ({
      ...s,
      gate: { enabled: true, thresholdDb: q(step(s.gate.thresholdDb, gain, 5), 1) },
      // The compressor's *timing* is what tightness actually is: a faster attack catches
      // the pick and a shorter release is finished before the next note, so nothing
      // swells. Threshold and ratio cannot express that, which is why these two were
      // opened up — see `BassSettings.comp`.
      comp: {
        ...s.comp,
        enabled: true,
        attackMs: q(step(s.comp.attackMs, -gain, 4), 1),
        releaseMs: q(step(s.comp.releaseMs, -gain, 60), 10),
      },
      // 250 Hz is where a room makes a bass flabby, so tight is a cut there rather
      // than a cut in the sub — taking the bottom out does not make it tighter.
      eq: { ...s.eq, lowMidDb: q(step(s.eq.lowMidDb, -gain, 1.5), 0.5) },
    }),
  },
  {
    id: 'float',
    words: ['ลอย', 'โปร่ง', 'ลอยขึ้น', 'float', 'open', 'airy', 'clarity'],
    label: 'ความลอย',
    bias: 1,
    apply: (s, gain) => ({
      ...s,
      // "Floating" is the 800 Hz band, not treble. A phone speaker cannot reproduce a
      // bass fundamental at all, so what makes a note audible above a mix is the octave
      // where the *note* lives rather than the one where its weight does. More DI keeps
      // the string in the picture; less cabinet resonance stops the weight dragging it
      // back down.
      eq: {
        ...s.eq,
        midDb: q(step(s.eq.midDb, gain, 2), 0.5),
        lowMidDb: q(step(s.eq.lowMidDb, -gain, 1), 0.5),
      },
      diMix: q(step(s.diMix, gain, 0.12), 0.05),
      cab: { ...s.cab, resonanceDb: q(step(s.cab.resonanceDb, -gain, 1.5), 0.5) },
    }),
  },
  {
    id: 'thunder',
    words: ['กระหึ่ม', 'หนักๆ', 'ตูม', 'อึ้ม', 'thunder', 'huge', 'massive', 'boom'],
    label: 'ความกระหึ่ม',
    bias: 1,
    apply: (s, gain) => ({
      ...s,
      // The opposite of tight on the two controls that matter, plus weight taken from the
      // **clean** band rather than the sub EQ alone: this rig never distorts the lows, so
      // lifting `lowDb` adds fundamental that was never turned into harmonics.
      comp: {
        ...s.comp,
        attackMs: q(step(s.comp.attackMs, gain, 8), 1),
        releaseMs: q(step(s.comp.releaseMs, gain, 100), 10),
      },
      lowDb: q(step(s.lowDb, gain, 1.5), 0.5),
      eq: { ...s.eq, subDb: q(step(s.eq.subDb, gain, 2), 0.5) },
      cab: { ...s.cab, resonanceDb: q(step(s.cab.resonanceDb, gain, 2), 0.5) },
    }),
  },
  {
    id: 'boxy',
    words: ['ตัดกลาง', 'กล่อง', 'อู้อี้', 'scoop', 'boxy', 'honky'],
    label: 'ตัดย่านกลางต่ำ',
    bias: -1,
    apply: (s, gain) => ({
      ...s,
      eq: { ...s.eq, lowMidDb: q(step(s.eq.lowMidDb, gain, 3), 0.5) },
    }),
  },
  {
    id: 'sustain',
    words: ['ซัสเทน', 'ยาว', 'ค้าง', 'sustain', 'even'],
    label: 'ซัสเทน',
    bias: 1,
    apply: (s, gain) => ({
      ...s,
      comp: {
        // Spread first: the timing fields are the player's, and a sustain request is
        // about how *hard* the compressor works, not how fast it reacts.
        ...s.comp,
        enabled: true,
        thresholdDb: q(step(s.comp.thresholdDb, -gain, 3), 1),
        ratio: q(step(s.comp.ratio, gain, 1), 0.5),
      },
    }),
  },
  {
    id: 'di',
    words: ['ดีไอ', 'di', 'direct'],
    label: 'DI',
    bias: 0,
    apply: (s, gain) => ({
      ...s,
      diMix: q(Math.min(1, Math.max(0, step(s.diMix, gain, 0.15))), 0.01),
    }),
  },
  {
    id: 'noise',
    words: ['เสียงรบกวน', 'ฮัม', 'จี่', 'noise', 'hiss', 'hum', 'buzz'],
    label: 'ลดเสียงรบกวน',
    bias: 1,
    apply: (s, gain) => ({
      ...s,
      gate: { enabled: true, thresholdDb: q(step(s.gate.thresholdDb, gain, 6), 1) },
    }),
  },
  {
    id: 'loud',
    words: ['ดัง', 'louder', 'loud', 'volume', 'วอลลุ่ม'],
    label: 'ระดับเสียง',
    bias: 1,
    apply: (s, gain) => ({ ...s, outputDb: q(step(s.outputDb, gain, 2), 0.5) }),
  },
  {
    id: 'quiet',
    words: ['เบาลง', 'เบาๆ', 'ค่อย', 'quieter', 'quiet', 'softer'],
    label: 'ลดระดับเสียง',
    bias: -1,
    apply: (s, gain) => ({ ...s, outputDb: q(step(s.outputDb, gain, 2), 0.5) }),
  },
  /* ---- Named controls. `bias: 0` — they want an explicit direction. ------- */
  {
    id: 'sub',
    words: ['ซับ', 'เบส', 'ทุ้ม', 'เสียงต่ำ', 'sub', 'bass', 'lows', 'low end'],
    label: 'ย่านต่ำ',
    bias: 0,
    apply: (s, gain) => ({
      ...s,
      eq: { ...s.eq, subDb: q(step(s.eq.subDb, gain, 2), 0.5) },
    }),
  },
  {
    id: 'mid',
    words: ['กลาง', 'มิด', 'mid', 'mids', 'midrange'],
    label: 'ย่านกลาง',
    bias: 0,
    apply: (s, gain) => ({
      ...s,
      eq: { ...s.eq, midDb: q(step(s.eq.midDb, gain, 2), 0.5) },
    }),
  },
  {
    id: 'split',
    words: ['ครอสโอเวอร์', 'จุดตัด', 'crossover', 'split'],
    label: 'จุดตัด',
    bias: 0,
    apply: (s, gain) => ({ ...s, crossoverHz: q(step(s.crossoverHz, gain, 20), 5) }),
  },
];

export const BASS_LEXICON: Lexicon<BassSettings> = {
  rules: BASS_RULES,
  presets: BASS_PRESETS,
  clamp: clampBass,
  diff: bassDiff,
};

/* ==========================================================================
   Drums
========================================================================== */

const DRUM_RULES: readonly ToneRule<DrumSettings>[] = [
  {
    id: 'punch',
    words: ['ตึบ', 'แน่น', 'หนักแน่น', 'punch', 'punchy', 'smack', 'slam'],
    label: 'ความตึบ',
    bias: 1,
    apply: (s, gain) => ({
      ...s,
      // The parallel blend, which can only add. Nothing here reaches for the glue
      // compressor to make a kit hit harder — that is the move that makes it softer.
      crush: { ...s.crush, enabled: true },
      punch: q(Math.min(1, Math.max(0, step(s.punch, gain, 0.15))), 0.01),
    }),
  },
  {
    id: 'thick',
    words: ['หนา', 'อ้วน', 'เนื้อ', 'thick', 'fat', 'weight', 'boom'],
    label: 'ความหนา',
    bias: 1,
    apply: (s, gain) => ({
      ...s,
      eq: { ...s.eq, kickDb: q(step(s.eq.kickDb, gain, 2), 0.5) },
    }),
  },
  {
    id: 'thin',
    words: ['บาง', 'ผอม', 'thin', 'weak'],
    label: 'ความบาง',
    bias: -1,
    apply: (s, gain) => ({
      ...s,
      eq: { ...s.eq, kickDb: q(step(s.eq.kickDb, gain, 2), 0.5) },
    }),
  },
  {
    id: 'bright',
    words: ['ใส', 'คม', 'สว่าง', 'หัวไม้', 'bright', 'crisp', 'snap', 'stick', 'attack'],
    label: 'หัวไม้',
    bias: 1,
    apply: (s, gain) => ({
      ...s,
      eq: { ...s.eq, snapDb: q(step(s.eq.snapDb, gain, 2.5), 0.5) },
    }),
  },
  {
    id: 'dark',
    words: ['ทึบ', 'มืด', 'อู้', 'dark', 'dull', 'muffled'],
    label: 'ความทึบ',
    bias: -1,
    apply: (s, gain) => ({
      ...s,
      eq: { ...s.eq, snapDb: q(step(s.eq.snapDb, gain, 2.5), 0.5) },
    }),
  },
  {
    id: 'boxy',
    words: ['กล่อง', 'อู้อี้', 'ตัดกลาง', 'boxy', 'box', 'cardboard', 'honky'],
    label: 'ลดความกล่อง',
    bias: -1,
    apply: (s, gain) => ({
      ...s,
      eq: { ...s.eq, boxDb: q(step(s.eq.boxDb, gain, 2.5), 0.5) },
    }),
  },
  {
    id: 'room',
    words: ['ก้อง', 'ห้อง', 'กว้าง', 'รีเวิร์บ', 'room', 'reverb', 'ambience', 'big'],
    label: 'ห้องเสียง',
    bias: 1,
    apply: (s, gain) => {
      const mix = step(s.room.mix, gain, 0.1);
      return {
        ...s,
        room: {
          enabled: mix > 0.005,
          sizeSec: q(step(s.room.sizeSec, gain, 0.4), 0.1),
          mix: q(Math.max(0, mix), 0.01),
        },
      };
    },
  },
  {
    id: 'dry',
    words: ['แห้ง', 'dry'],
    label: 'ความแห้ง',
    bias: -1,
    apply: (s, gain) => {
      const mix = step(s.room.mix, gain, 0.12);
      return {
        ...s,
        room: { ...s.room, enabled: mix > 0.005, mix: q(Math.max(0, mix), 0.01) },
      };
    },
  },
  {
    id: 'tight',
    words: ['กระชับ', 'สั้น', 'เกต', 'tight', 'gated', 'controlled'],
    label: 'ความกระชับ',
    bias: 1,
    apply: (s, gain) => ({
      ...s,
      gate: { enabled: true, thresholdDb: q(step(s.gate.thresholdDb, gain, 6), 1) },
      room: { ...s.room, mix: q(Math.max(0, step(s.room.mix, -gain, 0.05)), 0.01) },
    }),
  },
  {
    id: 'glue',
    words: ['กลู', 'รวมเป็นชุด', 'เกลี่ย', 'glue', 'together', 'cohesive'],
    label: 'กลู',
    bias: 1,
    apply: (s, gain) => ({
      ...s,
      glue: {
        enabled: true,
        thresholdDb: q(step(s.glue.thresholdDb, -gain, 2), 1),
        ratio: q(step(s.glue.ratio, gain, 0.5), 0.5),
      },
    }),
  },
  {
    id: 'drive',
    words: ['แตก', 'ซ่า', 'ขับ', 'drive', 'saturate', 'saturation', 'crunch', 'dirty'],
    label: 'ความแตก',
    bias: 1,
    apply: (s, gain) => {
      const amount = step(s.drive.amount, gain, 0.12);
      return { ...s, drive: { enabled: amount > 0, amount: q(Math.max(0, amount), 0.01) } };
    },
  },
  {
    id: 'noise',
    words: ['รั่ว', 'เสียงรบกวน', 'ฮัม', 'noise', 'bleed', 'hiss', 'hum'],
    label: 'ลดเสียงรั่ว',
    bias: 1,
    apply: (s, gain) => ({
      ...s,
      gate: { enabled: true, thresholdDb: q(step(s.gate.thresholdDb, gain, 6), 1) },
    }),
  },
  {
    id: 'loud',
    words: ['ดัง', 'louder', 'loud', 'volume', 'วอลลุ่ม'],
    label: 'ระดับเสียง',
    bias: 1,
    apply: (s, gain) => ({ ...s, outputDb: q(step(s.outputDb, gain, 2), 0.5) }),
  },
  {
    id: 'quiet',
    words: ['เบาลง', 'เบาๆ', 'ค่อย', 'quieter', 'quiet', 'softer'],
    label: 'ลดระดับเสียง',
    bias: -1,
    apply: (s, gain) => ({ ...s, outputDb: q(step(s.outputDb, gain, 2), 0.5) }),
  },
  /* ---- Named controls ---------------------------------------------------- */
  {
    id: 'kick',
    words: ['เตะ', 'กลองเตะ', 'เบส', 'เสียงต่ำ', 'kick', 'bass drum', 'lows'],
    label: 'กลองเตะ',
    bias: 0,
    apply: (s, gain) => ({
      ...s,
      eq: { ...s.eq, kickDb: q(step(s.eq.kickDb, gain, 2), 0.5) },
    }),
  },
  {
    id: 'snare',
    words: ['สแนร์', 'กลองสแนร์', 'snare', 'crack'],
    label: 'สแนร์',
    bias: 0,
    apply: (s, gain) => ({
      ...s,
      eq: { ...s.eq, snapDb: q(step(s.eq.snapDb, gain, 2), 0.5) },
    }),
  },
];

export const DRUM_LEXICON: Lexicon<DrumSettings> = {
  rules: DRUM_RULES,
  presets: DRUM_PRESETS,
  clamp: clampDrums,
  diff: drumDiff,
};

const VOCAL_RULES: readonly ToneRule<VocalSettings>[] = [
  {
    id: 'bright',
    words: ['ใส', 'สว่าง', 'แหลม', 'คม', 'bright', 'clear', 'crisp', 'treble', 'air', 'สะกด'],
    label: 'ความใส',
    bias: 1,
    apply: (s, gain) => ({
      ...s,
      eq: { ...s.eq, airDb: q(step(s.eq.airDb, gain, 1.5), 0.5) },
    }),
  },
  {
    id: 'dark',
    words: ['ทึบ', 'มืด', 'อู้', 'ขุ่น', 'dark', 'dull', 'muffled', 'muddy'],
    label: 'ความทึบ',
    bias: -1,
    apply: (s, gain) => ({
      ...s,
      eq: { ...s.eq, airDb: q(step(s.eq.airDb, gain, 1.5), 0.5) },
    }),
  },
  {
    id: 'thick',
    words: ['หนา', 'อุ่น', 'อ้วน', 'เนื้อ', 'อิ่ม', 'thick', 'fat', 'warm', 'body', 'full'],
    label: 'ความหนา',
    bias: 1,
    apply: (s, gain) => ({
      ...s,
      eq: { ...s.eq, bodyDb: q(step(s.eq.bodyDb, gain, 1.5), 0.5) },
    }),
  },
  {
    id: 'thin',
    words: ['บาง', 'ผอม', 'เบาบาง', 'thin', 'skinny'],
    label: 'ความบาง',
    bias: -1,
    apply: (s, gain) => ({
      ...s,
      eq: { ...s.eq, bodyDb: q(step(s.eq.bodyDb, gain, 1.5), 0.5) },
    }),
  },
  {
    id: 'reverb',
    words: ['ก้อง', 'สะท้อน', 'reverb', 'echo', 'delay', 'ดีเลย์', 'รีเวิร์บ', 'มิติ'],
    label: 'มิติเสียง',
    bias: 1,
    apply: (s, gain) => ({
      ...s,
      reverb: { ...s.reverb, mix: q(step(s.reverb.mix, gain, 0.05), 0.01) },
    }),
  },
  {
    id: 'loud',
    words: ['ดัง', 'ดังขึ้น', 'แรง', 'เพิ่มเสียง', 'louder', 'loud', 'boost', 'gain'],
    label: 'เพิ่มระดับเสียง',
    bias: 1,
    apply: (s, gain) => ({ ...s, outputDb: q(step(s.outputDb, gain, 2), 0.5) }),
  },
  {
    id: 'quiet',
    words: ['เบาลง', 'เบาๆ', 'ค่อย', 'quieter', 'quiet', 'softer'],
    label: 'ลดระดับเสียง',
    bias: -1,
    apply: (s, gain) => ({ ...s, outputDb: q(step(s.outputDb, gain, 2), 0.5) }),
  },
];

export const VOCAL_LEXICON: Lexicon<VocalSettings> = {
  rules: VOCAL_RULES,
  presets: VOCAL_PRESETS,
  clamp: clampVocals,
  diff: vocalDiff,
};

const KEYS_RULES: readonly ToneRule<KeysSettings>[] = [
  {
    id: 'bright',
    words: ['ใส', 'สว่าง', 'แหลม', 'คม', 'bright', 'clear', 'crisp', 'treble', 'air'],
    label: 'ความใส',
    bias: 1,
    apply: (s, gain) => ({
      ...s,
      eq: { ...s.eq, highDb: q(step(s.eq.highDb, gain, 1.5), 0.5) },
    }),
  },
  {
    id: 'dark',
    words: ['ทึบ', 'มืด', 'อู้', 'ขุ่น', 'dark', 'dull', 'muffled', 'muddy'],
    label: 'ความทึบ',
    bias: -1,
    apply: (s, gain) => ({
      ...s,
      eq: { ...s.eq, highDb: q(step(s.eq.highDb, gain, 1.5), 0.5) },
    }),
  },
  {
    id: 'thick',
    words: ['หนา', 'อุ่น', 'อ้วน', 'เนื้อ', 'อิ่ม', 'thick', 'fat', 'warm', 'body', 'full'],
    label: 'ความหนา',
    bias: 1,
    apply: (s, gain) => ({
      ...s,
      eq: { ...s.eq, lowDb: q(step(s.eq.lowDb, gain, 1.5), 0.5) },
    }),
  },
  {
    id: 'thin',
    words: ['บาง', 'ผอม', 'เบาบาง', 'thin', 'skinny'],
    label: 'ความบาง',
    bias: -1,
    apply: (s, gain) => ({
      ...s,
      eq: { ...s.eq, lowDb: q(step(s.eq.lowDb, gain, 1.5), 0.5) },
    }),
  },
  {
    id: 'reverb',
    words: ['ก้อง', 'สะท้อน', 'reverb', 'echo', 'delay', 'ดีเลย์', 'รีเวิร์บ', 'มิติ'],
    label: 'มิติเสียง',
    bias: 1,
    apply: (s, gain) => ({
      ...s,
      reverb: { ...s.reverb, mix: q(step(s.reverb.mix, gain, 0.05), 0.01) },
    }),
  },
  {
    id: 'chorus',
    words: ['กว้าง', 'สเตอริโอ', 'โครัส', 'กว้างขึ้น', 'chorus', 'stereo', 'wide'],
    label: 'ความกว้างสเตอริโอ',
    bias: 1,
    apply: (s, gain) => ({
      ...s,
      chorus: { ...s.chorus, mix: q(step(s.chorus.mix, gain, 0.05), 0.01) },
    }),
  },
];

export const KEYS_LEXICON: Lexicon<KeysSettings> = {
  rules: KEYS_RULES,
  presets: KEYS_PRESETS,
  clamp: clampKeys,
  diff: keysDiff,
};

const BRASS_RULES: readonly ToneRule<BrassSettings>[] = [
  {
    id: 'bright',
    words: ['ใส', 'สว่าง', 'แหลม', 'คม', 'bright', 'clear', 'crisp', 'treble', 'air', 'บาด'],
    label: 'ความใส',
    bias: 1,
    apply: (s, gain) => ({
      ...s,
      eq: { ...s.eq, highDb: q(step(s.eq.highDb, gain, 1.5), 0.5) },
    }),
  },
  {
    id: 'dark',
    words: ['ทึบ', 'มืด', 'อู้', 'ขุ่น', 'dark', 'dull', 'muffled', 'muddy'],
    label: 'ความทึบ',
    bias: -1,
    apply: (s, gain) => ({
      ...s,
      eq: { ...s.eq, highDb: q(step(s.eq.highDb, gain, 1.5), 0.5) },
    }),
  },
  {
    id: 'thick',
    words: ['หนา', 'อุ่น', 'อ้วน', 'เนื้อ', 'อิ่ม', 'thick', 'fat', 'warm', 'body', 'full'],
    label: 'ความหนา',
    bias: 1,
    apply: (s, gain) => ({
      ...s,
      eq: { ...s.eq, lowDb: q(step(s.eq.lowDb, gain, 1.5), 0.5) },
    }),
  },
  {
    id: 'thin',
    words: ['บาง', 'ผอม', 'เบาบาง', 'thin', 'skinny'],
    label: 'ความบาง',
    bias: -1,
    apply: (s, gain) => ({
      ...s,
      eq: { ...s.eq, lowDb: q(step(s.eq.lowDb, gain, 1.5), 0.5) },
    }),
  },
  {
    id: 'reverb',
    words: ['ก้อง', 'สะท้อน', 'reverb', 'echo', 'delay', 'ดีเลย์', 'รีเวิร์บ', 'มิติ'],
    label: 'มิติเสียง',
    bias: 1,
    apply: (s, gain) => ({
      ...s,
      reverb: { ...s.reverb, mix: q(step(s.reverb.mix, gain, 0.05), 0.01) },
    }),
  },
];

export const BRASS_LEXICON: Lexicon<BrassSettings> = {
  rules: BRASS_RULES,
  presets: BRASS_PRESETS,
  clamp: clampBrass,
  diff: brassDiff,
};
