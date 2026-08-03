/**
 * The mixer's model.
 *
 * Three tiers — channel → subgroup → master — and deliberately **no clips**. A
 * channel plays one thing, positioned in time by a single offset and windowed by an
 * in/out pair. That is the timeline model the jam page's layers used, and it is the
 * whole of it: the moment a channel can hold two clips there is a timeline to
 * maintain, and a timeline is what this app has now deleted twice.
 *
 * What each tier is for:
 *
 * - **Channel.** One source (a live input or one recorded/imported buffer), one
 *   optional instrument rack as its insert, fader, pan, mute, solo, and where it
 *   sits in time. This is where a performance lives.
 * - **Subgroup.** A named sum with its own fader, pan and mute — drums together,
 *   backing together — so a balance found between four channels survives being
 *   pushed up against everything else. Nothing is inserted here; a subgroup is a
 *   sum, not a processor.
 * - **Master.** One fader, and the only place a limiter belongs, because it is the
 *   only place that sees the whole mix.
 *
 * Every value here is a plain number or string: the state has to survive being
 * rendered offline by a second graph in a second context, and anything holding a
 * node could not.
 */

import type { ChannelStrip } from '../lib/channelStrip';
import type { Instrument } from '../lib/rig';

/** Where a channel's audio comes from. */
export type ChannelSource =
  /**
   * The live input, through the shared device session.
   *
   * Several channels may name it at once — that is one device, one open stream and
   * N taps on it, which `lib/inputSession.ts` already guarantees. It is what makes
   * "guitar through the amp rack *and* a dry DI channel beside it" possible.
   */
  | { kind: 'live' }
  /**
   * A decoded buffer: a take from the library, or an imported file.
   *
   * `takeId` is kept so a channel can say where it came from, and `name` so it can
   * still label itself once the take is gone from the library.
   */
  | { kind: 'clip'; name: string; takeId?: string; durationSec: number }
  /** Nothing assigned yet. A strip you can see and dial before it has a source. */
  | { kind: 'empty' };

/**
 * One channel strip.
 *
 * `insert` is an `Instrument` rather than a chain: the six racks already exist and
 * already read their settings from `lib/ampStore.ts`, so a channel names one and the
 * graph builds it. `null` means the signal passes straight through, which is the
 * right default for anything already recorded through a rack.
 */
export interface MixerChannel {
  id: string;
  name: string;
  source: ChannelSource;
  /** Which instrument rack is inserted, or null for a clean channel. */
  insert: Instrument | null;
  /**
   * The channel's own shaping — polarity, low cut, EQ, compressor, alignment.
   *
   * Separate from `insert` and cheap on purpose: see the note at the top of
   * `lib/channelStrip.ts`. Every channel has one; only a few want a rack.
   */
  strip: ChannelStrip;
  /**
   * Input trim in dB, **before** the insert. −24…+24.
   *
   * Separate from the fader because they do different jobs and the order matters: the
   * trim sets how hard the rack is driven, the fader sets how loud the result sits in
   * the mix. Collapsing them into one control means turning a channel up also drives
   * its amp harder, which is the difference between a level change and a tone change.
   */
  trimDb: number;
  /** Fader position in dB. 0 is unity; the useful range is −60…+12. */
  gainDb: number;
  /** −1 hard left, 0 centre, +1 hard right. Equal-power, via `StereoPannerNode`. */
  pan: number;
  muted: boolean;
  solo: boolean;
  /** Which subgroup this channel sums into. `null` routes straight to master. */
  groupId: string | null;
  /**
   * Where the source starts, in mix time.
   *
   * Only meaningful for a clip; a live channel is always "now". Negative values are
   * refused rather than clamped, the way a jam layer's are — a take that would start
   * before zero is a take whose head has to be trimmed instead.
   */
  offsetSec: number;
  /** Window within the source. `outPoint` of 0 means "to the end". */
  inPoint: number;
  outPoint: number;
}

/** A named sum of channels. */
export interface MixerGroup {
  id: string;
  name: string;
  gainDb: number;
  pan: number;
  muted: boolean;
  /**
   * Soloing a *group* means "only what feeds me". Kept here rather than derived so
   * a group solo and a channel solo can be reasoned about together — see
   * `audibleChannelIds`, which is where the interaction between them is decided.
   */
  solo: boolean;
}

/** The master bus. */
export interface MixerMaster {
  gainDb: number;
  /**
   * The look-ahead limiter on the master, on or off.
   *
   * Off by default. A limiter that nobody asked for turns "my mix is too loud" into
   * "my mix sounds squashed and I cannot tell why", and the meters already say when
   * a mix is clipping.
   */
  limiter: boolean;
  /** Ceiling in dBFS the limiter aims at. */
  ceilingDb: number;
  /**
   * The desk's own output switch.
   *
   * Separate from `monitorLive`, which is about *who owns the live input* and is decided by
   * the route. This is the player's own "silence this page" — it stops clips as well as the
   * live channels, because that is what an output switch means, and it survives navigating
   * away and back where `monitorLive` deliberately does not.
   */
  muted: boolean;
}

/** The whole desk. One value, serialisable, renderable offline. */
export interface MixerState {
  channels: MixerChannel[];
  groups: MixerGroup[];
  master: MixerMaster;
  /**
   * Whether this desk owns the **live monitor** right now.
   *
   * False while another page is monitoring the same input — see `monitorScope` in
   * `lib/ampStore.ts`. It silences channels whose source is the live input and *nothing
   * else*: clips keep playing, because leaving a page has never been allowed to stop
   * playback in this app, and every fader, mute and rack setting is untouched so the
   * balance comes straight back with the page.
   */
  monitorLive: boolean;
}

/**
 * Transport state. Mirrors the recorder's vocabulary rather than inventing one.
 *
 * There is no `recording`, and that is a scope decision rather than an omission:
 * capture lives on the recorder page, which already owns the device, the worklet, the
 * WAV encoder and the dropout recovery. A take recorded there is in the shared
 * library and can be dropped onto a channel a second later. Duplicating the capture
 * path here would be a second implementation of the one thing in this app that has
 * actually been verified against hardware.
 */
export type MixerStatus = 'idle' | 'playing' | 'rendering';

/**
 * Where a channel's audio has to be booked to play.
 *
 * The output of the one piece of arithmetic this model needs, kept as its own type
 * because getting it wrong is silent: `when` is a context time, `offset` and
 * `duration` are positions *within the buffer*, and mixing the two up plays the
 * right audio at the wrong moment or the wrong audio at the right one.
 */
export interface ChannelPlacement {
  /** Seconds from the start of the run before this channel's source starts. */
  delaySec: number;
  /** Where to start reading the buffer. */
  offsetSec: number;
  /** How much of it to play, or null for "until it ends". */
  durationSec: number | null;
}
