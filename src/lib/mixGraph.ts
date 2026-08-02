/**
 * The desk, as Web Audio nodes. One builder, two contexts.
 *
 * `BaseAudioContext`, not `AudioContext`, because this same function has to build the
 * live monitor path and the offline render. That is not tidiness — it is the only way
 * the two can be guaranteed to agree. A node belongs to one context for life, so the
 * offline render cannot borrow the live graph; if it built its own arrangement by
 * hand, "the mix I heard" and "the file I got" would be two implementations of the
 * same idea, and they would drift the first time a strip gained a control. Everything
 * that shapes the sound is described here once and instantiated twice.
 *
 * Per channel:
 *
 *   source → trim → [rack insert] → panner → fader ─┐
 *                                                   ├→ group → master → limiter → out
 *   another channel ────────────────────────────────┘
 *
 * The trim comes **before** the insert and the fader after it, which is the whole
 * reason a strip has two level controls: the trim decides how hard the rack is driven,
 * the fader decides how loud the result sits. One control doing both would make turning
 * a channel up also change its tone.
 *
 * Five decisions worth keeping:
 *
 * - **The fader is the only place a channel's level is written**, and its value is
 *   `fader × (audible ? 1 : 0)` from `lib/mixer.ts`. Mute, solo and the fader
 *   multiply into that one `AudioParam`; two effects writing it fight over it, which
 *   on this page would mean a mute that a fader move silently undoes.
 * - **Pan is a `StereoPannerNode`.** Its law is specified, equal-power and
 *   automatable, and a hand-rolled splitter/merger pair would be three more nodes per
 *   channel to get subtly wrong. `panGains` exists for the meters, not for the graph.
 * - **The insert is a real rack** — `createRigChain`, the same six chains the
 *   recorder monitors through, cabinet and all. A "simpler mixer EQ" would be the
 *   second tone chain this project has already deleted once.
 * - **The limiter lives on the master only.** It is the one bus that sees the whole
 *   sum, and it is a worklet processor, so it is also the one thing here that can
 *   fail to load — hence nullable, and reported rather than thrown.
 */

import {
  AMP_WORKLET_URL,
  createAmpChain,
  DEFAULT_AMP,
  type AmpChain,
  type AmpSettings,
} from './ampFx';
import {
  audibleChannelIds,
  audibleGroupIds,
  channelGain,
  faderGain,
  groupGain,
  masterGain,
  trimGain,
} from './mixer';
import { createRigChain, type RigChain, type RigSettings } from './rig';
import type { MixerState } from '../types/mixer';

/** One channel's nodes. The source is attached later, per run. */
export interface ChannelNodes {
  id: string;
  /**
   * Where a source connects: always the trim, which is the first thing in the strip.
   *
   * Fixed rather than "the insert, or the panner when there is none", so attaching a
   * source never has to know what the strip contains — and so a rack switched on later
   * does not need every source re-pointed at a different node.
   */
  input: AudioNode;
  /** Input trim, before the insert. This is the GAIN knob. */
  trim: GainNode;
  /**
   * Pre-insert tap, so a strip can show what is *arriving* as well as what is leaving.
   *
   * The difference between the two meters is a diagnosis: signal here and nothing at the
   * fader means the strip ate it (a gate in the rack, a mute, a group at zero); nothing
   * here means the source never reached the channel at all. Without it, "silent" is one
   * symptom with a dozen causes.
   */
  inputAnalyser: AnalyserNode;
  inputTimeDomain: Float32Array<ArrayBuffer>;
  /** The rack, when one is inserted. Kept so a settings change can reach it. */
  rack: RigChain | null;
  panner: StereoPannerNode;
  fader: GainNode;
  /** Post-fader tap for this strip's meter. Analyser, not a script node. */
  analyser: AnalyserNode;
  /** Scratch buffer for the meter, allocated once. */
  timeDomain: Float32Array<ArrayBuffer>;
  /** Which group's fader this channel is connected to, so a reroute can undo it. */
  groupId: string | null;
}

export interface GroupNodes {
  id: string;
  panner: StereoPannerNode;
  fader: GainNode;
  analyser: AnalyserNode;
  timeDomain: Float32Array<ArrayBuffer>;
}

export interface MixGraph {
  ctx: BaseAudioContext;
  channels: Map<string, ChannelNodes>;
  groups: Map<string, GroupNodes>;
  /** Where channels with no group, and every group, arrive. */
  masterFader: GainNode;
  /** The master limiter, or null when its worklet could not be loaded. */
  limiter: AmpChain | null;
  /** Wet/dry pair straddling the limiter, so bypass is a gain change not a rewire. */
  limiterWet: GainNode;
  limiterDry: GainNode;
  /** Master meter tap, after everything. */
  analyser: AnalyserNode;
  timeDomain: Float32Array<ArrayBuffer>;
  analyserL: AnalyserNode;
  analyserR: AnalyserNode;
  timeDomainL: Float32Array<ArrayBuffer>;
  timeDomainR: Float32Array<ArrayBuffer>;
  disconnect: () => void;
}

/** Meter window. 2048 at 48 k is ~43 ms — long enough to be steady, short enough to move. */
const METER_FFT = 2048;

/**
 * The master limiter is the amp chain with everything except the limiter switched off.
 *
 * Rather than a second implementation of look-ahead limiting: that worklet is written,
 * measured (13 checks, 2.5× faster than the version it replaced) and already loaded on
 * this page. Everything else in the chain is bypassed, so the signal path is a DC
 * blocker, the limiter and two gains.
 *
 * Built from `DEFAULT_AMP`, **not** from the user's amp settings, and that is
 * load-bearing. Spreading the live settings would put the guitar's input trim, its
 * output trim and its tone stack on the master bus — the default amp is +2 dB bass and
 * +2 dB treble, so every mix would come out EQ'd by whatever the guitarist had dialled,
 * and dialling the amp would change the master. The three neutralisations below are
 * explicit for the same reason: `enabled: false` covers the blocks that have a switch,
 * and the trims and the tone stack do not have one.
 */
function masterLimiterSettings(ceilingDb: number): AmpSettings {
  return {
    ...DEFAULT_AMP,
    inputDb: 0,
    outputDb: 0,
    tone: { ...DEFAULT_AMP.tone, bassDb: 0, midDb: 0, trebleDb: 0 },
    gate: { ...DEFAULT_AMP.gate, enabled: false },
    comp: { ...DEFAULT_AMP.comp, enabled: false },
    drive: { ...DEFAULT_AMP.drive, enabled: false },
    cab: { ...DEFAULT_AMP.cab, enabled: false },
    delay: { ...DEFAULT_AMP.delay, enabled: false },
    reverb: { ...DEFAULT_AMP.reverb, enabled: false },
    limiter: { enabled: true, ceilingDb },
  };
}

/**
 * Load the worklet module the master limiter needs.
 *
 * Separate from `buildMixGraph` because a module load is asynchronous and graph
 * construction must not be: an offline render builds its graph inside a function that
 * is already awaiting the module, and the live path loads it once at arm time.
 * Callers that skip this get a graph with `limiter: null`, which is a working desk
 * with the limiter switch greyed out rather than a page that failed to open.
 */
export async function loadMixWorklets(ctx: BaseAudioContext): Promise<boolean> {
  if (!ctx.audioWorklet) return false;
  try {
    await ctx.audioWorklet.addModule(AMP_WORKLET_URL);
    return true;
  } catch {
    return false;
  }
}

export interface BuildOptions {
  ctx: BaseAudioContext;
  state: MixerState;
  rig: RigSettings;
  /** False when `loadMixWorklets` failed, so no worklet node is constructed. */
  hasWorklets: boolean;
  /** Where the master ends up. The live destination, or the offline one. */
  destination: AudioNode;
}

/**
 * Build the whole desk.
 *
 * Deliberately builds **every** channel, including inaudible ones, and sets their
 * gain to zero instead of leaving them out. Two reasons: a mute has to be able to
 * come back instantly and without a click, and a graph whose shape depends on the
 * mute state has to be rebuilt every time one is pressed — which is the design this
 * project already replaced once, on the recorder's six parallel racks.
 */
export function buildMixGraph({
  ctx,
  state,
  rig,
  hasWorklets,
  destination,
}: BuildOptions): MixGraph {
  const audible = audibleChannelIds(state);
  const passing = audibleGroupIds(state, audible);

  // ---- Master, built first so everything downstream has somewhere to arrive ----
  const masterFader = ctx.createGain();
  masterFader.gain.value = masterGain(state.master);

  const limiterWet = ctx.createGain();
  const limiterDry = ctx.createGain();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = METER_FFT;
  analyser.smoothingTimeConstant = 0;

  const splitter = ctx.createChannelSplitter(2);
  const analyserL = ctx.createAnalyser();
  analyserL.fftSize = METER_FFT;
  analyserL.smoothingTimeConstant = 0;

  const analyserR = ctx.createAnalyser();
  analyserR.fftSize = METER_FFT;
  analyserR.smoothingTimeConstant = 0;

  let limiter: AmpChain | null = null;
  if (hasWorklets) {
    try {
      limiter = createAmpChain(ctx, masterLimiterSettings(state.master.ceilingDb));
      masterFader.connect(limiter.input);
      limiter.output.connect(limiterWet);
    } catch {
      // Reported by the caller through `notice`, not thrown: a desk with no limiter
      // still mixes, and losing the page over a safety net is worse than mixing
      // without one.
      limiter = null;
    }
  }

  const wet = limiter !== null && state.master.limiter;
  limiterWet.gain.value = wet ? 1 : 0;
  limiterDry.gain.value = wet ? 0 : 1;
  masterFader.connect(limiterDry);

  // Connect to the legacy mono analyser
  limiterWet.connect(analyser);
  limiterDry.connect(analyser);

  // Connect to L/R splitter
  limiterWet.connect(splitter);
  limiterDry.connect(splitter);
  splitter.connect(analyserL, 0);
  splitter.connect(analyserR, 1);

  // Connect direct outputs to destination
  limiterWet.connect(destination);
  limiterDry.connect(destination);

  // ---- Subgroups --------------------------------------------------------------
  const groups = new Map<string, GroupNodes>();
  for (const group of state.groups) {
    const panner = ctx.createStereoPanner();
    panner.pan.value = group.pan;

    const fader = ctx.createGain();
    fader.gain.value = groupGain(group, passing);

    const groupAnalyser = ctx.createAnalyser();
    groupAnalyser.fftSize = METER_FFT;
    groupAnalyser.smoothingTimeConstant = 0;

    panner.connect(fader);
    fader.connect(groupAnalyser);
    groupAnalyser.connect(masterFader);

    groups.set(group.id, {
      id: group.id,
      panner,
      fader,
      analyser: groupAnalyser,
      timeDomain: new Float32Array(groupAnalyser.fftSize),
    });
  }

  // ---- Channels ---------------------------------------------------------------
  const channels = new Map<string, ChannelNodes>();
  for (const channel of state.channels) {
    const panner = ctx.createStereoPanner();
    panner.pan.value = channel.pan;

    const fader = ctx.createGain();
    fader.gain.value = channelGain(channel, audible);

    const channelAnalyser = ctx.createAnalyser();
    channelAnalyser.fftSize = METER_FFT;
    channelAnalyser.smoothingTimeConstant = 0;

    // The trim is the head of every strip, whatever else it contains, so a source is
    // always attached to the same node and gain staging happens before the rack.
    const trim = ctx.createGain();
    trim.gain.value = trimGain(channel.trimDb);

    const inputAnalyser = ctx.createAnalyser();
    inputAnalyser.fftSize = METER_FFT;
    inputAnalyser.smoothingTimeConstant = 0;
    trim.connect(inputAnalyser);

    let rack: RigChain | null = null;
    // No source, no rack. A rig chain is the most expensive thing in this app — a
    // convolver plus two AudioWorklet processors each — and the starting desk names six
    // of them on eight channels that are playing nothing at all. Building them for
    // silence cost a full rebuild's worth of nodes every time any channel changed, and
    // the processors outlive `disconnect()` until GC gets to them, so repeated rebuilds
    // piled live worklets onto the audio thread. `needsRebuild` treats a source-kind
    // change as a rebuild, so a channel gets its rack the moment it has something to
    // put through it.
    if (channel.insert !== null && channel.source.kind !== 'empty') {
      try {
        rack = createRigChain(ctx, channel.insert, rig);
        trim.connect(rack.input);
        rack.output.connect(panner);
      } catch {
        // A rack that will not build (its worklets, on a browser that refuses them)
        // must not take the channel with it: pass the signal through clean.
        rack = null;
      }
    }
    if (rack === null) trim.connect(panner);

    panner.connect(fader);
    fader.connect(channelAnalyser);

    const target = channel.groupId === null ? null : groups.get(channel.groupId);
    // A channel naming a group that no longer exists goes straight to master rather
    // than nowhere. Losing a routing is a mistake; losing the audio is a bug.
    channelAnalyser.connect(target ? target.panner : masterFader);

    channels.set(channel.id, {
      id: channel.id,
      input: trim,
      trim,
      inputAnalyser,
      inputTimeDomain: new Float32Array(inputAnalyser.fftSize),
      rack,
      panner,
      fader,
      analyser: channelAnalyser,
      timeDomain: new Float32Array(channelAnalyser.fftSize),
      groupId: target ? channel.groupId : null,
    });
  }

  const disconnect = () => {
    for (const nodes of channels.values()) {
      try {
        nodes.trim.disconnect();
        nodes.inputAnalyser.disconnect();
        nodes.rack?.disconnect();
        nodes.panner.disconnect();
        nodes.fader.disconnect();
        nodes.analyser.disconnect();
      } catch {
        // Disposal races are harmless; the graph is going away regardless.
      }
    }
    for (const nodes of groups.values()) {
      try {
        nodes.panner.disconnect();
        nodes.fader.disconnect();
        nodes.analyser.disconnect();
      } catch {
        // As above.
      }
    }
    try {
      limiter?.disconnect();
      limiterWet.disconnect();
      limiterDry.disconnect();
      masterFader.disconnect();
      analyser.disconnect();
      analyserL.disconnect();
      analyserR.disconnect();
      splitter.disconnect();
    } catch {
      // As above.
    }
  };

  return {
    ctx,
    channels,
    groups,
    masterFader,
    limiter,
    limiterWet,
    limiterDry,
    analyser,
    timeDomain: new Float32Array(analyser.fftSize),
    analyserL,
    analyserR,
    timeDomainL: new Float32Array(analyserL.fftSize),
    timeDomainR: new Float32Array(analyserR.fftSize),
    disconnect,
  };
}

/**
 * Push the whole state into an existing graph.
 *
 * Every gain and pan, every time, from one place — the same shape as the rigs'
 * `update(rig)`: a caller that changed one fader does not have to know which nodes
 * that touches, and a caller that changed five is one call rather than five. Ramped
 * rather than stepped, because a fader dragged at 60 fps writing `.value` directly is
 * a click per frame.
 *
 * The graph is **not** rebuilt for a mute, a solo or a reroute of level; only a
 * change of insert or of group membership needs new nodes, and those are the two
 * cases the caller has to rebuild for.
 */
export function applyMixState(
  graph: MixGraph,
  state: MixerState,
  rig: RigSettings,
  rampSec = 0.02,
): void {
  const at = graph.ctx.currentTime;
  const audible = audibleChannelIds(state);
  const passing = audibleGroupIds(state, audible);

  for (const channel of state.channels) {
    const nodes = graph.channels.get(channel.id);
    if (!nodes) continue;
    nodes.trim.gain.setTargetAtTime(trimGain(channel.trimDb), at, rampSec);
    nodes.fader.gain.setTargetAtTime(channelGain(channel, audible), at, rampSec);
    nodes.panner.pan.setTargetAtTime(channel.pan, at, rampSec);
    nodes.rack?.update(rig);
  }

  for (const group of state.groups) {
    const nodes = graph.groups.get(group.id);
    if (!nodes) continue;
    nodes.fader.gain.setTargetAtTime(groupGain(group, passing), at, rampSec);
    nodes.panner.pan.setTargetAtTime(group.pan, at, rampSec);
  }

  graph.masterFader.gain.setTargetAtTime(masterGain(state.master), at, rampSec);

  const wet = graph.limiter !== null && state.master.limiter;
  graph.limiterWet.gain.setTargetAtTime(wet ? 1 : 0, at, rampSec);
  graph.limiterDry.gain.setTargetAtTime(wet ? 0 : 1, at, rampSec);
  graph.limiter?.update(masterLimiterSettings(state.master.ceilingDb));
}

/** Peak of one meter tap, 0..1. Read inside an animation frame, never in render. */
export function readMeter(analyser: AnalyserNode, buffer: Float32Array<ArrayBuffer>): number {
  analyser.getFloatTimeDomainData(buffer);
  let peak = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    const magnitude = Math.abs(buffer[i]);
    if (magnitude > peak) peak = magnitude;
  }
  return peak;
}
