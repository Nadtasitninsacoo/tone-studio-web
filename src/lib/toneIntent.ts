/**
 * The local tone engine — plain text in, `AmpSettings` out, no network.
 *
 * Pure and deterministic, so it compiles with `npx tsc --module commonjs` and is
 * checkable from Node. That is the whole point of it: it is the half of the tone
 * assistant that always works — offline, with no API key, at zero cost, in the same
 * millisecond the player pressed enter.
 *
 * ---------------------------------------------------------------------------
 * What this is and is not.
 *
 * It is **not** a language model and does not pretend to be. It is a lexicon of the
 * words guitarists actually use about tone — in Thai and English — each mapped to
 * the controls that change that thing, with a direction and a magnitude. "แตกอีก
 * หน่อย" moves the drive up half a step; "หนาๆ แต่อย่าให้ทึบ" moves the bass up two
 * and holds the treble. That covers most of what gets typed at a tone control,
 * and it covers it predictably, which a model does not.
 *
 * **It reads all three instruments.** The machinery below — normalisation, fuzzy
 * genre matching, clause splitting, direction, magnitude, residue — is instrument
 * agnostic; what differs is which controls a word moves, and that lives in a
 * `Lexicon`. "หนาขึ้น" raises the guitar's bass shelf, the bass rig's sub *and* its
 * clean low band, and the drum bus's kick shelf. The guitar lexicon is the default
 * argument, so every existing caller and check is unchanged; `lib/rigLexicon.ts` has
 * the other two.
 *
 * Where it stops: it has no idea what a sentence *means*. "อยากได้เสียงเหมือน
 * เพลงที่เปิดอยู่" is out of reach, and that is what `/api/tone` is for. When the
 * lexicon matches nothing, `understood` is false and the caller escalates rather
 * than silently returning the settings unchanged — a control that appears to do
 * nothing is worse than one that says it did not understand.
 *
 * Two implementation choices worth keeping:
 *
 * - **Clauses are split before rules are applied.** "เพิ่มเบส ลดแหลม" has two
 *   directions in one sentence; a single global search for "เพิ่ม" would apply it
 *   to both halves and turn the treble up too.
 * - **Magnitude is a multiplier on a step, not an absolute value.** Rules say "one
 *   step of bass is 2 dB"; "นิดหน่อย" halves it and "มากๆ" doubles it. Absolute
 *   targets would make every request overwrite the last, so a player asking for two
 *   small nudges would get one big one.
 * - **Filler is stripped and Thai genre names are matched fuzzily.** Real requests
 *   arrive as "เอาแนวหมลำ", not "หมอลำ": there is a verb, a classifier, and a
 *   missing vowel. Exact substring matching answered "ยังไม่เข้าใจ" to a request any
 *   reader would get, so the text is normalised first and Thai keywords are matched
 *   within an edit distance of one or two. Latin keywords stay exact — "pop" and
 *   "lai" are short enough that a fuzzy match would fire on unrelated words.
 * - **Thai matches on substrings, latin on word boundaries.** Thai is written
 *   without spaces, so a substring is the only thing a match can be. Latin is not,
 *   and treating it the same way made "popular request" select the pop preset,
 *   because `pop` is inside `popular` — and made the residue of "add some echo" read
 *   "dd so", because the filler words `a` and `me` were removed from inside the
 *   words that contained them.
 * - **`residue` is what the lexicon could not account for**, and it is the signal
 *   the caller uses to decide whether a request is worth spending a model call on.
 *   See `useToneAssistant`: the local engine runs first now, and Claude only sees
 *   what this could not explain.
 * - **Quality words and control names read direction differently**, because Thai
 *   does. "ลง" after a control name means less of it — "เบสลง" is less bass — but
 *   after an adjective it means *more* of that adjective: "บางลง" is thinner, not
 *   thicker, and "เบาลง" is quieter. Only an explicit reducing verb (ลด, ไม่ต้อง,
 *   อย่า, less) flips a quality. Getting this wrong double-negates, which is silent
 *   and turns every request into its opposite.
 * ---------------------------------------------------------------------------
 */

import type { AmpSettings } from './ampFx';
import { ampDiff, clampAmp, type AmpChange } from './ampSchema';
import { TONE_PRESETS, type TonePreset } from './tonePresets';

/** Where a suggestion came from. Shown in the UI — the two are not equivalent. */
export type ToneSource = 'local' | 'claude' | 'preset';

export interface ToneSuggestion<S = AmpSettings> {
  settings: S;
  /** One line of Thai naming what was done, for the chat log. */
  summary: string;
  changes: AmpChange[];
  /** The genre mode this landed on, when the prompt named one. */
  presetId: string | null;
  source: ToneSource;
  /**
   * False when nothing in the text was recognised.
   *
   * The caller uses this to escalate to the model rather than to report a
   * successful no-op. `changes` being empty is not the same thing: "ทำให้แตกขึ้น"
   * at maximum drive is understood *and* changes nothing.
   */
  understood: boolean;
  /**
   * The part of the request this engine could not account for.
   *
   * Everything it recognised — a genre name, a rule word, a direction, a magnitude,
   * ordinary filler — is removed; what is left is what it did not understand. An
   * empty residue means the lexicon read the whole sentence and there is nothing a
   * model would add. A long one means the opposite, and is what makes the escalation
   * decision cheap: "หนาขึ้นอีกนิด" leaves nothing, "อยากได้เสียงเหมือนในเพลงนี้"
   * leaves almost all of itself.
   */
  residue: string;
}

/** True for a string containing Thai characters. */
function isThai(value: string): boolean {
  return /[\u0e00-\u0e7f]/.test(value);
}

/* --------------------------------------------------------------------------
   Lexicon
-------------------------------------------------------------------------- */

/**
 * One word-to-control mapping, for one instrument.
 *
 * Generic over the settings type rather than over a path into it: a rule usually
 * moves two or three controls together — "warm" is treble down *and* mid up *and*
 * bias up — and expressing that as a list of field paths made the interesting part,
 * which is the relationship between them, the least readable part.
 */
export interface ToneRule<S> {
  id: string;
  /** Matched as substrings, so Thai needs no word boundaries. */
  words: readonly string[];
  /** Thai label for the summary line. */
  label: string;
  /**
   * Direction a bare mention implies. `0` means the word names a control rather
   * than a quality ("เบส"), so it needs an explicit up/down — absent one, it reads
   * as "more", which is what people mean when they name a knob.
   */
  bias: 1 | -1 | 0;
  /** `gain` is signed and scaled: 1 is one step, −0.5 is half a step down. */
  apply(settings: S, gain: number): S;
}

/** The minimum a lexicon's presets have to carry. `TonePreset` and friends satisfy it. */
export interface LexiconPreset<S> {
  id: string;
  label: string;
  hint: string;
  keywords: readonly string[];
  settings: S;
}

/**
 * Everything instrument-specific about reading a tone request.
 *
 * `clamp` and `diff` are part of it because a suggestion is only usable if it is
 * bounded and reviewable, and both of those are per-instrument — `crush.ratio` has a
 * different ceiling from `comp.ratio`, and a diff has to print the labels the rack
 * prints.
 */
export interface Lexicon<S> {
  rules: readonly ToneRule<S>[];
  presets: readonly LexiconPreset<S>[];
  clamp(input: unknown, base: S): S;
  diff(before: S, after: S): AmpChange[];
}

/** Nudge a number by `gain` steps of `step`, letting `clampAmp` bound it later. */
function step(value: number, gain: number, size: number): number {
  return value + gain * size;
}

/** Round to a step the knobs can actually land on, so the readout is not 2.4999. */
function quantise(value: number, grid: number): number {
  return Math.round(value / grid) * grid;
}

const GUITAR_RULES: readonly ToneRule<AmpSettings>[] = [
  {
    id: 'thick',
    words: ['หนา', 'อ้วน', 'เนื้อ', 'อิ่ม', 'thick', 'fat', 'body', 'full'],
    label: 'ความหนา',
    bias: 1,
    apply: (amp, gain) => ({
      ...amp,
      tone: { ...amp.tone, bassDb: quantise(step(amp.tone.bassDb, gain, 2), 0.5) },
      cab: { ...amp.cab, resonanceDb: quantise(step(amp.cab.resonanceDb, gain, 1), 0.5) },
    }),
  },
  {
    id: 'thin',
    words: ['บาง', 'ผอม', 'เบาบาง', 'thin', 'skinny'],
    label: 'ความบาง',
    // Negative bias, and `apply` does not invert. The inversion lives in exactly
    // one place — the bias — so "บางลง" cannot cancel itself out.
    bias: -1,
    apply: (amp, gain) => ({
      ...amp,
      tone: { ...amp.tone, bassDb: quantise(step(amp.tone.bassDb, gain, 2.5), 0.5) },
    }),
  },
  {
    id: 'bright',
    words: ['ใส', 'สว่าง', 'แหลม', 'คม', 'bright', 'clear', 'crisp', 'sparkle', 'treble', 'ทรีเบิล'],
    label: 'ความใส',
    bias: 1,
    apply: (amp, gain) => ({
      ...amp,
      tone: { ...amp.tone, trebleDb: quantise(step(amp.tone.trebleDb, gain, 2.5), 0.5) },
      cab: { ...amp.cab, presenceDb: quantise(step(amp.cab.presenceDb, gain, 1), 0.5) },
    }),
  },
  {
    id: 'dark',
    words: ['ทึบ', 'มืด', 'อู้', 'ขุ่น', 'dark', 'dull', 'muffled', 'muddy'],
    label: 'ความทึบ',
    bias: -1,
    apply: (amp, gain) => ({
      ...amp,
      tone: { ...amp.tone, trebleDb: quantise(step(amp.tone.trebleDb, gain, 2.5), 0.5) },
      cab: { ...amp.cab, presenceDb: quantise(step(amp.cab.presenceDb, gain, 1), 0.5) },
    }),
  },
  {
    id: 'warm',
    words: ['นุ่ม', 'อุ่น', 'หวาน', 'กลม', 'warm', 'smooth', 'soft', 'round'],
    label: 'ความนุ่ม',
    bias: 1,
    apply: (amp, gain) => ({
      ...amp,
      tone: {
        ...amp.tone,
        trebleDb: quantise(step(amp.tone.trebleDb, -gain, 1.5), 0.5),
        midDb: quantise(step(amp.tone.midDb, gain, 1), 0.5),
      },
      // A hotter bias adds even harmonics, which is most of what "warm" means on a
      // valve stage — dropping the treble alone just makes it dull.
      drive: { ...amp.drive, bias: quantise(step(amp.drive.bias, gain, 0.06), 0.01) },
    }),
  },
  {
    id: 'drive',
    words: ['แตก', 'ซ่า', 'ดิสทอร์ต', 'โอเวอร์ไดรฟ์', 'drive', 'dist', 'gain', 'dirty', 'crunch', 'สกปรก'],
    label: 'ความแตก',
    bias: 1,
    apply: (amp, gain) => {
      const amount = step(amp.drive.amount, gain, 0.15);
      // Past three-quarters, more amount alone stops adding character — the next
      // stage is what a real amp would do. Below a quarter, drop back to one stage
      // so "แตกน้อยลง" actually cleans up instead of staying fizzy.
      const stages: 1 | 2 | 3 = amount > 0.7 ? 3 : amount > 0.25 ? 2 : 1;
      return {
        ...amp,
        drive: {
          ...amp.drive,
          enabled: amount > 0,
          amount: quantise(amount, 0.01),
          stages: gain > 0 ? Math.max(amp.drive.stages, stages) as 1 | 2 | 3 : stages,
        },
      };
    },
  },
  {
    id: 'clean',
    words: ['คลีน', 'ไม่แตก', 'สะอาด', 'clean', 'undistorted'],
    label: 'คลีน',
    bias: 1,
    apply: (amp) => ({
      ...amp,
      // A null curve is a true bypass in `ampFx`, so this is off, not quiet.
      drive: { ...amp.drive, enabled: false, amount: 0, stages: 1 },
    }),
  },
  {
    id: 'reverb',
    words: ['ก้อง', 'ห้อง', 'รีเวิร์บ', 'reverb', 'verb', 'hall', 'room', 'space', 'กว้างๆ ห้อง'],
    label: 'ห้องเสียง',
    bias: 1,
    apply: (amp, gain) => {
      const mix = step(amp.reverb.mix, gain, 0.1);
      return {
        ...amp,
        reverb: {
          enabled: mix > 0.005,
          sizeSec: quantise(step(amp.reverb.sizeSec, gain, 0.6), 0.1),
          mix: quantise(Math.max(0, mix), 0.01),
        },
      };
    },
  },
  {
    id: 'dry',
    // Only the adjective. "ไม่ต้องก้อง" is already handled by the reverb rule plus a
    // reducing verb; listing it here too made the two rules cancel each other.
    words: ['แห้ง', 'dry'],
    label: 'ความแห้ง',
    bias: -1,
    apply: (amp, gain) => {
      const mix = step(amp.reverb.mix, gain, 0.12);
      return {
        ...amp,
        reverb: { ...amp.reverb, enabled: mix > 0.005, mix: quantise(Math.max(0, mix), 0.01) },
      };
    },
  },
  {
    id: 'delay',
    words: ['ดีเลย์', 'เอคโค่', 'หน่วง', 'สแลป', 'delay', 'echo', 'slapback', 'repeat'],
    label: 'ดีเลย์',
    bias: 1,
    apply: (amp, gain) => {
      const mix = step(amp.delay.mix, gain, 0.08);
      return {
        ...amp,
        delay: { ...amp.delay, enabled: mix > 0.005, mix: quantise(Math.max(0, mix), 0.01) },
      };
    },
  },
  {
    id: 'tight',
    words: ['แน่น', 'กระชับ', 'กระด้าง', 'tight', 'punch', 'punchy', 'focused'],
    label: 'ความแน่น',
    bias: 1,
    apply: (amp, gain) => ({
      ...amp,
      // Tight is three things at once: a gate that closes between notes, less
      // low-end wander, and a cone that is not ringing.
      gate: {
        enabled: true,
        thresholdDb: quantise(step(amp.gate.thresholdDb, gain, 6), 1),
      },
      comp: { ...amp.comp, enabled: true },
      tone: { ...amp.tone, bassDb: quantise(step(amp.tone.bassDb, -gain, 1), 0.5) },
      cab: { ...amp.cab, resonanceDb: quantise(step(amp.cab.resonanceDb, -gain, 1), 0.5) },
    }),
  },
  {
    id: 'cut',
    words: ['กัด', 'แสบ', 'เจ็บ', 'ดันออกมา', 'cut', 'bite', 'aggressive', 'edge'],
    label: 'ความกัด',
    bias: 1,
    apply: (amp, gain) => ({
      ...amp,
      tone: {
        ...amp.tone,
        midDb: quantise(step(amp.tone.midDb, gain, 1.5), 0.5),
        // Move the peak toward the pick attack rather than just raising it.
        midHz: quantise(step(amp.tone.midHz, gain, 300), 10),
      },
      cab: { ...amp.cab, presenceDb: quantise(step(amp.cab.presenceDb, gain, 1.5), 0.5) },
    }),
  },
  {
    id: 'sustain',
    words: ['ซัสเทน', 'ยาว', 'ค้าง', 'ลากยาว', 'sustain', 'sing'],
    label: 'ซัสเทน',
    bias: 1,
    apply: (amp, gain) => ({
      ...amp,
      comp: {
        enabled: true,
        thresholdDb: quantise(step(amp.comp.thresholdDb, -gain, 3), 1),
        ratio: quantise(step(amp.comp.ratio, gain, 1.5), 0.5),
      },
    }),
  },
  {
    id: 'scoop',
    // "ลดกลาง" is deliberately absent: the `mid` rule plus a reducing verb already
    // covers it, and listing it here fired both and produced a net boost.
    words: ['ตัดกลาง', 'สกู๊ป', 'scoop', 'scooped'],
    label: 'ตัดกลาง',
    bias: -1,
    apply: (amp, gain) => ({
      ...amp,
      tone: { ...amp.tone, midDb: quantise(step(amp.tone.midDb, gain, 4), 0.5) },
    }),
  },
  {
    id: 'wide',
    words: ['กว้าง', 'สเตอริโอ', 'wide', 'stereo', 'spread'],
    label: 'ความกว้าง',
    bias: 1,
    apply: (amp, gain) => ({
      ...amp,
      cab: { ...amp.cab, width: quantise(step(amp.cab.width, gain, 0.2), 0.01) },
    }),
  },
  {
    id: 'noise',
    words: ['เสียงรบกวน', 'ฮัม', 'จี่', 'ซ่าๆ พื้น', 'noise', 'hiss', 'hum', 'buzz', 'noisy'],
    label: 'ลดเสียงรบกวน',
    bias: 1,
    apply: (amp, gain) => ({
      ...amp,
      gate: { enabled: true, thresholdDb: quantise(step(amp.gate.thresholdDb, gain, 6), 1) },
    }),
  },
  {
    id: 'loud',
    words: ['ดัง', 'ดังขึ้น', 'louder', 'loud', 'volume', 'วอลลุ่ม'],
    label: 'ระดับเสียง',
    bias: 1,
    apply: (amp, gain) => ({
      ...amp,
      outputDb: quantise(step(amp.outputDb, gain, 2), 0.5),
    }),
  },
  {
    id: 'quiet',
    // No "ลดเสียง": the reducing verb inside it would flip this rule and make the
    // request louder. "ลดวอลลุ่ม" reaches the same place through the `loud` rule.
    words: ['เบาลง', 'เบาๆ', 'ค่อย', 'quieter', 'quiet', 'softer'],
    label: 'ลดระดับเสียง',
    bias: -1,
    apply: (amp, gain) => ({
      ...amp,
      outputDb: quantise(step(amp.outputDb, gain, 2), 0.5),
    }),
  },
  /* ---- Named controls. `bias: 0` — these want an explicit direction. ------ */
  {
    id: 'bass',
    words: ['เบส', 'เสียงต่ำ', 'ทุ้ม', 'bass', 'low end', 'lows'],
    label: 'เบส',
    bias: 0,
    apply: (amp, gain) => ({
      ...amp,
      tone: { ...amp.tone, bassDb: quantise(step(amp.tone.bassDb, gain, 2), 0.5) },
    }),
  },
  {
    id: 'mid',
    words: ['กลาง', 'มิด', 'mid', 'mids', 'midrange'],
    label: 'กลาง',
    bias: 0,
    apply: (amp, gain) => ({
      ...amp,
      tone: { ...amp.tone, midDb: quantise(step(amp.tone.midDb, gain, 2), 0.5) },
    }),
  },
];

/**
 * The guitar lexicon, and the default for every existing caller.
 *
 * Declared after the rules and before the machinery that consumes it, so the file
 * still reads top to bottom: what the words are, what they are for, then how they
 * are matched.
 */
export const GUITAR_LEXICON: Lexicon<AmpSettings> = {
  rules: GUITAR_RULES,
  presets: TONE_PRESETS,
  clamp: clampAmp,
  diff: ampDiff,
};

/* --------------------------------------------------------------------------
   Parsing
-------------------------------------------------------------------------- */

/**
 * Verbs that explicitly ask for *less* of something.
 *
 * These — and only these — flip a quality word. "ลดความแตก" is less drive; "แตกลง"
 * is not, because ลง after an adjective intensifies it rather than reversing it.
 */
const REDUCE_WORDS = [
  'ลด', 'ไม่ต้อง', 'ไม่ค่อย', 'อย่า', 'เลิก', 'หยุด',
  'less', 'reduce', 'decrease', 'lower', 'remove', 'without', 'no ',
];

/**
 * Everything that means "less" when it follows a **control name**.
 *
 * Wider than `REDUCE_WORDS` because "เบสลง" and "กลางน้อย" are both requests for
 * less, and a bare control name carries no direction of its own.
 */
const CONTROL_DOWN_WORDS = [...REDUCE_WORDS, 'ลง', 'น้อย', 'เบา', 'down', 'cut'];

/**
 * Words that carry no tone information: verbs of asking, classifiers, politeness.
 *
 * Stripped before anything else, and stripped from the residue too, so "เอาแนวหมลำ
 * หน่อยครับ" is measured as the two characters of actual content it is rather than
 * as a sentence the engine failed to understand.
 */
const FILLER_WORDS = [
  'เอา', 'แนว', 'แบบ', 'ขอ', 'อยากได้', 'อยาก', 'ได้', 'ทำ', 'ให้', 'เสียง', 'โทน',
  'หน่อย', 'นะ', 'น่ะ', 'ครับ', 'คับ', 'ค่ะ', 'คะ', 'จ้า', 'จ้ะ', 'เป็น', 'ที่', 'มัน',
  'ช่วย', 'กีตาร์', 'กีต้าร์', 'ปรับ', 'ตั้ง', 'เล่น', 'ไป', 'มา', 'ด้วย', 'สัก',
  'please', 'make', 'give', 'me', 'my', 'i', 'want', 'the', 'a', 'an', 'sound',
  'sounds', 'tone', 'guitar', 'like', 'some', 'bit', 'more', 'set', 'to', 'of', 'for',
];

/**
 * Grammar: direction particles, intensifiers and connectives.
 *
 * These are read elsewhere — `directionOf` and `magnitudeOf` look for their own
 * subsets, and `CLAUSE_SPLIT` consumes the connectives — but they all have to be
 * removed from the **residue**, or a perfectly understood "หนาขึ้นอีกนิด" reports
 * "ขึ้นอีก" as text the engine did not understand and escalates for no reason.
 */
const GRAMMAR_WORDS = [
  'เพิ่ม', 'ขึ้น', 'ลง', 'อีก', 'กว่า', 'ๆ', 'แต่', 'และ', 'กับ', 'แล้ว', 'ส่วน', 'หรือ',
  'more', 'up', 'increase', 'boost', 'raise', 'but', 'and', 'then', 'also', 'plus',
];

/** Words that scale a step. Checked longest-first so "มากๆ" beats "มาก". */
const STRONG_WORDS = ['มากๆ', 'เยอะๆ', 'สุด', 'สุดๆ', 'จัด', 'จัดๆ', 'แรงๆ', 'very', 'a lot', 'much', 'max', 'extreme'];
const WEAK_WORDS = ['นิด', 'นิดๆ', 'หน่อย', 'เล็กน้อย', 'นิดหน่อย', 'slightly', 'a bit', 'a little', 'touch'];

/** Clause separators. A sentence can hold two opposite requests. */
const CLAUSE_SPLIT = /(?:\s*(?:และ|แล้ว|แต่|กับ|ส่วน|,|;|\/|\+|\band\b|\bbut\b|\bthen\b)\s*)+/gi;

/** Escape a literal for use inside a `RegExp`. */
function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Latin inflections a keyword is still allowed to carry.
 *
 * `bright` has to match "brighter" — comparatives are how English asks for more of
 * something, and requiring the bare adjective made "brighter please" unintelligible.
 * Anchored at the start of the word, so this does not reopen the hole that word
 * boundaries closed: `pop` still does not match "popular", because `ular` is not an
 * inflection.
 */
const LATIN_SUFFIXES = '(?:er|est|ed|ing|s|y)?';

/**
 * Compiled word patterns, cached.
 *
 * `containsWord` is called from rule matching, keyword matching and residue
 * consumption — hundreds of times per request — and compiling a `RegExp` on each
 * call was most of the cost of reading one sentence.
 */
const wordPatterns = new Map<string, RegExp>();

function wordPattern(word: string): RegExp {
  let pattern = wordPatterns.get(word);
  if (!pattern) {
    pattern = new RegExp(
      `(?<![a-z0-9])${escapeForRegex(word)}${LATIN_SUFFIXES}(?![a-z0-9])`,
      'g',
    );
    wordPatterns.set(word, pattern);
  }
  // Shared instances carry `lastIndex` between calls, and a stale one makes `test`
  // skip the front of the next string it is given.
  pattern.lastIndex = 0;
  return pattern;
}

/**
 * Does `text` contain `word` as a word?
 *
 * Thai has no word separators, so a substring *is* the match. Latin does, and
 * ignoring that matched `pop` inside `popular` and `a` inside `add`.
 */
function containsWord(text: string, word: string): boolean {
  if (isThai(word)) return text.includes(word);
  return wordPattern(word).test(text);
}

/** Remove every occurrence of `word`, by the same rules as `containsWord`. */
function removeWord(text: string, word: string): string {
  if (isThai(word)) return text.split(word).join(' ');
  return text.replace(wordPattern(word), ' ');
}

function hasAny(text: string, words: readonly string[]): boolean {
  return words.some((word) => containsWord(text, word));
}

/**
 * Direction for a clause, read two ways.
 *
 * Down beats up in both: "ไม่ต้องเพิ่มเบส" is at worst a request to leave it alone,
 * and reading it as a boost is the more damaging misunderstanding.
 */
function directionOf(clause: string, kind: 'quality' | 'control'): 1 | -1 {
  const words = kind === 'quality' ? REDUCE_WORDS : CONTROL_DOWN_WORDS;
  return hasAny(clause, words) ? -1 : 1;
}

function magnitudeOf(clause: string): number {
  if (hasAny(clause, STRONG_WORDS)) return 2;
  if (hasAny(clause, WEAK_WORDS)) return 0.5;
  return 1;
}

/* --------------------------------------------------------------------------
   Fuzzy matching, for Thai genre names only.

   The failing case that motivated this: "เอาแนวหมลำ". `หมอลำ` is five characters
   and the request has four — one dropped vowel — so `includes` says no and the
   whole request falls through to "ยังไม่เข้าใจ". Typing Thai without the tone and
   vowel marks in exactly the right places is normal, and a tone control that
   demands perfect spelling of a genre name is a tone control people stop typing at.

   Deliberately **not** applied to latin keywords. `pop`, `lai`, `bend` and `rock`
   are short enough that an edit distance of one reaches unrelated words — "top",
   "law", "band", "lock" — and a wrong genre applied confidently is worse than an
   admitted miss. Thai keywords here are 4+ characters and share no near neighbours.
-------------------------------------------------------------------------- */

/**
 * Levenshtein distance, bounded.
 *
 * Returns `limit + 1` as soon as every cell in a row exceeds the limit, so a long
 * mismatch costs a row or two rather than the whole matrix.
 */
function editDistance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + cost);
      row.push(value);
      if (value < best) best = value;
    }
    if (best > limit) return limit + 1;
    previous = row;
  }
  return previous[b.length];
}

/** How wrong a keyword may be spelled and still count. Longer words, more slack. */
function toleranceFor(keyword: string): number {
  if (keyword.length < 4) return 0;
  return keyword.length <= 7 ? 1 : 2;
}

/**
 * The best near-match of `keyword` inside `text`, or null.
 *
 * Only windows that **start on the keyword's first character** are considered. The
 * naive version tried every position at every length within tolerance, which is
 * `text.length × 3` distance computations per keyword — 177ms on a long prompt,
 * measured, for a pass that runs on every keystroke's worth of request. Anchoring on
 * the first character reduces it to the handful of positions where that character
 * actually occurs.
 *
 * Two anchors, not one: the keyword's first character **and** its second. The second
 * is what catches a dropped leading character — "มอลำ" for "หมอลำ", which is a real
 * way to mistype it. Beyond that the search gives up: a request whose first two
 * characters are both wrong is not a misspelling this can distinguish from a
 * different word, and guessing there would apply a whole genre confidently on no
 * evidence.
 */
function fuzzyFind(text: string, keyword: string): { index: number; length: number } | null {
  const tolerance = toleranceFor(keyword);
  if (tolerance === 0 || !isThai(keyword)) return null;

  const anchors = keyword[1] && keyword[1] !== keyword[0] ? [keyword[0], keyword[1]] : [keyword[0]];
  let best: { index: number; length: number; distance: number } | null = null;

  for (const anchor of anchors) {
    for (let index = text.indexOf(anchor); index !== -1; index = text.indexOf(anchor, index + 1)) {
      for (
        let length = Math.max(1, keyword.length - tolerance);
        length <= keyword.length + tolerance;
        length += 1
      ) {
        if (index + length > text.length) break;
        const distance = editDistance(keyword, text.slice(index, index + length), tolerance);
        if (distance > tolerance) continue;
        if (!best || distance < best.distance) best = { index, length, distance };
        if (distance === 0) return { index, length };
      }
    }
  }

  return best ? { index: best.index, length: best.length } : null;
}

/**
 * The genre mode a prompt names, if any.
 *
 * Scored by **how much of the name matched**, with an exact match breaking a tie
 * against a fuzzy one of the same length. Length has to come first: `พิณ` is an exact
 * three-character keyword of `lai-phin` and sits inside "พิณกองยาง", so ranking
 * exact matches first answered the wrong Isan mode to a misspelled one.
 */
export function matchPreset(prompt: string): TonePreset | null;
export function matchPreset<S>(
  prompt: string,
  presets: readonly LexiconPreset<S>[],
): LexiconPreset<S> | null;
export function matchPreset(
  prompt: string,
  presets: readonly LexiconPreset<unknown>[] = TONE_PRESETS,
): LexiconPreset<unknown> | null {
  const text = prompt.toLowerCase();

  let best: { preset: LexiconPreset<unknown>; length: number; exact: boolean } | null = null;
  const better = (length: number, exact: boolean) => {
    if (!best) return true;
    if (length !== best.length) return length > best.length;
    return exact && !best.exact;
  };

  for (const preset of presets) {
    for (const keyword of preset.keywords) {
      const needle = keyword.toLowerCase();
      // Thai is written without spaces, so a short keyword is a substring of ordinary
      // words: `สด` ("live", a drum preset's keyword) sits inside `สวัสดี`, and a
      // greeting selected a whole drum voicing. Three characters is the shortest that
      // is safe here, and it is the same judgement that keeps latin keywords
      // word-anchored — a wrong preset applied confidently is worse than a miss.
      if (isThai(needle) && needle.length < 3) continue;
      if (containsWord(text, needle)) {
        if (better(needle.length, true)) best = { preset, length: needle.length, exact: true };
        continue;
      }
      const near = fuzzyFind(text, needle);
      if (near && better(needle.length, false)) {
        best = { preset, length: needle.length, exact: false };
      }
    }
  }

  return best?.preset ?? null;
}

/**
 * Read a request and return the settings it asks for.
 *
 * A prompt can do both things at once — "หมอลำแต่หนาหน่อย" selects a mode and then
 * adjusts it — so the preset is applied first and the rules run on top of its
 * settings rather than on the player's current ones.
 *
 * The lexicon defaults to the guitar's, which is what keeps every existing call site
 * — and the 342 checks behind them — reading exactly as before.
 */
export function interpretTone(prompt: string, current: AmpSettings): ToneSuggestion<AmpSettings>;
export function interpretTone<S>(
  prompt: string,
  current: S,
  lexicon: Lexicon<S>,
): ToneSuggestion<S>;
export function interpretTone<S>(
  prompt: string,
  current: S,
  lexicon: Lexicon<S> = GUITAR_LEXICON as unknown as Lexicon<S>,
): ToneSuggestion<S> {
  const text = prompt.toLowerCase().trim();
  const preset = matchPreset(text, lexicon.presets);

  // A matched mode name is consumed before the rules read the text. Genre names
  // contain tone words — "พิณกองยาว" contains ยาว, which is the sustain rule — and
  // leaving them in applied an adjustment nobody asked for on top of the preset.
  // Fuzzy matches are cut by position, since the spelling in the text differs from
  // the keyword by definition.
  let remaining = text;
  if (preset) {
    for (const keyword of preset.keywords) {
      const needle = keyword.toLowerCase();
      if (containsWord(remaining, needle)) {
        remaining = removeWord(remaining, needle);
        continue;
      }
      const near = fuzzyFind(remaining, needle);
      if (near) {
        remaining =
          `${remaining.slice(0, near.index)} ${remaining.slice(near.index + near.length)}`;
      }
    }
  }

  /** What the lexicon has accounted for, removed as it goes. See `residue`. */
  let unexplained = remaining;
  const consume = (word: string) => {
    unexplained = removeWord(unexplained, word);
  };

  let settings: S = preset ? preset.settings : current;
  const applied: string[] = [];

  for (const clause of remaining.split(CLAUSE_SPLIT)) {
    if (!clause.trim()) continue;

    const magnitude = magnitudeOf(clause);

    for (const rule of lexicon.rules) {
      const hit = rule.words.find((word) => containsWord(clause, word));
      if (!hit) continue;
      // The signs multiply: a rule's own bias says which way the word points, the
      // clause's direction says whether the player is asking for more of it or less.
      const direction = directionOf(clause, rule.bias === 0 ? 'control' : 'quality');
      const gain = (rule.bias === 0 ? direction : rule.bias * direction) * magnitude;
      settings = rule.apply(settings, gain);
      applied.push(`${rule.label} ${gain > 0 ? '↑' : '↓'}`);
      consume(hit);
    }
  }

  // Everything else the engine reads, so the residue is only what it truly did not
  // understand. Fillers go last: they are the longest list and the least specific.
  for (const word of [
    ...REDUCE_WORDS,
    ...CONTROL_DOWN_WORDS,
    ...GRAMMAR_WORDS,
    ...STRONG_WORDS,
    ...WEAK_WORDS,
    ...FILLER_WORDS,
  ]) {
    consume(word);
  }
  const residue = unexplained.replace(/[\s.,!?;:"'()\u0e46]+/g, ' ').trim();

  const next = lexicon.clamp(settings, current);
  const changes = lexicon.diff(current, next);
  const understood = Boolean(preset) || applied.length > 0;

  let summary: string;
  if (!understood) {
    summary = 'ยังไม่เข้าใจคำสั่งนี้ ลองบอกเป็นคำอย่าง "หนาขึ้น" "แตกอีกนิด" "ก้องๆ" หรือเลือกโหมดด้านบน';
  } else if (preset && applied.length > 0) {
    summary = `ตั้งเป็น ${preset.label} แล้วปรับ ${[...new Set(applied)].join(' · ')}`;
  } else if (preset) {
    summary = `ตั้งเป็นโหมด ${preset.label} — ${preset.hint}`;
  } else if (changes.length === 0) {
    summary = `${[...new Set(applied)].join(' · ')} — สุดทางแล้ว ไม่มีอะไรขยับต่อได้`;
  } else {
    summary = `ปรับ ${[...new Set(applied)].join(' · ')}`;
  }

  return {
    settings: next,
    summary,
    changes,
    presetId: preset?.id ?? null,
    source: preset && applied.length === 0 ? 'preset' : 'local',
    understood,
    residue,
  };
}
