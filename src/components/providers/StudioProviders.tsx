'use client';

import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

import { setMonitorScope } from '@/lib/ampStore';
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
  } = recorder;

  /**
   * Whether the desk was actually making a live sound, rather than merely holding a device.
   *
   * A ref-reading callback, so the handover below never takes the desk's state as a
   * dependency — it only asks at the moment the route changes.
   */
  const mixerChannels = mixer.state.channels;
  const wasMonitoringLive = useCallback(
    () => mixerChannels.some((channel) => channel.source.kind === 'live' && !channel.muted),
    [mixerChannels],
  );

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
   * The page on screen owns the live monitor.
   *
   * One instrument, one pair of speakers, one set of racks running at a time. Before this,
   * the recorder's monitor bus and the mixer's live channels both processed the same input
   * through their own chains on their own `AudioContext`s: double the convolvers and
   * worklet processors, one button switching on two chains, and three live channels was
   * enough to overrun the audio thread — heard as a stutter and then a dropout.
   *
   * This is the **only** place the decision is made, and it is made from the route, which
   * is the only thing that knows which page is visible. Both engines then apply it through
   * their own single gain writer, so nothing here fights anything for an `AudioParam`.
   *
   * Monitoring only. Clips playing on the mixer keep playing across pages — sound stops in
   * this app when somebody stops it, not when they navigate.
   */
  const pathname = usePathname();
  const { setMonitorLive } = mixer;
  const lastRoute = useRef<'recorder' | 'tone' | 'mixer' | null>(null);
  /**
   * A monitor to open as soon as there is an input to open it for.
   *
   * The route changes before the device is armed — on a cold load into `/amp` the status is
   * still `idle` for as long as the permission and `getUserMedia` take. Deciding on the
   * transition alone therefore decided against a page that was one moment away from having
   * a signal, and the tone page came up silent. So the transition records the *intent* and
   * the arming clears it.
   */
  const pendingMonitor = useRef(false);
  useEffect(() => {
    const ownedByMixer = pathname?.startsWith('/mixer') ?? false;
    const onTonePage = pathname?.startsWith('/amp') ?? false;
    const scope = ownedByMixer ? 'mixer' : 'recorder';
    setMonitorScope(scope);
    setMonitorLive(ownedByMixer);

    /**
     * A handover has to *hand the sound over*, not drop it.
     *
     * The recorder's monitor path has its own switch, off by default because a microphone
     * plus speakers is feedback. That was harmless while the mixer's live channel was
     * audible on every page — and the moment ownership started switching by route, leaving
     * the mixer meant walking into a page whose output was muted. "The mixer plays, the
     * tone page is silent" was the exact report, and it is not a bug in either engine:
     * ownership moved to somewhere that was not making a sound.
     *
     * Two arrivals hand the sound over, and they are tracked by **route group**, not by
     * scope — `/` and `/amp` are both `recorder`, so a scope comparison sees no transition
     * between them and that is exactly the walk that was silent:
     *
     * - **the tone page**, unconditionally. Dialling an amp you cannot hear is not a
     *   feature with a switch, it is guesswork; this page exists to hear the rack. The
     *   feedback reasoning above still holds for `/`, which is why the recorder page is
     *   left exactly as it was — you arm there, and you decide there whether the room is
     *   safe to open a monitor into.
     * - **back from a desk that was monitoring live**, as before.
     *
     * Once only, on the transition. Never fought afterwards: turn Monitor off while you
     * are on the page and it stays off, because this does not run again until the route
     * changes.
     */
    const previous = lastRoute.current;
    const route = ownedByMixer ? 'mixer' : onTonePage ? 'tone' : 'recorder';
    if (previous !== route) {
      lastRoute.current = route;
      pendingMonitor.current =
        route === 'tone' || (previous === 'mixer' && route === 'recorder' && wasMonitoringLive());
    }

    // An input to hear it on. `arming` is not enough — the graph is not carrying signal yet.
    const isArmed = recorderStatus !== 'idle' && recorderStatus !== 'error' && recorderStatus !== 'arming';
    if (pendingMonitor.current && isArmed) {
      pendingMonitor.current = false;
      if (!isMonitoring) toggleMonitoring();
    }
  }, [
    pathname,
    setMonitorLive,
    isMonitoring,
    toggleMonitoring,
    wasMonitoringLive,
    recorderStatus,
  ]);

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

