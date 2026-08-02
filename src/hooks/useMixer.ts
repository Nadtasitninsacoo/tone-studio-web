'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { amplitudeToDb, computePeaks, encodeWav, peakDbOf } from '@/lib/audio';
import { resumeOnGesture, watchAudioContext } from '@/lib/contextHealth';
import { acquireInput, type InputHealth, type InputLease } from '@/lib/inputSession';
import { mediaErrorMessage } from '@/lib/mediaErrors';
import { filenameStamp } from '@/lib/format';
import { DEFAULT_MP3_KBPS, encodeMp3 } from '@/lib/mp3';
import {
  getMonitorBufferMs,
  getRigQuality,
  getRigSnapshot,
  getServerMonitorBufferMs,
  getServerRigQuality,
  getServerRigSnapshot,
  setMonitorBufferMs,
  setRigQuality,
  subscribeAmp,
} from '@/lib/ampStore';
import {
  audibleChannelIds,
  channelLength,
  clampFaderDb,
  clampPan,
  clampTrimDb,
  createChannel,
  createGroup,
  isLiveChannel,
  mixDuration,
  moveChannel,
  needsRebuild,
  placeChannel,
  shouldParkContext,
  trimChannelEnd,
  trimChannelStart,
} from '@/lib/mixer';
import {
  applyMixState,
  buildMixGraph,
  loadMixWorklets,
  readMeter,
  type MixGraph,
} from '@/lib/mixGraph';
import type { Instrument } from '@/lib/rig';
import type { MixerChannel, MixerState, MixerStatus } from '@/types/mixer';
import type { Take } from '@/types/recorder';

/** Lead time when booking a run, so every node is scheduled before the clock arrives. */
const SCHEDULE_LEAD = 0.12;

/** Peak-hold fall rate, in normalised amplitude per second. Matches the recorder's. */
const HOLD_DECAY_PER_SEC = 0.35;

/**
 * The desk a new session opens with: eight strips, matching the console.
 *
 * Data, not a rule — a channel can be renamed, re-inserted and rerouted, and strips
 * can be added or removed. It is here rather than in the component so the engine can
 * be rendered by more than one view without two definitions of "a new desk", and so
 * the names in the graph match the names on screen from the first frame.
 *
 * The first six carry the six instrument racks as inserts, which is what makes a strip
 * a *channel* rather than a level: IN 1 through FX 2 each drive a real chain that the
 * tone page dials. The last two are clean channels, for anything that arrives already
 * processed.
 */
const STARTING_STRIPS: readonly { name: string; insert: Instrument | null; group: string }[] = [
  { name: 'IN 1', insert: 'vocals', group: 'GROUP-A' },
  { name: 'V-TONE', insert: 'guitar', group: 'GROUP-A' },
  { name: 'DRUMS', insert: 'drums', group: 'GROUP-A' },
  { name: 'BREAK', insert: 'bass', group: 'GROUP-A' },
  { name: 'FX 1', insert: 'keys', group: 'GROUP-B' },
  { name: 'FX 2', insert: 'brass', group: 'GROUP-B' },
  { name: 'IN 7', insert: null, group: 'GROUP-B' },
  { name: 'IN 8', insert: null, group: 'GROUP-B' },
];

let channelCounter = 0;
let groupCounter = 0;

/**
 * One strip's meter. Mutated in place and painted from rAF, never through state.
 *
 * `input` is the pre-insert reading and `peak` the post-fader one, because the two
 * together are a diagnosis rather than a number: signal in and nothing out means the
 * strip ate it, and nothing in either means it never arrived.
 */
export interface StripMeter {
  input: number;
  peak: number;
  hold: number;
}

function emptyMeter(): StripMeter {
  return { input: 0, peak: 0, hold: 0 };
}

/** The starting desk: eight strips, two groups, master at unity, limiter off. */
function initialState(): MixerState {
  const groups = [createGroup('GROUP-A', 'Band'), createGroup('GROUP-B', 'Backing')];
  const channels: MixerChannel[] = STARTING_STRIPS.map((strip) => {
    channelCounter += 1;
    return createChannel(`CH-${channelCounter}`, strip.name, {
      insert: strip.insert,
      groupId: strip.group,
    });
  });
  groupCounter = 2;
  return {
    channels,
    groups,
    master: { gainDb: 0, limiter: false, ceilingDb: -0.3, muted: false },
    // The desk starts owning the live monitor; the route watcher corrects it on the first
    // navigation. Starting false would mean a page that opens silent for no visible reason.
    monitorLive: true,
  };
}

/**
 * useMixer — the mixing desk.
 *
 * Three tiers of gain, N channels, one shared `AudioContext`, and the same graph
 * description used for the live path and for the render. What lives here rather than
 * in `lib/`: everything that has to hold a node, a buffer or a clock.
 *
 * The rules this engine is built on, all of them learned elsewhere in this project:
 *
 * - **One `AudioContext`.** Every channel is scheduled against its clock, so two
 *   contexts would mean two clocks and no way to place anything against anything else.
 * - **The clock owns the playhead**, and React's copy of it changes only when the
 *   displayed second does. A 60 fps playhead in state re-renders every strip.
 * - **The graph is built once and driven by parameters.** A fader, a mute, a solo, a
 *   pan and a trim are all parameter writes; only a changed insert or a changed group
 *   rebuilds, and `needsRebuild` is the only place that decides.
 * - **The live input comes through `lib/inputSession`**, so the recorder can hold the
 *   same device at the same time and a dropout reopens it under the graph instead of
 *   ending the session.
 * - **The render is offline and deterministic**, built by the same `buildMixGraph`.
 *   A realtime bounce would capture whatever the machine was doing at the time.
 *
 * Nothing in this file has run in a browser.
 */
export function useMixer() {
  const [state, setState] = useState<MixerState>(initialState);
  const [status, setStatus] = useState<MixerStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  /** Whole seconds only. The live value lives in a ref — see `getPlayhead`. */
  const [playhead, setPlayhead] = useState(0);
  const [renderRatio, setRenderRatio] = useState<number | null>(null);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(null);
  const [activeDeviceLabel, setActiveDeviceLabel] = useState('No input');
  /**
   * The last few things that happened to the audio, newest first.
   *
   * A page whose failures cannot be watched needs to be able to say what happened just
   * before it went quiet. "The sound stopped" has meant a suspended context, a device
   * reset, a graph rebuilt with no live channel and a desk reset by a hot reload — four
   * different faults with one symptom, and each round of guessing cost real time. Only
   * genuine transitions are recorded, never per-frame state, so this stays cheap.
   */
  const [events, setEvents] = useState<{ id: number; at: number; text: string }[]>([]);
  /** Whether the held test tone is sounding. */
  const [isTestTone, setIsTestTone] = useState(false);
  /** Available output devices, and which one the context is feeding. */
  const [outputs, setOutputs] = useState<{ deviceId: string; label: string }[]>([]);
  const [activeOutputId, setActiveOutputId] = useState<string>('');
  const [inputHealth, setInputHealth] = useState<InputHealth>({
    state: 'live',
    attempt: 0,
    message: null,
  });

  /**
   * The rig, from the shared store.
   *
   * Not local state: a channel's insert is one of the six racks the tone page dials,
   * and a mixer that kept its own copy would be a second tone that disagrees with the
   * one the player set. See `lib/ampStore.ts`.
   */
  const rig = useSyncExternalStore(subscribeAmp, getRigSnapshot, getServerRigSnapshot);
  /** Shared with the recorder: one machine, one buffer, one quality mode. */
  const rigQuality = useSyncExternalStore(subscribeAmp, getRigQuality, getServerRigQuality);
  const bufferMs = useSyncExternalStore(
    subscribeAmp,
    getMonitorBufferMs,
    getServerMonitorBufferMs,
  );

  const ctxRef = useRef<AudioContext | null>(null);
  const graphRef = useRef<MixGraph | null>(null);
  const stopHealthRef = useRef<() => void>(() => {});
  const stopGestureRef = useRef<() => void>(() => {});
  const hasWorkletsRef = useRef(false);
  /**
   * Whether this context is suspended on purpose. See `shouldParkContext`.
   *
   * A ref, not state: the two watchers read it from inside a poll and a DOM listener that
   * both outlive any single render, and nothing on screen depends on it.
   */
  const isParkedRef = useRef(false);

  /** Decoded audio per channel. Buffers outlive the context, so they are kept here. */
  const buffersRef = useRef(new Map<string, AudioBuffer>());
  /** Nodes started for the current run, so a stop can reach all of them. */
  const runningRef = useRef<AudioBufferSourceNode[]>([]);
  /** Object URLs minted for imports, revoked on unmount. */
  const urlsRef = useRef<string[]>([]);
  const lastAppliedStateRef = useRef<MixerState | null>(null);
  const lastExportUrlRef = useRef<string | null>(null);
  /** The held test tone's nodes, so it can be switched off and cleaned up. */
  const testToneRef = useRef<{ ctx: AudioContext; osc: OscillatorNode; level: GainNode } | null>(
    null,
  );

  /**
   * `takeLiveInput`, for `armInput` to reach.
   *
   * A ref because `armInput` is defined first and both are `useCallback`s: taking the
   * function as a dependency would rebuild the arm callback on every desk change.
   */
  const takeLiveInputRef = useRef<(channelId: string, exclusive?: boolean) => void>(() => {});
  /** `logEvent`, for the functions defined above it. Assigned in an effect below. */
  const logEventRef = useRef<(text: string) => void>(() => {});
  /** The live input, shared with the recorder page. */
  const leaseRef = useRef<InputLease | null>(null);
  const inputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  /**
   * The stream itself, kept so a rebuild can re-attach it.
   *
   * Without this, a stream handed over while the graph did not exist — a recovery that
   * lands during a rebuild, or a device armed before the engine was built — was dropped
   * and never retried, and the input was silently gone for the rest of the session.
   */
  const inputStreamRef = useRef<MediaStream | null>(null);

  /** `{ ctxTime, playhead }` of the current run's origin. */
  const originRef = useRef({ ctxTime: 0, playhead: 0 });
  const playheadRef = useRef(0);
  const shownSecondRef = useRef(-1);
  const isPlayingRef = useRef(false);
  const stateRef = useRef(state);
  /** Mirrored for the diagnostics, which are read inside an animation frame. */
  const inputHealthRef = useRef(inputHealth);
  const rigRef = useRef(rig);

  /** Per-strip meters, keyed by channel or group id, plus `master`. */
  const metersRef = useRef(new Map<string, StripMeter>());

  /**
   * Where the signal is, as one object mutated in place.
   *
   * This exists because "no sound" is one symptom with a dozen causes, and none of them
   * are visible from a screenshot: a suspended context, a device that never attached, a
   * channel with no source, a gate in an insert, a group fader at zero. Reading it in
   * order — engine, device, how many channels are live, level in, level out — puts the
   * break in one place instead of leaving it to be guessed at.
   */
  const diagnosticsRef = useRef({
    /** `'running'`, `'suspended'`, `'closed'`, or `'none'` before the engine exists. */
    context: 'none' as string,
    /** The shared session's view of the device, or `'none'` when nothing is held. */
    device: 'none' as string,
    /** Whether a source node is actually attached to the graph. */
    attached: false,
    /** Channels whose source is the live input. */
    liveChannels: 0,
    /** Loudest pre-insert reading across all channels, 0..1. */
    inputPeak: 0,
    /** Post-limiter master reading, 0..1. */
    masterPeak: 0,
    /**
     * How many instrument racks are running in this graph right now.
     *
     * The one number that explains a stutter. Each chain is a convolver, two AudioWorklet
     * processors and an oversampled waveshaper, and the recorder is running its own set
     * on its own context at the same time — so three live channels here can mean six
     * chains on the machine, which is enough to overrun the audio thread's budget and
     * turn into crackle and then silence. Invisible until now, which is why "it stutters
     * and dies" looked like a mystery instead of arithmetic.
     */
    rigChains: 0,
  });

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    rigRef.current = rig;
  }, [rig]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    inputHealthRef.current = inputHealth;
  }, [inputHealth]);

  const isLive = isPlaying || activeDeviceId !== null;

  /** Record one transition. Never called from render or from the animation frame. */
  const logEvent = useCallback((text: string) => {
    /**
     * The id is derived **inside** the updater, from the state itself.
     *
     * `Date.now()` collided because sixteen recovery attempts landed in the same few
     * milliseconds. A module-level counter collided too, for a subtler reason: incrementing
     * it outside the updater makes the update impure, and React 19's StrictMode invokes an
     * updater twice with the same input — so two entries were produced carrying the one id
     * the counter had reached. Reading the head of the list is pure: two invocations with
     * the same `current` agree, and two calls in one batch see each other's result.
     */
    setEvents((current) => {
      const id = (current[0]?.id ?? 0) + 1;
      return [{ id, at: Date.now(), text }, ...current].slice(0, 12);
    });
  }, []);

  useEffect(() => {
    logEventRef.current = logEvent;
  }, [logEvent]);

  const meterFor = useCallback((id: string): StripMeter => {
    const existing = metersRef.current.get(id);
    if (existing) return existing;
    const created = emptyMeter();
    metersRef.current.set(id, created);
    return created;
  }, []);

  /** The live playhead. A getter, so consuming this hook is never a ref read in render. */
  const getPlayhead = useCallback(() => playheadRef.current, []);

  /** Read one strip's meter. Called inside an animation frame, never during render. */
  const getMeter = useCallback(
    (id: string): StripMeter => meterFor(id),
    [meterFor],
  );

  const commitPlayhead = useCallback((next: number) => {
    playheadRef.current = next;
    const second = Math.floor(next);
    if (second === shownSecondRef.current) return;
    shownSecondRef.current = second;
    setPlayhead(next);
  }, []);

  const syncPlayhead = useCallback(() => {
    shownSecondRef.current = Math.floor(playheadRef.current);
    setPlayhead(playheadRef.current);
  }, []);

  // ---------------------------------------------------------------- engine ---

  const stopSources = useCallback(() => {
    for (const node of runningRef.current) {
      try {
        node.stop();
        node.disconnect();
      } catch {
        // Already stopped, or already disconnected. Nothing to do either way.
      }
    }
    runningRef.current = [];
  }, []);

  /**
   * Rebuild the node graph around the current state, keeping the context.
   *
   * The context survives on purpose: it holds the clock everything is placed against,
   * and closing it would also drop the live input's source node. Only the nodes go.
   */
  const rebuild = useCallback((next: MixerState) => {
    const ctx = ctxRef.current;
    if (!ctx) return;

    graphRef.current?.disconnect();
    const graph = buildMixGraph({
      ctx,
      state: next,
      rig: rigRef.current,
      hasWorklets: hasWorkletsRef.current,
      destination: ctx.destination,
    });
    graphRef.current = graph;
    lastAppliedStateRef.current = next;

    // The live input feeds every channel that names it. One source node, N
    // connections — the device is opened once and tapped many times.
    if (!inputSourceRef.current && inputStreamRef.current) {
      // A stream arrived while there was no graph to hang it on. This is where it gets
      // picked up rather than lost.
      inputSourceRef.current = ctx.createMediaStreamSource(inputStreamRef.current);
    }
    // The graph now *is* this state, and recording that here is what closes a hole in the
    // apply effect: it compares against the last applied state, and a rebuild triggered
    // from anywhere else (`ensureEngine`, a re-arm) would otherwise leave that reference
    // null. The first change after the engine appeared then compared against nothing and
    // was silently dropped — a channel that went live in the state and never in the graph.
    lastAppliedStateRef.current = next;
    logEventRef.current(
      `graph rebuilt — ${next.channels.filter((channel) => channel.source.kind !== 'empty').length}` +
        `/${next.channels.length} channels have a source`,
    );

    const source = inputSourceRef.current;
    if (source) {
      // Detach from the graph that was just thrown away before wiring into the new one.
      // `graph.disconnect()` only clears each node's *outputs*, so without this the
      // source accumulates a connection into every dead graph it has ever fed.
      try {
        source.disconnect();
      } catch {
        // Nothing was connected yet.
      }
      for (const channel of next.channels) {
        if (!isLiveChannel(channel)) continue;
        const nodes = graph.channels.get(channel.id);
        if (nodes) source.connect(nodes.input);
      }
    }
  }, []);

  const ensureEngine = useCallback(async (): Promise<AudioContext> => {
    const existing = ctxRef.current;
    if (existing) {
      // Anyone asking for the engine wants it running, so this is also where a park ends.
      // Clearing the flag first matters: it is what lets the watchers do their job again,
      // and a resume that leaves it set is a context nothing is watching.
      isParkedRef.current = false;
      // Same reason as below: a refused resume is not a reason to hand back nothing.
      try {
        if (existing.state === 'suspended') await existing.resume();
      } catch {
        // Waiting on a gesture. The graph is already built and will simply be silent
        // until the policy is satisfied.
      }
      return existing;
    }

    /**
     * A bigger buffer than `'interactive'`, on purpose.
     *
     * `'interactive'` asks for the smallest buffer the machine will give — 128 or 256
     * frames, about 3–5 ms. That is right for one instrument through one rack. A *mixer*
     * is a different job: three
     * live channels means three rig chains, each with a gate worklet, a limiter worklet
     * and (on guitar and bass) a cabinet convolution and an oversampled waveshaper, and
     * at 3 ms the audio thread has to finish all of it inside 128 samples or the buffer
     * underruns — which is heard as a stutter, and then as silence when the output stream
     * gives up.
     *
     * 30 ms asks for roughly eight times that budget for exactly the same DSP. The cost is
     * 25 ms of extra monitoring latency, which is audible when playing but is the right
     * trade for a desk: it is the difference between three channels working and three
     * channels dropping out.
     *
     * The recorder's context now asks for the same 30 ms, and this comment is why: it went
     * on running six rig chains at 3 ms until the output stream gave up, exactly as
     * predicted above, and the desk staying audible while the Rig page was silent is what
     * finally identified it. See `MONITOR_LATENCY_HINT` in `useRecorder.ts`.
     */
    // From the shared store, not a constant: the buffer describes the machine, and the
    // player has already had to find the right one on the Rig page. See `lib/ampStore.ts`.
    const ctx = new AudioContext({ latencyHint: getMonitorBufferMs() / 1000 });
    ctxRef.current = ctx;
    /**
     * A refused `resume()` must NOT abort building the engine.
     *
     * This engine is created from an effect — the mixer follows the recorder's device on
     * its own — so there may have been no user gesture yet, and Chrome's autoplay policy
     * *rejects* `resume()` in that case. The rejection used to propagate: the worklet was
     * never loaded, `resumeOnGesture` was never installed and, worst of all,
     * `rebuild()` never ran, so the desk had no graph for the rest of the session. Every
     * later press found `ctxRef` already set and returned a context with nothing behind
     * it. Silence with no way back, from one rejected promise.
     *
     * Suspended is a fine state to build in: nodes connect, parameters apply, and the
     * gesture listener below starts the clock at the first click.
     */
    try {
      if (ctx.state === 'suspended') await ctx.resume();
    } catch {
      // Autoplay policy. `resumeOnGesture` below is exactly the answer to it.
    }

    logEvent(`engine created (${ctx.state}, ${Math.round(ctx.sampleRate / 100) / 10} kHz)`);
    hasWorkletsRef.current = await loadMixWorklets(ctx);
    if (!hasWorkletsRef.current) {
      logEvent('amp worklet failed to load — no master limiter');
      setNotice(
        'The master limiter could not be loaded in this browser, so the mix plays without it.',
      );
    }

    // The same watchdog the recorder uses: a Windows endpoint reset either suspends
    // the context or leaves its clock stopped, and neither raises an event here.
    stopHealthRef.current = watchAudioContext(ctx, {
      onStalled: () => {
        logEvent('engine STALLED — clock stopped while running');
        setNotice('The audio engine stopped responding — press play to start it again.');
        stopSources();
        setIsPlaying(false);
      },
      onResumed: () => {
        logEvent('engine resumed from suspended');
        // The clock lost time the playhead did not, so what comes back is behind the
        // mix. Rebooking from the current position is the only way it lines up.
        if (isPlayingRef.current) {
          stopSources();
          setIsPlaying(false);
        }
      },
      // Both watchers have to know a park from a fault, or they undo it half a second
      // later — the poll by resuming, the gesture listener on the next keystroke.
      isParked: () => isParkedRef.current,
    });
    stopGestureRef.current = resumeOnGesture(ctx, () => isParkedRef.current);

    rebuild(stateRef.current);
    return ctx;
  }, [logEvent, rebuild, stopSources]);

  /**
   * Apply a state change: parameters where possible, a rebuild only where necessary.
   *
   * Every mutation in this hook goes through here, which is what keeps the graph and
   * the state from disagreeing — the failure mode being a fader that moves on screen
   * and not in the sound.
   */
  const change = useCallback(
    (update: (current: MixerState) => MixerState) => {
      setState((current) => {
        const next = update(current);
        stateRef.current = next;
        return next;
      });
    },
    [],
  );

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;

    const previous = lastAppliedStateRef.current;
    const current = state;
    if (previous === current) return;

    // `rebuild` records the state it built from, so `previous` is only null before the
    // graph exists — and the early return above has already covered that. Treating a
    // missing reference as "nothing to do" is what dropped the first change after the
    // engine appeared.
    if (previous === null || needsRebuild(previous, current)) {
      rebuild(current);
    } else {
      applyMixState(graph, current, rigRef.current);
    }
    lastAppliedStateRef.current = current;
  }, [state, rebuild]);

  /**
   * Push the quality mode into every rack this desk holds.
   *
   * The desk builds the same `RigChain`s the Rig page does — one per channel that has both
   * an insert and a source — so it pays the same twelve-worklets-per-six-racks cost and
   * needs the same lever. Walking the graph rather than threading the mode through
   * `buildMixGraph` keeps that function's signature about the mix and not about the
   * machine; a rebuild re-applies it below.
   */
  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    for (const nodes of graph.channels.values()) nodes.rack?.setQuality(rigQuality);
  }, [rigQuality, state]);

  /**
   * A buffer change reaches this context only by building a new one.
   *
   * `latencyHint` is fixed for a context's life, and the desk's is read in `ensureEngine`.
   * Closing it here is safe precisely when the desk is idle — the decoded takes are
   * `AudioBuffer`s, which belong to no context and survive — and refusing to close it while
   * something is playing is the point: a rebuild mid-playback is a worse outcome than a
   * buffer that applies a moment later.
   */
  const lastBufferRef = useRef(bufferMs);
  useEffect(() => {
    if (lastBufferRef.current === bufferMs) return;
    const ctx = ctxRef.current;
    if (!ctx || status !== 'idle') return;
    lastBufferRef.current = bufferMs;
    ctxRef.current = null;
    graphRef.current = null;
    lastAppliedStateRef.current = null;
    stopHealthRef.current();
    stopGestureRef.current();
    isParkedRef.current = false;
    void ctx.close().catch(() => {
      // Already closing. The refs are cleared either way, so the next `ensureEngine`
      // builds a fresh one at the new buffer.
    });
    logEventRef.current(`buffer changed to ${bufferMs} ms — engine will rebuild`);
  }, [bufferMs, status]);

  /**
   * Park the whole context while nobody is listening to this desk.
   *
   * See `shouldParkContext` for why muting the channels was not enough: a silent graph is
   * still a computed graph, so the desk's rig chains were running beside the tone page's
   * own for the same instrument, on a second render thread. `suspend()` is the only thing
   * that stops all of it at once.
   *
   * Never a synchronous `setState`, so this is safe in an effect body: it writes a ref and
   * calls two promises whose results nothing waits on. The park flag is set *before*
   * suspending and cleared *after* the resume is requested, so the watchers never see a
   * suspended-and-unwatched window in either direction.
   */
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx || ctx.state === 'closed') return;
    const park = shouldParkContext(state, status);
    if (park === isParkedRef.current) return;

    if (park) {
      isParkedRef.current = true;
      void ctx.suspend().catch(() => {
        // Nothing to fall back to: a context that refuses to suspend is merely expensive,
        // and un-parking keeps the watchers honest about it.
        isParkedRef.current = false;
      });
      return;
    }

    isParkedRef.current = false;
    void ctx.resume().catch(() => {
      // Autoplay policy. `resumeOnGesture` is installed for exactly this, and it is now
      // allowed to fire again because the flag is already clear.
    });
    // `activeDeviceId` is in the deps because the context is built *by* arming, after this
    // effect has already run and returned on a null `ctxRef`. Without something that
    // changes when the engine appears, the first park decision is made against no engine
    // and never revisited — the same trap the recorder's monitor connection sits in.
  }, [state, status, activeDeviceId]);

  /**
   * Push a rig change from elsewhere into the inserted racks.
   *
   * `change` covers a change made here; this is the other direction — the tone page
   * writing the shared store — which would otherwise leave every insert on the tone
   * it was built with while the rack on screen showed something else.
   */
  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    applyMixState(graph, stateRef.current, rig);
  }, [rig]);

  // ------------------------------------------------------------- transport ---

  const scheduleRun = useCallback((graph: MixGraph, from: number, startAt: number) => {
    const started: AudioBufferSourceNode[] = [];
    for (const channel of stateRef.current.channels) {
      if (channel.source.kind !== 'clip') continue;
      const buffer = buffersRef.current.get(channel.id);
      if (!buffer) continue;
      const placement = placeChannel(channel, from);
      if (!placement) continue;
      const nodes = graph.channels.get(channel.id);
      if (!nodes) continue;

      const node = graph.ctx.createBufferSource();
      node.buffer = buffer;
      node.connect(nodes.input);
      // The third argument bounds playback to the trimmed window, so the out-point is
      // honoured without a separate stop() to get wrong.
      node.start(
        startAt + placement.delaySec,
        placement.offsetSec,
        placement.durationSec ?? undefined,
      );
      started.push(node);
    }
    runningRef.current = started;
  }, []);

  const play = useCallback(
    async (from?: number) => {
      const ctx = await ensureEngine();
      const graph = graphRef.current;
      if (!graph) return;

      stopSources();
      const duration = mixDuration(stateRef.current);
      if (duration <= 0) {
        // Nothing is loaded, so there is no transport to run — but the press was still
        // useful: `ensureEngine` above created and resumed the context, which is what a
        // live channel needs to be heard. Running a playhead against a zero-length mix
        // was the bug here: it counted up for ever and reported "playing" while the desk
        // had nothing to play.
        playheadRef.current = 0;
        syncPlayhead();
        setIsPlaying(false);
        setStatus('idle');
        setNotice(
          'Nothing is loaded on a channel yet, so there is nothing to play. The engine is ' +
            'running — a channel set to the live input is audible without the transport.',
        );
        return;
      }
      const position = Math.max(0, Math.min(from ?? playheadRef.current, duration));
      const startAt = ctx.currentTime + SCHEDULE_LEAD;

      scheduleRun(graph, position, startAt);
      originRef.current = { ctxTime: startAt, playhead: position };
      playheadRef.current = position;
      syncPlayhead();
      setStatus('playing');
      setIsPlaying(true);
    },
    [ensureEngine, scheduleRun, stopSources, syncPlayhead],
  );

  const pause = useCallback(() => {
    stopSources();
    setIsPlaying(false);
    setStatus((current) => (current === 'playing' ? 'idle' : current));
    // Motion stops here, so React's copy has to catch up with the ref — otherwise the
    // next render snaps the playhead back to the last committed second.
    syncPlayhead();
  }, [stopSources, syncPlayhead]);

  const togglePlay = useCallback(() => {
    if (isPlayingRef.current) pause();
    else void play();
  }, [pause, play]);

  const seek = useCallback(
    (to: number) => {
      const duration = mixDuration(stateRef.current);
      const next = Math.max(0, Math.min(to, duration));
      playheadRef.current = next;
      syncPlayhead();
      if (isPlayingRef.current) void play(next);
    },
    [play, syncPlayhead],
  );

  /** Advance the playhead from the audio clock, and paint every meter. */
  useEffect(() => {
    if (!isLive) return;
    let frame = 0;
    let previous = performance.now();

    const tick = (now: number) => {
      const deltaSec = Math.min(0.1, (now - previous) / 1000);
      previous = now;

      const graph = graphRef.current;
      if (graph) {
        for (const [id, nodes] of graph.channels) {
          const meter = meterFor(id);
          meter.input = readMeter(nodes.inputAnalyser, nodes.inputTimeDomain);
          meter.peak = readMeter(nodes.analyser, nodes.timeDomain);
          meter.hold = Math.max(meter.hold - HOLD_DECAY_PER_SEC * deltaSec, meter.peak);
        }
        for (const [id, nodes] of graph.groups) {
          const meter = meterFor(id);
          meter.peak = readMeter(nodes.analyser, nodes.timeDomain);
          meter.hold = Math.max(meter.hold - HOLD_DECAY_PER_SEC * deltaSec, meter.peak);
        }

        // Read stereo Left/Right master meters
        const masterL = meterFor('master-L');
        masterL.peak = readMeter(graph.analyserL, graph.timeDomainL);
        masterL.hold = Math.max(masterL.hold - HOLD_DECAY_PER_SEC * deltaSec, masterL.peak);

        const masterR = meterFor('master-R');
        masterR.peak = readMeter(graph.analyserR, graph.timeDomainR);
        masterR.hold = Math.max(masterR.hold - HOLD_DECAY_PER_SEC * deltaSec, masterR.peak);

        // Keep the legacy mono meter updated just in case
        const master = meterFor('master');
        master.peak = readMeter(graph.analyser, graph.timeDomain);
        master.hold = Math.max(master.hold - HOLD_DECAY_PER_SEC * deltaSec, master.peak);

        // Filled from the same reads rather than a second pass over the graph.
        const diagnostics = diagnosticsRef.current;
        let loudestInput = 0;
        for (const [id] of graph.channels) {
          const meter = meterFor(id);
          if (meter.input > loudestInput) loudestInput = meter.input;
        }
        diagnostics.inputPeak = loudestInput;
        diagnostics.masterPeak = Math.max(masterL.peak, masterR.peak);
        // Counted from the graph, not from the state: a channel can *name* an insert and
        // still have no rack, because `createRigChain` is allowed to fail (a browser that
        // refuses the worklet module) and the channel then passes clean rather than
        // taking the strip down with it. This number is the load that actually exists —
        // and a channel showing an insert while this reads 0 is that failure, visible.
        let chains = 0;
        for (const [, nodes] of graph.channels) if (nodes.rack) chains += 1;
        diagnostics.rigChains = chains;
      }

      const diagnostics = diagnosticsRef.current;
      diagnostics.context = ctxRef.current?.state ?? 'none';
      diagnostics.device = leaseRef.current ? inputHealthRef.current.state : 'none';
      diagnostics.attached = inputSourceRef.current !== null;
      diagnostics.liveChannels = stateRef.current.channels.filter(isLiveChannel).length;

      if (isPlayingRef.current && graph) {
        const elapsed = graph.ctx.currentTime - originRef.current.ctxTime;
        if (elapsed >= 0) {
          const next = originRef.current.playhead + elapsed;
          const duration = mixDuration(stateRef.current);
          if (duration > 0 && next >= duration) {
            playheadRef.current = duration;
            stopSources();
            setIsPlaying(false);
            setStatus('idle');
            syncPlayhead();
          } else {
            commitPlayhead(next);
          }
        }
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [commitPlayhead, isLive, meterFor, stopSources, syncPlayhead]);

  // --------------------------------------------------------------- sources ---

  /** Decode an `ArrayBuffer` into the shared context, so it can be scheduled. */
  const decodeInto = useCallback(
    async (channelId: string, bytes: ArrayBuffer, name: string, takeId?: string) => {
      const ctx = await ensureEngine();
      // `decodeAudioData` detaches its input, so a caller reusing the bytes gets an
      // empty buffer — hence the slice, and hence this being the only decode path.
      const buffer = await ctx.decodeAudioData(bytes.slice(0));
      buffersRef.current.set(channelId, buffer);
      change((current) => ({
        ...current,
        channels: current.channels.map((channel) =>
          channel.id === channelId
            ? {
                ...channel,
                name: name || channel.name,
                source: { kind: 'clip', name, takeId, durationSec: buffer.duration },
                inPoint: 0,
                outPoint: buffer.duration,
              }
            : channel,
        ),
      }));
    },
    [change, ensureEngine],
  );

  /** Put a take from the shared library on a channel. */
  const loadTake = useCallback(
    async (channelId: string, take: Take) => {
      setError(null);
      try {
        const bytes = take.blob
          ? await take.blob.arrayBuffer()
          : await (await fetch(take.url)).arrayBuffer();
        await decodeInto(channelId, bytes, take.name, take.id);
      } catch {
        setError(`“${take.name}” could not be decoded, so the channel is unchanged.`);
      }
    },
    [decodeInto],
  );

  /** Put an audio file from disk on a channel. */
  const loadFile = useCallback(
    async (channelId: string, file: File) => {
      setError(null);
      try {
        await decodeInto(channelId, await file.arrayBuffer(), file.name);
      } catch {
        setError(`“${file.name}” is not audio this browser can decode.`);
      }
    },
    [decodeInto],
  );

  /**
   * Point a channel at the live input.
   *
   * Needs no device work of its own: `armInput` holds the lease and the source node,
   * and the rebuild connects that node to every channel that names it.
   *
   * Named `takeLiveInput`, not `useLiveInput`: anything beginning with `use` is read as
   * a hook, and the lint rule then refuses every call from inside a callback — which is
   * the only place a channel is ever assigned from.
   */
  const takeLiveInput = useCallback(
    (channelId: string, exclusive = false) => {
      buffersRef.current.delete(channelId);
      /**
       * Additive unless the caller asks otherwise, and the distinction is the whole point.
       *
       * Two things call this and they mean opposite things. The Rig page's
       * "○ CH · no signal" link means **move** the input to the channel carrying that rack —
       * its own log line has said `moved` since the day it was written. Choosing `live` on a
       * strip in CHANNEL SOURCES means **this strip, as well**, and silently emptying the
       * others is then destroying a desk the player set up.
       *
       * The exclusivity was added to this shared function to stop six live channels
       * overrunning the audio thread. That was a real problem, but it is now answered by
       * things the player controls — the LIGHT mode and the buffer — rather than by a rule
       * that makes the desk impossible to set up.
       */
      const cleared: string[] = [];
      change((current) => ({
        ...current,
        channels: current.channels.map((channel) => {
          if (channel.id === channelId) {
            return { ...channel, source: { kind: 'live' }, offsetSec: 0, inPoint: 0, outPoint: 0 };
          }
          if (exclusive && channel.source.kind === 'live') {
            cleared.push(channel.name);
            return { ...channel, source: { kind: 'empty' }, offsetSec: 0, inPoint: 0, outPoint: 0 };
          }
          return channel;
        }),
      }));
      // Never silently: the desk's event log exists "for when a silence needs explaining",
      // and a strip that stops carrying signal because you clicked somewhere else is
      // exactly that.
      if (cleared.length > 0) logEvent(`live input moved off ${cleared.join(', ')}`);
      if (!leaseRef.current) {
        setNotice('This channel is set to the live input — open a device to hear it.');
      }
    },
    [change, logEvent],
  );

  useEffect(() => {
    takeLiveInputRef.current = takeLiveInput;
  }, [takeLiveInput]);

  const clearChannel = useCallback(
    (channelId: string) => {
      buffersRef.current.delete(channelId);
      change((current) => ({
        ...current,
        channels: current.channels.map((channel) =>
          channel.id === channelId
            ? { ...channel, source: { kind: 'empty' }, inPoint: 0, outPoint: 0, offsetSec: 0 }
            : channel,
        ),
      }));
    },
    [change],
  );

  // ------------------------------------------------------------ live input ---

  /** Attach the lease's stream to the graph, replacing whatever was there. */
  const attachInput = useCallback((stream: MediaStream) => {
    // Remembered first, unconditionally: whatever happens below, a later rebuild must be
    // able to find this stream.
    inputStreamRef.current = stream;

    const ctx = ctxRef.current;
    const graph = graphRef.current;
    if (!ctx || !graph) return;

    try {
      inputSourceRef.current?.disconnect();
    } catch {
      // Already detached.
    }
    const source = ctx.createMediaStreamSource(stream);
    inputSourceRef.current = source;
    for (const channel of stateRef.current.channels) {
      if (!isLiveChannel(channel)) continue;
      const nodes = graph.channels.get(channel.id);
      if (nodes) source.connect(nodes.input);
    }
  }, []);

  const armInput = useCallback(
    async (deviceId: string, deviceLabel: string) => {
      setError(null);
      await ensureEngine();

      leaseRef.current?.release();
      leaseRef.current = null;

      try {
        const lease = await acquireInput({
          deviceId,
          label: deviceLabel,
          onStream: (stream) => {
            logEvent('input stream replaced (recovery)');
            attachInput(stream);
          },
          onLoss: () => {
            // Nothing to salvage here — the mixer does not capture — so a dropout is
            // only a monitoring interruption. The clips keep playing.
          },
          onHealth: (health) => {
            setInputHealth(health);
            logEvent(
              health.attempt > 0
                ? `device ${health.state} (attempt ${health.attempt})`
                : `device ${health.state}`,
            );
            if (health.state === 'lost') setError(health.message);
            else if (health.state === 'live') setError(null);
          },
        });
        leaseRef.current = lease;
        attachInput(lease.stream);
        setActiveDeviceId(deviceId);

        /**
         * An armed device with nothing listening to it is not a state worth being in.
         *
         * Opening an input and then having to find a second control before anything can be
         * heard is the failure this whole page kept coming back to — "do I have to press
         * something on the mixer every time?" is the right question, and the answer has to
         * be no. So if the desk is completely empty, the guitar channel takes the input.
         * One channel, not six: six racks on one signal is mud and six times the CPU.
         *
         * Only when *every* channel is empty. A desk someone has already set up is never
         * rearranged by arming a device.
         */
        const desk = stateRef.current;
        if (desk.channels.every((channel) => channel.source.kind === 'empty')) {
          /**
           * The **guitar** channel, deliberately, and this is the third time this default
           * has moved — so the reasoning is worth keeping.
           *
           * A clean strip (no insert) is the safest way to be *heard*, and that is what
           * this was, but it made every control on the tone page act on nothing: the
           * signal you could hear was the one signal no rack touched. Being audible and
           * being adjustable are both requirements, so the input goes where the racks
           * are, and the tone page now shows which channel each rack is on — so a silent
           * rack can be seen rather than guessed at.
           *
           * If the amp does eat the signal, `V-TONE`'s own strip shows it: input meter
           * moving, output meter dark. The gate sits at −58 dB by default.
           */
          const target =
            desk.channels.find((channel) => channel.insert === 'guitar') ?? desk.channels[0];
          if (target) {
            takeLiveInputRef.current(target.id);
            logEvent(`live input auto-assigned to ${target.name}`);
            setNotice(
              `${target.name} is taking the live input, through the guitar rack — so the tone ` +
                'page changes what you hear. Its strip shows the level arriving and the level ' +
                'leaving, so a rack that eats the signal is visible rather than a mystery.',
            );
          }
        }
      } catch (cause) {
        logEvent(`device failed to open: ${mediaErrorMessage(cause).slice(0, 60)}`);
        setError(mediaErrorMessage(cause));
        return false;
      }
    },
    [attachInput, ensureEngine, logEvent],
  );

  const releaseInput = useCallback(() => {
    try {
      inputSourceRef.current?.disconnect();
    } catch {
      // Already detached.
    }
    inputSourceRef.current = null;
    inputStreamRef.current = null;
    leaseRef.current?.release();
    leaseRef.current = null;
    setActiveDeviceId(null);
    setActiveDeviceLabel('No input');
  }, []);

  const retryInput = useCallback(() => {
    setError(null);
    leaseRef.current?.retry('manual');
  }, []);

  // ------------------------------------------------------------ strip edits ---

  const setChannelGain = useCallback(
    (id: string, gainDb: number) =>
      change((current) => ({
        ...current,
        channels: current.channels.map((channel) =>
          channel.id === id ? { ...channel, gainDb: clampFaderDb(gainDb) } : channel,
        ),
      })),
    [change],
  );

  /** The GAIN knob: input trim, before the insert. See `types/mixer.ts`. */
  const setChannelTrim = useCallback(
    (id: string, trimDb: number) =>
      change((current) => ({
        ...current,
        channels: current.channels.map((channel) =>
          channel.id === id ? { ...channel, trimDb: clampTrimDb(trimDb) } : channel,
        ),
      })),
    [change],
  );

  const setChannelPan = useCallback(
    (id: string, pan: number) =>
      change((current) => ({
        ...current,
        channels: current.channels.map((channel) =>
          channel.id === id ? { ...channel, pan: clampPan(pan) } : channel,
        ),
      })),
    [change],
  );

  const toggleChannelMute = useCallback(
    (id: string) =>
      change((current) => ({
        ...current,
        channels: current.channels.map((channel) =>
          channel.id === id ? { ...channel, muted: !channel.muted } : channel,
        ),
      })),
    [change],
  );

  const toggleChannelSolo = useCallback(
    (id: string) =>
      change((current) => ({
        ...current,
        channels: current.channels.map((channel) =>
          channel.id === id ? { ...channel, solo: !channel.solo } : channel,
        ),
      })),
    [change],
  );

  const setChannelInsert = useCallback(
    (id: string, insert: Instrument | null) =>
      change((current) => ({
        ...current,
        channels: current.channels.map((channel) =>
          channel.id === id ? { ...channel, insert } : channel,
        ),
      })),
    [change],
  );

  const setChannelGroup = useCallback(
    (id: string, groupId: string | null) =>
      change((current) => ({
        ...current,
        channels: current.channels.map((channel) =>
          channel.id === id ? { ...channel, groupId } : channel,
        ),
      })),
    [change],
  );

  const renameChannel = useCallback(
    (id: string, name: string) =>
      change((current) => ({
        ...current,
        channels: current.channels.map((channel) =>
          channel.id === id ? { ...channel, name } : channel,
        ),
      })),
    [change],
  );

  const nudgeChannel = useCallback(
    (id: string, deltaSec: number) =>
      change((current) => ({
        ...current,
        channels: current.channels.map((channel) =>
          channel.id === id ? moveChannel(channel, channel.offsetSec + deltaSec) : channel,
        ),
      })),
    [change],
  );

  const setChannelOffset = useCallback(
    (id: string, offsetSec: number) =>
      change((current) => ({
        ...current,
        channels: current.channels.map((channel) =>
          channel.id === id ? moveChannel(channel, offsetSec) : channel,
        ),
      })),
    [change],
  );

  const trimStart = useCallback(
    (id: string, deltaSec: number) =>
      change((current) => ({
        ...current,
        channels: current.channels.map((channel) =>
          channel.id === id ? trimChannelStart(channel, deltaSec) : channel,
        ),
      })),
    [change],
  );

  const trimEnd = useCallback(
    (id: string, deltaSec: number) =>
      change((current) => ({
        ...current,
        channels: current.channels.map((channel) =>
          channel.id === id ? trimChannelEnd(channel, deltaSec) : channel,
        ),
      })),
    [change],
  );

  /**
   * The channels a rack is inserted on. Used by the tone page to say where it lands.
   *
   * A rack with no channel — or only channels with no source — is a rack whose knobs
   * cannot change anything you can hear, and that has been the single most confusing
   * thing about this app: six pages of controls acting on nothing.
   */
  const channelsForInsert = useCallback(
    (instrument: Instrument) => state.channels.filter((channel) => channel.insert === instrument),
    [state.channels],
  );

  /**
   * Set the level of every channel carrying this rack, from a 0..1 figure.
   *
   * The bridge between the tone page's per-instrument level (linear, 1.0 = unity) and the
   * mixer's faders (dB). `amplitudeToDb` is the honest conversion and it floors at −60,
   * which `faderGain` already treats as silence — so 0 means off on both pages.
   *
   * Additive by design: the caller still writes the recorder's own monitor level exactly
   * as before. Nothing here changes the recorder's audio path, which is the one part of
   * this app that has been verified against hardware.
   */
  const setInsertLevel = useCallback(
    (instrument: Instrument, level: number) => {
      const gainDb = amplitudeToDb(Math.max(0, Math.min(1, level)));
      change((current) => ({
        ...current,
        channels: current.channels.map((channel) =>
          channel.insert === instrument ? { ...channel, gainDb: clampFaderDb(gainDb) } : channel,
        ),
      }));
    },
    [change],
  );

  /** Mute or unmute every channel carrying this rack. */
  const setInsertEnabled = useCallback(
    (instrument: Instrument, enabled: boolean) => {
      change((current) => ({
        ...current,
        channels: current.channels.map((channel) =>
          channel.insert === instrument ? { ...channel, muted: !enabled } : channel,
        ),
      }));
    },
    [change],
  );

  /**
   * Put the live input on the first channel carrying this rack.
   *
   * The action behind "this rack is not on anything you can hear". One click from a dead
   * knob to a live one.
   */
  const putLiveOnInsert = useCallback(
    (instrument: Instrument) => {
      const target = stateRef.current.channels.find((channel) => channel.insert === instrument);
      if (!target) return;
      // `true`: this is the *move*. The link that calls it says a rack has no signal, and
      // answering it by adding a seventh live channel is not what it offered.
      takeLiveInputRef.current(target.id, true);
      logEvent(`live input moved to ${target.name} (${instrument})`);
    },
    [logEvent],
  );

  const addChannel = useCallback(() => {
    channelCounter += 1;
    const id = `CH-${channelCounter}`;
    change((current) => ({
      ...current,
      channels: [...current.channels, createChannel(id, `Ch ${current.channels.length + 1}`)],
    }));
    setSelectedChannelId(id);
  }, [change]);

  const removeChannel = useCallback(
    (id: string) => {
      buffersRef.current.delete(id);
      metersRef.current.delete(id);
      change((current) => ({
        ...current,
        channels: current.channels.filter((channel) => channel.id !== id),
      }));
      setSelectedChannelId((current) => (current === id ? null : current));
    },
    [change],
  );

  const setGroupGainDb = useCallback(
    (id: string, gainDb: number) =>
      change((current) => ({
        ...current,
        groups: current.groups.map((group) =>
          group.id === id ? { ...group, gainDb: clampFaderDb(gainDb) } : group,
        ),
      })),
    [change],
  );

  const setGroupPan = useCallback(
    (id: string, pan: number) =>
      change((current) => ({
        ...current,
        groups: current.groups.map((group) =>
          group.id === id ? { ...group, pan: clampPan(pan) } : group,
        ),
      })),
    [change],
  );

  const toggleGroupMute = useCallback(
    (id: string) =>
      change((current) => ({
        ...current,
        groups: current.groups.map((group) =>
          group.id === id ? { ...group, muted: !group.muted } : group,
        ),
      })),
    [change],
  );

  const toggleGroupSolo = useCallback(
    (id: string) =>
      change((current) => ({
        ...current,
        groups: current.groups.map((group) =>
          group.id === id ? { ...group, solo: !group.solo } : group,
        ),
      })),
    [change],
  );

  const renameGroup = useCallback(
    (id: string, name: string) =>
      change((current) => ({
        ...current,
        groups: current.groups.map((group) => (group.id === id ? { ...group, name } : group)),
      })),
    [change],
  );

  const addGroup = useCallback(() => {
    groupCounter += 1;
    change((current) => ({
      ...current,
      groups: [...current.groups, createGroup(`GROUP-${groupCounter}`, `Group ${groupCounter}`)],
    }));
  }, [change]);

  const setMasterGainDb = useCallback(
    (gainDb: number) =>
      change((current) => ({
        ...current,
        master: { ...current.master, gainDb: clampFaderDb(gainDb) },
      })),
    [change],
  );

  const toggleLimiter = useCallback(
    () =>
      change((current) => ({
        ...current,
        master: { ...current.master, limiter: !current.master.limiter },
      })),
    [change],
  );

  const setCeilingDb = useCallback(
    (ceilingDb: number) =>
      change((current) => ({
        ...current,
        master: { ...current.master, ceilingDb: Math.min(0, Math.max(-12, ceilingDb)) },
      })),
    [change],
  );

  /**
   * Hand the live monitor to this desk, or give it up.
   *
   * Called only by the route watcher in `StudioProviders`. It goes through `change()` like
   * every other desk edit, so it is one gain write per channel from the one place that
   * writes them — and it is logged, because "the mixer went quiet when I changed page" is
   * exactly the kind of correct-but-surprising behaviour that has to be explainable.
   */
  /** The desk's output switch. Silences this page, clips included. */
  const toggleMasterMute = useCallback(
    () =>
      change((current) => ({
        ...current,
        master: { ...current.master, muted: !current.master.muted },
      })),
    [change],
  );

  const setMonitorLive = useCallback(
    (monitorLive: boolean) => {
      if (stateRef.current.monitorLive === monitorLive) return;
      change((current) => ({ ...current, monitorLive }));
      logEvent(monitorLive ? 'live monitor: this desk' : 'live monitor: handed to the tone page');
    },
    [change, logEvent],
  );

  const clearSolos = useCallback(
    () =>
      change((current) => ({
        ...current,
        channels: current.channels.map((channel) => ({ ...channel, solo: false })),
        groups: current.groups.map((group) => ({ ...group, solo: false })),
      })),
    [change],
  );

  /**
   * A held 440 Hz tone straight into the master, on until it is switched off.
   *
   * A self-test, and it exists because this page cannot be debugged from a screenshot:
   * "silent" covers a suspended context, an output the OS moved, a device that never
   * attached, a channel with no source, a gate inside an insert and a group fader at
   * zero, and they need completely different fixes. The tone goes to `ctx.destination`
   * directly, so it deliberately **bypasses every channel, insert, pan, group, the
   * master fader and the limiter** — everything the desk could possibly do to a signal:
   *
   * - Heard → the engine, the master and the output are fine, and the fault is upstream
   *   of the master: a source, a rack or a routing.
   * - Not heard → nothing after the master works, and no strip setting can matter.
   *   Check the context state and which output Windows is using.
   *
   * **Held rather than a one-second beep**, and that is a lesson rather than a
   * preference: a beep that stops by design is indistinguishable from a signal that
   * arrives and dies, which is the exact ambiguity this control was added to remove. If
   * the tone stops while the button still says on, something really did stop it.
   *
   * It is attached to the **destination**, not to the master fader, and that matters for
   * more than purity: `rebuild()` disconnects the whole graph and builds a new one, so a
   * tone hung off `masterFader` would go silent the moment any strip changed its source or
   * its insert — a self-test that lies exactly when it is being used. The destination
   * outlives every rebuild.
   *
   * Ramped at both ends, because a square-edged sine is a click.
   */
  const toggleTestTone = useCallback(async () => {
    const running = testToneRef.current;
    if (running) {
      const at = running.ctx.currentTime;
      running.level.gain.cancelScheduledValues(at);
      running.level.gain.setValueAtTime(running.level.gain.value, at);
      running.level.gain.linearRampToValueAtTime(0, at + 0.03);
      running.osc.stop(at + 0.05);
      testToneRef.current = null;
      setIsTestTone(false);
      return;
    }

    const ctx = await ensureEngine();

    const at = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.frequency.value = 440;

    const level = ctx.createGain();
    level.gain.setValueAtTime(0, at);
    // −14 dBFS: audible on any output without being painful on headphones.
    level.gain.linearRampToValueAtTime(0.2, at + 0.03);

    osc.connect(level);
    level.connect(ctx.destination);
    osc.start(at);
    osc.onended = () => {
      try {
        osc.disconnect();
        level.disconnect();
      } catch {
        // Already gone.
      }
    };

    testToneRef.current = { ctx, osc, level };
    setIsTestTone(true);
    setNotice(
      'Test tone on: 440 Hz straight to the output, bypassing every channel, the master ' +
        'fader and the limiter. If you hear it, the engine and the output are fine and the ' +
        'silence is upstream. It stays on until you switch it off — if it stops by itself, ' +
        'something stopped the engine.',
    );
  }, [ensureEngine]);

  /**
   * List the output devices, so the mix can be pointed at one.
   *
   * This is not a luxury on Windows. A USB audio interface presents an *output* as well
   * as an input, and plugging one in often makes it the system default — so the browser's
   * audio goes out of the pedal's headphone socket while the player is listening to the
   * laptop's speakers, sees a healthy input meter, and hears nothing. The symptom is
   * indistinguishable from a broken mixer, and no amount of work inside the graph fixes
   * it. Bluetooth does the same thing on connect.
   */
  const refreshOutputs = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setOutputs(
        devices
          .filter((device) => device.kind === 'audiooutput' && device.deviceId !== 'communications')
          .map((device, index) => ({
            deviceId: device.deviceId,
            label: device.label || `Output ${index + 1}`,
          })),
      );
    } catch {
      // Enumeration refused; the picker stays empty and the default output is used.
    }
  }, []);

  /**
   * Send the mix to a specific output.
   *
   * `AudioContext.setSinkId` is Chrome 110+ and not in the DOM types yet, hence the cast.
   * A browser without it keeps the system default, which is why the failure path here is a
   * notice rather than an error: the mix is not broken, it is just going somewhere else.
   */
  const setOutputDevice = useCallback(
    async (deviceId: string) => {
      const ctx = await ensureEngine();
      const sinkable = ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> };
      if (typeof sinkable.setSinkId !== 'function') {
        setNotice('This browser cannot choose an audio output, so the system default is used.');
        return;
      }
      // Never with an empty string. "System default" is what the context already does, and
      // `setSinkId('')` is both pointless here and the shape of call that has crashed
      // Chromium renderers — a tab that dies takes the whole session with it, which is a
      // far worse outcome than not being able to re-select the default.
      if (!deviceId) {
        setActiveOutputId('');
        setNotice(
          'Left on the system default output. To move the sound, either pick a specific ' +
            'device here or change the default in the Windows sound settings.',
        );
        return;
      }
      try {
        await sinkable.setSinkId(deviceId);
        setActiveOutputId(deviceId);
      } catch (cause) {
        setError(
          cause instanceof Error
            ? `That output could not be opened (${cause.name}).`
            : 'That output could not be opened.',
        );
      }
    },
    [ensureEngine],
  );

  // ---------------------------------------------------------------- render ---

  /**
   * Render the mix offline, through the same graph description.
   *
   * Live channels are **skipped and named**, not silently dropped: there is nothing to
   * render for an input that only exists in real time, and a mix that quietly omits a
   * channel the player can hear is the worst kind of export. The rest is deterministic
   * and as fast as the CPU allows.
   */
  const renderMix = useCallback(async (): Promise<AudioBuffer | null> => {
    const current = stateRef.current;
    const duration = mixDuration(current);
    if (duration <= 0) {
      setError('There is nothing to render — put a take or a file on a channel first.');
      return null;
    }

    const audible = audibleChannelIds(current);
    const skipped = current.channels.filter(
      (channel) => isLiveChannel(channel) && audible.has(channel.id),
    );

    setStatus('rendering');
    setRenderRatio(0);
    try {
      const sampleRate = ctxRef.current?.sampleRate ?? 48000;
      const offline = new OfflineAudioContext({
        numberOfChannels: 2,
        length: Math.ceil(duration * sampleRate),
        sampleRate,
      });

      const hasWorklets = await loadMixWorklets(offline);
      const graph = buildMixGraph({
        ctx: offline,
        state: current,
        rig: rigRef.current,
        hasWorklets,
        destination: offline.destination,
      });

      for (const channel of current.channels) {
        if (channel.source.kind !== 'clip') continue;
        const buffer = buffersRef.current.get(channel.id);
        if (!buffer) continue;
        const placement = placeChannel(channel, 0);
        if (!placement) continue;
        const nodes = graph.channels.get(channel.id);
        if (!nodes) continue;

        const node = offline.createBufferSource();
        node.buffer = buffer;
        node.connect(nodes.input);
        node.start(
          placement.delaySec,
          placement.offsetSec,
          placement.durationSec ?? undefined,
        );
      }

      const rendered = await offline.startRendering();
      setRenderRatio(1);
      if (skipped.length > 0) {
        setNotice(
          `${skipped.length} live channel${skipped.length === 1 ? '' : 's'} ` +
            `(${skipped.map((channel) => channel.name).join(', ')}) ` +
            'could not be rendered — a live input exists only in real time. Record it on the ' +
            'recorder page and put the take on the channel.',
        );
      }
      return rendered;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The mix could not be rendered.');
      return null;
    } finally {
      setStatus('idle');
      setRenderRatio(null);
    }
  }, []);

  /** Channel data from a rendered buffer, for the encoders. */
  const channelData = (buffer: AudioBuffer): Float32Array[] => {
    const channels: Float32Array[] = [];
    for (let index = 0; index < buffer.numberOfChannels; index += 1) {
      channels.push(buffer.getChannelData(index));
    }
    return channels;
  };

  const exportWav = useCallback(async (): Promise<{ url: string; name: string } | null> => {
    const rendered = await renderMix();
    if (!rendered) return null;
    const blob = encodeWav(channelData(rendered), rendered.sampleRate);
    const url = URL.createObjectURL(blob);
    if (lastExportUrlRef.current) {
      try {
        URL.revokeObjectURL(lastExportUrlRef.current);
      } catch {
        // Ignore
      }
      urlsRef.current = urlsRef.current.filter((u) => u !== lastExportUrlRef.current);
    }
    lastExportUrlRef.current = url;
    urlsRef.current.push(url);
    return { url, name: `mix_${filenameStamp(Date.now())}.wav` };
  }, [renderMix]);

  const exportMp3 = useCallback(
    async (kbps = DEFAULT_MP3_KBPS): Promise<{ url: string; name: string } | null> => {
      const rendered = await renderMix();
      if (!rendered) return null;
      // Takes the buffer itself, not channel arrays: LAME wants the sample rate and
      // the channel count together, and reading them off the buffer is one source of
      // truth rather than three arguments to get out of step.
      const blob = await encodeMp3(rendered, kbps);
      const url = URL.createObjectURL(blob);
      if (lastExportUrlRef.current) {
        try {
          URL.revokeObjectURL(lastExportUrlRef.current);
        } catch {
          // Ignore
        }
        urlsRef.current = urlsRef.current.filter((u) => u !== lastExportUrlRef.current);
      }
      lastExportUrlRef.current = url;
      urlsRef.current.push(url);
      return { url, name: `mix_${filenameStamp(Date.now())}.mp3` };
    },
    [renderMix],
  );

  /** Peak of the rendered mix, for a headroom warning before anyone exports. */
  const measureMix = useCallback(async (): Promise<number | null> => {
    const rendered = await renderMix();
    if (!rendered) return null;
    return peakDbOf(channelData(rendered));
  }, [renderMix]);

  /** Waveform envelope of a channel's buffer, for its strip. */
  const channelPeaks = useCallback((id: string): number[] => {
    const buffer = buffersRef.current.get(id);
    if (!buffer) return [];
    return computePeaks(channelData(buffer), 240);
  }, []);

  // Release everything when the app unmounts.
  useEffect(() => {
    return () => {
      stopHealthRef.current();
      stopGestureRef.current();
      for (const node of runningRef.current) {
        try {
          node.stop();
        } catch {
          // Already stopped.
        }
      }
      try {
        testToneRef.current?.osc.stop();
      } catch {
        // Never started, or already stopped.
      }
      graphRef.current?.disconnect();
      leaseRef.current?.release();
      for (const url of urlsRef.current) URL.revokeObjectURL(url);
      urlsRef.current = [];
      lastAppliedStateRef.current = null;
      lastExportUrlRef.current = null;
      void ctxRef.current?.close();
      ctxRef.current = null;
      graphRef.current = null;
    };
  }, []);

  const duration = mixDuration(state);
  const soloActive =
    state.channels.some((channel) => channel.solo) || state.groups.some((group) => group.solo);

  return {
    state,
    status,
    error,
    notice,
    clearError: useCallback(() => setError(null), []),
    clearNotice: useCallback(() => setNotice(null), []),

    /** Mix length: the last channel to finish. Live channels do not extend it. */
    duration,
    isPlaying,
    isLive,
    /** Whole seconds. Anything needing the live value calls `getPlayhead`. */
    playhead,
    getPlayhead,
    play,
    pause,
    togglePlay,
    seek,

    /** Read a strip's meter inside an animation frame — never during render. */
    getMeter,
    /**
     * Where the signal is. Read inside an animation frame; the object is stable and
     * mutated in place, so it must never be compared or stored as state.
     */
    getDiagnostics: useCallback(() => diagnosticsRef.current, []),
    /** Envelope of a channel's buffer, for drawing its strip. */
    channelPeaks,
    /** Length of one channel's window, in seconds. */
    channelLength,

    selectedChannelId,
    setSelectedChannelId,
    addChannel,
    removeChannel,
    renameChannel,
    setChannelGain,
    setChannelTrim,
    /** Cross-page linking: one instrument's level/mute reaches its mixer channels. */
    channelsForInsert,
    setInsertLevel,
    setInsertEnabled,
    putLiveOnInsert,
    /**
     * The machine's two settings, shared with the recorder — see `lib/ampStore.ts`.
     *
     * Exposed from here as well so the desk can carry the same controls: a player who
     * found the buffer this laptop needs should not have to find it twice, and the mode
     * governs the desk's racks exactly as it governs the Rig page's.
     */
    bufferMs,
    changeBufferMs: setMonitorBufferMs,
    rigQuality,
    changeRigQuality: setRigQuality,
    /** The last few audio transitions, newest first. For when a silence needs explaining. */
    events,
    setChannelPan,
    toggleChannelMute,
    toggleChannelSolo,
    setChannelInsert,
    setChannelGroup,
    nudgeChannel,
    setChannelOffset,
    trimStart,
    trimEnd,
    loadTake,
    loadFile,
    takeLiveInput,
    clearChannel,

    addGroup,
    renameGroup,
    setGroupGainDb,
    setGroupPan,
    toggleGroupMute,
    toggleGroupSolo,

    setMasterGainDb,
    toggleMasterMute,
    toggleLimiter,
    setCeilingDb,
    setMonitorLive,
    /** True while anything is soloed, so the UI can offer one button to undo it. */
    soloActive,
    clearSolos,

    activeDeviceId,
    activeDeviceLabel,
    inputHealth,
    armInput,
    /** Output devices, and where the mix is going. See `setOutputDevice`. */
    outputs,
    activeOutputId,
    refreshOutputs,
    setOutputDevice,
    releaseInput,
    retryInput,

    /** A held 440 Hz tone into the master, to halve the search when nothing is heard. */
    toggleTestTone,
    isTestTone,

    renderRatio,
    renderMix,
    exportWav,
    exportMp3,
    measureMix,
  };
}

export type MixerApi = ReturnType<typeof useMixer>;
