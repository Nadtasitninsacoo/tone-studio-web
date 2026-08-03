/**
 * The mixer's arithmetic and its routing rules. Pure — no DOM, no Web Audio.
 *
 * Everything here is deterministic and checkable from Node, which is deliberate:
 * the two things a mixer gets silently wrong are *what is audible* and *where in
 * time a channel starts*, and neither one announces itself. A muted group holding a
 * soloed channel, a fader that reaches zero before the bottom of its travel, a
 * clip booked a buffer-offset earlier than intended — all of them sound like
 * something else. So the decisions live in functions with assertions behind them,
 * and `lib/mixGraph.ts` only wires up what these return.
 */

// Both relative, so this file compiles with a bare `npx tsc` and can be checked
// from Node without the bundler's path aliases — the way `songFx` and `beats` are.
import { clamp, dbToGain } from './audio';
import { clampStrip, DEFAULT_STRIP } from './channelStrip';
import type {
  ChannelPlacement,
  MixerChannel,
  MixerGroup,
  MixerState,
  MixerStatus,
} from '../types/mixer';

/** Fader travel, in dB. Above unity because a quiet take has to be liftable. */
export const FADER_MIN_DB = -60;
export const FADER_MAX_DB = 12;

/**
 * The dB at which a fader is treated as off.
 *
 * At the bottom of its travel a fader must be **silent**, not −60 dB: a channel left
 * at the bottom would otherwise still contribute, and twenty of them add up to an
 * audible floor nobody can find. Anything at or below this is gain zero.
 */
export const FADER_OFF_DB = FADER_MIN_DB;

/** Shortest window a trim may leave, so a channel can never become nothing. */
export const MIN_WINDOW_SEC = 0.05;

/** Input-trim travel, in dB. Symmetric, because gain staging cuts as often as it lifts. */
export const TRIM_MIN_DB = -24;
export const TRIM_MAX_DB = 24;

/**
 * Where unity sits on a 0–100 fader, as a percentage of travel.
 *
 * Three quarters up, like a hardware desk: it leaves headroom above unity to reach for
 * without the top of the travel being a cliff, and it puts the useful range of a
 * quiet channel across most of the throw instead of the last inch.
 */
export const FADER_UNITY_POSITION = 75;

/**
 * Fader position → linear gain.
 *
 * `dbToGain` with two extra rules: the bottom of the travel is exactly zero, and the
 * top is clamped. Without the first, `dbToGain(-60)` is 0.001 — inaudible alone,
 * present in a sum, and impossible to explain.
 */
export function faderGain(gainDb: number): number {
  if (!Number.isFinite(gainDb) || gainDb <= FADER_OFF_DB) return 0;
  return dbToGain(Math.min(gainDb, FADER_MAX_DB));
}

/** Clamp a fader value into its travel, refusing NaN rather than passing it on. */
export function clampFaderDb(gainDb: number): number {
  if (!Number.isFinite(gainDb)) return 0;
  return clamp(gainDb, FADER_MIN_DB, FADER_MAX_DB);
}

/** Clamp an input trim. Same NaN rule: a bad value is unity, not full boost. */
export function clampTrimDb(trimDb: number): number {
  if (!Number.isFinite(trimDb)) return 0;
  return clamp(trimDb, TRIM_MIN_DB, TRIM_MAX_DB);
}

/** Input trim → linear gain. No off position: a trim of −24 dB is quiet, not muted. */
export function trimGain(trimDb: number): number {
  return dbToGain(clampTrimDb(trimDb));
}

/**
 * Fader position (0–100, as the strip draws it) → dB.
 *
 * Two straight lines meeting at unity, which is what a desk's throw does: below unity
 * the whole −60…0 range is spread over three quarters of the travel, above it the
 * remaining quarter covers +12. A single linear map from 0–100 onto −60…+12 would put
 * unity at 83% and squeeze every useful fader move for a quiet channel into the top
 * third of the strip.
 *
 * Position 0 lands on `FADER_OFF_DB`, which `faderGain` turns into true silence.
 */
export function faderPositionToDb(position: number): number {
  if (!Number.isFinite(position)) return 0;
  const travel = clamp(position, 0, 100);
  if (travel <= 0) return FADER_MIN_DB;
  if (travel >= 100) return FADER_MAX_DB;
  if (travel <= FADER_UNITY_POSITION) {
    return FADER_MIN_DB * (1 - travel / FADER_UNITY_POSITION);
  }
  const above = (travel - FADER_UNITY_POSITION) / (100 - FADER_UNITY_POSITION);
  return FADER_MAX_DB * above;
}

/** The inverse, so a strip can draw the position for a stored dB value. */
export function dbToFaderPosition(gainDb: number): number {
  if (!Number.isFinite(gainDb)) return FADER_UNITY_POSITION;
  const db = clamp(gainDb, FADER_MIN_DB, FADER_MAX_DB);
  if (db <= 0) {
    return FADER_UNITY_POSITION * (1 - db / FADER_MIN_DB);
  }
  return FADER_UNITY_POSITION + (100 - FADER_UNITY_POSITION) * (db / FADER_MAX_DB);
}

/** Clamp a pan value. NaN goes to centre, not to hard left. */
export function clampPan(pan: number): number {
  if (!Number.isFinite(pan)) return 0;
  return clamp(pan, -1, 1);
}

/**
 * Equal-power pan gains, for meters and for the offline path.
 *
 * The graph itself uses `StereoPannerNode`, whose law is specified and which can be
 * automated; this is the same law in one line, for the places that need the numbers
 * rather than a node — a per-channel meter that should read what the master hears,
 * and any check of the routing.
 *
 * Sine/cosine, not linear: a linear crossfade drops 3 dB of power in the middle, so
 * a centred channel sits quieter than the same channel panned hard, and every mix
 * built on it slowly loses its centre.
 */
export function panGains(pan: number): { left: number; right: number } {
  const angle = ((clampPan(pan) + 1) * Math.PI) / 4;
  return { left: Math.cos(angle), right: Math.sin(angle) };
}

/** A channel with nothing to play. Kept out of the graph entirely. */
export function isSilentSource(channel: MixerChannel): boolean {
  return channel.source.kind === 'empty';
}

/** The window a clip channel plays, honouring `outPoint === 0` as "to the end". */
export function channelWindow(channel: MixerChannel): { inPoint: number; outPoint: number } {
  const source = channel.source;
  const total = source.kind === 'clip' ? source.durationSec : 0;
  const inPoint = clamp(channel.inPoint, 0, Math.max(0, total));
  const rawOut = channel.outPoint > 0 ? channel.outPoint : total;
  const outPoint = clamp(rawOut, inPoint, Math.max(inPoint, total));
  return { inPoint, outPoint };
}

/** How long a channel sounds for, after trimming. */
export function channelLength(channel: MixerChannel): number {
  const { inPoint, outPoint } = channelWindow(channel);
  return Math.max(0, outPoint - inPoint);
}

/** Where a channel ends in mix time. */
export function channelEnd(channel: MixerChannel): number {
  return Math.max(0, channel.offsetSec) + channelLength(channel);
}

/**
 * The whole mix's length: the last channel to finish.
 *
 * Live channels contribute nothing — they have no length until they have been
 * recorded, and letting them extend the mix would make the render duration depend
 * on whether an input happened to be armed.
 */
export function mixDuration(state: MixerState): number {
  let longest = 0;
  for (const channel of state.channels) {
    if (channel.source.kind !== 'clip') continue;
    longest = Math.max(longest, channelEnd(channel));
  }
  return longest;
}

/**
 * Book one channel against a run that starts at `fromSec` of the mix.
 *
 * The three-way distinction that has to be right:
 *  - The playhead is **before** the channel: wait, then play the whole window.
 *  - The playhead is **inside** it: start immediately, but from further into the
 *    buffer — this is the case that silently plays the wrong audio if the offset is
 *    left at `inPoint`.
 *  - The playhead is **past** it: nothing to book at all.
 *
 * Returns null for the last case rather than a zero-length placement, so a caller
 * cannot accidentally start a node that plays nothing and then wait for it to end.
 */
export function placeChannel(channel: MixerChannel, fromSec: number): ChannelPlacement | null {
  const length = channelLength(channel);
  if (length <= 0) return null;

  const { inPoint } = channelWindow(channel);
  const start = Math.max(0, channel.offsetSec);
  const end = start + length;
  if (fromSec >= end) return null;

  if (fromSec <= start) {
    return { delaySec: start - fromSec, offsetSec: inPoint, durationSec: length };
  }

  const into = fromSec - start;
  return { delaySec: 0, offsetSec: inPoint + into, durationSec: length - into };
}

/**
 * Which channels are audible, resolving both tiers of solo and mute.
 *
 * The rules, in the order they apply — and the order is the whole design:
 *
 * 1. **Any solo anywhere makes everything else silent.** Solo is exclusive listening;
 *    a solo that only partly worked is worse than no solo.
 * 2. **A channel solo beats a channel mute.** Pressing solo on a muted channel is a
 *    request to hear it, and it is what a player does after muting something to
 *    check what it was.
 * 3. **A group mute is absolute for the channels under it** — except for a channel
 *    that is itself soloed, by rule 2. Muting the drum group must silence the drums
 *    even though each drum channel is unmuted; that is what the group is for.
 * 4. **A group solo passes its own channels**, minus the ones muted at channel
 *    level, because that mute is inside the thing being soloed.
 *
 * Returned as a `Set` of ids: the graph writes one gain per channel from this, and a
 * membership test is what it needs.
 */
export function audibleChannelIds(state: MixerState): Set<string> {
  const groups = new Map(state.groups.map((group) => [group.id, group]));
  // Live monitoring can be handed to another page. It is checked before the solo rules
  // rather than inside them, because "this desk is not the one making the live sound" is
  // not a mix decision — a soloed live channel on a page nobody is looking at is still
  // the same input being processed twice.
  const liveMuted = state.monitorLive === false;
  /**
   * A channel that cannot sound cannot solo anything.
   *
   * The census runs over *eligible* channels only, and that is not a nicety: a solo left
   * latched on a live channel would otherwise silence the whole desk the moment the tone
   * page took the live monitor — including the clips, which are the one thing this rule
   * promises to keep playing across pages. A Node check covers exactly that case.
   */
  const eligible = (channel: MixerChannel) =>
    !isSilentSource(channel) && !(liveMuted && isLiveChannel(channel));
  const channelSolo = state.channels.some((channel) => channel.solo && eligible(channel));
  const groupSolo = state.groups.some((group) => group.solo);
  const audible = new Set<string>();

  for (const channel of state.channels) {
    if (!eligible(channel)) continue;
    const group = channel.groupId === null ? null : (groups.get(channel.groupId) ?? null);

    // Rule 2, and it comes first: a soloed channel is heard whatever is muted
    // above or around it.
    if (channel.solo) {
      audible.add(channel.id);
      continue;
    }

    // Rule 1: something else is soloed. The only survivors are that solo's own.
    if (channelSolo) continue;
    if (groupSolo) {
      if (!group?.solo) continue;
      // Rule 4: inside a soloed group, a channel mute still applies.
      if (channel.muted) continue;
      audible.add(channel.id);
      continue;
    }

    // No solo anywhere: the ordinary case.
    if (channel.muted) continue;
    // Rule 3.
    if (group?.muted) continue;
    audible.add(channel.id);
  }

  return audible;
}

/**
 * Which groups should pass audio.
 *
 * Derived from the channels rather than from the group's own flags, so a group can
 * never be the thing that silences a channel `audibleChannelIds` just said was
 * audible. That mismatch is exactly how a soloed channel in a muted group ends up
 * inaudible with two functions each believing they did the right thing.
 */
export function audibleGroupIds(state: MixerState, audible: Set<string>): Set<string> {
  const passing = new Set<string>();
  for (const channel of state.channels) {
    if (!audible.has(channel.id)) continue;
    if (channel.groupId !== null) passing.add(channel.groupId);
  }
  return passing;
}

/**
 * The gain to write for one channel: its fader, or zero when it is not audible.
 *
 * One number from one place, because the fader and the mute multiply into a single
 * `AudioParam` and two effects writing the same param fight over it. That rule was
 * learned on the recorder's six-channel monitor path and it applies here at greater
 * scale — see `lib/ampStore.ts`.
 */
export function channelGain(channel: MixerChannel, audible: Set<string>): number {
  if (!audible.has(channel.id)) return 0;
  return faderGain(channel.gainDb);
}

/**
 * The master's gain: its fader, or zero when the desk's output switch is off.
 *
 * One function so the live graph and the offline render cannot disagree about it — a render
 * that ignored the switch would export a mix nobody could hear, and one that honoured a
 * *monitor* decision would export silence for the wrong reason.
 */
export function masterGain(master: MixerState['master']): number {
  if (master.muted) return 0;
  return faderGain(master.gainDb);
}

/** The same, for a group: its fader, or zero when nothing audible feeds it. */
export function groupGain(group: MixerGroup, passing: Set<string>): number {
  if (!passing.has(group.id)) return 0;
  return faderGain(group.gainDb);
}

/**
 * Trim a channel's head without moving what is already in time.
 *
 * `offsetSec` moves with `inPoint`, which is the jam page's rule and the reason a
 * trim there does not ruin the timing: changing the in-point alone drags every
 * remaining note earlier by the amount trimmed. A trim is "start later in the
 * source", not "play the same source earlier".
 */
export function trimChannelStart(channel: MixerChannel, deltaSec: number): MixerChannel {
  const { inPoint, outPoint } = channelWindow(channel);
  const nextIn = clamp(inPoint + deltaSec, 0, Math.max(0, outPoint - MIN_WINDOW_SEC));
  const moved = nextIn - inPoint;
  return {
    ...channel,
    inPoint: nextIn,
    outPoint,
    offsetSec: Math.max(0, channel.offsetSec + moved),
  };
}

/** Trim the tail. Nothing moves in time, so this one is only a window change. */
export function trimChannelEnd(channel: MixerChannel, deltaSec: number): MixerChannel {
  const { inPoint, outPoint } = channelWindow(channel);
  const total = channel.source.kind === 'clip' ? channel.source.durationSec : outPoint;
  const nextOut = clamp(outPoint + deltaSec, inPoint + MIN_WINDOW_SEC, Math.max(total, inPoint + MIN_WINDOW_SEC));
  return { ...channel, inPoint, outPoint: nextOut };
}

/** Move a channel in time. Never before zero — the mix has no negative time. */
export function moveChannel(channel: MixerChannel, offsetSec: number): MixerChannel {
  return { ...channel, offsetSec: Math.max(0, Number.isFinite(offsetSec) ? offsetSec : 0) };
}

/** Sum of the audible faders, as a linear figure. Used to warn before a render. */
export function summedGain(state: MixerState): number {
  const audible = audibleChannelIds(state);
  const groups = new Map(state.groups.map((group) => [group.id, group]));
  let total = 0;
  for (const channel of state.channels) {
    if (!audible.has(channel.id)) continue;
    const group = channel.groupId === null ? null : groups.get(channel.groupId);
    total += faderGain(channel.gainDb) * (group ? faderGain(group.gainDb) : 1);
  }
  return total * faderGain(state.master.gainDb);
}

/** A fresh channel. `name` is the caller's, everything else is a sane default. */
export function createChannel(id: string, name: string, patch: Partial<MixerChannel> = {}): MixerChannel {
  return {
    id,
    name,
    source: { kind: 'empty' },
    insert: null,
    // A fresh copy per channel: `DEFAULT_STRIP` is a module-level object, and
    // sharing it would put one strip behind all eight the moment anything
    // mutated in place. `clampStrip` already deep-copies.
    strip: clampStrip(DEFAULT_STRIP),
    trimDb: 0,
    gainDb: 0,
    pan: 0,
    muted: false,
    solo: false,
    groupId: null,
    offsetSec: 0,
    inPoint: 0,
    outPoint: 0,
    ...patch,
  };
}

/** A fresh subgroup. */
export function createGroup(id: string, name: string): MixerGroup {
  return { id, name, gainDb: 0, pan: 0, muted: false, solo: false };
}

/** A fresh desk state, for callers that need one without the hook. */
export function createMixerState(
  channels: MixerChannel[],
  groups: MixerGroup[] = [],
): MixerState {
  return {
    channels,
    groups,
    master: { gainDb: 0, limiter: false, ceilingDb: -0.3, muted: false },
    monitorLive: true,
  };
}

/** True when this channel's source is the live input. */
export function isLiveChannel(channel: MixerChannel): boolean {
  return channel.source.kind === 'live';
}

/**
 * Whether a state change needs the graph rebuilt rather than updated.
 *
 * Only three things do: which rack is inserted on a channel, which group it feeds, and
 * what kind of source it holds. Everything else is a parameter write. Keeping the
 * decision in one predicate is what stops the engine from rebuilding on every fader
 * move "just in case" — a rebuild interrupts the sound, which is the bug the
 * recorder's permanently-parallel racks exist to avoid.
 *
 * Pure, and here rather than in `lib/mixGraph.ts`, so it can be checked from Node
 * without loading anything that expects a browser.
 */
export function needsRebuild(before: MixerState, after: MixerState): boolean {
  if (before.channels.length !== after.channels.length) return true;
  if (before.groups.length !== after.groups.length) return true;

  const previous = new Map(before.channels.map((channel) => [channel.id, channel]));
  for (const channel of after.channels) {
    const was = previous.get(channel.id);
    if (!was) return true;
    if (was.insert !== channel.insert) return true;
    if (was.groupId !== channel.groupId) return true;
    if (was.source.kind !== channel.source.kind) return true;
  }

  const previousGroups = new Set(before.groups.map((group) => group.id));
  return after.groups.some((group) => !previousGroups.has(group.id));
}

/**
 * Whether the desk's `AudioContext` should be suspended outright.
 *
 * **Gain zero is not enough, and neither is a muted channel.** Web Audio stops computing
 * a node with no path to `destination`, not one whose output is silent — so while the tone
 * page owned the live monitor, this desk went on running a full rig chain per live channel
 * for a signal nobody could hear. Two contexts, two sets of gates, limiters, convolvers
 * and oversampled waveshapers, for one instrument: the audio thread was doing double the
 * work to produce one page's sound, which is what a stutter on the tone page *is*. The
 * recorder answers the mirror-image case by disconnecting its monitor bus; a desk has
 * eight strips and no single bus to unhook, so it parks the whole context instead —
 * `suspend()` stops the render thread, which is every node at once.
 *
 * Three things forbid parking, and all three are about somebody listening:
 *
 * - it owns the live monitor (`monitorLive`) — that is the mixer page being on screen;
 * - it is playing, because clips keep playing across pages by design;
 * - it is rendering, because an offline render reads this state.
 *
 * Pure so the invariant can be checked from Node: the desk must never be parked while it
 * is making, or about to make, a sound.
 */
export function shouldParkContext(state: MixerState, status: MixerStatus): boolean {
  if (state.monitorLive) return false;
  return status === 'idle';
}
