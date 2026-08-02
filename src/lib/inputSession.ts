/**
 * One open input device, shared between engines and self-healing.
 *
 * This exists because of a specific, reproducible failure: the pedal (or its
 * driver, or the Windows audio endpoint behind it) drops for a moment, the
 * `MediaStreamTrack` fires `ended`, and everything downstream stops — with
 * "Input device disconnected." and nothing to press. Both engines used to handle
 * that event by giving up: `useRecorder` closed its whole `AudioContext`, so
 * monitoring, the meters and the tuner went with the device, and `useJam` marked
 * itself failed mid-take. A USB glitch that lasts 40 ms ended the session.
 *
 * Two things are wrong with that, and this module fixes both.
 *
 * **A lost device is a transient, not a verdict.** `ended` is what the browser
 * says when the endpoint goes away for *any* reason: USB selective suspend, a
 * driver reset, another application grabbing the device in exclusive mode, a
 * sample-rate change, a hub power blip. Almost all of those come back within a
 * second or two, so the right response is to reopen the same device — patiently,
 * with backoff, and cued by `devicechange` rather than by polling — and hand the
 * fresh stream back to whoever was using it. The graph never has to be rebuilt
 * for that, which is what makes recovery inaudible: the engines re-point one
 * `MediaStreamAudioSourceNode` and everything after it is untouched.
 *
 * **Two engines must not open the same device twice.** `useRecorder` is armed
 * from app start (it lives above the router so the amp page can be heard), and
 * arming the jam page opened a *second* `getUserMedia` on the same hardware. A
 * class-compliant USB interface does not always survive that: the second open
 * can reset the endpoint, which ends the first stream — i.e. the failure this
 * module recovers from was partly self-inflicted. So a device is opened once and
 * every holder gets a `clone()` of it. Clones share the device but have
 * independent lifetimes, so one engine calling `track.stop()` — which both
 * already do in their teardown — cannot silence the other.
 *
 * The device is released when the last holder releases it, never before.
 *
 * Nothing here has run in a browser. The pure helpers (`pickReplacement`,
 * `retryDelayMs`, `inputConstraints`) are checked from Node; the event wiring and
 * the recovery loop are reasoned, not observed.
 */

// Relative, like `songFx` and `beats`: it is what lets this file be compiled and
// checked from Node without the bundler's path aliases.
import { mediaErrorKind } from './mediaErrors';

/** Whether the shared device is delivering audio right now. */
export type InputState =
  /** Open and running. */
  | 'live'
  /** The track exists but the OS has stopped feeding it. Often self-healing. */
  | 'muted'
  /** Gone, and being reopened. */
  | 'recovering'
  /** Gone, and out of attempts. A manual retry is the only way forward. */
  | 'lost';

/** Why a device stopped delivering audio. */
export type InputLossReason =
  /** The track fired `ended` — unplugged, reset, or taken by another app. */
  | 'ended'
  /** The track stayed muted long enough that waiting was no longer sensible. */
  | 'muted'
  /** The render thread stopped advancing, so the whole context was suspect. */
  | 'stalled'
  /** A caller asked for a fresh open. */
  | 'manual';

/** What the UI needs to say about the device. */
export interface InputHealth {
  state: InputState;
  /** Reopen attempts since the loss. Zero while live. */
  attempt: number;
  /** One line for the user, or null when there is nothing to report. */
  message: string | null;
}

/** A `MediaDeviceInfo`, reduced to what matching needs so Node can check it. */
export interface DeviceLike {
  deviceId: string;
  groupId: string;
  label: string;
  /** Absent in the checks; `'audioinput'` is assumed when it is. */
  kind?: string;
}

/** The device to find again, taken from the live track wherever possible. */
export interface DeviceTarget {
  deviceId: string;
  groupId: string;
  label: string;
}

/** One engine's use of the shared device. */
export interface InputLease {
  /**
   * This holder's own clone of the device stream.
   *
   * Safe to `stop()` — it is not the shared master. Replaced on recovery, which
   * arrives through `onStream` rather than by mutating this field.
   */
  stream: MediaStream;
  /** The id actually opened, which is not always the id requested. */
  deviceId: string;
  label: string;
  /** Force a reopen now. For a "retry" button, or a stalled render thread. */
  retry: (reason?: InputLossReason) => void;
  /** Drop this holder. The device closes when the last one lets go. */
  release: () => void;
}

export interface LeaseOptions {
  /** Empty string means "the system default", as `getUserMedia` treats it. */
  deviceId: string;
  /** For display and as the last-resort way to recognise the device again. */
  label: string;
  /**
   * A replacement stream is live. The old clone is already stopped.
   *
   * The holder re-points its source node at this stream. It is the *same*
   * device, but not necessarily the same format — check the channel count and
   * sample rate before assuming the existing graph still fits.
   */
  onStream: (stream: MediaStream) => void;
  /**
   * The device just went away, before any attempt to get it back.
   *
   * This is where a take in progress gets salvaged: the samples captured up to
   * this point are a real performance and are still correctly aligned.
   */
  onLoss: (reason: InputLossReason) => void;
  /** Every state change, for the badge and the banner. */
  onHealth: (health: InputHealth) => void;
}

/**
 * The first retry is deliberately quick.
 *
 * A driver reset or an exclusive-mode grab is usually over in well under a
 * second, and that is the common case — worth catching before the player has
 * finished noticing.
 */
const FIRST_RETRY_MS = 200;

/** Ceiling on the backoff. Beyond this, `devicechange` is doing the real work. */
const MAX_RETRY_MS = 4000;

/**
 * Attempts before giving up: about 80 seconds of trying.
 *
 * Giving up is not the end of it — a `devicechange` while `lost` starts a fresh
 * round, so a pedal plugged back in after a coffee break still recovers by
 * itself. The cap only stops the timer-driven loop from running forever.
 */
const RETRY_ATTEMPTS = 24;

/**
 * How long a muted track is left alone before it is treated as lost.
 *
 * `mute` means the OS stopped delivering audio while the track object lives on;
 * Windows does it briefly when an endpoint is reconfigured, and it unmutes
 * itself. Reopening immediately would fight that, so wait — but not for ever,
 * because a track that never unmutes is silence with no explanation.
 */
const MUTE_GRACE_MS = 2500;

/**
 * The audio constraints, in one place.
 *
 * Both engines had their own copy of this object, which is exactly the kind of
 * duplication that drifts: the browser's voice-chat DSP has to stay off on every
 * path, or a take is gated, gain-ridden and echo-cancelled — and on one page
 * only. `channelCount` is an ideal, not `exact`, so a mono interface still opens.
 */
export function inputConstraints(deviceId: string): MediaStreamConstraints {
  return {
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 2,
    },
  };
}

/** Backoff for reopen attempt `attempt` (0-based), in ms. */
export function retryDelayMs(attempt: number): number {
  if (attempt <= 0) return FIRST_RETRY_MS;
  return Math.min(MAX_RETRY_MS, FIRST_RETRY_MS * 2 ** attempt);
}

/**
 * Find the same device again in a fresh enumeration.
 *
 * Deliberately conservative: it returns the device the player was using, or
 * nothing. There is no "well, this other input looks close enough" branch, and
 * that is the whole point — silently re-arming onto the laptop's built-in
 * microphone would carry on recording, at a plausible level, from the wrong
 * instrument. An admitted miss is recoverable; a wrong device is a wasted take.
 *
 * Order matters:
 *  - `deviceId` first. Chrome's ids are stable per origin for the same physical
 *    device, so a replug usually lands here.
 *  - `groupId` next, for the case where the id was re-salted but the hardware
 *    group survived.
 *  - `label` last. Two identical pedals share a label, so this can pick the
 *    other one of a matched pair — harmless, they are the same device — but it
 *    can never wander onto different hardware.
 */
export function pickReplacement(devices: DeviceLike[], target: DeviceTarget): DeviceLike | null {
  const inputs = devices.filter(
    (device) =>
      (device.kind ?? 'audioinput') === 'audioinput' &&
      // An OS alias for whatever is current, not hardware. `default` is kept
      // because it is a legitimate thing to have opened; `communications` never is.
      device.deviceId !== 'communications',
  );

  if (target.deviceId) {
    const byId = inputs.find((device) => device.deviceId === target.deviceId);
    if (byId) return byId;
  }

  if (target.groupId) {
    const byGroup = inputs.find((device) => device.groupId === target.groupId);
    if (byGroup) return byGroup;
  }

  if (target.label) {
    const byLabel = inputs.find((device) => device.label === target.label);
    if (byLabel) return byLabel;
  }

  // Opened as the system default: asking for the default again is the same
  // request, whatever the OS has since decided that means.
  if (!target.deviceId || target.deviceId === 'default') {
    return inputs.find((device) => device.deviceId === 'default') ?? null;
  }

  return null;
}

/** What to say while reopening. Names the device, because "reconnecting" alone reads as a network problem. */
export function recoveringMessage(label: string, attempt: number): string {
  if (attempt <= 1) return `${label} dropped out — reopening it.`;
  return `${label} dropped out — reopening it (attempt ${attempt}).`;
}

/** What to say once the timer-driven attempts are exhausted. */
export function lostMessage(label: string): string {
  return `${label} is not responding. Reconnect it — the app will pick it up automatically — or choose another input.`;
}

/** What to say while the OS is holding the device open but silent. */
export function mutedMessage(label: string): string {
  return `${label} went silent. Another application may have taken it — waiting for it to come back.`;
}

/**
 * Which real device the `default` alias points at.
 *
 * Pure, and load-bearing: `default` is not hardware, it is a pointer to whatever the OS
 * currently prefers, and it enumerates as its own entry with its own id. Treating it as
 * a device in its own right is how the same pedal gets opened **twice** — once as
 * `default` by one page and once by its real id from another — which a class-compliant
 * USB interface can answer by resetting its endpoint. That reset ends the first stream,
 * which is exactly the "sound came in for a second and then stopped" failure.
 *
 * Chrome gives the alias entry the same `groupId` as the hardware behind it, so the real
 * id is findable without opening anything. Returns null when there is nothing to
 * resolve, and the caller then treats `default` as its own key — which is correct on a
 * browser that does not expose the alias at all.
 */
export function resolveDefaultDeviceId(devices: DeviceLike[]): string | null {
  const inputs = devices.filter((device) => (device.kind ?? 'audioinput') === 'audioinput');
  const alias = inputs.find((device) => device.deviceId === 'default');
  if (!alias || !alias.groupId) return null;

  const real = inputs.find(
    (device) =>
      device.deviceId !== 'default' &&
      device.deviceId !== 'communications' &&
      device.deviceId !== '' &&
      device.groupId === alias.groupId,
  );
  return real?.deviceId ?? null;
}

/**
 * Open a device by id, and fall back to opening it by name.
 *
 * Chrome's device ids are per-origin hashes that can be re-salted — a replug, a
 * cleared site setting — so `{ deviceId: { exact } }` failing does not mean the
 * pedal is absent. Only two failure kinds are worth a second look: `missing`
 * (nothing matched the constraint) and `constraints` (it matched and could not
 * comply). Anything else — refused permission, device busy — is about the device
 * that *was* found, so retrying by name would only produce a worse message.
 *
 * Matching on the label is safe here for the same reason it is in
 * `pickReplacement`: it can find the other one of two identical pedals, and it
 * cannot wander onto different hardware.
 */
async function openDevice(deviceId: string, label: string): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia(inputConstraints(deviceId));
  } catch (cause) {
    const kind = mediaErrorKind(cause);
    if (!deviceId || !label || (kind !== 'missing' && kind !== 'constraints')) throw cause;

    const devices = await navigator.mediaDevices.enumerateDevices();
    const match = devices.find(
      (device) =>
        device.kind === 'audioinput' &&
        device.deviceId !== 'communications' &&
        device.deviceId !== deviceId &&
        device.label === label,
    );
    if (!match) throw cause;

    return await navigator.mediaDevices.getUserMedia(inputConstraints(match.deviceId));
  }
}

interface Holder extends LeaseOptions {
  /** The clone handed to this holder. Stopped when it is replaced or released. */
  stream: MediaStream;
}

interface Session {
  key: string;
  /** What was asked for. Empty for the system default. */
  requestedId: string;
  /** How to find this device again. Taken from the live track, not the request. */
  target: DeviceTarget;
  /** For messages. The track's own label wins over the caller's. */
  label: string;
  /** The one open device. Never handed out — holders get clones. */
  master: MediaStream;
  holders: Set<Holder>;
  health: InputHealth;
  /** Removes the listeners from the current master track. */
  detachTrack: () => void;
  muteTimer: number;
  /** In-flight recovery, so concurrent losses cannot start two loops. */
  recovery: Promise<boolean> | null;
  /** Cuts the current backoff sleep short — called on `devicechange`. */
  wake: (() => void) | null;
  disposed: boolean;
}

/**
 * Open sessions, keyed by requested device id.
 *
 * A map rather than a single session because arming two different devices on two
 * pages is legitimate. Two *holders of the same device* is the common case, and
 * that is one entry with two clones.
 */
const sessions = new Map<string, Session>();

/** In-flight session creation promises, keyed by canonical device id. */
const inFlightSessions = new Map<string, Promise<Session>>();

/**
 * Requested device id → the key its session is actually stored under.
 *
 * `''`, `'default'` and the hardware's own id all name one device, and one device must
 * be one session or it gets opened twice. The alias is remembered so the resolution
 * (an `enumerateDevices` call) happens once per requested id rather than per arm.
 */
const aliases = new Map<string, string>();

/** Whether the shared `devicechange` listener is installed. */
let deviceChangeHooked = false;

function stopStream(stream: MediaStream | null): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      // Already stopped, or the device is gone. Either way there is nothing to do.
    }
  }
}

/**
 * Run a holder's callback without letting it take the others down.
 *
 * Every notification here is a loop over holders, and the holders are two
 * different engines. One of them throwing while a device is being recovered must
 * not stop the other from being handed its stream — that would turn a recoverable
 * dropout into a page that never comes back.
 */
function safely(what: () => void): void {
  try {
    what();
  } catch {
    // Nothing useful to do with it: the holder is a hook, not a caller with a
    // recovery of its own, and the device work has to carry on regardless.
  }
}

function setHealth(session: Session, health: InputHealth): void {
  session.health = health;
  for (const holder of [...session.holders]) safely(() => holder.onHealth(health));
}

/** The target and label a live track reports, which beat anything the caller knew. */
function targetOf(track: MediaStreamTrack, fallback: DeviceTarget): DeviceTarget {
  const settings = track.getSettings();
  return {
    deviceId: settings.deviceId ?? fallback.deviceId,
    groupId: settings.groupId ?? fallback.groupId,
    label: track.label || fallback.label,
  };
}

/**
 * Report what the browser actually granted, against what was asked for.
 *
 * Constraints are a *request*: Chrome ties its audio processing to the device session, so a
 * stream opened elsewhere with the voice-chat DSP on can leave a later stream with that
 * configuration however explicitly it asked for `false`. The symptom is exactly a guitar
 * that pumps (AGC) and sounds veiled (noise suppression eating the decay), and it cannot be
 * diagnosed from the source — only from the settings the track admits to.
 *
 * On the transition only, never per frame.
 */
function reportTrackSettings(track: MediaStreamTrack, when: string): void {
  const settings = track.getSettings() as MediaTrackSettings & {
    latency?: number;
    autoGainControl?: boolean;
    noiseSuppression?: boolean;
    echoCancellation?: boolean;
  };
  const unwanted = (['autoGainControl', 'noiseSuppression', 'echoCancellation'] as const).filter(
    (key) => settings[key] === true,
  );
  const line = `[input] ${when} · ${track.label} · ${settings.sampleRate ?? '?'} Hz · ${
    settings.channelCount ?? '?'
  } ch · agc=${settings.autoGainControl} ns=${settings.noiseSuppression} aec=${
    settings.echoCancellation
  } · latency=${settings.latency ?? '?'}`;

  if (unwanted.length > 0) {
    // Not a warning about our code: the request was correct and was overridden.
    console.warn(`${line} · IGNORED: ${unwanted.join(', ')} came back on`);
  } else {
    console.info(line);
  }
  console.info('[input] full settings:', settings);
}

/** Listen to the master track. Its events are the only loss signal that matters. */
function watchTrack(session: Session): void {
  const track = session.master.getAudioTracks()[0];
  if (!track) {
    session.detachTrack = () => {};
    return;
  }

  const onEnded = () => {
    // `ended` is the device going away: unplugged, reset, or taken in exclusive mode.
    console.warn(`[input] track ENDED · ${session.label} · readyState=${track.readyState}`);
    void beginRecovery(session, 'ended');
  };

  const onMute = () => {
    // `mute` is different in kind: the track is still held, the OS has simply stopped
    // feeding it. Windows does this briefly on an endpoint reconfiguration and it usually
    // unmutes itself, which is why the two are logged separately.
    console.warn(`[input] track MUTED · ${session.label} · still held, waiting to unmute`);
    // Not a loss yet. Report it, then give the OS a moment to sort itself out.
    setHealth(session, { state: 'muted', attempt: 0, message: mutedMessage(session.label) });
    window.clearTimeout(session.muteTimer);
    session.muteTimer = window.setTimeout(() => {
      void beginRecovery(session, 'muted');
    }, MUTE_GRACE_MS);
  };

  const onUnmute = () => {
    console.info(`[input] track UNMUTED · ${session.label}`);
    window.clearTimeout(session.muteTimer);
    setHealth(session, { state: 'live', attempt: 0, message: null });
  };

  track.addEventListener('ended', onEnded);
  track.addEventListener('mute', onMute);
  track.addEventListener('unmute', onUnmute);

  session.detachTrack = () => {
    window.clearTimeout(session.muteTimer);
    track.removeEventListener('ended', onEnded);
    track.removeEventListener('mute', onMute);
    track.removeEventListener('unmute', onUnmute);
  };
}

/** Adopt a freshly opened stream as the master and start watching it. */
function adopt(session: Session, stream: MediaStream): void {
  session.detachTrack();
  stopStream(session.master);
  session.master = stream;
  const track = stream.getAudioTracks()[0];
  if (track) {
    session.target = targetOf(track, session.target);
    session.label = track.label || session.label;
  }
  watchTrack(session);
}

/** Give one holder a clone of the current master, replacing the one it had. */
function handOver(session: Session, holder: Holder): void {
  stopStream(holder.stream);
  holder.stream = session.master.clone();
  const stream = holder.stream;
  safely(() => holder.onStream(stream));
}

/**
 * A sleep that `devicechange` can cut short.
 *
 * The backoff exists so a device that is genuinely gone is not hammered, but
 * when the OS *tells* us the device list changed there is no reason to keep
 * waiting — that event is the most likely moment for the reopen to succeed.
 */
function sleep(session: Session, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      session.wake = null;
      window.clearTimeout(timer);
      resolve();
    };
    const timer = window.setTimeout(finish, ms);
    session.wake = finish;
  });
}

/**
 * Reopen the device, hand the new stream to every holder, or admit defeat.
 *
 * One loop per session at a time: `ended` on the master and a `retry()` from the
 * UI can arrive together, and opening the device twice is what this module exists
 * to avoid.
 */
function beginRecovery(session: Session, reason: InputLossReason): Promise<boolean> {
  if (session.recovery) return session.recovery;
  if (session.disposed) return Promise.resolve(false);

  const run = async (): Promise<boolean> => {
    window.clearTimeout(session.muteTimer);
    setHealth(session, {
      state: 'recovering',
      attempt: 0,
      message: recoveringMessage(session.label, 0),
    });
    // Before anything is reopened: a take in progress has to be closed out while
    // its anchors are still valid.
    for (const holder of [...session.holders]) safely(() => holder.onLoss(reason));

    // The old master is finished, whatever its `readyState` claims. Holding it
    // open can keep the OS endpoint claimed, which is the one thing that would
    // stop the reopen from working.
    session.detachTrack();
    stopStream(session.master);

    for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt += 1) {
      if (session.disposed || session.holders.size === 0) break;

      setHealth(session, {
        state: 'recovering',
        attempt: attempt + 1,
        message: recoveringMessage(session.label, attempt + 1),
      });

      await sleep(session, retryDelayMs(attempt));
      if (session.disposed || session.holders.size === 0) break;

      // Hoisted so the catch below can say *which* device refused to open.
      let attempted = '(none)';
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const match = pickReplacement(devices, session.target);
        // Not there yet. Nothing to open, so do not burn a `getUserMedia` on it.
        if (!match) {
          // The distinction that matters: absent from the enumeration is a different
          // problem from present-but-unopenable, and 16 identical log lines hid it.
          console.warn(
            `[input] recovery ${attempt + 1}/${RETRY_ATTEMPTS}: no device matches ` +
              `id=${session.target.deviceId} group=${session.target.groupId} ` +
              `label="${session.target.label}" · ${devices.filter((d) => d.kind === 'audioinput').length} inputs listed`,
          );
          continue;
        }

        attempted = match.deviceId;
        const stream = await navigator.mediaDevices.getUserMedia(
          inputConstraints(match.deviceId),
        );
        const track = stream.getAudioTracks()[0];
        // A stream whose track arrives already dead is a device mid-reset. Let it go
        // and come back on the next attempt rather than adopting a corpse.
        if (!track || track.readyState !== 'live') {
          stopStream(stream);
          continue;
        }

        adopt(session, stream);
        for (const holder of [...session.holders]) handOver(session, holder);
        setHealth(session, { state: 'live', attempt: 0, message: null });
        console.info(`[input] recovery succeeded on attempt ${attempt + 1}`);
        reportTrackSettings(track, 'reopened');
        return true;
      } catch (cause) {
        console.warn(
          `[input] recovery ${attempt + 1}/${RETRY_ATTEMPTS}: open failed on ` +
            `${attempted} · ${cause instanceof Error ? `${cause.name}: ${cause.message}` : cause}`,
        );
        // Every failure mode here is worth another attempt: `NotReadableError`
        // while the driver reloads, `NotFoundError` between unplug and replug.
        // Only running out of attempts is final, and `devicechange` reopens even
        // that.
      }
    }

    if (!session.disposed) {
      setHealth(session, {
        state: 'lost',
        attempt: RETRY_ATTEMPTS,
        message: lostMessage(session.label),
      });
    }
    return false;
  };

  session.recovery = run().finally(() => {
    session.recovery = null;
  });
  return session.recovery;
}

/**
 * The key one device's session is stored under, resolving the `default` alias.
 *
 * Checks the alias map first so the common case costs nothing, and only enumerates when
 * a `default` request has not been seen before. A failure to enumerate is not fatal: the
 * alias keeps its own key, which is the old behaviour.
 */
async function canonicalKey(requested: string): Promise<string> {
  const known = aliases.get(requested);
  if (known) return known;
  if (requested !== 'default') return requested;

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const real = resolveDefaultDeviceId(devices);
    if (real) {
      aliases.set(requested, real);
      return real;
    }
  } catch {
    // Enumeration refused. `default` then behaves as its own device, as before.
  }
  return requested;
}

/**
 * Wake every session when the device list changes.
 *
 * Two jobs: cut short a backoff sleep, and restart the loop for a session that
 * had given up. This is why a pedal plugged back in ten minutes later still
 * comes straight back without anyone pressing anything.
 */
function hookDeviceChange(): void {
  if (deviceChangeHooked) return;
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.addEventListener) return;
  deviceChangeHooked = true;

  navigator.mediaDevices.addEventListener('devicechange', () => {
    for (const session of sessions.values()) {
      if (session.disposed) continue;
      session.wake?.();
      if (session.health.state === 'lost' && session.holders.size > 0) {
        void beginRecovery(session, 'ended');
      }
    }
  });
}

function dispose(session: Session): void {
  session.disposed = true;
  session.detachTrack();
  session.wake?.();
  stopStream(session.master);
  sessions.delete(session.key);
  // Aliases outliving their session would send the next request to a key with nothing
  // behind it, and it would open the device again under a name nobody is watching.
  for (const [requested, key] of [...aliases]) {
    if (key === session.key) aliases.delete(requested);
  }
}

/**
 * Open a device (or join the open one) and keep it alive.
 *
 * Rejects the way `getUserMedia` does when the device cannot be opened at all,
 * so callers keep reporting the first failure through `mediaErrorMessage`. Every
 * *later* failure is handled here instead, and reported through `onHealth`.
 */
export async function acquireInput(options: LeaseOptions): Promise<InputLease> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new TypeError('This browser does not support audio capture.');
  }

  const requested = options.deviceId || 'default';
  const key = await canonicalKey(requested);
  let session = sessions.get(key);

  if (session && session.health.state !== 'live') {
    // Someone is asking for a device that is currently down — arming again is a
    // reasonable thing to do about that, so make it mean "try now".
    const ok = await beginRecovery(session, 'manual');
    if (!ok) {
      // Report it like a failed open, because from the caller's side that is
      // exactly what happened. The session stays up and keeps trying for the
      // holders it already has.
      if (session.holders.size === 0) dispose(session);
      throw new DOMException(lostMessage(session.label), 'NotReadableError');
    }
  }

  if (!session) {
    const inFlight = inFlightSessions.get(key);
    if (inFlight) {
      session = await inFlight;
    } else {
      const promise = (async () => {
        // The canonical id, not the requested one: opening `default` again after it has been
        // resolved would re-open the alias and leave the session keyed to a pointer.
        const master = await openDevice(key === 'default' ? options.deviceId : key, options.label);
        const track = master.getAudioTracks()[0];
        const fallback: DeviceTarget = {
          deviceId: options.deviceId,
          groupId: '',
          label: options.label,
        };

        const createdSession: Session = {
          key,
          requestedId: options.deviceId,
          target: track ? targetOf(track, fallback) : fallback,
          label: track?.label || options.label,
          master,
          holders: new Set<Holder>(),
          health: { state: 'live', attempt: 0, message: null },
          detachTrack: () => {},
          muteTimer: 0,
          recovery: null,
          wake: null,
          disposed: false,
        };

        sessions.set(key, createdSession);
        // The track knows better than the enumeration did: if it resolved to a different id
        // (and nothing already holds that id), move the session under it, so a later request
        // by that id joins this session instead of opening the device a second time.
        const resolved = createdSession.target.deviceId;
        if (resolved && resolved !== key && !sessions.has(resolved)) {
          sessions.delete(key);
          createdSession.key = resolved;
          sessions.set(resolved, createdSession);
          aliases.set(key, resolved);
        }
        aliases.set(requested, createdSession.key);
        if (resolved) aliases.set(resolved, createdSession.key);
        watchTrack(createdSession);
        // On the real open path, which is where the interesting answer is: the constraints
        // above are a *request*, and this is the only place that reports what came back.
        if (track) reportTrackSettings(track, 'opened');
        return createdSession;
      })();

      inFlightSessions.set(key, promise);
      try {
        session = await promise;
      } finally {
        inFlightSessions.delete(key);
      }
    }
  }

  const held = session;
  const holder: Holder = { ...options, stream: held.master.clone() };
  held.holders.add(holder);
  hookDeviceChange();

  const track = holder.stream.getAudioTracks()[0];

  return {
    stream: holder.stream,
    // The resolved id, not the requested one: `''` and `'default'` both open
    // real hardware, and the caller needs to know which so it can be re-armed.
    deviceId: track?.getSettings().deviceId ?? held.target.deviceId,
    label: held.label,
    retry: (reason: InputLossReason = 'manual') => {
      void beginRecovery(held, reason);
    },
    release: () => {
      if (!held.holders.delete(holder)) return;
      stopStream(holder.stream);
      if (held.holders.size === 0) dispose(held);
    },
  };
}

/** Current health of an open device, for a caller that did not keep the callback. */
export function inputHealthOf(deviceId: string): InputHealth | null {
  const requested = deviceId || 'default';
  return sessions.get(aliases.get(requested) ?? requested)?.health ?? null;
}

/** Test seam: drop every session. Never called by the app. */
export function resetInputSessions(): void {
  for (const session of [...sessions.values()]) dispose(session);
  aliases.clear();
}
