/**
 * Node-board geometry.
 *
 * Pure functions of layout numbers, deliberately with no DOM access. Two reasons:
 *
 * 1. Wires must be exact. Measuring ports with `getBoundingClientRect` on every
 *    render is both slow and one frame stale during a drag, so the connectors lag
 *    behind the node they are attached to. Deriving anchors from the same numbers
 *    that position the nodes cannot disagree with where the nodes actually are.
 * 2. There is no test runner here. A pure module can be compiled with
 *    `npx tsc --outDir <tmp> --module commonjs` and checked from plain Node, the
 *    way `lib/timeline.ts` and `lib/beats.ts` were. Geometry inlined in a
 *    component cannot be checked at all.
 */

export interface Point {
  x: number;
  y: number;
}

/** A node's box in board coordinates. */
export interface NodeBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/* --------------------------------------------------------------------------
   A drawn signal chain.

   `ampGraph` describes the amp this way and `SignalBoard` draws it. The types
   live here rather than in the graph module so the renderer imports no chain of
   its own, and so a second chain — the song rack, say — needs a graph function
   and no new component.

   The three states a node can be in are not two. `inPath` says the signal runs
   through the node at all; `active` says it is also *changing* the sound. A
   switched-off tone stack is in the path and inert — it is still a filter at
   0 dB — while a send at zero mix receives nothing. Collapsing them would draw
   a bypassed EQ as disconnected, which is the one thing a board must not lie
   about.
-------------------------------------------------------------------------- */

/** One node on a drawn chain. `Id` narrows to a chain's own node names. */
export interface SignalNode<Id extends string = string> {
  id: Id;
  /** Short uppercase label. */
  label: string;
  /** Compact value, or null when the node has no single meaningful number. */
  readout: string | null;
  /** Signal runs through here at all. False only for a send turned down to zero. */
  inPath: boolean;
  /** Signal runs through here AND is being changed. Drives the glow. */
  active: boolean;
  /** Whether the user can switch this node from the board. */
  toggleable: boolean;
  /** Longer explanation, for the title attribute. */
  hint: string;
  box: NodeBox;
}

/** One wire. `from` accepts `'in'`, which is the entry point rather than a node. */
export interface SignalEdge<Id extends string = string> {
  id: string;
  from: Id | 'in';
  to: Id;
  /** Carrying a non-zero signal right now. */
  live: boolean;
  path: string;
}

export interface SignalGraph<Id extends string = string> {
  nodes: SignalNode<Id>[];
  edges: SignalEdge<Id>[];
  /** Feedback loop marker, drawn only where one is audible. */
  feedback: { active: boolean; path: string } | null;
  width: number;
  height: number;
}

/** Grid pitch in px. A quarter of the 56px page grid in `globals.css`. */
export const GRID_PITCH = 14;

/** Input port: left edge, vertically centred. */
export function inPort(box: NodeBox): Point {
  return { x: box.x, y: box.y + box.h / 2 };
}

/** Output port: right edge, vertically centred. */
export function outPort(box: NodeBox): Point {
  return { x: box.x + box.w, y: box.y + box.h / 2 };
}

/** Snap a free coordinate to the board grid. */
export function snapToGrid(value: number, pitch = GRID_PITCH): number {
  return Math.round(value / pitch) * pitch;
}

/** Snap a whole box's origin, leaving its size alone. */
export function snapBox(box: NodeBox, pitch = GRID_PITCH): NodeBox {
  return { ...box, x: snapToGrid(box.x, pitch), y: snapToGrid(box.y, pitch) };
}

/**
 * Cubic path from one port to another, leaving and entering horizontally.
 *
 * Control points are pushed along x by 40% of the span so a wire departs the
 * output sideways rather than diagonally — that horizontal exit is what makes a
 * chain read as signal flow. Clamped to 24px so two nodes stacked almost
 * vertically still get a visible bend instead of a straight diagonal.
 */
export function wirePath(from: Point, to: Point): string {
  const dx = Math.max(24, Math.abs(to.x - from.x) * 0.4);
  return `M ${from.x} ${from.y} C ${from.x + dx} ${from.y}, ${to.x - dx} ${to.y}, ${to.x} ${to.y}`;
}

/** Top port: horizontally centred on the upper edge. */
export function topPort(box: NodeBox): Point {
  return { x: box.x + box.w / 2, y: box.y };
}

/** Bottom port: horizontally centred on the lower edge. */
export function bottomPort(box: NodeBox): Point {
  return { x: box.x + box.w / 2, y: box.y + box.h };
}

/**
 * Cubic path between two ports stacked vertically, leaving and entering
 * vertically.
 *
 * The mirror of `wirePath`. A vertical flow needs its control points offset along
 * y, or a fan-out to three parallel branches leaves the source sideways and reads
 * as three unrelated lines rather than one signal splitting.
 */
export function verticalWirePath(from: Point, to: Point): string {
  const dy = Math.max(14, Math.abs(to.y - from.y) * 0.55);
  return `M ${from.x} ${from.y} C ${from.x} ${from.y + dy}, ${to.x} ${to.y - dy}, ${to.x} ${to.y}`;
}

/**
 * Lay a chain out left to right.
 *
 * A rack is a fixed chain, so its positions are computed rather than stored:
 * nothing can drift out of sync with the audio graph, and there is no saved layout
 * to migrate when a stage is added.
 *
 * Unused. This and the four helpers below it — `boardExtent`, `insertionIndex`,
 * `reorder`, plus `inPort`/`outPort`/`wirePath` above — are for a horizontal,
 * draggable board that the app does not have; the boards it does have are vertical
 * and deliberately fixed. Kept because they are pure, checkable and cheap, not
 * because anything calls them.
 */
export function chainLayout(
  count: number,
  options: { nodeW?: number; nodeH?: number; gap?: number; originX?: number; originY?: number } = {},
): NodeBox[] {
  const { nodeW = 168, nodeH = 96, gap = 56, originX = 0, originY = 0 } = options;
  return Array.from({ length: count }, (_, index) => ({
    x: originX + index * (nodeW + gap),
    y: originY,
    w: nodeW,
    h: nodeH,
  }));
}

/**
 * Total board size for a laid-out set of nodes, plus padding.
 *
 * Used to size the `<svg>` under the nodes. An svg that is merely `inset-0` clips
 * the halo on the last wire, which reads as the connector fading out early.
 */
export function boardExtent(boxes: NodeBox[], padding = 24): { width: number; height: number } {
  if (boxes.length === 0) return { width: padding * 2, height: padding * 2 };
  const right = Math.max(...boxes.map((box) => box.x + box.w));
  const bottom = Math.max(...boxes.map((box) => box.y + box.h));
  return { width: right + padding, height: bottom + padding };
}

/**
 * Where a dragged node would be inserted in a left-to-right chain.
 *
 * Returns an index in `0..boxes.length`. Compares against each box's midpoint, so
 * the insertion point flips when the pointer passes half of a node rather than
 * its edge — the edge version makes the last slot nearly unreachable.
 */
export function insertionIndex(boxes: NodeBox[], pointerX: number): number {
  let index = 0;
  for (const box of boxes) {
    if (pointerX < box.x + box.w / 2) break;
    index += 1;
  }
  return index;
}

/** Move an item within an array. Returns a new array; out-of-range is a no-op. */
export function reorder<T>(items: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= items.length || to < 0 || to > items.length) {
    return [...items];
  }
  const next = [...items];
  const [moved] = next.splice(from, 1);
  // Removing shifts everything after `from` left by one, so a rightward move
  // targets `to - 1`. Getting this wrong puts the item one slot past the caret.
  next.splice(from < to ? to - 1 : to, 0, moved);
  return next;
}
