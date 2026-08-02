'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';

import {
  getRigDeskLink,
  getServerRigDeskLink,
  setRigSettings,
  subscribeAmp,
  type MonitorScope,
} from '@/lib/ampStore';
import { loadRig } from '@/lib/rigStorage';
import { useInputDevices } from '@/hooks/useInputDevices';
import { useMixer } from '@/hooks/useMixer';
import { useRecorder } from '@/hooks/useRecorder';
import { useTakeLibrary } from '@/hooks/useTakeLibrary';
import type { InputDevice, Take } from '@/types/recorder';

type MixerStudio = ReturnType<typeof useMixer>;

/**
 * The recorder engine, its device list, and the take library, as one value.
 *
 * Grouped rather than three contexts because every consumer of one wants at least
 * two of them, and because the take library only makes sense beside the engine that
 * fills it.
 */
export interface RecorderStudio {
  recorder: ReturnType<typeof useRecorder>;
  inputs: ReturnType<typeof useInputDevices>;
  library: ReturnType<typeof useTakeLibrary>;
  selectedTakeId: string | null;
  setSelectedTakeId: (id: string | null) => void;
  /** Open a device and start metering. */
  selectDevice: (device: InputDevice) => void;
}

const RecorderContext = createContext<RecorderStudio | null>(null);
const MixerContext = createContext<MixerStudio | null>(null);

/**
 * StudioProviders — holds the engines above the router.
 *
 * Each hook used to be called inside its page component, so a route change
 * unmounted it: the AudioContext closed, the mic was released, every object URL
 * was revoked and the whole session went with it. Leaving the page therefore
 * stopped the music and lost the video. Mounted here, in the root layout, they
 * outlive the page swap — playback keeps running until someone actually presses
 * stop, and each page's work is still there when you come back to it.
 *
 * Two things make this affordable at 60 frames a second:
 *
 * 1. Each provider receives `children` as **one element it does not recreate**.
 *    When the playhead ticks, the provider re-renders, hands React the identical
 *    child element, and React bails out of that whole subtree. Only components
 *    that actually read a context re-render. Do not wrap `children` in anything
 *    here, and do not move this composition inside a component that has state —
 *    either one turns every tick into a full-app re-render.
 * 2. Nothing in either hook runs until it is used: the engines are created lazily
 *    on the first import, and every loop is gated on `isPlaying` or `isLive`.
 */
export function StudioProviders({ children }: { children: ReactNode }) {
  return (
    <RecorderProvider>
      <MixerProvider>{children}</MixerProvider>
    </RecorderProvider>
  );
}

/**
 * The recorder engine, above the router for the same reason as the other two.
 *
 * It was inside `RecorderDashboard` while the dashboard was the only page that
 * needed it. Splitting the amp onto `/amp` made that untenable: navigating there
 * unmounted the hook, which closed the AudioContext and released the input — so the
 * tone controls would have been dialling an amp nobody could hear, on a page whose
 * arrival had just stopped the monitoring. The takes went with it.
 *
 * Mounted here, arming survives navigation, the meters keep reading, and a take
 * recorded on one page is in the library on every other.
 */
function RecorderProvider({ children }: { children: ReactNode }) {
  const inputs = useInputDevices();
  const library = useTakeLibrary();
  const [selectedTakeId, setSelectedTakeId] = useState<string | null>(null);

  const { add: addTake } = library;

  /** Hand the finished take to the library (which persists it) and select it. */
  const handleTakeReady = useCallback(
    (take: Take) => {
      addTake(take);
      setSelectedTakeId(take.id);
    },
    [addTake],
  );

  /**
   * Restore the saved rig, once, after mount.
   *
   * **After mount, never during render.** Every route is prerendered, so a rig read from
   * storage while rendering exists on the client and not on the server — a hydration
   * mismatch, and the same reason `lib/theme.ts` reads its own storage in an effect. The
   * store starts on `DEFAULT_RIG`, which is also the server snapshot, and this replaces it
   * a tick later; both engines are already subscribed and push the change into their graphs.
   *
   * Guarded by a ref rather than by a dependency, because it must not run again when the
   * player changes something — restoring over a live edit is the one thing worse than not
   * restoring at all.
   */
  const hasRestoredRig = useRef(false);
  useEffect(() => {
    if (hasRestoredRig.current) return;
    hasRestoredRig.current = true;
    const stored = loadRig();
    if (stored) setRigSettings(stored.rig);
  }, []);

  const recorder = useRecorder(handleTakeReady);
  const { arm, activeDeviceId } = recorder;
  const { permission, devices } = inputs;

  const selectDevice = useCallback(
    (device: InputDevice) => {
      void arm(device.deviceId, device.label);
    },
    [arm],
  );

  /**
   * Auto-arm the best available input on first load: the Tank-G if it is connected,
   * otherwise the first interface-looking device.
   *
   * Lives here rather than on the dashboard so it also fires for someone who opens
   * `/amp` first — a tone page that cannot hear anything until you visit
   * another route would be a trap.
   */
  const hasAutoArmed = useRef(false);
  useEffect(() => {
    if (hasAutoArmed.current) return;
    if (permission !== 'granted' || devices.length === 0) return;
    if (activeDeviceId) return;

    const preferred =
      devices.find((device) => device.isTankG) ??
      devices.find((device) => device.isInterface) ??
      devices[0];

    hasAutoArmed.current = true;
    void arm(preferred.deviceId, preferred.label);
  }, [permission, devices, activeDeviceId, arm]);

  const value: RecorderStudio = {
    recorder,
    inputs,
    library,
    selectedTakeId,
    setSelectedTakeId,
    selectDevice,
  };

  return <RecorderContext.Provider value={value}>{children}</RecorderContext.Provider>;
}

/**
 * The mixing desk, above the router for the same reason as the recorder.
 *
 * The mix is a session, not a page: leaving `/mixer` while it plays must not close the
 * `AudioContext`, drop the decoded takes on its channels or release the input. Mounted
 * here, the desk is still set up when you come back from the tone page — which is the
 * whole point of dialling a rack on `/amp` while listening to the mix.
 */
function MixerProvider({ children }: { children: ReactNode }) {
  const mixer = useMixer();
  const { recorder } = useRecorderStudio();

  const { armInput, activeDeviceId: mixerDeviceId } = mixer;
  const {
    activeDeviceId: recorderDeviceId,
    activeDeviceLabel,
    isMonitoring,
    toggleMonitoring,
    status: recorderStatus,
    monitorScope,
  } = recorder;

  /**
   * Follow the recorder's input until the mixer is given one of its own.
   *
   * One app, one instrument, one cable: making the mixer arm a device *again* was a
   * design mistake, and a costly one to debug — the recorder showed a healthy −0.4 dBFS
   * while the console sat at `DEVICE NONE`, which reads as a broken mixer rather than as
   * two pages disagreeing about what "armed" means. Sharing costs nothing because
   * `lib/inputSession` opens the hardware once and hands out taps; this is not a second
   * open, it is the same one.
   *
   * The guard is a ref rather than the state, so a device the user then *changes* on the
   * mixer is never overwritten by this. It follows once, then gets out of the way.
   */
  const hasFollowed = useRef(false);
  useEffect(() => {
    if (hasFollowed.current) return;
    if (mixerDeviceId || !recorderDeviceId) return;
    hasFollowed.current = true;
    // Async, so nothing here is a synchronous setState in an effect body.
    void armInput(recorderDeviceId, activeDeviceLabel);
  }, [armInput, mixerDeviceId, recorderDeviceId, activeDeviceLabel]);

  /**
   * Follow the owner of the live monitor. **Do not decide it.**
   *
   * One instrument, one pair of speakers, one set of racks running at a time — that part is
   * unchanged and non-negotiable. Before it, the recorder's monitor bus and the mixer's live
   * channels both processed the same input through their own chains on their own
   * `AudioContext`s: double the convolvers and worklet processors, one button switching on
   * two chains, and three live channels was enough to overrun the audio thread.
   *
   * What changed is *who decides*. This used to read the route and hand ownership to
   * whichever page was on screen, which meant opening the mixer to glance at a fader
   * silenced the rack you were dialling. A tone is built by ear over minutes; the numbers
   * were always safe in the store, but the listening was not, and losing it to a click on a
   * nav item is indistinguishable in the moment from the monitor breaking.
   *
   * So ownership is explicit now and lives in `lib/ampStore.ts`, written by
   * `MonitorHandover` — a button on each page — and by nothing else. This effect only
   * *applies* what the store says. Navigation changes nothing about the sound.
   *
   * Monitoring only, as before. Clips playing on the mixer keep playing across pages: sound
   * stops in this app when somebody stops it, not when they navigate.
   */
  const { setMonitorLive } = mixer;
  const rigDeskLink = useSyncExternalStore(subscribeAmp, getRigDeskLink, getServerRigDeskLink);
  const lastScope = useRef<MonitorScope | null>(null);
  /**
   * A monitor to open as soon as there is an input to open it for.
   *
   * Ownership can be taken before the device is armed — on a cold load the status is `idle`
   * for as long as the permission and `getUserMedia` take. Deciding at the instant of the
   * press would decide against an engine one moment away from having a signal, so the press
   * records the *intent* and the arming clears it.
   */
  const pendingMonitor = useRef(false);
  useEffect(() => {
    // Bridged, the desk stays live even when the Rig side owns the monitor — that is what
    // "work together" means, and it is the one case where both engines sound at once.
    setMonitorLive(monitorScope === 'mixer' || rigDeskLink);

    /**
     * Taking the sound has to *give you the sound*, not just the right to it.
     *
     * The recorder's monitor path has its own switch, off by default because a microphone
     * plus speakers is feedback. Leaving it alone here would mean pressing "รับเสียงมาที่นี่"
     * and getting silence, which is the same complaint the route-driven version produced —
     * "the mixer plays, the rig page is silent" — with a button in front of it.
     *
     * `previous !== null` is what keeps the feedback rule intact: the first pass is the page
     * loading, not a handover, so nothing opens a speaker on its own. Only a press does, and
     * a press is a person deciding the room is safe.
     *
     * Once, on the transition, and never fought afterwards: switch Monitor off while you are
     * here and it stays off, because this does not run again until ownership moves.
     */
    const previous = lastScope.current;
    if (previous !== monitorScope) {
      lastScope.current = monitorScope;
      pendingMonitor.current = previous !== null && monitorScope === 'recorder';
    }

    // An input to hear it on. `arming` is not enough — the graph is not carrying signal yet.
    const isArmed = recorderStatus !== 'idle' && recorderStatus !== 'error' && recorderStatus !== 'arming';
    if (pendingMonitor.current && isArmed) {
      pendingMonitor.current = false;
      if (!isMonitoring) toggleMonitoring();
    }
  }, [monitorScope, rigDeskLink, setMonitorLive, isMonitoring, toggleMonitoring, recorderStatus]);

  return <MixerContext.Provider value={mixer}>{children}</MixerContext.Provider>;
}

/** The recorder engine, devices and takes. */
export function useRecorderStudio(): RecorderStudio {
  const recorder = useContext(RecorderContext);
  if (!recorder) throw new Error('useRecorderStudio must be used inside <StudioProviders>.');
  return recorder;
}

/** The mixing desk. Throws rather than handing back a dead second copy. */
export function useMixerStudio(): MixerStudio {
  const mixer = useContext(MixerContext);
  if (!mixer) throw new Error('useMixerStudio must be used inside <StudioProviders>.');
  return mixer;
}

