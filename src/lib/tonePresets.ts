/**
 * Genre voicings for the tone assistant.
 *
 * Pure data plus one helper. No Web Audio, no DOM — the `/api/tone` route reads
 * this list on the server to tell the model what the modes are, and the rack reads
 * it in the browser to draw them.
 *
 * ---------------------------------------------------------------------------
 * These are **not** the five `AMP_PRESETS` in `ampFx.ts` with different names.
 *
 * Those five are entry points into the chain — "here is what one gentle stage
 * sounds like, here is what three hot ones sound like" — and they are organised by
 * how driven the amp is. These are organised by **what the guitar is doing in a
 * band**, which turns out to move different controls: whether the part has to cut
 * through a khaen and a hand drum, whether it is carrying a melody or strumming
 * underneath a singer, whether the room is a parade or a studio.
 *
 * Two decisions repeat across the Isan voicings and are worth stating once:
 *
 * - **Bass comes down, not up.** A morlam or phin part shares its low end with a
 *   bass guitar and a klong yao, and every dB below 200 Hz is a dB fighting them.
 *   Cutting it is what lets a thin, bright guitar be heard at all — turning it up
 *   is the instinct, and it is the thing that buries the part.
 * - **The mid peak is placed, not boosted.** `midHz` matters more than `midDb`
 *   here: 700 Hz is body, 1.6 kHz is the pick and the string. Isan playing lives in
 *   the second one, which is why several of these move the frequency and leave the
 *   gain modest.
 * ---------------------------------------------------------------------------
 */

import { DEFAULT_AMP, type AmpSettings } from './ampFx';

export interface TonePreset {
  id: string;
  /** Thai name, as the picker shows it. */
  label: string;
  /** Romanised or English name, for the model and for search. */
  latin: string;
  /** One line, in Thai, on what it is for. */
  hint: string;
  /**
   * Words that should select this mode, Thai and English.
   *
   * Read by `toneIntent.ts`. Deliberately generous: someone typing "อีสาน" or
   * "isan" is asking for a family of sounds, and landing on morlam is a far better
   * answer than "ไม่เข้าใจ".
   */
  keywords: readonly string[];
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

export const TONE_PRESETS: readonly TonePreset[] = [
  /* ---- Isan ------------------------------------------------------------- */
  {
    id: 'morlam',
    label: 'หมอลำ',
    latin: 'Morlam',
    hint: 'บาง คม เน้นการเกา ตัดเบสให้พ้นทางแคน กลอง และเบส สแลปแบ็คสั้น',
    keywords: ['หมอลำ', 'morlam', 'mor lam', 'อีสาน', 'isan', 'แคน', 'khaen'],
    settings: withAmp({
      // Compressor before the amp, low ratio: fast repeated picking wants the
      // notes even, not squashed. The gate goes up because a bright thin voicing
      // amplifies hiss along with the pick.
      gate: { enabled: true, thresholdDb: -52 },
      comp: { enabled: true, thresholdDb: -20, ratio: 3 },
      // Bass well down, mid peak up at the pick rather than the body.
      tone: { bassDb: -4, midDb: 2.5, midHz: 1600, trebleDb: 4 },
      drive: { enabled: true, amount: 0.18, stages: 1, bias: 0.16 },
      cab: { enabled: true, model: 'american', presenceDb: 3, resonanceDb: -2, width: 0.25 },
      // Short slapback, few repeats. Long repeats smear fast picking into mush.
      delay: { enabled: true, timeSec: 0.11, feedback: 0.14, mix: 0.18 },
      reverb: { enabled: true, sizeSec: 1.1, mix: 0.12 },
    }),
  },
  {
    id: 'phin-kong-yao',
    label: 'พิณกองยาว',
    latin: 'Phin kong yao',
    hint: 'หนา แตกจัด ซัสเทนยาว สำหรับขบวนกลองยาว ไบแอสต่ำให้เป็นฟัซซ์',
    keywords: [
      'พิณกองยาว', 'กองยาว', 'กลองยาว', 'phin kong yao', 'kong yao', 'klong yao',
      'ขบวน', 'แห่', 'พิณไฟฟ้า',
    ],
    settings: withAmp({
      gate: { enabled: true, thresholdDb: -46 },
      comp: { enabled: true, thresholdDb: -24, ratio: 4 },
      // Mid pushed hard at 900: this has to be the loudest thing in a moving
      // parade, and mids are what carries outdoors. Bass modest — a klong yao
      // already owns the bottom, and it is louder than any amp.
      tone: { bassDb: 1, midDb: 5, midHz: 900, trebleDb: 2 },
      // Bias low on purpose: near-symmetric clipping is a fuzz, and that squared-off
      // sustain is the sound. Raising it here makes it a polite rock amp.
      drive: { enabled: true, amount: 0.82, stages: 3, bias: 0.06 },
      cab: { enabled: true, model: 'greenback', presenceDb: 1.5, resonanceDb: 1, width: 0.4 },
      reverb: { enabled: true, sizeSec: 1.3, mix: 0.14 },
      outputDb: 1,
    }),
  },
  {
    id: 'lai-phin',
    label: 'ลายพิณ',
    latin: 'Lai phin',
    hint: 'เสียงเดินลาย ชัดทุกตัวโน้ต ซัสเทนจากคอมป์ ดีเลย์ช่วยลายให้ต่อเนื่อง',
    keywords: ['ลายพิณ', 'ลาย', 'lai phin', 'lai', 'พิณ', 'phin', 'เดินลาย', 'โซโล่พิณ'],
    settings: withAmp({
      gate: { enabled: true, thresholdDb: -50 },
      // Higher ratio than kong yao and a lower threshold: a melodic line needs the
      // long tail, and the compressor is what supplies it before the drive does.
      comp: { enabled: true, thresholdDb: -26, ratio: 5 },
      tone: { bassDb: -3, midDb: 4, midHz: 1200, trebleDb: 3 },
      drive: { enabled: true, amount: 0.42, stages: 2, bias: 0.22 },
      cab: { enabled: true, model: 'v30', presenceDb: 2, resonanceDb: -1, width: 0.35 },
      delay: { enabled: true, timeSec: 0.3, feedback: 0.26, mix: 0.24 },
      reverb: { enabled: true, sizeSec: 1.7, mix: 0.18 },
    }),
  },

  /* ---- Thai popular ----------------------------------------------------- */
  {
    id: 'luk-thung',
    label: 'ลูกทุ่ง',
    latin: 'Luk thung',
    hint: 'ใสสว่าง คอมป์แน่น สแลปแบ็คแบบวงลูกทุ่ง ไม่แตกแต่มีเนื้อ',
    keywords: ['ลูกทุ่ง', 'luk thung', 'lukthung', 'ทุ่ง', 'หางเครื่อง', 'วงลูกทุ่ง'],
    settings: withAmp({
      comp: { enabled: true, thresholdDb: -22, ratio: 4 },
      tone: { bassDb: 0, midDb: 1, midHz: 800, trebleDb: 4 },
      // Just enough drive to have a voice; one stage keeps single notes clean.
      drive: { enabled: true, amount: 0.14, stages: 1, bias: 0.14 },
      cab: { enabled: true, model: 'american', presenceDb: 2.5, resonanceDb: 0, width: 0.35 },
      delay: { enabled: true, timeSec: 0.13, feedback: 0.18, mix: 0.2 },
      reverb: { enabled: true, sizeSec: 1.6, mix: 0.2 },
    }),
  },
  {
    id: 'string',
    label: 'สตริง',
    latin: 'Thai string / pop',
    hint: 'คลีนกว้าง เว้นกลางไว้ให้เสียงร้อง ห้องกว้าง เหมาะกับคอร์ดและอาร์เพจจิโอ',
    keywords: ['สตริง', 'string', 'ป็อป', 'pop', 'อินดี้', 'indie'],
    settings: withAmp({
      comp: { enabled: true, thresholdDb: -26, ratio: 2.5 },
      // Mids scooped a little rather than a lot: this sits under a vocal, and the
      // hole has to be where the voice is without hollowing the guitar out.
      tone: { bassDb: 1.5, midDb: -2.5, midHz: 700, trebleDb: 3 },
      drive: { enabled: true, amount: 0.08, stages: 1, bias: 0.1 },
      // Width is the point of this one — dual-mono cab spread wide, no delay trick.
      cab: { enabled: true, model: 'jazz', presenceDb: 2, resonanceDb: 0.5, width: 0.7 },
      delay: { enabled: true, timeSec: 0.42, feedback: 0.3, mix: 0.18 },
      reverb: { enabled: true, sizeSec: 2.8, mix: 0.3 },
    }),
  },
  {
    id: 'phuea-chiwit',
    label: 'เพื่อชีวิต',
    latin: 'Phuea chiwit',
    hint: 'ตีคอร์ดหนักแน่น กลางเยอะ แตกพอมีเนื้อ ไม่กลบเสียงร้อง',
    keywords: ['เพื่อชีวิต', 'phuea chiwit', 'pleng phuea chiwit', 'คาราบาว', 'ตีคอร์ด', 'strum'],
    settings: withAmp({
      comp: { enabled: true, thresholdDb: -20, ratio: 3 },
      tone: { bassDb: 2, midDb: 3, midHz: 750, trebleDb: 1.5 },
      drive: { enabled: true, amount: 0.34, stages: 2, bias: 0.2 },
      cab: { enabled: true, model: 'american', presenceDb: 1, resonanceDb: 0.5, width: 0.3 },
      reverb: { enabled: true, sizeSec: 1.4, mix: 0.15 },
    }),
  },

  /* ---- Western ---------------------------------------------------------- */
  {
    id: 'rock',
    label: 'ร็อค',
    latin: 'Rock',
    hint: 'คลันช์สองสเตจ กลางดัน กีตาร์ริธึมที่ยังได้ยินทุกสาย',
    keywords: ['ร็อค', 'ร็อก', 'rock', 'คลันช์'],
    settings: withAmp({
      tone: { bassDb: 2, midDb: 2, midHz: 750, trebleDb: 2.5 },
      drive: { enabled: true, amount: 0.45, stages: 2, bias: 0.2 },
      cab: { enabled: true, model: 'greenback', presenceDb: 1.5, resonanceDb: 1, width: 0.4 },
      reverb: { enabled: true, sizeSec: 1.5, mix: 0.16 },
    }),
  },
  {
    id: 'metal',
    label: 'เมทัล',
    latin: 'Metal',
    hint: 'ตัดกลาง สามสเตจร้อน เกตสูง แน่นและแห้ง',
    keywords: ['เมทัล', 'metal', 'เมทอล', 'หนักๆ', 'heavy', 'djent'],
    settings: withAmp({
      gate: { enabled: true, thresholdDb: -44 },
      tone: { bassDb: 4, midDb: -5, midHz: 650, trebleDb: 3.5 },
      drive: { enabled: true, amount: 0.8, stages: 3, bias: 0.12 },
      cab: { enabled: true, model: 'v30', presenceDb: 2, resonanceDb: 1.5, width: 0.5 },
      reverb: { enabled: false, sizeSec: 1.2, mix: 0.1 },
    }),
  },
  {
    id: 'blues',
    label: 'บลูส์',
    latin: 'Blues',
    hint: 'ขอบของการแตก ดันแรงก็แตก เบามือก็ใส กลางอุ่น',
    keywords: ['บลูส์', 'blues', 'บลู', 'เบนด์', 'bend'],
    settings: withAmp({
      comp: { enabled: true, thresholdDb: -18, ratio: 2.5 },
      tone: { bassDb: 1, midDb: 3, midHz: 620, trebleDb: 1.5 },
      // One stage, moderate gain: the dynamics have to survive, because picking
      // harder is how the part gets louder and dirtier.
      drive: { enabled: true, amount: 0.3, stages: 1, bias: 0.26 },
      cab: { enabled: true, model: 'greenback', presenceDb: 0.5, resonanceDb: 1, width: 0.3 },
      reverb: { enabled: true, sizeSec: 1.9, mix: 0.24 },
    }),
  },
  {
    id: 'jazz',
    label: 'แจ๊ส',
    latin: 'Jazz',
    hint: 'อุ่น ไม่แตก ปลายไม่จัด ตู้ 1×15 คอร์ดฟังชัดทุกตัว',
    keywords: ['แจ๊ส', 'jazz', 'แจ๊ซ', 'คอร์ดแจ๊ส', 'hollow'],
    settings: withAmp({
      comp: { enabled: true, thresholdDb: -24, ratio: 2 },
      tone: { bassDb: 2, midDb: 1.5, midHz: 500, trebleDb: -3 },
      // Drive off entirely, not merely low: a jazz archtop tone is defined by the
      // absence of harmonics the amp adds, and 8% is still 8%.
      drive: { enabled: false, amount: 0, stages: 1, bias: 0.1 },
      cab: { enabled: true, model: 'jazz', presenceDb: -1, resonanceDb: 1, width: 0.4 },
      reverb: { enabled: true, sizeSec: 1.8, mix: 0.16 },
    }),
  },
  {
    id: 'sakon',
    label: 'เพลงสากล',
    latin: 'Western pop / rock',
    hint: 'กลางๆ ทุกทาง โทนกลางถนน มิกซ์ลงแผ่นได้เลย',
    keywords: ['สากล', 'เพลงสากล', 'western', 'international', 'ทั่วไป', 'general', 'balanced'],
    settings: withAmp({
      comp: { enabled: true, thresholdDb: -22, ratio: 3 },
      tone: { bassDb: 1.5, midDb: 0.5, midHz: 800, trebleDb: 2 },
      drive: { enabled: true, amount: 0.3, stages: 2, bias: 0.18 },
      cab: { enabled: true, model: 'v30', presenceDb: 1, resonanceDb: 0.5, width: 0.4 },
      delay: { enabled: false, timeSec: 0.34, feedback: 0.28, mix: 0.2 },
      reverb: { enabled: true, sizeSec: 1.8, mix: 0.18 },
    }),
  },
  {
    id: 'ambient',
    label: 'แอมเบียนต์',
    latin: 'Ambient',
    hint: 'เกือบไม่แตก ห้องยาว ดีเลย์ป้อนกลับเยอะ สำหรับพื้นเสียงและเท็กซ์เจอร์',
    keywords: ['แอมเบียนต์', 'ambient', 'เท็กซ์เจอร์', 'texture', 'pad'],
    settings: withAmp({
      comp: { enabled: true, thresholdDb: -28, ratio: 2.5 },
      tone: { bassDb: 1, midDb: -2, midHz: 520, trebleDb: 1.5 },
      drive: { enabled: true, amount: 0.06, stages: 1, bias: 0.1 },
      cab: { enabled: true, model: 'jazz', presenceDb: 2, resonanceDb: 0, width: 0.85 },
      delay: { enabled: true, timeSec: 0.56, feedback: 0.46, mix: 0.34 },
      reverb: { enabled: true, sizeSec: 4.2, mix: 0.4 },
    }),
  },
];

/** Look one up. Returns null rather than a default — a wrong tone is worse than none. */
export function tonePresetById(id: string): TonePreset | null {
  return TONE_PRESETS.find((preset) => preset.id === id) ?? null;
}

/** Compact catalogue for the model's system prompt: id, names, and what it is for. */
export function describePresets(): string {
  return TONE_PRESETS.map(
    (preset) => `- ${preset.id} (${preset.label} / ${preset.latin}): ${preset.hint}`,
  ).join('\n');
}
