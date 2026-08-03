/**
 * The rig — which instrument is plugged in and all three instruments' settings —
 * as one store shared by every page.
 *
 * ---------------------------------------------------------------------------
 * Why this is a module-level store and not React state.
 *
 * The tone controls live on their own route, and the thing they control is two live
 * audio graphs on two other routes: the recorder's monitor path and the jam page's
 * playback and mixdown. Those graphs are built by `useRecorder` and `useJam`, which
 * are mounted above the router so navigation cannot close their AudioContexts. A
 * settings object owned by either hook would have made the other a second copy, and
 * a copy is a tone that silently disagrees with itself depending on which page you
 * dialled it from.
 *
 * A module-scoped external store solves it without threading state through three
 * providers: both hooks subscribe and push changes into their own graph, the tone
 * page reads and writes, and there is exactly one answer to "what is the rig set
 * to". Same pattern as `lib/theme.ts` and `lib/accent.ts`, for the same reason —
 * `useSyncExternalStore` is what keeps a value that lives outside React from
 * disagreeing with the server's HTML on the first paint.
 *
 * **All three instruments are kept side by side**, and all three chains run **at the
 * same time**, each with its own switch. That is what a live setup needs: one input,
 * three processors, mixed. The tab selects which rack you are *looking at*; `enabled`
 * decides which are *heard*, and the two are independent. Dialling a bass sound must not cost you the guitar sound you spent ten
 * minutes on, and the two are heard through the same monitor path minutes apart.
 *
 * **Not persisted, deliberately.** A knob drag fires changes every frame, so writing
 * `localStorage` on each one would hammer it for a value nobody asked to keep — and
 * the app already has explicit tone storage in `lib/ampPresets.ts`, which silent
 * persistence would quietly compete with. The session starts on `DEFAULT_RIG`, which
 * is also the server snapshot, so there is nothing to hydrate.
 * ---------------------------------------------------------------------------
 */

import type { AmpSettings } from './ampFx';
import type { RigQuality } from '@/lib/bypass';
import type { BassSettings } from './bassFx';
import type { DrumSettings } from './drumFx';
import type { VocalSettings } from './vocalFx';
import type { KeysSettings } from './keysFx';
import type { BrassSettings } from './brassFx';
import { DEFAULT_RIG, type Instrument, type RigSettings } from './rig';

let rig: RigSettings = DEFAULT_RIG;
let instrument: Instrument = 'guitar';
let masterVolume: number = 1.0;
/**
 * Which chains are in the monitor path, independently.
 *
 * A record rather than one flag, because the three run in parallel and a player
 * performing with a guitar and a drum machine on one interface has to mute one
 * without touching the other. The guitar starts on and the other two off: three
 * chains at once is three convolvers and six worklet processors, and nobody should
 * pay for a rack they have not opened.
 */
let enabled: Record<Instrument, boolean> = {
  guitar: true,
  bass: false,
  drums: false,
  vocals: false,
  keys: false,
  brass: false,
};

/**
 * Per-channel level into the monitor bus, 0..1.5.
 *
 * This is the mixer half of the bridge: three chains running at once need balancing
 * against each other, and on/off alone cannot do that. Above 1 on purpose — a drum
 * bus and a guitar amp do not arrive at the same level, and the alternative is asking
 * the player to fix it with the output trim inside each rack, which also changes what
 * the limiter sees.
 */
let level: Record<Instrument, number> = {
  guitar: 1,
  bass: 1,
  drums: 1,
  vocals: 1,
  keys: 1,
  brass: 1,
};

/**
 * Which page owns the **live monitoring**.
 *
 * One flag, because there is one instrument and one pair of speakers. The recorder's
 * monitor bus and the mixer's live channels are two views of the same input, and running
 * both means the same signal through two sets of racks on two `AudioContext`s: double the
 * convolvers, double the worklet processors, and one press turning on two chains. On this
 * machine three live channels was enough to overrun the audio thread — the sound stuttered
 * and then dropped out, which read as a mystery for an entire session.
 *
 * So whichever page is on screen owns the live sound. Deliberately **not** a mute of
 * anything the user set: the recorder's own MONITOR switch, the channel levels and every
 * rack setting are untouched and come straight back when the page does.
 *
 * It governs *monitoring only*. Clip playback on the mixer keeps running across routes —
 * this app's rule since the engines moved above the router is that sound stops when
 * somebody stops it, not when they navigate.
 */
export type MonitorScope = 'recorder' | 'mixer';

let monitorScope: MonitorScope = 'recorder';

/**
 * How much of every chain is in the path. See `lib/bypass.ts` for what moves.
 *
 * Here rather than inside `RigSettings` on purpose. It is not a tone decision — it does not
 * belong in a preset, it must not travel to `/api/tone`, and `clampRig` has no business
 * validating it. It describes the machine the racks are running on, and it is the same
 * answer for all six of them at once.
 *
 * `full` is the default because `light` gives up the gate and the limiter, which are real
 * losses; nobody should discover them without having asked.
 */
let rigQuality: RigQuality = 'full';

/**
 * The monitor buffer, in milliseconds, for **both** engines.
 *
 * One value rather than one per engine, because it describes the machine and not the page.
 * A player who has just discovered that this laptop needs 60 ms to carry five racks should
 * not have to discover it again on the desk, and two numbers for one fact is how they end
 * up disagreeing.
 *
 * 30 ms is the default for the reason recorded in `useRecorder.ts`: it is what the desk was
 * already using on the machine where 3 ms had gone silent. It is a starting point to tune
 * from in either direction, which is why it is a control at all.
 */
let monitorBufferMs = 30;

/**
 * Whether the Rig page's channel row also drives the desk's faders and mutes.
 *
 * **Off by default, because the two are different jobs.** Only one side owns the live
 * monitor at a time, so the Rig page's level is the level you hear *while dialling a tone*
 * and the desk's fader is the level that instrument sits at *in the mix*. They are never
 * both applied, which is exactly why they can be independent without disagreeing.
 *
 * They used to be wired together unconditionally, and it broke the obvious workflow: shape
 * a tone on the Rig page, balance it on the desk, go back to the Rig page for one more
 * tweak — and the balance is gone, overwritten by a slider that was only ever meant to set
 * a monitor level.
 *
 * On, it is the old behaviour and it is useful on purpose: one row of six faders that moves
 * the whole desk is the fastest way to rough out a balance before touching a strip.
 *
 * One direction only, Rig to desk. The reverse has no answer — an instrument has one level
 * and a desk can carry the same rack on several strips, so "which fader sets it" is a
 * question with no correct answer rather than one nobody has implemented.
 */
let rigDeskLink = false;

const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

export function subscribeAmp(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Every instrument's settings.
 *
 * Returns the same object until something changes it. `useSyncExternalStore`
 * compares snapshots by identity, so building a fresh object here — even an
 * identical one — would re-render every subscriber on every check.
 */
export function getRigSnapshot(): RigSettings {
  return rig;
}

/** The server and first-client snapshot. Constant, so hydration cannot mismatch. */
export function getServerRigSnapshot(): RigSettings {
  return DEFAULT_RIG;
}

export function getInstrumentSnapshot(): Instrument {
  return instrument;
}

export function getServerInstrumentSnapshot(): Instrument {
  return 'guitar';
}

/**
 * The guitar slot, for callers that only ever mean the guitar.
 *
 * `useJam` is one: it is an overdub page for a guitar over a song, and it should not
 * start processing a take as a drum bus because the tone page's tab was left on
 * drums. It reads this rather than `getRigSnapshot().instrument`.
 */
export function getAmpSnapshot(): AmpSettings {
  return rig.guitar;
}

export function getServerAmpSnapshot(): AmpSettings {
  return DEFAULT_RIG.guitar;
}

export function getMonitorScope(): MonitorScope {
  return monitorScope;
}

/** The server never monitors, and the recorder is the app's front door. */
export function getServerMonitorScope(): MonitorScope {
  return 'recorder';
}

/**
 * Hand the live monitor to one side.
 *
 * Called from `MonitorHandover` — a button — and from nothing else. It used to be written
 * by a route watcher, so the sound followed whichever page was on screen; that made
 * opening the mixer to glance at a fader silence the rack you were dialling, which reads
 * as a broken monitor rather than as a design. Keeping this to a single writer is what
 * stops the two engines from ever disagreeing about who is making sound.
 */
export function setMonitorScope(next: MonitorScope): void {
  if (monitorScope === next) return;
  monitorScope = next;
  emit();
}

export function getRigQuality(): RigQuality {
  return rigQuality;
}

/** Prerendered pages get the full chain, which is what an unconfigured machine should try. */
export function getServerRigQuality(): RigQuality {
  return 'full';
}

export function setRigQuality(next: RigQuality): void {
  if (rigQuality === next) return;
  rigQuality = next;
  emit();
}

export function getMonitorBufferMs(): number {
  return monitorBufferMs;
}

export function getServerMonitorBufferMs(): number {
  return 30;
}

export function setMonitorBufferMs(next: number): void {
  if (monitorBufferMs === next) return;
  monitorBufferMs = next;
  emit();
}

export function getRigDeskLink(): boolean {
  return rigDeskLink;
}

/** Separate on the server, as on the client: the safe default is the one that erases nothing. */
export function getServerRigDeskLink(): boolean {
  return false;
}

export function setRigDeskLink(next: boolean): void {
  if (rigDeskLink === next) return;
  rigDeskLink = next;
  emit();
}

/* --------------------------------------------------------------------------
   Who is making the sound

   Two derived answers, in **one** place, because asking twice is how this app has
   now produced the same bug three times:

   - the sidebar said `MONITOR: RIG` while the desk was making the sound;
   - the desk's banner said the engine was parked while it was running;
   - and `MixerWorkspace` read the *bridge* where it meant "does the desk own the
     sound", so pressing "take the sound" on the desk with the bridge off left the
     page insisting it was parked and offering a button to turn the bridge on. The
     Rig side had gone quiet as designed, so both halves of the screen agreed that
     nothing was playing — which is indistinguishable from a broken desk, and was
     read as exactly that.

   Every consumer reads these, and nobody re-derives them. Same rule as
   `audibleChannelIds` on the desk: two functions deciding independently is how a
   soloed channel inside a muted group ends up silent with both of them convinced
   they were right.
-------------------------------------------------------------------------- */

/**
 * Whether the desk is the end of the chain — the engine feeding the room.
 *
 * Pure, so the four combinations can be checked from Node.
 */
export function deskOwnsSound(scope: MonitorScope, bridged: boolean): boolean {
  return scope === 'mixer' || bridged;
}

/**
 * Whether the Rig page's own monitor bus is the one feeding the room.
 *
 * The exact complement of `deskOwnsSound`, and that is the invariant rather than a
 * coincidence: **exactly one side owns the live monitor.** Both true is two sets of
 * gates, limiters, convolvers and oversampled waveshapers on one instrument, which
 * is the load that made the output stream give up. Both false is silence with every
 * reading on screen still looking correct — the bug above. A Node check covers all
 * four combinations in both directions.
 */
export function rigOwnsMonitor(scope: MonitorScope, bridged: boolean): boolean {
  return scope === 'recorder' && !bridged;
}

export function getDeskOwnsSound(): boolean {
  return deskOwnsSound(monitorScope, rigDeskLink);
}

/** Matches the server defaults above: the recorder is the front door, unbridged. */
export function getServerDeskOwnsSound(): boolean {
  return deskOwnsSound(getServerMonitorScope(), getServerRigDeskLink());
}

export function getRigOwnsMonitor(): boolean {
  return rigOwnsMonitor(monitorScope, rigDeskLink);
}

export function getServerRigOwnsMonitor(): boolean {
  return rigOwnsMonitor(getServerMonitorScope(), getServerRigDeskLink());
}

export function getMasterVolume(): number {
  return masterVolume;
}

export function getServerMasterVolume(): number {
  return 1.0;
}

export function setMasterVolume(next: number): void {
  const bounded = Math.min(1.5, Math.max(0, next));
  if (masterVolume === bounded) return;
  masterVolume = bounded;
  emit();
}

/** The whole record. Stable identity until something changes it. */
export function getEnabledSnapshot(): Record<Instrument, boolean> {
  return enabled;
}

const SERVER_ENABLED: Record<Instrument, boolean> = {
  guitar: true,
  bass: false,
  drums: false,
  vocals: false,
  keys: false,
  brass: false,
};
const SERVER_LEVEL: Record<Instrument, number> = {
  guitar: 1,
  bass: 1,
  drums: 1,
  vocals: 1,
  keys: 1,
  brass: 1,
};

/** Per-channel level. Stable identity until something changes it. */
export function getLevelSnapshot(): Record<Instrument, number> {
  return level;
}

export function getServerLevelSnapshot(): Record<Instrument, number> {
  return SERVER_LEVEL;
}

export function setInstrumentLevel(which: Instrument, next: number): void {
  const bounded = Math.min(1.5, Math.max(0, next));
  if (level[which] === bounded) return;
  level = { ...level, [which]: bounded };
  emit();
}

export function getServerEnabledSnapshot(): Record<Instrument, boolean> {
  return SERVER_ENABLED;
}

/**
 * Whether the *guitar* chain is on.
 *
 * For `useJam`, which is a guitar overdub page with one chain of its own. It must not
 * go silent because the tone page's drum channel was switched off.
 */
export function getAmpEnabledSnapshot(): boolean {
  return enabled.guitar;
}

export function getServerAmpEnabledSnapshot(): boolean {
  return true;
}

/**
 * Replace one instrument's settings.
 *
 * Callers are expected to have clamped already — `clampAmp` and its siblings are the
 * boundary for anything from a model, a request body or storage. This does not clamp
 * again because it is on the knob-drag path, and re-validating every field per frame
 * to catch a mistake that cannot originate here is waste.
 */
/**
 * Replace all six racks at once.
 *
 * For restoring a saved rig, and for nothing else so far. Six separate writes would emit
 * six times and let a subscriber render against a rig that is half restored — a guitar from
 * storage beside a bass from the defaults, which is a tone nobody ever dialled.
 *
 * The caller is responsible for having clamped it. `lib/rigStorage.ts` is the only path in,
 * and it does.
 */
export function setRigSettings(next: RigSettings): void {
  rig = next;
  emit();
}

export function setAmpSettings(next: AmpSettings): void {
  if (next === rig.guitar) return;
  rig = { ...rig, guitar: next };
  emit();
}

export function setBassSettings(next: BassSettings): void {
  if (next === rig.bass) return;
  rig = { ...rig, bass: next };
  emit();
}

export function setDrumSettings(next: DrumSettings): void {
  if (next === rig.drums) return;
  rig = { ...rig, drums: next };
  emit();
}

export function setVocalSettings(next: VocalSettings): void {
  if (next === rig.vocals) return;
  rig = { ...rig, vocals: next };
  emit();
}

export function setKeysSettings(next: KeysSettings): void {
  if (next === rig.keys) return;
  rig = { ...rig, keys: next };
  emit();
}

export function setBrassSettings(next: BrassSettings): void {
  if (next === rig.brass) return;
  rig = { ...rig, brass: next };
  emit();
}

/**
 * Switch instruments.
 *
 * Only what is on screen moves. All three chains stay in the graph and keep playing —
 * this does not touch the settings and does not touch `enabled`, because selecting a
 * rack must not silence an instrument or disturb a knob. The engine watches it for one
 * thing only: which chain's gate and limiter feed the header's meters.
 */
export function setInstrument(next: Instrument): void {
  if (next === instrument) return;
  instrument = next;
  emit();
}

export function setInstrumentEnabled(which: Instrument, next: boolean): void {
  if (enabled[which] === next) return;
  enabled = { ...enabled, [which]: next };
  emit();
}

/** Flip one channel, returning its new state so a caller can act on it directly. */
export function toggleInstrumentEnabled(which: Instrument): boolean {
  const next = !enabled[which];
  enabled = { ...enabled, [which]: next };
  emit();
  return next;
}

/** The guitar channel, for `useJam`'s single chain. */
export function toggleAmpEnabled(): boolean {
  return toggleInstrumentEnabled('guitar');
}
