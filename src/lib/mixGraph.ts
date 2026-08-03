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
 *   source → trim → Ø → HPF → [rack insert] → EQ → comp → delay → panner → fader ─┐
 *                                                                                 ├→ …
 *   another channel ──────────────────────────────────────────────────────────────┘
 *                                       … → group → master → limiter → out
 *
 * The strip's order is not arbitrary, and every position is a rule this codebase
 * already wrote down somewhere else:
 *
 * - **Ø and the low cut come before the insert.** Rumble into a rack's gain stages
 *   is amplified along with the note, which is the same argument that puts the
 *   amp's gate before its drive rather than after it.
 * - **The EQ comes after the insert.** A rack already carries tone shaping designed
 *   for its instrument; the channel EQ is corrective — the room, the mic, the seat
 *   in the mix — so it acts on what is actually leaving. Putting it first would
 *   make it a second tone stack fighting the first.
 * - **The compressor comes after the EQ**, because a compressor reacts to what it
 *   is fed. `drumFx` says the same thing about its own EQ, in the same words.
 * - **The alignment delay is last before the pan**, because it aligns the channel,
 *   not one stage of it.
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
} from './ampFx';
import {
  clampStrip,
  PEAK_Q,
  SHELF_Q,
  STRIP_RANGES,
  type ChannelStrip,
} from './channelStrip';
import { makeBypass } from './bypass';
import {
  audibleChannelIds,
  audibleGroupIds,
  channelGain,
  groupGain,
  masterGain,
  trimGain,
} from './mixer';
import { createRigChain, type RigChain, type RigSettings } from './rig';
import type { MixerState } from '../types/mixer';

/** One channel's nodes. The source is attached later, per run. */
/**
 * One channel strip's nodes, in signal order.
 *
 * All of them always exist. "Off" is a neutral setting, never a disconnection:
 * polarity at +1, the low cut at its lowest corner, the EQ flat, the compressor at
 * ratio 1, the delay at zero. Same rule the amp's stages follow — neutralised in
 * place, so a switch is a parameter write and never a rebuild.
 */
export interface StripNodes {
  /** Polarity: a gain of +1 or -1. */
  invert: GainNode;
  hpf: BiquadFilterNode;
  low: BiquadFilterNode;
  lowMid: BiquadFilterNode;
  highMid: BiquadFilterNode;
  high: BiquadFilterNode;
  comp: DynamicsCompressorNode;
  delay: DelayNode;
}

export interface ChannelNodes {
  id: string;
  /**
   * Take this strip's insert out of the graph, or put it back. Null when it has none.
   *
   * A rack that is merely turned down still runs: Web Audio computes a node because it has
   * a path to `destination`, not because it is audible. The Rig page learned that twice in
   * one day — once for its monitor bus and once for its six channels — and a muted strip
   * carrying a rig chain is the same mistake on a desk with eight of them.
   *
   * Driven from `useMixer`, not from `applyMixState`, because it has to be ordered against
   * the fader ramp: connect before the level comes up, and wait for the level to reach zero
   * before disconnecting, or the strip clicks.
   */
  rackBypass: ((inPath: boolean) => void) | null;
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
  /**
   * The channel strip's nodes, always built.
   *
   * Unconditional, unlike the rack — and that is what makes `stripNeedsRebuild()`
   * able to return a constant. If these appeared when a control left its default,
   * the first turn of an EQ knob would be a graph rebuild, which is a click on a
   * live channel. Five biquads, a native compressor and a delay line cost almost
   * nothing next to one rack; the rack is the thing worth building lazily.
   */
  strip: StripNodes;
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
  limiter: MasterLimiter | null;
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

/** The master limiter: one worklet, its two parameters, and nothing else. */
interface MasterLimiter {
  readonly input: AudioNode;
  readonly output: AudioNode;
  update(ceilingDb: number): void;
  disconnect(): void;
}

/**
 * A limiter, rather than a whole amp chain configured to behave like one.
 *
 * This used to be `createAmpChain` with everything switched off, and the comment above it
 * claimed the result was "a DC blocker, the limiter and two gains". It was not. The rule
 * that chain is built on — stated in `lib/ampGraph.ts` — is that **a disabled stage is
 * neutralised in place, not removed**: switching the cabinet off swaps in a parallel bypass
 * gain, switching the drive off installs a null curve, switching the gate off writes 0 to a
 * parameter. Every node stays wired and every node still runs.
 *
 * So the desk was carrying a full guitar amplifier on its master bus — a gate worklet,
 * three waveshapers at 4x oversampling, two cabinet convolvers, a reverb convolver, nine
 * biquads and a delay line — every quantum, before a single channel was open, to obtain one
 * look-ahead limiter. On the machine this was written for that is about one and a half rig
 * chains of overhead, and it is most of why the desk broke up on fewer channels than the
 * Rig page did.
 *
 * The reason the old version existed is still respected and is worth restating, because it
 * is easy to read this change as undoing it: the master limiter must **never** inherit the
 * player's amp settings. Spreading those would put the guitar's input trim, output trim and
 * tone stack across the whole mix — the default amp alone is +2 dB bass and +2 dB treble —
 * and dialling the amp would change the master. That rule was about not borrowing the
 * guitar's *values*. It never required borrowing its *signal path*, and a limiter that owns
 * nothing but a ceiling cannot inherit anything at all.
 *
 * The processor is the same one, from the same module, already loaded on this page: written,
 * measured, and 2.5x faster than the version it replaced.
 */
function createMasterLimiter(ctx: BaseAudioContext, ceilingDb: number): MasterLimiter {
  const node = new AudioWorkletNode(ctx, 'limiter-processor', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  });

  const ceiling = node.parameters.get('ceiling');
  const enabled = node.parameters.get('enabled');
  // Always on as a processor; the desk's own switch is the wet/dry pair around it, so a
  // bypass stays a gain change rather than a rewire.
  if (enabled) enabled.value = 1;
  if (ceiling) ceiling.value = ceilingDb;

  return {
    input: node,
    output: node,
    update(nextCeilingDb: number) {
      if (ceiling) ceiling.value = nextCeilingDb;
    },
    disconnect() {
      node.port.onmessage = null;
      try {
        node.disconnect();
      } catch {
        // Already detached, or the context has gone.
      }
    },
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

/**
 * Build one channel strip and wire it end to end. Returns its head and tail.
 *
 * The nodes are created flat and connected in signal order here rather than in the
 * channel loop, so the order is readable in one place and the loop stays about
 * routing. Nothing is conditional: see `StripNodes`.
 */
function buildStrip(ctx: BaseAudioContext): {
  nodes: StripNodes;
  head: AudioNode;
  tail: AudioNode;
} {
  const invert = ctx.createGain();

  const hpf = ctx.createBiquadFilter();
  hpf.type = 'highpass';
  hpf.Q.value = SHELF_Q;

  const low = ctx.createBiquadFilter();
  low.type = 'lowshelf';
  low.frequency.value = 120;
  low.Q.value = SHELF_Q;

  const lowMid = ctx.createBiquadFilter();
  lowMid.type = 'peaking';
  lowMid.Q.value = PEAK_Q;

  const highMid = ctx.createBiquadFilter();
  highMid.type = 'peaking';
  highMid.Q.value = PEAK_Q;

  const high = ctx.createBiquadFilter();
  high.type = 'highshelf';
  high.frequency.value = 8000;
  high.Q.value = SHELF_Q;

  const comp = ctx.createDynamicsCompressor();
  // Knee 0: the strip's compressor is a corrective tool and a soft knee makes the
  // ratio a lie near the threshold. The racks keep their own, gentler behaviour.
  comp.knee.value = 0;

  // Sized from the range, not from the value — `maxDelayTime` is fixed for a node's
  // life, so a delay built at the current setting could never be turned up.
  const delay = ctx.createDelay(STRIP_RANGES.delayMs[1] / 1000);

  invert.connect(hpf);
  hpf.connect(low);
  low.connect(lowMid);
  lowMid.connect(highMid);
  highMid.connect(high);

  return {
    nodes: { invert, hpf, low, lowMid, highMid, high, comp, delay },
    head: invert,
    tail: high,
  };
}

/**
 * Write a strip's settings onto its nodes.
 *
 * Every one is an `AudioParam` or a settable enum, which is what `stripNeedsRebuild`
 * promises. Ramped like every other level in this file, except the two that must
 * not be: see below.
 */
export function applyStrip(
  nodes: StripNodes,
  raw: ChannelStrip,
  at: number,
  rampSec: number,
): void {
  const strip = clampStrip(raw);

  // Polarity is a sign, not a level. Ramping it sweeps the channel through zero —
  // audible as a dip on every flip — so it is set outright.
  nodes.invert.gain.value = strip.invert ? -1 : 1;

  // "Off" is the lowest corner the range allows rather than a disconnection, so the
  // switch is a parameter write like everything else here.
  nodes.hpf.frequency.setTargetAtTime(
    strip.hpf.enabled ? strip.hpf.hz : STRIP_RANGES.hpfHz[0],
    at,
    rampSec,
  );

  nodes.low.gain.setTargetAtTime(strip.eq.lowDb, at, rampSec);
  nodes.lowMid.frequency.setTargetAtTime(strip.eq.lowMidHz, at, rampSec);
  nodes.lowMid.gain.setTargetAtTime(strip.eq.lowMidDb, at, rampSec);
  nodes.highMid.frequency.setTargetAtTime(strip.eq.highMidHz, at, rampSec);
  nodes.highMid.gain.setTargetAtTime(strip.eq.highMidDb, at, rampSec);
  nodes.high.gain.setTargetAtTime(strip.eq.highDb, at, rampSec);

  // Ratio 1 is a mathematical no-op, so a disabled compressor stays in the path
  // doing nothing — the same trick the amp's compressor uses.
  nodes.comp.threshold.setTargetAtTime(strip.comp.thresholdDb, at, rampSec);
  nodes.comp.ratio.setTargetAtTime(strip.comp.enabled ? strip.comp.ratio : 1, at, rampSec);
  nodes.comp.attack.setTargetAtTime(strip.comp.attack, at, rampSec);
  nodes.comp.release.setTargetAtTime(strip.comp.release, at, rampSec);

  // Not ramped either. A sliding delay line is a pitch shift — that is what a
  // flanger is — and this exists to align microphones, not to sweep them.
  nodes.delay.delayTime.value = strip.delayMs / 1000;
}

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

  let limiter: MasterLimiter | null = null;
  if (hasWorklets) {
    try {
      limiter = createMasterLimiter(ctx, state.master.ceilingDb);
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

    // The strip sits between the trim and the insert on its front half, and
    // between the insert and the panner on its back half — see the chain at the
    // top of this file for why each stage is where it is.
    const strip = buildStrip(ctx);
    trim.connect(strip.head);

    let rack: RigChain | null = null;
    // No source, no rack. A rig chain is the most expensive thing in this app — a
    // convolver plus two AudioWorklet processors each — and the starting desk names six
    // of them on eight channels that are playing nothing at all. Building them for
    // silence cost a full rebuild's worth of nodes every time any channel changed, and
    // the processors outlive `disconnect()` until GC gets to them, so repeated rebuilds
    // piled live worklets onto the audio thread. `needsRebuild` treats a source-kind
    // change as a rebuild, so a channel gets its rack the moment it has something to
    // put through it.
    let rackBypass: ((inPath: boolean) => void) | null = null;
    if (channel.insert !== null && channel.source.kind !== 'empty') {
      try {
        rack = createRigChain(ctx, channel.insert, rig);
        strip.tail.connect(rack.input);
        rack.output.connect(strip.nodes.comp);
        rackBypass = makeBypass(strip.tail, rack, strip.nodes.comp);
      } catch {
        // A rack that will not build (its worklets, on a browser that refuses them)
        // must not take the channel with it: pass the signal through clean.
        rack = null;
      }
    }
    if (rack === null) strip.tail.connect(strip.nodes.comp);
    strip.nodes.comp.connect(strip.nodes.delay);
    strip.nodes.delay.connect(panner);

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
      rackBypass,
      strip: strip.nodes,
      panner,
      fader,
      analyser: channelAnalyser,
      timeDomain: new Float32Array(channelAnalyser.fftSize),
      groupId: target ? channel.groupId : null,
    });

    // Applied at build time, not left to the next state change: a rebuild that
    // returned a flat strip would silently undo the player's EQ until they touched
    // something, which is the hole `lastAppliedStateRef` was added to close on the
    // other side.
    applyStrip(strip.nodes, channel.strip, ctx.currentTime, 0);
  }

  const disconnect = () => {
    for (const nodes of channels.values()) {
      try {
        nodes.trim.disconnect();
        nodes.inputAnalyser.disconnect();
        // Every strip node, not just the ends: `disconnect()` clears a node's own
        // outputs, so anything left out here stays wired into a graph that has
        // been thrown away. Cheap nodes accumulate too.
        for (const node of Object.values(nodes.strip)) node.disconnect();
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
    applyStrip(nodes.strip, channel.strip, at, rampSec);
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
  graph.limiter?.update(state.master.ceilingDb);
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
