'use client';

import { Wire } from '@/components/board/Wire';
import type { SignalGraph, SignalNode } from '@/lib/board';

interface SignalBoardProps {
  /** A described chain — `ampGraph(amp)` today; the renderer knows nothing else. */
  graph: SignalGraph;
  /** Heading. Says which chain this is when a page shows more than one. */
  title: string;
  /** Called with a node id when a switchable node is tapped. */
  onToggle: (id: string) => void;
}

/**
 * SignalBoard — a described chain drawn as signal flow.
 *
 * A **map, not a replacement**. Every parameter still lives in the rack beside it;
 * this answers a different question — "where does my signal actually go" — which a
 * vertical list of pedals cannot, because the list implies a straight line and the
 * chain is not one. Delay and reverb are parallel sends, so switching them off never
 * interrupts the dry path. See `lib/ampGraph` for where the topology comes from and
 * why it matters.
 *
 * Kept separate from the graph it draws so a second chain needs no second component:
 * it reads `SignalGraph` and nothing about amps.
 *
 * Laid out vertically at the width the graph reports. This lives in a 256px rail on
 * desktop and a bottom sheet on a phone, so it renders identically at **every**
 * breakpoint — no `hidden lg:*`, which on the jam rails would leave a phone unable
 * to reach these controls at all.
 *
 * Deliberately not draggable. Reordering the nodes would suggest reordering the
 * audio, and the chain is built as a fixed topology; a board that can be rearranged
 * without changing the sound is worse than no board.
 */
export function SignalBoard({ graph, title, onToggle }: SignalBoardProps) {
  return (
    // `grid-overlay` was written for the page ground in an earlier design pass and
    // then left unused. A board is the one surface it actually belongs on: it reads
    // as a workspace behind the wires, and nothing legible sits under it.
    <div className="grid-overlay rounded-lg border border-line bg-canvas p-2">
      <div className="mb-1.5 flex items-baseline justify-between">
        <h3 className="font-mono text-[9px] font-semibold tracking-[0.16em] uppercase text-ink-3">
          {title}
        </h3>
        <span className="font-mono text-[8px] tracking-wider uppercase text-ink-3">
          tap to bypass
        </span>
      </div>

      <div className="relative mx-auto" style={{ width: graph.width, height: graph.height }}>
        {/* Wires sit under the nodes and never take pointer events. `overflow-visible`
            so the delay's feedback loop and the live halo are not clipped at the
            edge — a wire that fades out early reads as a broken connection. */}
        <svg
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-visible"
          width={graph.width}
          height={graph.height}
        >
          {graph.edges.map((edge) => (
            <Wire key={edge.id} d={edge.path} live={edge.live} />
          ))}

          {graph.feedback ? <Wire d={graph.feedback.path} live /> : null}
        </svg>

        {graph.nodes.map((node) => (
          <BoardNode key={node.id} node={node} onToggle={() => onToggle(node.id)} />
        ))}
      </div>
    </div>
  );
}

/**
 * One node.
 *
 * Three readings, and they are not the same thing:
 * - **active** — carrying signal and changing it: accent border and the breathing
 *   `node-idle` glow.
 * - **in path, inert** — the signal still runs through it, but it is neutral. This
 *   is what a switched-off tone stack or compressor really is: still in the graph,
 *   doing nothing. Plain border, full opacity.
 * - **out of path** — a send turned down to zero. Dimmed, because nothing reaches
 *   it at all.
 */
function BoardNode({ node, onToggle }: { node: SignalNode; onToggle: () => void }) {
  const { box } = node;

  const tone = node.active
    ? 'border-cyan/45 bg-cyan/10 text-ink animate-node-idle'
    : node.inPath
      ? 'border-line bg-panel text-ink-2'
      : 'border-line bg-panel text-ink-3 opacity-55';

  const label = (
    <>
      <span className="block truncate text-[9px] font-semibold tracking-[0.12em] uppercase">
        {node.label}
      </span>
      {/* Reserved height even when empty, so switching an effect on does not
          nudge the node and drag its wires with it. */}
      <span className="block h-3 truncate font-mono text-[9px] text-ink-3">
        {node.readout ?? ''}
      </span>
    </>
  );

  const shared =
    'absolute flex flex-col items-center justify-center rounded-md border px-1 text-center transition-[border-color,background-color,opacity,box-shadow] duration-200';
  const style = { left: box.x, top: box.y, width: box.w, height: box.h };

  if (!node.toggleable) {
    return (
      <div className={`${shared} ${tone}`} style={style} title={node.hint}>
        {label}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={node.active}
      title={node.hint}
      className={`${shared} ${tone} cursor-pointer hover:border-cyan/70`}
      style={style}
    >
      {label}
    </button>
  );
}
