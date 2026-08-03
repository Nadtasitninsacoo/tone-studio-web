/**
 * A cabinet impulse response the player supplied, made safe to convolve with.
 *
 * Pure: no Web Audio, no DOM, no storage. `decodeAudioData` and `localStorage` are
 * the browser's half and live in the hook; everything that decides *what the
 * speaker is* happens here, so it compiles with
 * `npx tsc --outDir <tmp> --module commonjs` and is checked from plain Node like
 * the rest of `lib/`.
 *
 * ---------------------------------------------------------------------------
 * `cabinet.ts` says a measured IR "would be better and there is no way to obtain
 * one here without shipping a binary asset". This is that way: the player ships it.
 *
 * Four things stand between a `.wav` off the internet and a `ConvolverNode`, and
 * every one of them has already gone wrong somewhere in this codebase:
 *
 * 1. **Length is CPU, linearly.** The synthesised cabinets are 24 ms. A real cab IR
 *    is 100–500 ms and one with a room on it is longer. The Rig page runs three cab
 *    convolvers (guitar L+R, bass) and a full desk can reach sixteen, so a 500 ms
 *    file is up to 20× the cabinet load on one page and 111× on the other. That is
 *    the load that made the output stream give up once already — see
 *    `MONITOR_LATENCY_HINT`. Hence `IR_TIERS`: chosen once before playing, like
 *    `RigQuality`, and a different trade from it.
 * 2. **Level has to be normalised at 1 kHz, not at the peak.** Peak-normalising the
 *    four synthesised models left them at +13.8, +16.4, +12.9 and +18.5 dB, so
 *    switching cabinets moved the level by 5.6 dB and no A/B between them meant
 *    anything. A user IR that skipped this would be louder or quieter than every
 *    built-in cabinet, and "the one I loaded sounds better" would just mean "louder".
 * 3. **A cut tail is a click convolved into every note.** Truncating to a tier is a
 *    discontinuity; it gets faded, exactly as the synthesised tail is.
 * 4. **A file can be a gain bomb.** Normalising divides by the response at 1 kHz. A
 *    file with no energy there — silence, DC, a mangled decode — asks for a gain of
 *    1e12 into somebody's speakers. `makeUserCabinet` refuses it rather than
 *    building it, and refusing is a result, not an exception.
 * ---------------------------------------------------------------------------
 */

// Relative, not aliased: this module is pure, so it can be compiled and checked from
// plain Node, which `@/` paths break. Same rule as `lib/ampGraph.ts`.
import { REFERENCE_HZ, responseDbAt } from './cabinet';

/* --------------------------------------------------------------------------
   Constants
-------------------------------------------------------------------------- */

/**
 * Longest impulse kept from a file, in milliseconds.
 *
 * Past this it is a reverb rather than a cabinet, and there is a reverb send two
 * blocks away that is built for it — with a `roomImpulse` generator that is stereo
 * and diffuse, which is what a tail wants and what a cab IR is not.
 */
export const USER_IR_MAX_MS = 500;

/** Detail levels, in the order they appear in the picker. */
export type IrDetail = 'close' | 'room' | 'full';

export const IR_DETAILS: readonly IrDetail[] = ['close', 'room', 'full'];

export const DEFAULT_IR_DETAIL: IrDetail = 'room';

export interface IrTier {
  id: IrDetail;
  label: string;
  hint: string;
  /**
   * Milliseconds kept, or `null` for the whole file.
   *
   * The lengths are where a cabinet impulse actually changes character rather than
   * round numbers: the cone and the box are done inside ~30 ms, close-mic early
   * reflections by ~90 ms, and everything after that is the room the IR was
   * captured in.
   */
  ms: number | null;
}

export const IR_TIERS: readonly IrTier[] = [
  {
    id: 'close',
    label: 'Close',
    hint: 'Cone and box only. The cheapest — for six racks, a full desk, or a slow machine.',
    ms: 32,
  },
  {
    id: 'room',
    label: 'Room',
    hint: 'Adds the close-mic early reflections. The default.',
    ms: 96,
  },
  {
    id: 'full',
    label: 'Full',
    hint: 'The whole file, room and all. Costs the most; always used for the export.',
    ms: null,
  },
];

export function irTierById(id: IrDetail): IrTier {
  return IR_TIERS.find((tier) => tier.id === id) ?? IR_TIERS[1];
}

/**
 * Fade applied to the end of every tier, in milliseconds.
 *
 * Short on purpose. The synthesised cabinets fade their last 25%, which is right for
 * a 24 ms impulse built to be faded; doing that to a real 256 ms capture would throw
 * away most of the room it was bought for. A few milliseconds is all a cut needs to
 * stop being a click.
 */
const FADE_MS = 4;

/**
 * Response at 1 kHz below which a file is refused, in dB.
 *
 * The gain bomb guard. Normalising multiplies by `10 ** (-referenceDb / 20)`, so a
 * file reading −200 dB at the reference asks for a gain of 1e10. −60 dB is far below
 * anything a real impulse measures and far above the floor of a decode that went
 * wrong.
 */
const MIN_REFERENCE_DB = -60;

/* --------------------------------------------------------------------------
   Types
-------------------------------------------------------------------------- */

/**
 * A user cabinet, as stored.
 *
 * **The source is kept, not the tiers.** Tiers are derived on load, because they
 * depend on the sample rate of the context that will play them and that is not fixed
 * between sessions — this app has already met a Bluetooth profile dragging the rate
 * down. Storing a tier cooked at 48 kHz and replaying it at 44.1 kHz would shift the
 * whole cabinet curve by 8.8%, silently, and only for people whose hardware changed.
 */
export interface UserCabinet {
  /** File name, for the readout. Never used to find the file again. */
  name: string;
  /** Rate the samples are at. */
  sampleRate: number;
  /** Mono, already capped to `USER_IR_MAX_MS`. */
  samples: Float32Array;
  /** Length of the file as supplied, in ms, before capping. For the readout. */
  sourceMs: number;
}

export type IrRejection = 'empty' | 'silent' | 'broken';

export type UserCabinetResult =
  | { ok: true; cabinet: UserCabinet; truncated: boolean }
  | { ok: false; reason: IrRejection; message: string };

/* --------------------------------------------------------------------------
   Building
-------------------------------------------------------------------------- */

function reject(reason: IrRejection, message: string): UserCabinetResult {
  return { ok: false, reason, message };
}

/**
 * Turn decoded audio into a cabinet, or say why not. Never throws.
 *
 * `channels` is whatever `decodeAudioData` produced. **Only the first is used.**
 * Summing a stereo IR looks like the generous choice and is not: the two channels of
 * a stereo cab capture are two microphones at different distances, so summing them
 * is a comb filter the player never asked for — the same trap `cabinet.ts` records
 * above its `reflections` field, arriving from a new direction. Every IR loader
 * worth using takes channel one for a mono slot; the stereo spread this rack wants
 * is made afterwards, from two presence curves and no delay, which cannot cancel.
 */
export function makeUserCabinet(
  name: string,
  channels: readonly Float32Array[],
  sampleRate: number,
): UserCabinetResult {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    return reject('broken', 'That file reported an impossible sample rate.');
  }
  const source = channels[0];
  if (!source || source.length === 0) {
    return reject('empty', 'That file has no audio in it.');
  }

  const maxSamples = Math.max(1, Math.floor((USER_IR_MAX_MS / 1000) * sampleRate));
  const kept = Math.min(source.length, maxSamples);
  const samples = new Float32Array(kept);
  for (let i = 0; i < kept; i += 1) {
    const value = source[i];
    // One NaN convolves into every sample of every note forever. A file carrying one
    // is not a cabinet with a flaw, it is not a cabinet.
    if (!Number.isFinite(value)) {
      return reject('broken', 'That file contains invalid samples and cannot be used.');
    }
    samples[i] = value;
  }

  // Measured before any tier is cut, so a file that is only silence is refused once
  // here rather than producing three separately-exploding impulses later.
  const referenceDb = responseDbAt(samples, sampleRate, REFERENCE_HZ);
  if (!Number.isFinite(referenceDb) || referenceDb < MIN_REFERENCE_DB) {
    return reject(
      'silent',
      'That file has almost no level at 1 kHz, so it cannot be used as a cabinet.',
    );
  }

  return {
    ok: true,
    truncated: source.length > kept,
    cabinet: {
      name,
      sampleRate,
      samples,
      sourceMs: (source.length / sampleRate) * 1000,
    },
  };
}

/**
 * Linear resample. Only ever runs when the context's rate differs from the file's.
 *
 * Linear is enough here and would not be for program material: an impulse response is
 * a filter, the error is a gentle top-end loss rather than the aliasing that ruins a
 * resampled recording, and the alternative is shipping a windowed-sinc for a case
 * that costs one pass over at most 24,000 samples.
 */
function resample(samples: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return samples;
  const ratio = to / from;
  const length = Math.max(1, Math.round(samples.length * ratio));
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const at = i / ratio;
    const low = Math.floor(at);
    const high = Math.min(low + 1, samples.length - 1);
    const t = at - low;
    out[i] = samples[low] * (1 - t) + samples[high] * t;
  }
  return out;
}

/** How many samples a tier keeps of this cabinet, at this rate. */
function tierSamples(tier: IrTier, available: number, sampleRate: number): number {
  if (tier.ms === null) return available;
  return Math.min(available, Math.max(1, Math.floor((tier.ms / 1000) * sampleRate)));
}

/** How long a tier actually is for this file, in ms — what the readout should say. */
export function tierLengthMs(cabinet: UserCabinet, detail: IrDetail): number {
  const tier = irTierById(detail);
  const available = cabinet.samples.length;
  return (tierSamples(tier, available, cabinet.sampleRate) / cabinet.sampleRate) * 1000;
}

/**
 * Build one tier's impulse, ready for a `ConvolverNode`.
 *
 * Returns unity at 1 kHz, faded to silence, at `targetRate`. Never throws: a
 * cabinet that got this far was validated by `makeUserCabinet`, and anything that
 * still cannot be normalised comes back unscaled rather than multiplied by 1e12.
 *
 * The caller must set `ConvolverNode.normalize = false`, for the same reason
 * `cabinetImpulse`'s caller must — the node's own scaling would discard all of this.
 */
export function userCabinetImpulse(
  cabinet: UserCabinet,
  detail: IrDetail,
  targetRate: number = cabinet.sampleRate,
): Float32Array {
  const rate = Number.isFinite(targetRate) && targetRate > 0 ? targetRate : cabinet.sampleRate;
  const resampled = resample(cabinet.samples, cabinet.sampleRate, rate);
  const keep = tierSamples(irTierById(detail), resampled.length, rate);
  const ir = resampled.slice(0, keep);

  // The cut is a discontinuity, and a discontinuity convolved with every note is a
  // click on every note. Faded even when nothing was cut: a file can end abruptly on
  // its own, and this is the only place that would notice.
  const fade = Math.min(ir.length, Math.max(1, Math.floor((FADE_MS / 1000) * rate)));
  for (let i = 0; i < fade; i += 1) {
    const index = ir.length - fade + i;
    ir[index] *= 1 - (i + 1) / fade;
  }

  // Level-matched to the built-in cabinets at 1 kHz, so switching between a loaded IR
  // and a synthesised one is a change of tone and not of volume — and so the three
  // tiers of the *same* file match each other, which cutting the tail would otherwise
  // break by removing energy.
  const referenceDb = responseDbAt(ir, rate, REFERENCE_HZ);
  if (Number.isFinite(referenceDb) && referenceDb >= MIN_REFERENCE_DB) {
    const scale = 10 ** (-referenceDb / 20);
    for (let i = 0; i < ir.length; i += 1) ir[i] *= scale;
  }

  return ir;
}

/* --------------------------------------------------------------------------
   Storage codec

   16-bit, not 32. The impulse is normalised and its tail is faded to zero, so the
   96 dB a signed 16-bit sample carries is well past anything a cabinet curve holds —
   and it halves what goes into `localStorage`, where the app already keeps the rig
   and where the budget is shared with everything else. 500 ms at 48 kHz is 24,000
   samples: 48 KB as Int16, about 64 KB once base64 has had it.
-------------------------------------------------------------------------- */

/** Serialised form. Plain JSON so it can sit in `localStorage` beside the rig. */
export interface StoredUserCabinet {
  v: 1;
  name: string;
  sampleRate: number;
  sourceMs: number;
  /** Int16 samples, base64. */
  pcm: string;
}

export function encodeUserCabinet(cabinet: UserCabinet): StoredUserCabinet {
  const pcm = new Uint8Array(cabinet.samples.length * 2);
  const view = new DataView(pcm.buffer);
  for (let i = 0; i < cabinet.samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, cabinet.samples[i]));
    // Asymmetric on purpose: two's complement runs to -32768 but only +32767, and
    // scaling by 32768 lets a sample of exactly +1 wrap to the most negative value.
    view.setInt16(i * 2, Math.round(clamped * 32767), true);
  }
  let binary = '';
  // Chunked: spreading a 48 KB array into `fromCharCode` overflows the call stack.
  for (let i = 0; i < pcm.length; i += 0x8000) {
    binary += String.fromCharCode(...pcm.subarray(i, i + 0x8000));
  }
  return {
    v: 1,
    name: cabinet.name,
    sampleRate: cabinet.sampleRate,
    sourceMs: cabinet.sourceMs,
    pcm: btoa(binary),
  };
}

/**
 * Read a stored cabinet back, or `null`.
 *
 * Total, like `clampAmp`: everything it is handed is untrusted — a hand-edited
 * `localStorage` entry, a half-written record, a value from a future version of this
 * app. `null` means "there is no user cabinet", which every caller already handles
 * because that is also the state before anyone loads one.
 */
export function decodeUserCabinet(stored: unknown): UserCabinet | null {
  if (stored === null || typeof stored !== 'object') return null;
  const record = stored as Partial<StoredUserCabinet>;
  if (record.v !== 1) return null;
  if (typeof record.pcm !== 'string' || record.pcm.length === 0) return null;
  if (typeof record.sampleRate !== 'number' || !Number.isFinite(record.sampleRate)) return null;
  if (record.sampleRate <= 0) return null;

  let binary: string;
  try {
    binary = atob(record.pcm);
  } catch {
    return null;
  }
  if (binary.length < 2) return null;

  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const view = new DataView(bytes.buffer);
  const count = Math.floor(bytes.length / 2);
  const samples = new Float32Array(count);
  for (let i = 0; i < count; i += 1) samples[i] = view.getInt16(i * 2, true) / 32767;

  return {
    name: typeof record.name === 'string' ? record.name : 'Cabinet',
    sampleRate: record.sampleRate,
    samples,
    sourceMs:
      typeof record.sourceMs === 'number' && Number.isFinite(record.sourceMs)
        ? record.sourceMs
        : (count / record.sampleRate) * 1000,
  };
}
