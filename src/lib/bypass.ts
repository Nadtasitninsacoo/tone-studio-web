/**
 * Taking a processor out of a chain so it stops costing anything.
 *
 * ---------------------------------------------------------------------------
 * `lib/ampGraph.ts` states the rule the racks were built on: *"A disabled stage is
 * neutralised in place, not removed."* Every stage stays wired and is driven to a
 * setting that does nothing — the gate's `enabled` to 0, the compressor to ratio 1, the
 * drive to a null curve. That was the right call for everything it was written about:
 * rebuilding a graph to change a stage count clicks, and "build once, drive by
 * parameters" is what keeps six racks' worth of controls honest.
 *
 * It stops being the right call for an **AudioWorkletNode**. A neutralised biquad is a
 * few multiplies of C++; a neutralised worklet is still a JavaScript callback across the
 * worklet boundary every 128 samples, and there are two of them in every chain. With six
 * racks live that is twelve, or about 4,500 invocations a second before any of them has
 * done anything. Measured here as a monitor that broke up from the fifth rack onwards.
 *
 * **Both ends have to go.** Disconnecting only the input leaves the node connected to
 * whatever follows it, so it still has a path to `destination` — and Web Audio runs a node
 * because it has a path there, not because it has a signal. It would keep being called,
 * on silence, which is the whole cost and none of the benefit. That is the same trap the
 * recorder's monitor bus and its rig channels each fell into once already.
 *
 * The reconnection is a step change on a live signal, so it can click. That is accepted
 * rather than solved: this is used by a quality mode, which is a deliberate choice made
 * once before playing, not a control to ride. A per-stage switch would need a ramp.
 * ---------------------------------------------------------------------------
 */

/** How much of the chain is in the path. See `lib/ampStore.ts`. */
export type RigQuality =
  /** Everything, as designed. For recording, and for running one or two racks. */
  | 'full'
  /**
   * The worklet processors are routed around on every chain.
   *
   * What is lost is the gate and the limiter — real losses, and the reason this is not the
   * default: nothing is catching a peak on the monitor path. What is bought is the
   * headroom to have five or six instruments audible at once on a machine that cannot do
   * it otherwise.
   */
  | 'light';

/**
 * Wire `from -> through -> to`, and hand back a switch that can take `through` out.
 *
 * Assumes `from.connect(through)` and `through.connect(to)` have already been made — it
 * describes an existing path rather than building one, so the modules keep their own
 * topology and their own reading order.
 */
export function makeBypass(
  from: AudioNode,
  /**
   * One node, or a whole sub-chain by its two ends.
   *
   * The desk's inserts are the second kind: a `RigChain` is dozens of nodes reached
   * through an `input` and an `output`, and taking one out of a strip is the same two
   * disconnects as taking out a single worklet.
   */
  through: AudioNode | { input: AudioNode; output: AudioNode },
  to: AudioNode,
): (inPath: boolean) => void {
  const entry = 'input' in through ? through.input : through;
  const exit = 'output' in through ? through.output : through;
  let inPath = true;

  return (next: boolean) => {
    if (next === inPath) return;
    inPath = next;

    try {
      if (next) {
        from.disconnect(to);
        from.connect(entry);
        exit.connect(to);
      } else {
        from.disconnect(entry);
        exit.disconnect(to);
        from.connect(to);
      }
    } catch {
      // A context that has gone away, or a connection already made or already gone.
      // Either way there is nothing to repair: the graph is being torn down.
    }
  };
}
