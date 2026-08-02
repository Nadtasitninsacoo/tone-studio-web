'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import {
  CLIP_THRESHOLD,
  computePeaks,
  dbToGain,
  encodeWav,
  mergeChunks,
  peakDbOf,
} from '@/lib/audio';
import { filenameStamp } from '@/lib/format';
import { AMP_WORKLET_URL, type AmpSettings } from '@/lib/ampFx';
import {
  getAmpSnapshot,
  getEnabledSnapshot,
  getInstrumentSnapshot,
  getLevelSnapshot,
  getRigSnapshot,
  getServerAmpSnapshot,
  getServerEnabledSnapshot,
  getServerInstrumentSnapshot,
  getServerLevelSnapshot,
  getServerRigSnapshot,
  setAmpSettings,
  setBassSettings,
  setDrumSettings,
  setVocalSettings,
  setKeysSettings,
  setBrassSettings,
  setInstrument,
  setInstrumentLevel,
  subscribeAmp,
  toggleInstrumentEnabled,
  getMasterVolume,
  getMonitorScope,
  getServerMasterVolume,
  getServerMonitorScope,
  setMasterVolume,
} from '@/lib/ampStore';
import type { BassSettings } from '@/lib/bassFx';
import type { DrumSettings } from '@/lib/drumFx';
import type { VocalSettings } from '@/lib/vocalFx';
import type { KeysSettings } from '@/lib/keysFx';
import type { BrassSettings } from '@/lib/brassFx';
import { createRigChain, INSTRUMENTS, type Instrument, type RigChain } from '@/lib/rig';
import { resumeOnGesture, watchAudioContext } from '@/lib/contextHealth';
import {
  acquireInput,
  type InputHealth,
  type InputLease,
  type InputLossReason,
} from '@/lib/inputSession';
import { mediaErrorMessage } from '@/lib/mediaErrors';
import { createPitchStabiliser, type PitchStabiliser } from '@/lib/pitchStabiliser';
import {
  bandLimitInPlace,
  createNoiseFloor,
  detectPitch,
  detectionIntervalMs,
  type NoiseFloor,
  rmsOf,
  settlingSamplesFor,
  windowLengthFor,
} from '@/lib/tuner';
import type {
  MeterSnapshot,
  RecorderStatus,
  StreamFormat,
  Take,
  TunerSnapshot,
} from '@/types/recorder';

/** Path to the capture worklet, served from `public/`. */
const WORKLET_URL = '/worklets/recorder-processor.js';

/** How long to wait after disarming for the worklet's trailing batch to arrive. */
const FLUSH_GRACE_MS = 120;

/** Peak-hold fall rate, in normalised amplitude per second. */
const HOLD_DECAY_PER_SEC = 0.35;

/** RMS ballistics: how fast the averaged bar rises/falls (0..1 per frame). */
const RMS_ATTACK = 0.5;
const RMS_RELEASE = 0.12;

/**
 * Audio the tuner keeps in front of it.
 *
 * Two things have to fit: the analysis window itself — 8192 samples at 48 kHz for
 * a 5-string bass low B, less for anything higher — and enough audio *before* it
 * for the band-limiting filters to have settled, which is another 6546. The
 * detector is handed a subarray of the newest samples sized to the tuning
 * actually selected, so a guitar analyses 2048 of these and pays a quarter of the
 * cost. See `windowLengthFor` and `settlingSamplesFor`.
 */
const TUNER_FFT_SIZE = 16384;

/**
 * Clarity floor for a band-limited input.
 *
 * Lower than the library's own default of 0.8, which assumes a clean line. A
 * guitar heard through a laptop microphone in a room measures around 0.77 even
 * after band limiting, and rejecting that would make the tuner useless on the one
 * input that has no cable. The adaptive noise gate, the median and the Kalman
 * filter downstream are what make a lower threshold safe.
 */
const TUNER_MIN_CLARITY = 0.72;

/** Live nodes and buffers for one open input stream. */
interface Engine {
  ctx: AudioContext;
  /**
   * The device, held through the shared session so the jam page can hold the same
   * one without opening it twice. Released in `teardown`, never stopped directly.
   */
  lease: InputLease;
  /** Stops the clock/suspend watch. See `lib/contextHealth`. */
  stopHealthWatch: () => void;
  /** Removes the gesture-resume listeners. */
  stopGestureResume: () => void;
  /**
   * This holder's stream and the node reading it.
   *
   * Both are replaced in place when the device is reopened — see `swapSource`.
   * Everything downstream of `input` survives that, which is what makes a
   * recovery inaudible rather than a rebuild.
   */
  stream: MediaStream;
  source: MediaStreamAudioSourceNode;
  /** Input trim, applied before capture so it is printed to the file. */
  input: GainNode;
  /** Direct monitoring path to the speakers (muted by default). */
  monitor: GainNode;
  /**
   * Whether `monitor` currently has a route to `destination`.
   *
   * Web Audio cannot be asked, and this is one of the two ways the page can be silent
   * while every control on it reads correctly — the other being a zero gain. The scope
   * effect disconnects the bus outright when the desk owns the monitor (a silent node is
   * still a computed node), so "connected" is a real, changing fact that only this
   * bookkeeping can report.
   */
  monitorConnected: boolean;
  /**
   * All three chains, live at once, on the monitor path only.
   *
   * Parallel rather than swapped. A live setup is one input into three processors
   * mixed together, so switching the rack on screen must not make a sound stop, and a
   * player with a guitar and a drum machine on one interface has to be able to mute
   * one channel without touching the other. "Off" is a gain of zero, not a teardown,
   * so a channel comes back instantly and without a click.
   *
   * The cost is real: three chains is three convolvers, six worklet processors and
   * three oversampled waveshapers running at once. Two start switched off for that
   * reason — see `lib/ampStore.ts`.
   */
  rigs: Record<Instrument, RigChain>;
  /** Per-channel level into the monitor bus. Zero is off. */
  rigWet: Record<Instrument, GainNode>;
  /**
   * Which of those actually reach `mixBus` right now.
   *
   * A channel that is off is disconnected, not just turned down, because Web Audio runs
   * a node based on whether it has a path to `destination` and not on whether it is
   * audible. Six chains left attached is six chains computed every quantum — which is
   * what made the monitor stutter. Bookkeeping, because Web Audio cannot be asked.
   */
  rigWetConnected: Record<Instrument, boolean>;
  /**
   * The chain whose gate and limiter meters are being reported.
   *
   * Deliberately NOT between `input` and the capture worklet. Takes are recorded
   * dry for the same reason the jam page records dry: an amp printed into the file
   * can never be changed afterwards, and the one thing you always want to change
   * after a take is the tone. The file is the performance; the amp is a decision.
   */
  meteredInstrument: Instrument;
  /** Crossfade between the amp and a straight monitor feed. */
  ampWet: GainNode;
  ampDry: GainNode;
  /** Zero-gain sink; keeps the capture node inside the render graph. */
  sink: GainNode;
  splitter: ChannelSplitterNode;
  analysers: AnalyserNode[];
  /**
   * Scratch buffer reused every frame to avoid per-frame allocation.
   * Pinned to `ArrayBuffer` (not `ArrayBufferLike`) for `getFloatTimeDomainData`.
   */
  timeDomain: Float32Array<ArrayBuffer>;
  /**
   * Tuner tap, on the **dry** input alongside the meters.
   *
   * Deliberately not after the amp: three cascaded valve stages generate a dense
   * harmonic series and a compressor flattens the decay the detector's confidence
   * measure depends on. Pitch detection wants the signal the strings actually
   * produced, which is the same signal the file gets.
   *
   * Its own analyser rather than the metering ones because it needs a far longer
   * window (8192 vs 2048) and mono rather than per-channel.
   */
  tunerAnalyser: AnalyserNode;
  tunerBuffer: Float32Array<ArrayBuffer>;
  /** Band-limited copy. Separate so the filters never touch the analyser's data. */
  tunerFiltered: Float32Array<ArrayBuffer>;
  /** Adaptive gate, so a hum or a hissy link is not mistaken for a note. */
  tunerFloor: NoiseFloor;
  /** Attack rejection, median and Kalman smoothing. */
  tunerStabiliser: PitchStabiliser;
  dryRecordPath: GainNode;
  wetRecordPath: GainNode;
  mixBus: GainNode;
  recordMux: GainNode;
  worklet: AudioWorkletNode;
  /** Captured PCM batches, one entry per worklet message. */
  chunks: Float32Array[][];
  channels: number;
}

/**
 * The monitor context's buffer, in seconds. **Not `'interactive'`, and this is why.**
 *
 * `'interactive'` asks for the smallest buffer the machine will give — 128 frames, about
 * 3 ms. That was right when this hook drove one guitar through one rack, and the comment
 * in `useMixer.ts` says as much: it explains that the desk needs 30 ms *because* it runs
 * three rig chains, and that the recorder can stay at 3 ms because it does not.
 *
 * That premise expired when the rack became six. Every chain is alive permanently — "off"
 * is a gain of zero, not a teardown — so this context now renders six gates, six limiters,
 * two convolvers and six oversampled waveshapers inside every 128-sample quantum. That is
 * twice the desk's load in a tenth of its budget.
 *
 * The same comment predicted exactly what happened next: *"a stutter, and then silence
 * when the output stream gives up."* Both were observed, in that order, on a USB pedal at
 * 48 kHz. The context went on reporting `state: 'running'` with a clock that kept
 * advancing, `monitorBus=connected` and every gain at 1.0, while a bare oscillator
 * connected straight to `destination` produced nothing — and a *fresh* context created in
 * the same page at the same moment was audible. An overrun output stream is silent, not
 * broken, and nothing in the API says so.
 *
 * 30 ms rather than a guess: it is the value the desk already uses, and the desk was
 * audible on that machine at the moment this one was not. Matching the thing that works
 * beats picking a number. The cost is 27 ms of extra monitoring latency, which a player
 * can feel — so this is a floor to tune down from, not a target. It is worth nothing at
 * 3 ms if 3 ms is silent.
 *
 * It is the **default**, not the value, because there is no single right one: 30 ms carried
 * one rack cleanly and broke up under six on the same machine an hour later. The number
 * depends on how many chains the player has switched on, which is a thing they change while
 * playing, so it belongs to them — see `changeBufferMs`.
 */
const DEFAULT_BUFFER_MS = 30;

/**
 * What the picker offers, in milliseconds.
 *
 * Coarse on purpose. The audible difference between 30 and 35 ms is nothing and the
 * difference in headroom is nothing either; what matters is which order of magnitude you
 * are in, and a slider would invite fiddling at a resolution that does not exist.
 */
export const BUFFER_CHOICES = [10, 30, 60, 120] as const;

/** One choice in the output picker. `deviceId: ''` is the system default. */
export interface OutputDevice {
  deviceId: string;
  label: string;
}

/**
 * What the engine's output path actually looks like, sampled at one instant.
 *
 * Every field here is something that reads as "silence with no explanation" when it is
 * wrong, and none of them is visible anywhere else on the screen. Returned from a
 * callback rather than exposed as state on purpose: it is read on a button press, never
 * during render, so it cannot differ between the server and the first paint.
 */
export interface OutputDiagnostics {
  /** `running`, `suspended` or `closed`. A suspended context is silent and says nothing. */
  contextState: AudioContextState;
  sampleRate: number;
  /** The chosen sink, `''` for the system default, or null on a browser without `sinkId`. */
  sinkId: string | null;
  /** `isMonitoring × master`. Zero here is the whole explanation for a silent page. */
  monitorGain: number;
  /** The visible rack's channel gain — `enabled × level × owns-the-monitor`. */
  instrumentGain: number;
  /** Whether the monitor bus is routed to `destination` at all. See the scope effect. */
  monitorConnected: boolean;
}

/**
 * `AudioContext.setSinkId`, which TypeScript's DOM library does not know about yet.
 *
 * Chromium 110+ (so Edge here) implements it; Firefox and Safari do not. Declared as
 * optional rather than asserted, so the picker degrades to a readout on a browser that
 * cannot honour it instead of throwing.
 */
type SinkCapableContext = AudioContext & {
  sinkId?: string;
  setSinkId?: (sinkId: string) => Promise<void>;
};

function emptyMeter(channels: number): MeterSnapshot {
  return {
    peak: new Array(channels).fill(0),
    rms: new Array(channels).fill(0),
    hold: new Array(channels).fill(0),
    clipped: false,
  };
}

/**
 * Re-point the graph at a replacement stream for the same device.
 *
 * The point of the whole recovery path: one node is disconnected and rebuilt, and
 * the splitter, the analysers, the capture worklet, all six instrument chains, the
 * cabinet convolvers and the monitor gain are left exactly as they were. The amp
 * stays dialled, monitoring comes back at the same level, and there is no click
 * because nothing in the audible path was touched.
 *
 * Returns false when the replacement does not fit the graph that exists, in which
 * case the caller has to arm again from scratch:
 *  - **Channel count.** The splitter, the analyser array and the worklet were all
 *    built for a fixed count, and the capture buffers are merged against it.
 *  - **Sample rate.** A context's rate is fixed for its life. Chrome will happily
 *    resample a `MediaStreamSource` into it, but then the WAV header would claim
 *    the device's rate for samples rendered at the context's — a file that plays
 *    at the wrong speed, silently.
 */
function swapSource(engine: Engine, stream: MediaStream): boolean {
  const track = stream.getAudioTracks()[0];
  if (!track) return false;

  const settings = track.getSettings();
  const channels = Math.max(1, Math.min(2, settings.channelCount ?? engine.channels));
  const sampleRate = settings.sampleRate ?? engine.ctx.sampleRate;
  if (channels !== engine.channels) return false;
  if (Math.abs(sampleRate - engine.ctx.sampleRate) > 1) return false;

  try {
    engine.source.disconnect();
  } catch {
    // Already detached — the node is being thrown away either way.
  }

  engine.stream = stream;
  engine.source = engine.ctx.createMediaStreamSource(stream);
  engine.source.connect(engine.input);

  // The tuner's history describes an input that has just been replaced: the noise
  // floor was measured on the old link and the median holds notes from before the
  // dropout. Keeping either would fight the first reading from the new stream.
  engine.tunerStabiliser.reset();
  engine.tunerFloor.reset();
  return true;
}

/**
 * The recording engine.
 *
 * Signal chain:
 *   MediaStreamSource -> inputGain -> ChannelSplitter -> AnalyserNode per channel (metering)
 *                                 -> AudioWorkletNode -> silentSink -> destination (capture)
 *                                 -> monitorGain -> destination (optional direct monitoring)
 *
 * `arm()` opens the device and starts metering *without* recording, which is how
 * a guitarist actually works: set the level first, then hit record.
 */
export function useRecorder(onTakeReady?: (take: Take) => void) {
  const [status, setStatus] = useState<RecorderStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  /**
   * Something happened that is worth saying but is not a failure.
   *
   * Currently one thing: a take was cut short by a dropout and kept anyway. It
   * cannot go through `error` — red is reserved for live and broken, and a saved
   * take is neither.
   */
  const [notice, setNotice] = useState<string | null>(null);
  /**
   * What the shared device session is doing.
   *
   * Separate from `error` because a dropout is not a failure to report and clear —
   * it is a condition that is being worked on, and the banner for it has to
   * disappear by itself when the device comes back. See `lib/inputSession`.
   */
  const [inputHealth, setInputHealth] = useState<InputHealth>({
    state: 'live',
    attempt: 0,
    message: null,
  });
  const [format, setFormat] = useState<StreamFormat | null>(null);
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(null);
  const [activeDeviceLabel, setActiveDeviceLabel] = useState<string>('No input');
  const [gainDb, setGainDb] = useState(0);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [recordSource, setRecordSource] = useState<'dry' | 'wet'>('wet');
  const recordSourceRef = useRef<'dry' | 'wet'>('wet');
  /**
   * Where this context's sound comes out, and the list to choose from.
   *
   * The input has had a device picker since the beginning; the output never did, because
   * "whatever Windows says" was assumed to be right. It is not, and the failure is
   * invisible from inside the app: a class-compliant USB interface enumerates an output
   * as well as an input, and Windows makes the newly-arrived endpoint the default
   * playback device — so the whole browser starts playing into the pedal while the meters,
   * the gain reduction and every rack keep reading correctly. Nothing in the graph is
   * wrong; the sound is simply leaving through a socket nobody is listening to.
   *
   * `''` means "follow the system default", which is the old behaviour and stays the
   * default. Choosing anything else pins it, and the pin survives a re-arm — see `arm`.
   */
  const [outputDevices, setOutputDevices] = useState<OutputDevice[]>([]);
  const [outputDeviceId, setOutputDeviceId] = useState<string>('');
  /**
   * The pin, for `arm` to read.
   *
   * A context's sink is a property of the context, and a re-arm builds a new one — so
   * without this, every device recovery would silently hand the sound back to whatever
   * Windows currently prefers. That is precisely the state this control exists to escape.
   */
  const outputDeviceIdRef = useRef<string>('');
  /**
   * The monitor buffer, in milliseconds. See `DEFAULT_BUFFER_MS`.
   *
   * A ref beside the state for the same reason as the output pin: a context's buffer is
   * fixed for its life, so `arm` has to read the current value when it builds a new one —
   * including on a device recovery, which happens without anyone pressing anything.
   */
  const [bufferMs, setBufferMs] = useState<number>(DEFAULT_BUFFER_MS);
  const bufferMsRef = useRef<number>(DEFAULT_BUFFER_MS);

  useEffect(() => {
    recordSourceRef.current = recordSource;
  }, [recordSource]);
  /**
   * Amp settings, from the store shared with the tone page and the jam engine.
   *
   * Not local state: the controls live on `/amp` now, and the same settings drive
   * the jam page's own graph. One store means a knob moved anywhere is heard
   * everywhere in the same frame — see `lib/ampStore.ts`.
   *
   * `arm()` reads `getAmpSnapshot()` directly rather than taking `amp` as a
   * dependency, so building the chain does not get re-created on every knob move.
   */
  const amp = useSyncExternalStore(subscribeAmp, getAmpSnapshot, getServerAmpSnapshot);
  const rig = useSyncExternalStore(subscribeAmp, getRigSnapshot, getServerRigSnapshot);
  const instrument = useSyncExternalStore(
    subscribeAmp,
    getInstrumentSnapshot,
    getServerInstrumentSnapshot,
  );
  /** Per-channel on/off. All three chains are live; this is which ones are heard. */
  const enabled = useSyncExternalStore(
    subscribeAmp,
    getEnabledSnapshot,
    getServerEnabledSnapshot,
  );
  /** Per-channel level, for balancing the three against each other. */
  const level = useSyncExternalStore(subscribeAmp, getLevelSnapshot, getServerLevelSnapshot);
  /** Master monitor volume level. */
  const masterVolume = useSyncExternalStore(subscribeAmp, getMasterVolume, getServerMasterVolume);
  /**
   * Whether this page owns the live monitor right now. See `lib/ampStore.ts`.
   *
   * Read here rather than passed in, so the rule holds however this hook is mounted.
   */
  const monitorScope = useSyncExternalStore(
    subscribeAmp,
    getMonitorScope,
    getServerMonitorScope,
  );
  /** Gain reduction reported by the two worklets, in dB. Painted from rAF. */
  const gateReductionRef = useRef(0);
  const limiterReductionRef = useRef(0);
  /**
   * Whether the tuner is running.
   *
   * Gated rather than always on: detection costs 2–8.5 ms of main thread per
   * reading depending on the window, and nobody is tuning while they track.
   */
  const [isTuning, setIsTuning] = useState(false);
  const isTuningRef = useRef(false);
  /**
   * Frequency bounds for the detector, set from the selected tuning.
   *
   * The range is what sizes the analysis window, so a guitar does not pay for a
   * 5-string bass's 171 ms window. Defaults span the whole instrument range so
   * the tuner works before the panel has said anything.
   */
  const tunerRangeRef = useRef({ minHz: 27.5, maxHz: 1400 });
  /** Latest pitch reading. Mutated in place; read inside an animation frame. */
  const tunerRef = useRef<TunerSnapshot>({ hz: 0, clarity: 0, rms: 0, at: 0 });
  /** Whole seconds only — coarse re-render trigger for non-animated UI. */
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [takeCount, setTakeCount] = useState(0);

  const engineRef = useRef<Engine | null>(null);
  /** Mutated in place every frame; read by meters and the live waveform. */
  const meterRef = useRef<MeterSnapshot>(emptyMeter(1));
  /** High-resolution elapsed time; the timecode reads this each frame. */
  const elapsedRef = useRef(0);
  /** `ctx.currentTime` when the current recording segment started. */
  const segmentStartRef = useRef(0);
  /** Elapsed time accumulated across previous (pre-pause) segments. */
  const accumulatedRef = useRef(0);
  const onTakeReadyRef = useRef(onTakeReady);
  /** Mirrors `status` for use inside the metering loop without re-subscribing. */
  const statusRef = useRef<RecorderStatus>('idle');
  /**
   * Close out the take in progress. Assigned below, once `stop` exists.
   *
   * A ref rather than a dependency because the recovery callbacks are handed to
   * `acquireInput` inside `arm`, which is defined before `stop` — and because a
   * recovery must always call the *current* `stop`, not the one that was current
   * when the device was armed.
   */
  const salvageRef = useRef<() => void>(() => {});
  /** Re-arm from scratch, for a replacement stream the graph cannot absorb. */
  const rearmRef = useRef<(deviceId: string, label: string) => void>(() => {});
  /**
   * `arm` and the device it is on, for callbacks defined before it.
   *
   * `changeBufferMs` has to rebuild the context on the *current* device with the *current*
   * `arm`, and it is declared above both. Refs rather than dependencies for the same reason
   * the recovery callbacks use them: taking `arm` as a dependency rebuilds every consumer
   * of this hook on every device change.
   */
  const armRef = useRef<(deviceId: string, label: string) => Promise<boolean>>(async () => false);
  const activeDeviceIdRef = useRef<string | null>(null);
  const activeDeviceLabelRef = useRef<string>('No input');

  useEffect(() => {
    onTakeReadyRef.current = onTakeReady;
  }, [onTakeReady]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  /** Close the stream and dispose the audio graph. */
  const teardown = useCallback(() => {
    const engine = engineRef.current;
    engineRef.current = null;
    if (!engine) return;

    try {
      engine.stopHealthWatch();
      engine.stopGestureResume();
      engine.dryRecordPath.disconnect();
      engine.wetRecordPath.disconnect();
      engine.mixBus.disconnect();
      engine.recordMux.disconnect();
      engine.worklet.port.onmessage = null;
      engine.worklet.disconnect();
      engine.source.disconnect();
      engine.input.disconnect();
      for (const id of INSTRUMENTS) engine.rigs[id].disconnect();
      engine.ampWet.disconnect();
      engine.ampDry.disconnect();
      engine.monitor.disconnect();
      engine.sink.disconnect();
      engine.splitter.disconnect();
      engine.tunerAnalyser.disconnect();
      // Through the lease, not `stream.getTracks().stop()`: the device is shared
      // with the jam engine now, and stopping the master out from under it is the
      // failure this whole path exists to prevent. Releasing stops this holder's
      // clone and closes the device only if nobody else holds it.
      engine.lease.release();
      void engine.ctx.close();
    } catch {
      // Node disposal races are harmless — the context is going away regardless.
    }
  }, []);

  /**
   * Open an input device and build the graph. Safe to call repeatedly; the
   * previous stream is torn down first so switching devices always works.
   */
  const arm = useCallback(
    async (deviceId: string, deviceLabel: string) => {
      teardown();
      setError(null);
      setStatus('arming');
      setInputHealth({ state: 'live', attempt: 0, message: null });

      // Hoisted so a failure *after* the device opened — a worklet module that will
      // not load, most likely — hands the hardware back instead of leaking a hold
      // on it that nothing will ever release.
      let lease: InputLease | null = null;

      try {
        /**
         * The device comes from the shared session, not from `getUserMedia`.
         *
         * Three things follow from that, and all three are the point:
         *  - The jam page can hold the same pedal without opening it a second
         *    time, which is one of the ways it used to end up reset mid-song.
         *  - A dropout is reopened automatically instead of ending the session.
         *  - The recovery lands as a new stream on `onStream`, which re-points one
         *    node rather than rebuilding the graph.
         */
        lease = await acquireInput({
          deviceId,
          label: deviceLabel,
          onLoss: (reason: InputLossReason) => {
            // Before anything else: a take that was running is still a take. It
            // was captured against valid anchors up to the moment the device went,
            // so it is encoded and handed to the library rather than discarded.
            if (statusRef.current === 'recording' || statusRef.current === 'paused') {
              salvageRef.current();
            }
            if (reason === 'muted') {
              setError(null);
            }
          },
          onStream: (next: MediaStream) => {
            const engine = engineRef.current;
            if (!engine) return;
            // Same device, same format in almost every case — so the graph absorbs
            // it. A device that came back in a different shape needs a real re-arm.
            if (!swapSource(engine, next)) rearmRef.current(deviceId, deviceLabel);
          },
          onHealth: (health: InputHealth) => {
            setInputHealth(health);
            if (health.state === 'live') {
              // `error` is included on purpose. A device that ran out of attempts and
              // then came back — plugged in again ten minutes later, which
              // `devicechange` catches — must not leave the transport stuck at a
              // failure it has recovered from.
              setError(null);
              setStatus((current) =>
                current === 'recovering' || current === 'error' ? 'ready' : current,
              );
              return;
            }
            if (health.state === 'lost') {
              // Out of automatic options: this is the one branch that is a real
              // error, and it keeps the original wording so nothing regressed for
              // the case where the device genuinely is not coming back.
              setError(health.message ?? 'Input device disconnected.');
              setStatus('error');
              return;
            }
            // Recovering or muted. The graph is intact and the amp is still
            // dialled, so this is not `error` and the transport is not reset.
            setStatus((current) =>
              current === 'idle' || current === 'error' ? current : 'recovering',
            );
          },
        });

        const stream = lease.stream;
        const track = stream.getAudioTracks()[0];
        const settings = track?.getSettings() ?? {};

        /**
         * The context runs at the **device's** rate, not the output's.
         *
         * Left unasked, a context takes its rate from whatever the OS currently calls the
         * default playback device — which on this machine is a moving target, because the
         * pedal re-enumerates and Windows re-points the default at endpoints with different
         * rates. A 48 kHz pedal feeding a 44.1 kHz context was observed here, and it costs
         * twice:
         *
         * - **It crackles.** Chromium has to resample the capture stream in real time
         *   inside a 3 ms buffer, on top of six rig chains. That is heard as the sound
         *   breaking up, and it looks exactly like a CPU overrun.
         * - **It corrupts takes, silently.** The worklet captures at the *context's* rate
         *   while the WAV header below was written from the *track's* — so a file recorded
         *   in this state claims 48 kHz for samples rendered at 44.1 and plays 8.8% fast
         *   and sharp. `swapSource` already refuses a rate change for this exact reason;
         *   the refusal was simply never applied to the first open.
         *
         * Asking can fail — `NotSupportedError` when the hardware will not run at that
         * rate — so the fallback is the old behaviour rather than a failed arm. `sampleRate`
         * below is then read from the context, which is the only thing that knows.
         */
        const deviceRate = settings.sampleRate;
        // From the ref, not the state: a recovery re-arms without a render, and a context
        // built with last session's buffer is the bug this whole constant exists for.
        const latencyHintSec = bufferMsRef.current / 1000;
        let ctx: AudioContext;
        try {
          ctx = new AudioContext(
            deviceRate
              ? { latencyHint: latencyHintSec, sampleRate: deviceRate }
              : { latencyHint: latencyHintSec },
          );
        } catch {
          ctx = new AudioContext({ latencyHint: latencyHintSec });
        }
        if (deviceRate && ctx.sampleRate !== deviceRate) {
          // Not fatal — capture and the header agree either way now — but it is the
          // difference between a clean monitor path and a resampled one, and it is
          // invisible from the screen.
          console.warn(
            `[output] context runs at ${ctx.sampleRate} Hz while the input is ${deviceRate} Hz — ` +
              'Chromium will resample, which is heard as crackling.',
          );
        }

        if (!ctx.audioWorklet) {
          throw new Error('AudioWorklet is unavailable in this browser.');
        }
        // Both modules before anything is built. The amp's nodes cannot be
        // constructed until its processors are registered.
        await ctx.audioWorklet.addModule(WORKLET_URL);
        await ctx.audioWorklet.addModule(AMP_WORKLET_URL);
        // Autoplay policy can start the context suspended.
        if (ctx.state === 'suspended') await ctx.resume();

        /**
         * Re-apply the pinned output before anything is built.
         *
         * A sink belongs to the context, and this is a *new* context — so a recovery would
         * otherwise hand the sound back to the system default, which is the thing the pin
         * exists to escape. Failure is not fatal: an unavailable sink means the device was
         * unplugged, and playing out of the default beats not arming at all.
         */
        const pinnedSink = outputDeviceIdRef.current;
        if (pinnedSink) {
          const sinkCtx = ctx as SinkCapableContext;
          if (sinkCtx.setSinkId) {
            await sinkCtx.setSinkId(pinnedSink).catch(() => {
              console.warn(`[output] could not pin sink ${pinnedSink} — using the system default`);
            });
          }
        }

        const channels = Math.max(1, Math.min(2, settings.channelCount ?? 1));
        /**
         * From the **context**, never from the track.
         *
         * This number goes into the WAV header, and the samples it describes are produced
         * by a worklet running on the context's clock. Taking the track's rate instead was
         * right only while the two always agreed — and when they stopped agreeing the file
         * was wrong with nothing to show for it. See the context construction above.
         */
        const sampleRate = ctx.sampleRate;

        const source = ctx.createMediaStreamSource(stream);
        const input = ctx.createGain();
        input.gain.value = dbToGain(gainDb);

        const splitter = ctx.createChannelSplitter(channels);
        const analysers: AnalyserNode[] = [];
        for (let channel = 0; channel < channels; channel += 1) {
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 2048;
          analyser.smoothingTimeConstant = 0;
          splitter.connect(analyser, channel);
          analysers.push(analyser);
        }

        // Mono by default: an AnalyserNode down-mixes whatever it is given, which
        // is what a tuner wants — one instrument, however many channels it arrives on.
        const tunerAnalyser = ctx.createAnalyser();
        tunerAnalyser.fftSize = TUNER_FFT_SIZE;
        // Averaging is for spectra. This node is read as a time-domain waveform and
        // smoothing would blur the very periodicity being measured.
        tunerAnalyser.smoothingTimeConstant = 0;

        const worklet = new AudioWorkletNode(ctx, 'recorder-processor', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [channels],
          channelCount: channels,
          channelCountMode: 'explicit',
          processorOptions: { channels },
        });

        // A node must have a path to `destination` to be pulled by the renderer,
        // so route the (silent) worklet output through a muted sink.
        const sink = ctx.createGain();
        sink.gain.value = 0;

        const monitor = ctx.createGain();
        monitor.gain.value = isMonitoring ? getMasterVolume() : 0;

        const mixBus = ctx.createGain();
        mixBus.gain.value = 1.0;

        const recordMux = ctx.createGain();
        recordMux.gain.value = 1.0;

        const dryRecordPath = ctx.createGain();
        dryRecordPath.gain.value = recordSourceRef.current === 'dry' ? 1.0 : 0.0;

        const wetRecordPath = ctx.createGain();
        wetRecordPath.gain.value = recordSourceRef.current === 'wet' ? 1.0 : 0.0;

        // All three, in parallel. The chain interface is the same for all of them, so
        // nothing below this line branches on the instrument — see `lib/rig.ts`.
        const startingRig = getRigSnapshot();
        const startingEnabled = getEnabledSnapshot();
        const startingLevel = getLevelSnapshot();
        const rigs = {} as Record<Instrument, RigChain>;
        const rigWet = {} as Record<Instrument, GainNode>;
        const rigWetConnected = {} as Record<Instrument, boolean>;
        const ampWet = ctx.createGain();
        const ampDry = ctx.createGain();
        // The dry feed is open only while every channel is off, so bypassing all three
        // leaves something to monitor rather than silence.
        const anyOn = INSTRUMENTS.some((id) => startingEnabled[id]);
        ampWet.gain.value = 0;
        ampDry.gain.value = anyOn ? 0 : 1;

        source.connect(input);
        
        // Tuner always taps the dry input
        input.connect(tunerAnalyser);

        // Dry recording path
        input.connect(dryRecordPath);
        dryRecordPath.connect(recordMux);

        // Wet recording path (mixBus collects everything)
        mixBus.connect(wetRecordPath);
        wetRecordPath.connect(recordMux);

        // Mux outputs to worklet and visualizer splitter
        recordMux.connect(worklet);
        recordMux.connect(splitter);

        worklet.connect(sink);
        sink.connect(ctx.destination);

        // Monitoring runs through the amp, or around it.
        for (const id of INSTRUMENTS) {
          const chain = createRigChain(ctx, id, startingRig);
          const wet = ctx.createGain();
          wet.gain.value = startingEnabled[id] ? startingLevel[id] : 0;

          input.connect(chain.input);
          chain.output.connect(wet);
          /**
           * Only the channels that are on are attached, from the very first quantum.
           *
           * Attaching all six and letting the effect detach five of them 80 ms later would
           * make every arm — including every device recovery, of which there were five in
           * one session — start with the full six-chain load on the audio thread. That is
           * the load the output stream gives up under, and giving up is not something it
           * recovers from by itself.
           */
          if (startingEnabled[id]) {
            wet.connect(mixBus);
            rigWetConnected[id] = true;
          } else {
            rigWetConnected[id] = false;
          }

          // Only the visible rack's meters are reported. Three chains writing to two
          // refs would race, and a gain-reduction readout flickering between three
          // chains is worse than one that shows the rack you are looking at.
          chain.onMeter((source_, reductionDb) => {
            if (engineRef.current?.meteredInstrument !== id) return;
            if (source_ === 'limiter') limiterReductionRef.current = reductionDb;
            else gateReductionRef.current = reductionDb;
          });

          rigs[id] = chain;
          rigWet[id] = wet;
        }
        ampWet.connect(mixBus);
        input.connect(ampDry);
        ampDry.connect(mixBus);

        // Connect the mixBus to the monitor
        mixBus.connect(monitor);
        monitor.connect(ctx.destination);

        /**
         * The context's own watchdog.
         *
         * A device reset takes the render thread with it as often as it takes the
         * input track: the context either suspends (fixable by resuming it, which
         * nothing was doing) or keeps claiming to run with a clock that has
         * stopped. The recorder holds no buffers, so a stalled context is cheapest
         * to fix by arming again — a fresh context, the same device, the tone
         * restored from the shared store.
         */
        const stopHealthWatch = watchAudioContext(ctx, {
          onStalled: () => {
            setError(null);
            setInputHealth({
              state: 'recovering',
              attempt: 1,
              message: 'The audio engine stopped responding — restarting it.',
            });
            rearmRef.current(deviceId, deviceLabel);
          },
        });
        const stopGestureResume = resumeOnGesture(ctx);

        const engine: Engine = {
          ctx,
          lease,
          stopHealthWatch,
          stopGestureResume,
          stream,
          source,
          input,
          monitor,
          // `monitor.connect(ctx.destination)` above. The scope effect maintains it.
          monitorConnected: true,
          rigs,
          rigWet,
          rigWetConnected,
          meteredInstrument: getInstrumentSnapshot(),
          ampWet,
          ampDry,
          sink,
          splitter,
          analysers,
          timeDomain: new Float32Array(analysers[0].fftSize),
          tunerAnalyser,
          tunerBuffer: new Float32Array(tunerAnalyser.fftSize),
          tunerFiltered: new Float32Array(tunerAnalyser.fftSize),
          tunerFloor: createNoiseFloor(),
          tunerStabiliser: createPitchStabiliser(),
          worklet,
          chunks: [],
          channels,
          dryRecordPath,
          wetRecordPath,
          mixBus,
          recordMux,
        };

        // Collect PCM batches while recording.
        worklet.port.onmessage = (event: MessageEvent) => {
          const data = event.data as { type?: string; channels?: Float32Array[] };
          if (data?.type === 'chunk' && data.channels) engine.chunks.push(data.channels);
        };

        // No `ended` listener here any more. It used to report the dropout and then
        // call `teardown()`, which closed the AudioContext — so a momentary USB
        // glitch took monitoring, the meters, the tuner and the amp with it, and the
        // only way back was to re-arm by hand. The session owns that event now, and
        // answers it by reopening the device under the graph.
        engineRef.current = engine;
        meterRef.current = emptyMeter(channels);
        setFormat({ sampleRate, channels, bitDepth: 16 });
        setActiveDeviceId(deviceId);
        setActiveDeviceLabel(deviceLabel);
        setStatus('ready');
        return true;
      } catch (cause) {
        // The device opened but the graph did not get built: hand the hardware back,
        // or the session keeps it claimed for a holder that does not exist.
        lease?.release();
        // Shared with `useInputDevices`, so the two cannot describe the same
        // failure differently — see `lib/mediaErrors`.
        setError(mediaErrorMessage(cause));
        setStatus('error');
        return false;
      }
    },
    [gainDb, isMonitoring, teardown],
  );

  /**
   * Change the monitor buffer, and rebuild the context around it.
   *
   * A buffer is fixed for a context's life, so this cannot be applied to the graph that
   * exists — it has to arm again. That is a real interruption of a couple of hundred
   * milliseconds, which is why this is a coarse picker and not a slider: it is a decision
   * made once when you change how many racks you are running, not something to ride.
   *
   * Nothing else is lost with the graph. Every rack setting, the levels, the channel
   * switches and the output pin all live outside it and are read back on the way up.
   */
  const changeBufferMs = useCallback(
    (next: number) => {
      if (bufferMsRef.current === next) return;
      bufferMsRef.current = next;
      setBufferMs(next);
      // Nothing to rebuild until there is something to rebuild. The next `arm` reads the
      // ref, so an unarmed change simply applies when the device opens.
      const deviceId = activeDeviceIdRef.current;
      if (!deviceId) return;
      void armRef.current(deviceId, activeDeviceLabelRef.current);
    },
    [],
  );

  /** Close the input and return to idle. */
  const disarm = useCallback(() => {
    teardown();
    meterRef.current = emptyMeter(1);
    elapsedRef.current = 0;
    setElapsedSeconds(0);
    setFormat(null);
    setActiveDeviceId(null);
    setActiveDeviceLabel('No input');
    setInputHealth({ state: 'live', attempt: 0, message: null });
    setStatus('idle');
  }, [teardown]);

  /**
   * Reopen the device now.
   *
   * For the button on the "not responding" banner. It goes through the session
   * rather than through `arm` so a device that is already being recovered is not
   * opened twice — and so a retry keeps the graph, and therefore the tone, intact.
   * With nothing armed at all there is nothing to retry, and the device picker is
   * the right control instead.
   */
  const retryInput = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    setError(null);
    engine.lease.retry('manual');
  }, []);

  /** Begin capturing to the in-memory buffer. */
  const start = useCallback(() => {
    const engine = engineRef.current;
    if (!engine || statusRef.current !== 'ready') return;

    engine.chunks = [];
    accumulatedRef.current = 0;
    elapsedRef.current = 0;
    segmentStartRef.current = engine.ctx.currentTime;
    setElapsedSeconds(0);
    engine.worklet.port.postMessage({ type: 'record', value: true });
    setStatus('recording');
  }, []);

  /** Suspend capture, keeping everything recorded so far. */
  const pause = useCallback(() => {
    const engine = engineRef.current;
    if (!engine || statusRef.current !== 'recording') return;

    accumulatedRef.current += engine.ctx.currentTime - segmentStartRef.current;
    engine.worklet.port.postMessage({ type: 'record', value: false });
    setStatus('paused');
  }, []);

  /** Continue capture into the same take. */
  const resume = useCallback(() => {
    const engine = engineRef.current;
    if (!engine || statusRef.current !== 'paused') return;

    segmentStartRef.current = engine.ctx.currentTime;
    engine.worklet.port.postMessage({ type: 'record', value: true });
    setStatus('recording');
  }, []);

  /**
   * Stop capture, encode the buffer to WAV and hand the take back.
   * The stream stays armed so the next take can start immediately.
   */
  const stop = useCallback(async (): Promise<Take | null> => {
    const engine = engineRef.current;
    if (!engine || (statusRef.current !== 'recording' && statusRef.current !== 'paused')) {
      return null;
    }

    if (statusRef.current === 'recording') {
      accumulatedRef.current += engine.ctx.currentTime - segmentStartRef.current;
    }

    engine.worklet.port.postMessage({ type: 'record', value: false });
    setStatus('ready');

    // Let the worklet's flush message cross the thread boundary before merging.
    await new Promise((resolve) => setTimeout(resolve, FLUSH_GRACE_MS));

    const chunks = engine.chunks;
    engine.chunks = [];
    elapsedRef.current = 0;
    setElapsedSeconds(0);

    const frames = chunks.reduce((sum, chunk) => sum + (chunk[0]?.length ?? 0), 0);
    if (frames === 0) {
      setError('Nothing was captured — check that the interface is sending signal.');
      return null;
    }

    const sampleRate = format?.sampleRate ?? engine.ctx.sampleRate;
    const merged = mergeChunks(chunks, engine.channels);
    const blob = encodeWav(merged, sampleRate);
    const index = takeCount + 1;
    const createdAt = Date.now();

    const url = URL.createObjectURL(blob);
    const take: Take = {
      id: `take-${createdAt}-${index}`,
      name: `take-${String(index).padStart(2, '0')}_${filenameStamp(createdAt)}.wav`,
      createdAt,
      durationSec: frames / sampleRate,
      sizeBytes: blob.size,
      sampleRate,
      channels: engine.channels,
      peakDb: peakDbOf(merged),
      peaks: computePeaks(merged),
      blob,
      url,
      // Object URLs honour the `download` attribute, so no separate URL is needed
      // until the take is persisted and served cross-origin.
      downloadUrl: url,
      deviceLabel: activeDeviceLabel,
      sync: 'local',
    };

    setTakeCount(index);
    onTakeReadyRef.current?.(take);
    return take;
  }, [activeDeviceLabel, format, takeCount]);

  /**
   * Wire the recovery callbacks to the current transport functions.
   *
   * Assigned in effects rather than passed as dependencies: `arm` hands these to
   * the session once, and a dropout twenty minutes later must reach the `stop` and
   * `arm` that are current then. Set after an assignment, never read during render.
   */
  useEffect(() => {
    salvageRef.current = () => {
      // The take is finished either way; what this decides is whether the samples
      // survive. They do: everything up to the dropout was captured against valid
      // anchors, and a truncated take of a real performance beats nothing.
      setNotice(
        'The input dropped out mid-take. Everything captured up to that point was kept.',
      );
      // Not awaited — the session is mid-recovery — and not left bare, so a failed
      // encode cannot land as an unhandled rejection on top of a lost device.
      void stop().catch(() => {});
    };
  }, [stop]);

  useEffect(() => {
    rearmRef.current = (deviceId: string, label: string) => {
      void arm(deviceId, label);
    };
    armRef.current = arm;
  }, [arm]);

  // The device `changeBufferMs` has to come back up on. Assigned rather than depended on,
  // so changing inputs does not rebuild every consumer of this hook.
  useEffect(() => {
    activeDeviceIdRef.current = activeDeviceId;
    activeDeviceLabelRef.current = activeDeviceLabel;
  }, [activeDeviceId, activeDeviceLabel]);

  /** Discard the current recording without producing a take. */
  const discard = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;

    engine.worklet.port.postMessage({ type: 'record', value: false });
    engine.chunks = [];
    accumulatedRef.current = 0;
    elapsedRef.current = 0;
    setElapsedSeconds(0);
    setStatus('ready');
  }, []);

  /** Input trim in dB, printed into the recording. */
  const changeGain = useCallback((next: number) => {
    setGainDb(next);
    const engine = engineRef.current;
    if (!engine) return;
    // Short ramp instead of a step, to avoid a click in the captured audio.
    engine.input.gain.setTargetAtTime(dbToGain(next), engine.ctx.currentTime, 0.01);
  }, []);

  /**
   * Change the amp. Safe to call on every pointer move: the chain is built once and
   * driven by parameters, so a slider drag never rebuilds a node.
   */
  /** Switch instruments. The chain-swap effect below does the rest. */
  const selectInstrument = useCallback((next: Instrument) => {
    setInstrument(next);
  }, []);

  /**
   * The bass and drum equivalents of `changeAmp`.
   *
   * Each pushes the whole rig into the live chain rather than its own slot, because
   * `RigChain.update` takes the rig and reads the slot it owns — so one of these
   * three is always the no-op the others are not, and none of them has to know which.
   */
  const changeBass = useCallback((next: BassSettings) => {
    setBassSettings(next);
    engineRef.current?.rigs.bass.update({ ...getRigSnapshot(), bass: next });
  }, []);

  const changeDrums = useCallback((next: DrumSettings) => {
    setDrumSettings(next);
    engineRef.current?.rigs.drums.update({ ...getRigSnapshot(), drums: next });
  }, []);

  const changeVocals = useCallback((next: VocalSettings) => {
    setVocalSettings(next);
    engineRef.current?.rigs.vocals.update({ ...getRigSnapshot(), vocals: next });
  }, []);

  const changeKeys = useCallback((next: KeysSettings) => {
    setKeysSettings(next);
    engineRef.current?.rigs.keys.update({ ...getRigSnapshot(), keys: next });
  }, []);

  const changeBrass = useCallback((next: BrassSettings) => {
    setBrassSettings(next);
    engineRef.current?.rigs.brass.update({ ...getRigSnapshot(), brass: next });
  }, []);

  const changeMasterVolume = useCallback((next: number) => {
    setMasterVolume(next);
    if (engineRef.current && isMonitoring) {
      engineRef.current.monitor.gain.setTargetAtTime(next, engineRef.current.ctx.currentTime, 0.02);
    }
  }, [isMonitoring]);

  const changeRecordSource = useCallback((next: 'dry' | 'wet') => {
    setRecordSource(next);
    const engine = engineRef.current;
    if (!engine) return;
    const at = engine.ctx.currentTime;
    engine.dryRecordPath.gain.setTargetAtTime(next === 'dry' ? 1.0 : 0.0, at, 0.01);
    engine.wetRecordPath.gain.setTargetAtTime(next === 'wet' ? 1.0 : 0.0, at, 0.01);
  }, []);

  const changeAmp = useCallback((next: AmpSettings) => {
    setAmpSettings(next);
    // Pushed straight into this graph as well as into the store: the store update
    // reaches other subscribers on the next render, and a tone change must not wait
    // a frame on the page that made it.
    engineRef.current?.rigs.guitar.update({ ...getRigSnapshot(), guitar: next });
  }, []);

  /**
   * Switch one channel on or off. The store only — the effect below does the audio.
   *
   * This used to write the gain here as well, so the switch felt instant on the page that
   * pressed it rather than a render later. That stopped being safe when a channel started
   * *leaving the graph* when it is off: the gain and the connection now have to move
   * together and in order (connect, then ramp up; ramp down, then disconnect), and a
   * second writer racing the effect turns a crossfade into a click, or connects a node
   * whose gain is already at full.
   *
   * What is lost is one render frame of latency on a button press, which nobody can hear
   * against a 20 ms ramp. What is gained is the rule this file states everywhere else:
   * one `AudioParam`, one writer.
   */
  const toggleInstrument = useCallback((which: Instrument) => {
    toggleInstrumentEnabled(which);
  }, []);

  /**
   * Push settings changed *elsewhere* into this graph.
   *
   * `changeAmp` covers a change made from a rack that calls it. This is the other
   * direction — the tone page writing the shared store, or the jam engine — which
   * would otherwise leave this monitor path on the tone it was armed with. Keyed on
   * the whole rig, so the bass and drum racks need no wiring of their own.
   */
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    // Pushed to all three: each chain reads its own slot out of the rig, so this is
    // one call per chain and two of them are no-ops.
    for (const id of INSTRUMENTS) engine.rigs[id].update(rig);
  }, [rig]);

  /**
   * Follow the visible rack with the meters.
   *
   * All three chains keep running; this only decides which one's gate and limiter feed
   * the header readout. There is nothing to rebuild — that was the old design, and it
   * made switching tabs interrupt the sound.
   */
  useEffect(() => {
    if (engineRef.current) engineRef.current.meteredInstrument = instrument;
  }, [instrument]);

  /**
   * Per-channel on/off, level, and whether this page owns the live monitor.
   *
   * **One effect for all three**, because they multiply into one gain and two effects
   * writing the same `AudioParam` would fight over it. That rule is why the monitor scope
   * is folded in here rather than given its own effect: a second writer would produce a
   * mute that a level change silently undoes, on the one path a player is listening to.
   *
   * `scope` is what stops this page and the mixer from both processing the same input
   * through their own racks — see `monitorScope` in `lib/ampStore.ts`. The dry feed is
   * scoped too: without it, a session with every channel off would still send the raw
   * input to the speakers from here while the mixer was doing the same job properly.
   *
   * Nothing about the player's own settings changes. When the scope comes back, so does
   * exactly the balance they left.
   */
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const at = engine.ctx.currentTime;
    const owns = monitorScope === 'recorder';

    /**
     * A channel that is off leaves the graph, it does not merely go quiet.
     *
     * The same rule as the monitor bus below, one level down, and it is the difference
     * between this page working and this page stuttering. All six chains are built at arm
     * time and kept — "off" has always been a gain of zero rather than a teardown, so a
     * channel comes back instantly and without a click — but a chain whose output still
     * *reaches* `mixBus` is a chain the render thread computes, silent or not. Six gates,
     * six limiters, two convolvers and six oversampled waveshapers, every quantum, to
     * produce one guitar.
     *
     * Disconnecting `rigWet` costs none of what the keep-them-alive rule was protecting:
     * the nodes, their parameters and the tone dialled into them are untouched, and
     * reconnecting is one call. It only removes the path to `destination`, which is the
     * only thing Web Audio uses to decide whether to run a node at all.
     *
     * Order matters in both directions, for the same reason as the monitor bus: connect
     * *before* ramping up and ramp down *before* disconnecting, or the reconnection lands
     * as a step change on a live signal — a click.
     */
    const detaching: number[] = [];
    for (const id of INSTRUMENTS) {
      const audible = enabled[id] && owns;
      if (audible && !engine.rigWetConnected[id]) {
        // Silent at the instant of connection, so the ramp below starts from zero rather
        // than from whatever the parameter was left at when it was detached.
        engine.rigWet[id].gain.cancelScheduledValues(at);
        engine.rigWet[id].gain.setValueAtTime(0, at);
        try {
          engine.rigWet[id].connect(engine.mixBus);
          engine.rigWetConnected[id] = true;
        } catch {
          // Already attached, or the context went away with the page.
        }
      }
      engine.rigWet[id].gain.setTargetAtTime(audible ? level[id] : 0, at, 0.02);
      if (!audible && engine.rigWetConnected[id]) {
        detaching.push(
          window.setTimeout(() => {
            try {
              engine.rigWet[id].disconnect(engine.mixBus);
              engine.rigWetConnected[id] = false;
            } catch {
              // Already detached, or the context went away with the page.
            }
          }, 80),
        );
      }
    }

    const anyOn = INSTRUMENTS.some((id) => enabled[id]);
    engine.ampDry.gain.setTargetAtTime(anyOn || !owns ? 0 : 1, at, 0.02);

    /**
     * Gain zero is not enough: the bus has to leave the graph.
     *
     * Web Audio does not stop computing a node because its output is silent — it stops
     * computing one that has **no path to `destination`**, which is the same rule that
     * makes the capture worklet need a 0-gain sink to run at all. Handing the monitor to
     * the mixer while leaving this bus connected meant six rig chains — six gates, six
     * limiters, two convolvers, six oversampled waveshapers — still running for nothing,
     * on top of whatever the mixer was doing. The audio thread was doing double the work
     * to produce one page's sound, which is exactly what the stutter was.
     *
     * The capture path (input → worklet → silent sink → destination) is untouched, so
     * recording and the tuner keep working while the monitor is disconnected.
     *
     * Connect before the ramp up, ramp down before the disconnect: a hard cut on a live
     * signal is a click, and 80 ms is four times the ramp's own time constant.
     */
    if (owns) {
      try {
        engine.monitor.connect(engine.ctx.destination);
        engine.monitorConnected = true;
      } catch {
        // Already connected; connecting twice is a no-op in every browser but throwing
        // implementations exist for closed contexts.
      }
    } else {
      detaching.push(
        window.setTimeout(() => {
          try {
            engine.monitor.disconnect(engine.ctx.destination);
            engine.monitorConnected = false;
          } catch {
            // Already detached, or the context went away with the page.
          }
        }, 80),
      );
    }

    // One cleanup for every pending detach, the channels' and the bus's alike. A detach
    // that fires after the state it was scheduled for has been replaced would cut a
    // channel the player has just switched back on.
    return () => {
      for (const timer of detaching) window.clearTimeout(timer);
    };
  }, [enabled, level, monitorScope]);

  /** Start/stop pitch detection. */
  const toggleTuner = useCallback(() => {
    setIsTuning((current) => {
      const next = !current;
      isTuningRef.current = next;
      if (!next) {
        // Blank the reading rather than leaving the last note frozen on screen
        // under a panel that is no longer listening.
        tunerRef.current.hz = 0;
        tunerRef.current.clarity = 0;
        tunerRef.current.at = 0;
        const engine = engineRef.current;
        if (engine) {
          engine.tunerStabiliser.reset();
          engine.tunerFloor.reset();
        }
      }
      return next;
    });
  }, []);

  /**
   * Tell the detector what it is listening for.
   *
   * Called when the tuning changes. Writes refs only — the frame loop reads them,
   * and re-rendering on a range change would be pure waste.
   */
  const setTunerRange = useCallback((minHz: number, maxHz: number) => {
    tunerRangeRef.current = { minHz, maxHz };
    const engine = engineRef.current;
    // The previous instrument's readings are meaningless against a new range,
    // and a stale bass note in the median would fight the first guitar string.
    // The noise floor is kept: it describes the input, not the instrument.
    if (engine) engine.tunerStabiliser.reset();
  }, []);

  /**
   * The list of places the sound could come out of.
   *
   * Output labels are hidden until *some* device permission has been granted, which is
   * why this can live here rather than behind its own prompt: by the time anyone is
   * looking at this list, the input has been armed and the labels are populated.
   * `communications` is filtered for the same reason as on the input side — it is a
   * Windows alias for the headset role, never hardware anyone means to pick.
   */
  const refreshOutputs = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return;
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setOutputDevices(
        all
          .filter((device) => device.kind === 'audiooutput' && device.deviceId !== 'communications')
          .map((device, index) => ({
            deviceId: device.deviceId,
            label: device.label || `Output ${index + 1}`,
          })),
      );
    } catch {
      // Enumeration refused. The picker stays empty and the system default is used,
      // which is exactly the behaviour this hook had before the picker existed.
    }
  }, []);

  /**
   * Keep the output list live.
   *
   * `devicechange` fires for outputs as well as inputs, and on this machine it fires a
   * lot: the pedal re-enumerates its playback endpoint every time the driver resets it,
   * which is the event that moves the system default in the first place.
   */
  useEffect(() => {
    const mediaDevices = typeof navigator === 'undefined' ? null : navigator.mediaDevices;
    if (!mediaDevices?.addEventListener) return;

    const onChange = () => void refreshOutputs();
    mediaDevices.addEventListener('devicechange', onChange);
    /**
     * The first read is deferred by a microtask, deliberately.
     *
     * `react-hooks/set-state-in-effect` refuses a `setState` reachable synchronously from
     * an effect body, and it cannot see that `refreshOutputs` only writes state after an
     * `await`. The enumeration is asynchronous either way, so nothing is lost by saying so
     * explicitly — and the alternative, suppressing the rule, would hide the next real one.
     */
    void Promise.resolve().then(refreshOutputs);

    return () => mediaDevices.removeEventListener('devicechange', onChange);
  }, [refreshOutputs]);

  /**
   * Pin the sound to one output, or hand it back to the system default with `''`.
   *
   * Written to the ref as well as to state because `arm` has to re-apply it to every new
   * context — see the pin in `arm`. Returns whether the browser honoured it, so the UI
   * can say "this browser cannot choose" rather than showing a control that lies.
   */
  const changeOutputDevice = useCallback(async (deviceId: string) => {
    outputDeviceIdRef.current = deviceId;
    setOutputDeviceId(deviceId);
    const ctx = engineRef.current?.ctx as SinkCapableContext | undefined;
    if (!ctx?.setSinkId) return false;
    try {
      await ctx.setSinkId(deviceId);
      console.info(`[output] sink set to ${deviceId || '(system default)'}`);
      return true;
    } catch (cause) {
      console.warn(`[output] setSinkId refused: ${cause instanceof Error ? cause.message : cause}`);
      return false;
    }
  }, []);

  /**
   * A 440 Hz tone straight into `destination`, and a snapshot of the output path.
   *
   * Deliberately **not** through the monitor bus: the whole point is to separate "this
   * context does not reach the speakers" from "this context reaches them and the monitor
   * path is muted or unrouted". Routed through the amp it would answer neither question,
   * and a chain that eats the signal would read as a dead output device.
   *
   * The snapshot comes back with it because both halves of the answer are needed at the
   * same instant — a gain read a second later is a different fact.
   *
   * Ramped rather than switched: a hard start on a sine is a click, and this gets pressed
   * by someone already unsure whether their speakers work.
   */
  const playTestTone = useCallback((): OutputDiagnostics | null => {
    const engine = engineRef.current;
    if (!engine) return null;
    const ctx = engine.ctx as SinkCapableContext;
    // Pressing this *is* a gesture, so a context the autoplay policy has parked can be
    // resumed here — and that alone is sometimes the entire fix.
    void ctx.resume().catch(() => {});

    const at = ctx.currentTime;
    const osc = ctx.createOscillator();
    const level = ctx.createGain();
    osc.frequency.value = 440;
    level.gain.setValueAtTime(0, at);
    level.gain.linearRampToValueAtTime(0.12, at + 0.02);
    level.gain.setValueAtTime(0.12, at + 0.9);
    level.gain.linearRampToValueAtTime(0, at + 1.0);
    osc.connect(level);
    level.connect(ctx.destination);
    osc.start(at);
    osc.stop(at + 1.05);
    osc.onended = () => {
      try {
        osc.disconnect();
        level.disconnect();
      } catch {
        // The context closed under it — nothing to tidy.
      }
    };


    const diagnostics: OutputDiagnostics = {
      contextState: ctx.state,
      sampleRate: ctx.sampleRate,
      sinkId: typeof ctx.sinkId === 'string' ? ctx.sinkId : null,
      monitorGain: engine.monitor.gain.value,
      instrumentGain: engine.rigWet[engine.meteredInstrument].gain.value,
      monitorConnected: engine.monitorConnected,
    };

    /**
     * Logged as well as returned, and on the same prefix as `[input]`.
     *
     * The readout on screen is for the player; this line is for the person reading a
     * console dump beside a dev server log, which is how every dropout on this machine has
     * actually been diagnosed. One line, greppable, with the two facts that are invisible
     * everywhere else — whether the bus is routed, and where the sound is being sent.
     */
    console.info(
      `[output] test tone · ctx=${diagnostics.contextState} · ${diagnostics.sampleRate} Hz · ` +
        `sink=${diagnostics.sinkId || '(default)'} · monitorBus=${
          diagnostics.monitorConnected ? 'connected' : 'DISCONNECTED'
        } · monitorGain=${diagnostics.monitorGain.toFixed(3)} · rackGain=${diagnostics.instrumentGain.toFixed(3)}`,
    );

    return diagnostics;
  }, []);

  /**
   * The same tone, on a **throwaway context that has never touched the mic**.
   *
   * The control for `playTestTone`, and deliberately its own button rather than a second
   * tone appended to the first. Two tones from one press asks the listener to tell 440 Hz
   * from 660 Hz a second apart and report which arrived — and when the answer that comes
   * back is "one beep", the measurement has produced nothing. One button, one tone, one
   * question: did *this* make a sound.
   *
   * What each outcome rules out, with `playTestTone` as the other half:
   *
   *  - **Both** — the engine's context reaches the speakers, so the silence is somewhere
   *    the tone does not go, which by construction is only the monitor bus.
   *  - **This one only** — the engine's context specifically is misrouted. A real Chromium
   *    behaviour: a context living beside an open `getUserMedia` stream can end up bound to
   *    the capture device's own endpoint, and this pedal publishes exactly such an
   *    endpoint. The fix is then the sink pin, or rebuilding the context.
   *  - **Neither, while an ordinary `<video>` plays** — Web Audio as a whole is being
   *    delivered somewhere else, which is a browser or OS problem this app cannot reach.
   *
   * Left on the system default even when a sink is pinned: a control with the same
   * variable applied to it is not a control. Closed on `ended`, so it costs one context
   * for a second and never accumulates.
   */
  const playProbeTone = useCallback(() => {
    const probe = new AudioContext();
    void probe.resume().catch(() => {});
    const at = probe.currentTime;
    const osc = probe.createOscillator();
    const level = probe.createGain();
    osc.frequency.value = 660;
    level.gain.setValueAtTime(0, at);
    level.gain.linearRampToValueAtTime(0.12, at + 0.02);
    level.gain.setValueAtTime(0.12, at + 0.9);
    level.gain.linearRampToValueAtTime(0, at + 1.0);
    osc.connect(level);
    level.connect(probe.destination);
    osc.start(at);
    osc.stop(at + 1.05);
    osc.onended = () => {
      void probe.close().catch(() => {});
    };
    console.info(`[output] probe tone (fresh context, no mic) · ctx=${probe.state}`);
  }, []);

  /** Direct monitoring through the computer's output. Off by default (feedback). */
  const toggleMonitoring = useCallback(() => {
    setIsMonitoring((current) => {
      const next = !current;
      const engine = engineRef.current;
      if (engine) {
        engine.monitor.gain.setTargetAtTime(next ? getMasterVolume() : 0, engine.ctx.currentTime, 0.02);
      }
      return next;
    });
  }, []);

  /**
   * `recovering` counts as live on purpose.
   *
   * The graph is still there, the analysers still read (silence, correctly), and
   * the panels have no reason to collapse and re-mount for a two-second dropout —
   * that flicker is most of what made the failure feel like a crash.
   */
  const isLive =
    status === 'ready' ||
    status === 'recording' ||
    status === 'paused' ||
    status === 'recovering';

  /**
   * Single metering + timing loop. Runs only while an input is open, writes to
   * refs, and only touches React state when the whole-second value changes.
   */
  useEffect(() => {
    if (!isLive) return;

    let frameId = 0;
    let previous = performance.now();
    let lastWholeSecond = -1;
    let lastDetectionAt = 0;

    const tick = (now: number) => {
      const deltaSec = Math.min(0.1, (now - previous) / 1000);
      previous = now;

      const engine = engineRef.current;
      if (engine) {
        const meter = meterRef.current;
        let clipped = false;

        for (let channel = 0; channel < engine.analysers.length; channel += 1) {
          const buffer = engine.timeDomain;
          engine.analysers[channel].getFloatTimeDomainData(buffer);

          let peak = 0;
          let sumSquares = 0;
          for (let i = 0; i < buffer.length; i += 1) {
            const sample = buffer[i];
            const magnitude = Math.abs(sample);
            if (magnitude > peak) peak = magnitude;
            sumSquares += sample * sample;
          }
          const rms = Math.sqrt(sumSquares / buffer.length);

          meter.peak[channel] = peak;
          // Asymmetric ballistics so the RMS bar reads like a hardware VU.
          const smoothing = rms > meter.rms[channel] ? RMS_ATTACK : RMS_RELEASE;
          meter.rms[channel] += (rms - meter.rms[channel]) * smoothing;

          const decayed = Math.max(0, meter.hold[channel] - HOLD_DECAY_PER_SEC * deltaSec);
          meter.hold[channel] = Math.max(decayed, peak);

          if (peak >= CLIP_THRESHOLD) clipped = true;
        }

        meter.clipped = clipped;

        // ---- Tuner ---------------------------------------------------------
        // Runs on its own clock inside this loop rather than in a second rAF: two
        // loops would both wake the main thread, and this one already holds the
        // engine. Skipped entirely when the panel is closed.
        if (isTuningRef.current) {
          const { minHz, maxHz } = tunerRangeRef.current;
          const rate = engine.ctx.sampleRate;
          const buffer = engine.tunerBuffer;
          // Never more window than there is buffer, and never so much that the
          // filters have no room to settle in front of it.
          const windowLength = Math.min(
            buffer.length - Math.min(settlingSamplesFor(minHz, rate), buffer.length >> 1),
            windowLengthFor(minHz, rate, buffer.length),
          );

          if (now - lastDetectionAt >= detectionIntervalMs(windowLength, rate)) {
            lastDetectionAt = now;
            engine.tunerAnalyser.getFloatTimeDomainData(buffer);

            // Filter the whole buffer, analyse only its tail. The filters start
            // from zero state and ring for several time constants; done in place
            // on the window alone that ringing lands on the front of the window,
            // where the autocorrelation is most sensitive — measured at 0.95
            // cents of error, which is twenty times the tolerance this display
            // claims. Everything before the window is what settles them.
            engine.tunerFiltered.set(buffer);
            bandLimitInPlace(engine.tunerFiltered, rate, minHz, maxHz);

            // The newest samples sit at the end of an analyser's buffer, so the
            // window is its tail — taking the head would analyse audio a third of
            // a second old and lag the needle behind the peg.
            const block = engine.tunerFiltered.subarray(
              engine.tunerFiltered.length - windowLength,
            );

            // The gate is relative to what this input does when nothing is
            // played, so a mains hum — which is periodic, and which a fixed gate
            // reports as a confident G1 — cannot be read as a note.
            const level = rmsOf(block);
            const gate = engine.tunerFloor.update(level);

            const pitch = detectPitch(block, rate, {
              minHz,
              maxHz,
              minRms: gate,
              minClarity: TUNER_MIN_CLARITY,
            });

            const stable = engine.tunerStabiliser.push(pitch, level, now);
            const tuner = tunerRef.current;
            tuner.clarity = stable.confidence;
            tuner.rms = level;
            if (stable.hz > 0) {
              tuner.hz = stable.hz;
              // Only a reading that survived the attack window and the filter
              // refreshes the timestamp; the panel fades on age, so a note that
              // has died stays legible while the peg is turned.
              if (stable.phase === 'tracking' || stable.phase === 'stable') tuner.at = now;
            } else if (stable.phase === 'idle') {
              tuner.hz = 0;
            }
          }
        }

        if (statusRef.current === 'recording') {
          elapsedRef.current =
            accumulatedRef.current + (engine.ctx.currentTime - segmentStartRef.current);
        }
      }

      const wholeSecond = Math.floor(elapsedRef.current);
      if (wholeSecond !== lastWholeSecond) {
        lastWholeSecond = wholeSecond;
        setElapsedSeconds(wholeSecond);
      }

      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [isLive]);

  // Release the device when the dashboard unmounts.
  useEffect(() => teardown, [teardown]);

  return {
    status,
    error,
    /** Non-failures worth saying. See the `notice` state. */
    notice,
    clearNotice: useCallback(() => setNotice(null), []),
    /**
     * Device health from the shared session: live, muted, recovering or lost.
     *
     * The UI reads this instead of inferring a dropout from `status`, because
     * "recovering" needs its own copy — one that says which device and how many
     * attempts, and that clears itself when the device returns.
     */
    inputHealth,
    retryInput,
    format,
    activeDeviceId,
    activeDeviceLabel,
    gainDb,
    isMonitoring,
    /**
     * Whether this engine — rather than the mixer — is making the live sound right now.
     *
     * Exposed because the screen has to be able to say so. A rack row that reports the
     * *desk's* channel while this engine is the one carrying the input says "no signal"
     * about a signal that is plainly there on the meters beside it.
     */
    monitorScope,
    amp,
    /** Limiter gain reduction in dB (<= 0). Read inside an animation frame. */
    limiterReductionRef,
    /** Gate gain reduction in dB (<= 0). Read inside an animation frame. */
    gateReductionRef,
    elapsedSeconds,
    isTuning,
    /** Latest pitch reading. Read inside an animation frame, never during render. */
    tunerRef,
    toggleTuner,
    setTunerRange,
    /** Live meter values. Read inside an animation frame, never during render. */
    meterRef,
    /** High-resolution elapsed seconds, for the timecode display. */
    elapsedRef,
    channels: format?.channels ?? 1,
    arm,
    disarm,
    start,
    pause,
    resume,
    stop,
    discard,
    changeGain,
    changeAmp,
    /** Per-channel on/off and level — the mixer. See `lib/ampStore.ts`. */
    enabled,
    toggleInstrument,
    level,
    setInstrumentLevel,

    /**
     * The rig: which instrument is in the monitor path, and all three settings.
     *
     * All three are returned whichever is selected, because the tone page keeps every
     * rack's controls alive in the store — switching instruments must not cost you the
     * sound you just dialled on the other one.
     */
    instrument,
    selectInstrument,
    bass: rig.bass,
    changeBass,
    drums: rig.drums,
    changeDrums,
    vocals: rig.vocals,
    changeVocals,
    keys: rig.keys,
    changeKeys,
    brass: rig.brass,
    changeBrass,
    masterVolume,
    changeMasterVolume,
    toggleMonitoring,
    /**
     * Where the sound comes out, and a way to prove it.
     *
     * The input has always had a picker; the output never did, and "silence with every
     * control reading correctly" is what that costs. See `OutputDiagnostics`.
     */
    outputDevices,
    outputDeviceId,
    changeOutputDevice,
    playTestTone,
    playProbeTone,
    /**
     * The monitor buffer. Bigger is more headroom for more racks, and more latency.
     *
     * Exposed because there is no right answer to set on the player's behalf: one rack
     * wants the smallest buffer the machine will give, six need eight times it, and which
     * one they are running changes minute to minute.
     */
    bufferMs,
    changeBufferMs,
    clearError: useCallback(() => setError(null), []),
    recordSource,
    changeRecordSource,
    getAnalyserNode: useCallback((channel: number) => {
      return engineRef.current?.analysers[channel] ?? null;
    }, []),
  };
}

export type RecorderApi = ReturnType<typeof useRecorder>;
