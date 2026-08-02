/**
 * The amp, described as a graph.
 *
 * Pure: takes `AmpSettings`, returns nodes and edges with geometry. No Web Audio,
 * no DOM, so it compiles and runs under plain Node like the rest of `lib/`.
 *
 * ---------------------------------------------------------------------------
 * Two things about `createAmpChain`'s topology that a list of controls cannot
 * show, and that this board exists to show:
 *
 *     in -> gate -> comp -> tone -> drive -> cab
 *     cab -+-> dry -----------------> out trim -> limiter -> out
 *          +-> delay <-> feedback --->
 *          +-> reverb --------------->
 *
 * 1. **The tone stack is before the drive.** EQ after distortion only filters
 *    harmonics that already exist; EQ before it decides which ones get generated.
 *    Anyone reaching for the bass knob to fix a muddy high-gain sound needs to see
 *    that the knob is upstream of the thing making the mud.
 * 2. **The output trim is before the limiter, and the limiter is last.** That is
 *    what makes "turn it up" a guarantee rather than a hope, and it is invisible in
 *    a rack where Output and Ceiling sit side by side in the same block.
 *
 * Delay and reverb are **parallel sends off the cabinet**, not stages in series, so
 * switching them off never interrupts the dry path.
 * ---------------------------------------------------------------------------
 *
 * A disabled stage here is **neutralised in place, not removed** — the gate's
 * `enabled` param goes to 0, the compressor to ratio 1, the drive stages to a null
 * curve, the cabinet to a parallel bypass gain. Only the delay and reverb *sends*
 * reach zero gain. `inPath` and `active` carry that distinction; see
 * `SignalNode` in `lib/board.ts`.
 */

// Relative, not aliased: this module is pure, so it can be compiled with
// `npx tsc --outDir <tmp> --module commonjs` and checked from plain Node — which
// `@/` paths break, because nothing rewrites them in the emitted `require`.
import type { AmpSettings } from './ampFx';
import {
  bottomPort,
  topPort,
  verticalWirePath,
  type NodeBox,
  type Point,
  type SignalEdge,
  type SignalGraph,
  type SignalNode,
} from './board';
import { cabinetById } from './cabinet';

export type AmpNodeId =
  | 'gate'
  | 'comp'
  | 'tone'
  | 'drive'
  | 'cab'
  | 'dry'
  | 'delay'
  | 'reverb'
  | 'out'
  | 'limiter';

export type AmpNode = SignalNode<AmpNodeId>;
export type AmpEdge = SignalEdge<AmpNodeId>;
export type AmpGraph = SignalGraph<AmpNodeId>;

/* --------------------------------------------------------------------------
   Geometry. Vertical and 240px wide: this draws in the jam page's rack rail,
   which is 256px on desktop and a bottom sheet on a phone. A left-to-right board
   would need horizontal scrolling in both.

   Rows are shorter than the FX board's because there are eight of them rather
   than five. A board tall enough to need scrolling stops being a map.
-------------------------------------------------------------------------- */

const W = 240;
const SERIAL_W = 132;
const BRANCH_W = 72;
const BRANCH_GAP = 12;
const ROW_H = 30;
const BRANCH_H = 38;
/** Vertical distance between the top edges of consecutive rows. */
const ROW_STEP = 44;

const SERIAL_X = (W - SERIAL_W) / 2;

function serialBox(row: number): NodeBox {
  return { x: SERIAL_X, y: row * ROW_STEP, w: SERIAL_W, h: ROW_H };
}

function branchBox(column: number, row: number): NodeBox {
  return {
    x: column * (BRANCH_W + BRANCH_GAP),
    y: row * ROW_STEP,
    w: BRANCH_W,
    h: BRANCH_H,
  };
}

/** dB reading with an explicit sign, the way a console prints it. */
function db(value: number): string {
  return `${value > 0 ? '+' : ''}${value}dB`;
}

/**
 * The tone stack's readout: the band furthest from flat.
 *
 * Three numbers do not fit in 132px, and showing one arbitrary band would
 * describe the EQ wrongly whenever another band is doing more. Flat reads as no
 * value at all rather than a misleading "0".
 */
function toneReadout(tone: AmpSettings['tone']): string | null {
  const bands = [tone.bassDb, tone.midDb, tone.trebleDb];
  const peak = bands.reduce((worst, value) => (Math.abs(value) > Math.abs(worst) ? value : worst), 0);
  return peak === 0 ? null : db(peak);
}

/** Whether a send is audible: switched on *and* mixed in above zero. */
function sendLive(enabled: boolean, mix: number): boolean {
  return enabled && mix > 0;
}

/** Describe the amp for the current settings. */
export function ampGraph(amp: AmpSettings): AmpGraph {
  const delayLive = sendLive(amp.delay.enabled, amp.delay.mix);
  const reverbLive = sendLive(amp.reverb.enabled, amp.reverb.mix);
  // Stages are cascaded waveshapers with a null curve when unused, so "driving"
  // needs a stage count AND an amount. Either at zero is a true bypass.
  const driveLive = amp.drive.enabled && amp.drive.amount > 0 && amp.drive.stages > 0;

  const boxes: Record<AmpNodeId, NodeBox> = {
    gate: serialBox(0),
    comp: serialBox(1),
    tone: serialBox(2),
    drive: serialBox(3),
    cab: serialBox(4),
    dry: branchBox(0, 5),
    delay: branchBox(1, 5),
    reverb: branchBox(2, 5),
    out: serialBox(6),
    limiter: serialBox(7),
  };

  const nodes: AmpNode[] = [
    {
      id: 'gate',
      label: 'Gate',
      readout: amp.gate.enabled ? `${amp.gate.thresholdDb}dB` : null,
      inPath: true,
      active: amp.gate.enabled,
      toggleable: true,
      hint: 'Hysteresis gate, before the gain stages — after them it would be gating a noise floor already amplified by 40 dB.',
      box: boxes.gate,
    },
    {
      id: 'comp',
      label: 'Comp',
      readout: amp.comp.enabled ? `${amp.comp.ratio}:1` : null,
      inPath: true,
      active: amp.comp.enabled,
      toggleable: true,
      hint: 'Switched off it stays in the path at ratio 1 — a mathematical no-op.',
      box: boxes.comp,
    },
    {
      id: 'tone',
      label: 'Tone stack',
      readout: toneReadout(amp.tone),
      inPath: true,
      // No enable flag: three filters at 0 dB are already a bypass, so the board
      // shows it inert rather than offering a switch that changes nothing.
      active: amp.tone.bassDb !== 0 || amp.tone.midDb !== 0 || amp.tone.trebleDb !== 0,
      toggleable: false,
      hint: 'Bass, mid and treble — BEFORE the drive, as in a real amp. This position is most of why an amp sim sounds like an amp.',
      box: boxes.tone,
    },
    {
      id: 'drive',
      label: 'Drive',
      readout: driveLive ? `${amp.drive.stages}× ${Math.round(amp.drive.amount * 100)}%` : null,
      inPath: true,
      active: driveLive,
      toggleable: true,
      hint: 'Up to three cascaded valve stages with a lowpass and a DC blocker between them. That cascade is what separates an amp from a fuzz.',
      box: boxes.drive,
    },
    {
      id: 'cab',
      label: 'Cabinet',
      readout: amp.cab.enabled ? cabinetById(amp.cab.model).label : null,
      // Bypass is a parallel gain around the two convolvers, not a disconnection:
      // an empty ConvolverNode outputs silence, so emptying it would mute the amp.
      inPath: true,
      active: amp.cab.enabled,
      toggleable: true,
      hint: 'Two convolvers panned apart, after the distortion — it is the loudspeaker. The single biggest change to a direct USB guitar.',
      box: boxes.cab,
    },
    {
      id: 'dry',
      label: 'Dry',
      readout: null,
      inPath: true,
      // Unity, always. This node exists to explain why switching the delay and
      // reverb off does not silence anything.
      active: true,
      toggleable: false,
      hint: 'The unprocessed path, always at unity. The sends are added on top of it.',
      box: boxes.dry,
    },
    {
      id: 'delay',
      label: 'Delay',
      readout: delayLive ? `${Math.round(amp.delay.timeSec * 1000)}ms` : null,
      inPath: delayLive,
      active: delayLive,
      toggleable: true,
      hint: 'A parallel send off the cabinet, with its own feedback loop. The repeats darken as they decay, like tape.',
      box: boxes.delay,
    },
    {
      id: 'reverb',
      label: 'Reverb',
      readout: reverbLive ? `${amp.reverb.sizeSec.toFixed(1)}s` : null,
      inPath: reverbLive,
      active: reverbLive,
      toggleable: true,
      hint: 'A parallel stereo convolution send. Separate from the cabinet, which is short and mono.',
      box: boxes.reverb,
    },
    {
      id: 'out',
      label: 'Output',
      readout: db(amp.outputDb),
      inPath: true,
      active: amp.outputDb !== 0,
      toggleable: false,
      hint: 'The three paths sum here, then the output trim — which is BEFORE the limiter.',
      box: boxes.out,
    },
    {
      id: 'limiter',
      label: 'Limiter',
      readout: amp.limiter.enabled ? `${amp.limiter.ceilingDb.toFixed(1)}dB` : null,
      inPath: true,
      active: amp.limiter.enabled,
      toggleable: true,
      hint: 'Look-ahead brickwall, last in the chain. It reads 3 ms ahead, so the gain is already down before a peak arrives — which is why Output can go up without the sound breaking.',
      box: boxes.limiter,
    },
  ];

  const edge = (id: string, from: AmpNodeId | 'in', to: AmpNodeId, live: boolean): AmpEdge => {
    // `in` is not a node — it is the entry point above the first one.
    const start: Point = from === 'in' ? { x: W / 2, y: -ROW_STEP + ROW_H } : bottomPort(boxes[from]);
    return { id, from, to, live, path: verticalWirePath(start, topPort(boxes[to])) };
  };

  const edges: AmpEdge[] = [
    // The serial spine is always live: disabled stages are neutralised, not removed.
    edge('in-gate', 'in', 'gate', true),
    edge('gate-comp', 'gate', 'comp', true),
    edge('comp-tone', 'comp', 'tone', true),
    edge('tone-drive', 'tone', 'drive', true),
    edge('drive-cab', 'drive', 'cab', true),
    // The fan-out.
    edge('cab-dry', 'cab', 'dry', true),
    edge('cab-delay', 'cab', 'delay', delayLive),
    edge('cab-reverb', 'cab', 'reverb', reverbLive),
    // The merge, then the two output stages in their real order.
    edge('dry-out', 'dry', 'out', true),
    edge('delay-out', 'delay', 'out', delayLive),
    edge('reverb-out', 'reverb', 'out', reverbLive),
    edge('out-limiter', 'out', 'limiter', true),
  ];

  // Feedback is clamped below 1 in ampFx; zero when the delay is off.
  const feedbackActive = delayLive && amp.delay.feedback > 0;
  const d = boxes.delay;
  const feedback = feedbackActive
    ? {
        active: true,
        // A loop out of the right edge and back into it, sitting clear of the node.
        path:
          `M ${d.x + d.w} ${d.y + d.h * 0.3} ` +
          `C ${d.x + d.w + 16} ${d.y + d.h * 0.3}, ` +
          `${d.x + d.w + 16} ${d.y + d.h * 0.7}, ` +
          `${d.x + d.w} ${d.y + d.h * 0.7}`,
      }
    : null;

  const height = boxes.limiter.y + boxes.limiter.h;
  return { nodes, edges, feedback, width: W, height };
}
