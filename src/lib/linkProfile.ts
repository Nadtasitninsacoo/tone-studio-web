/**
 * What actually opened on the other end of the cable — or the radio.
 *
 * Pure: takes two numbers off an opened stream and returns what kind of source it
 * is, so it compiles with `npx tsc --outDir <tmp> --module commonjs` and is checked
 * from plain Node like the rest of `lib/`.
 *
 * ---------------------------------------------------------------------------
 * Why this is not a label match.
 *
 * `useInputDevices` guesses Bluetooth from the device *name*, and has to: the list
 * has to be drawn before anything is opened, and a name is all there is at that
 * point. Its own comment already concedes the point — "the authoritative check is
 * the stream's actual sample rate once it opens".
 *
 * Nothing acted on that, and the guess then drove a claim it cannot support. Every
 * Bluetooth device was badged **"voice quality only"**, which is true of a headset
 * and false of a phone: one Bluetooth link carries 8–16 kHz mono speech (HFP/HSP),
 * the other carries 44.1 or 48 kHz music (A2DP), and they are the same radio, the
 * same pairing and often the same word in the same device name. Telling someone
 * their 48 kHz stereo music source is voice-only is the same class of mistake as
 * telling them the desk is parked while it is running.
 *
 * **The profile is not in the name. It is in the format.** A link that opened at
 * 16 kHz is a voice profile whatever it is called, and a link that opened at 48 kHz
 * is not, whatever it is called. So the name decides how the row is *drawn before
 * arming*, and this decides everything claimed *after*.
 * ---------------------------------------------------------------------------
 */

/**
 * Sample rate at or below which an input is a speech codec, in Hz.
 *
 * HFP narrowband is 8 kHz and its wideband successor (mSBC) is 16 kHz; A2DP starts
 * at 44.1. The gap between them is enormous and nothing real lands inside it, so the
 * threshold sits in the middle of it rather than on either edge — a codec nobody has
 * heard of arriving at 22 kHz should read as unusable for music, because it is.
 */
export const VOICE_RATE_CEILING_HZ = 24_000;

export type LinkProfile =
  /** Nothing open yet. Not a claim about anything. */
  | 'unopened'
  /**
   * A speech codec: 8–16 kHz, mono. Unusable for music and for recording an
   * instrument — but see `isUsableForTuning`, because it is fine for a tuner.
   */
  | 'voice'
  /** A wireless link carrying full-band audio — A2DP. Music arrives intact. */
  | 'wireless'
  /** A wire. The USB pedal, an interface, the machine's own input. */
  | 'wired';

export interface OpenedFormat {
  sampleRate: number;
  channels: number;
}

/**
 * Classify an opened input.
 *
 * `looksWireless` is the label guess from `useInputDevices`. It is only consulted to
 * tell a full-band *radio* link from a full-band *wire* — a distinction that changes
 * what to warn about (a radio can drop out and can renegotiate down to voice mid
 * session; a wire cannot) but never changes whether music will fit through it.
 *
 * Total: a missing or nonsensical format is `unopened`, never a guess.
 */
export function classifyLink(
  format: OpenedFormat | null | undefined,
  looksWireless: boolean,
): LinkProfile {
  if (!format) return 'unopened';
  const { sampleRate } = format;
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) return 'unopened';

  // Rate first, and rate alone. A mono 48 kHz USB pedal is an ordinary wired input,
  // so channel count cannot be part of this test — it would call the pedal a headset.
  if (sampleRate <= VOICE_RATE_CEILING_HZ) return 'voice';
  return looksWireless ? 'wireless' : 'wired';
}

/** Whether music or an instrument can be recorded through this at all. */
export function isUsableForMusic(profile: LinkProfile): boolean {
  return profile === 'wireless' || profile === 'wired';
}

/**
 * Whether the tuner can work on it. **A voice profile can.**
 *
 * Worth stating rather than assuming the answer follows from `isUsableForMusic`: an
 * 8 kHz link is hopeless for recording and completely fine for tuning, because the
 * highest open string on a guitar is 330 Hz and on a bass 98 — an order of magnitude
 * under the Nyquist limit of even the narrowband codec. `TunerPanel` already says so
 * to the player; this is the same fact where code can read it.
 */
export function isUsableForTuning(profile: LinkProfile): boolean {
  return profile !== 'unopened';
}

/**
 * Whether the format is stereo enough to carry a stereo music source.
 *
 * Separate from the profile because it is a separate disappointment: a link can be
 * full-band and still arrive mono, and a phone playing music into a mono input is
 * working correctly and sounds wrong.
 */
export function isStereo(format: OpenedFormat | null | undefined): boolean {
  return !!format && format.channels >= 2;
}
