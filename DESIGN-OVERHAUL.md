# UX/UI overhaul — workboard direction

A design spec and implementation plan for moving this app toward a sleek,
futuristic, drag-and-drop "workboard" feel, written against the code that is
actually here.

Read [AGENTS.md](AGENTS.md) and the **Design rules** and **Architecture** sections
of [README.md](README.md) first. This document is additive to both, and where it
appears to contradict them it says so explicitly and explains the resolution.

---

## 0. What the canvas actually is

The reference interfaces (Cursor-style agent boards, n8n, ComfyUI, Figma) share
one primitive: **a spatial canvas where the user composes a graph out of parts
dragged from a palette.** This app has no agents, no nodes, and no databases — so
the overhaul is not "add a node editor", it is "find the three places where the
user is already composing something spatially, and make those feel like a
workboard."

| Surface | What the user composes | Workboard fit |
|---|---|---|
| **`/editor`** — media rail + timeline | assets → clips on tracks, in time | **Primary.** A real 2-axis canvas that is currently missing its most obvious gesture |
| **`/jam`** — `FxRack` / `SongFxRack` | a signal chain out of 5 pedals | **Secondary.** Genuinely a node graph — it just isn't drawn as one |
| **`/` (Recorder)** — dashboard | nothing spatial; it's an instrument panel | **Not a canvas.** Do not force it |

The highest-value single change in this entire document:

> **You cannot currently drag an asset from the media rail onto the timeline.**
> `useEditor` has `dragClip` / `trimClipStart` / `trimClipEnd` for clips that
> already exist, and imports auto-place themselves. There is no
> `addClipFromAsset(assetId, trackId, startSec)`. The rail is a list of files, not
> a palette. Everything else here is polish on top of that gap.

---

## 1. Two conflicts with recorded decisions, and how to resolve them

These are not objections to the brief — both requested effects are achievable.
But this repo already paid for the naive versions, and the fixes are cheap.

### 1.1 Glassmorphism

README, Design rules:

> An earlier pass built translucent glass panels over animated aurora glows. It
> looked good in isolation and was **unusable** — colour washed across the video
> monitor and the text. It was removed entirely.

The failure was not `backdrop-filter`. It was **glass on the persistent layer** —
panels that sit over a video monitor and body text for the whole session, where
every frame of the video bleeds through the thing you are reading.

**Rule: glass is allowed only on layers that are temporary, or that have nothing
legible behind them.**

| Layer | Glass? | Why |
|---|---|---|
| Drag ghost / drop preview | **Yes** | On screen for ~600 ms; translucency is what makes it read as "not placed yet" |
| Command palette, sheets, mobile drawer scrim | **Yes** | Modal — nothing behind them needs reading |
| Floating toolbars over the *timeline* | **Yes, weak** (`backdrop-blur-sm`) | Behind them is the blueprint grid, not text |
| Node/pedal cards on the FX board | **Yes, weak** | Board background is grid + connectors |
| `ui/Panel.tsx`, video monitor chrome, `TakeList`, inspector | **No — stays opaque** | This is the exact case that was removed |

So: keep `--color-panel` opaque. Add *separate* glass tokens used only by the
floating layer. The look you want lives on the moving parts, which is also where
the eye goes.

### 1.2 Glow

README: **red is reserved for "live" or "broken", never decorative.** A glowing
node is a decorative glow. If active nodes glow red, the one signal in the app
that means "you are recording" is diluted.

**Rule: the glow palette is cyan / violet / teal only.** Red gets exactly one
glow, the existing `rec-pulse`, and nothing else may use it. Additional
constraint: the light-mode accents (`#097487`, `#6a35d6`, `#0b7f73`) were darkened
to clear WCAG AA — a glow must be built from `box-shadow` and a border, **never**
by lightening the token, or light mode loses its contrast compliance.

---

## 2. Token additions (Tailwind v4)

No `tailwind.config.js` exists and none should be created. These go in
`src/app/globals.css`. Semantic aliases go in `@theme inline` (so they follow
`.dark` with no `dark:` prefixes); literal values go in the `:root` / `.dark`
blocks alongside the existing ones.

```css
/* --- in @theme inline, beside the existing --color-* aliases --------------- */
@theme inline {
  /* Floating-layer glass. Deliberately NOT --color-panel: panels stay opaque. */
  --color-veil: var(--c-veil);          /* drag ghost, palette, sheet body */
  --color-veil-strong: var(--c-veil-strong);

  /* Canvas ground for board surfaces — one step below --color-base. */
  --color-canvas: var(--c-canvas);

  /* Node / port anatomy. */
  --color-port: var(--c-port);
  --color-port-live: var(--c-port-live);
  --color-wire: var(--c-wire);
  --color-wire-live: var(--c-wire-live);

  /* Drop-zone feedback. */
  --color-drop: var(--c-drop);
  --color-drop-invalid: var(--c-drop-invalid);

  --shadow-lift-drag: var(--s-lift-drag);
  --shadow-glow-cyan: var(--s-glow-cyan);
  --shadow-glow-violet: var(--s-glow-violet);
}

/* --- @theme (non-inline): motion primitives shared by CSS and JS ----------- */
@theme {
  /* Spring-ish easings for CSS-only transitions. The real springs live in JS. */
  --ease-drop: cubic-bezier(0.2, 0.9, 0.2, 1);

  --animate-wire-flow: wire-flow 1.1s linear infinite;
  --animate-node-idle: node-idle 4.5s ease-in-out infinite;
  --animate-drop-hint: drop-hint 1.4s ease-in-out infinite;
}

:root {
  --c-veil: rgb(255 255 255 / 0.72);
  --c-veil-strong: rgb(255 255 255 / 0.88);
  --c-canvas: #e8eaf1;
  --c-port: rgb(17 24 55 / 0.3);
  --c-port-live: #097487;
  --c-wire: rgb(17 24 55 / 0.22);
  --c-wire-live: #097487;
  --c-drop: #6a35d6;
  --c-drop-invalid: #e01843;
  --s-lift-drag: 0 18px 40px -12px rgb(17 24 55 / 0.4);
  --s-glow-cyan: 0 0 0 1px rgb(9 116 135 / 0.45), 0 0 22px -4px rgb(9 116 135 / 0.5);
  --s-glow-violet: 0 0 0 1px rgb(106 53 214 / 0.45), 0 0 22px -4px rgb(106 53 214 / 0.5);
}

.dark {
  --c-veil: rgb(20 22 31 / 0.68);
  --c-veil-strong: rgb(20 22 31 / 0.86);
  --c-canvas: #07080e;
  --c-port: rgb(255 255 255 / 0.26);
  --c-port-live: #22d3ee;
  --c-wire: rgb(255 255 255 / 0.18);
  --c-wire-live: #22d3ee;
  --c-drop: #8b5cf6;
  --c-drop-invalid: #ff3b5c;
  --s-lift-drag: 0 24px 56px -16px rgb(0 0 0 / 0.95);
  --s-glow-cyan: 0 0 0 1px rgb(34 211 238 / 0.5), 0 0 26px -4px rgb(34 211 238 / 0.55);
  --s-glow-violet: 0 0 0 1px rgb(139 92 246 / 0.5), 0 0 26px -4px rgb(139 92 246 / 0.55);
}

/* Keyframes at top level, not inside @theme — matches the existing file, and is
   required for animations applied conditionally at runtime. */
@keyframes wire-flow {
  to { stroke-dashoffset: -12; }
}

/* Breathing for an ACTIVE node. Opacity + shadow only: no transform, so it can
   never nudge layout or fight a drag transform on the same element. */
@keyframes node-idle {
  0%, 100% { box-shadow: var(--s-glow-cyan); }
  50%      { box-shadow: 0 0 0 1px color-mix(in oklab, var(--c-cyan) 65%, transparent),
                         0 0 34px -2px color-mix(in oklab, var(--c-cyan) 70%, transparent); }
}

@keyframes drop-hint {
  0%, 100% { opacity: 0.45; }
  50%      { opacity: 0.9; }
}
```

**Compile-checked.** The block above was run through this project's own
`@tailwindcss/postcss` (Tailwind 4.3.3) and every utility it promises is emitted:
`bg-veil`, `bg-veil-strong`, `bg-canvas`, `text-port-live`, `stroke-wire-live`,
`shadow-glow-cyan`, `shadow-glow-violet`, `shadow-lift-drag`, `animate-wire-flow`,
`animate-node-idle`, `animate-drop-hint`, `ease-drop`, plus the modifier forms
used later in this document — `bg-drop/8`, `inset-ring-drop/45`,
`inset-ring-drop-invalid/45` and `h-6!`. The CSS is valid; whether it *looks*
right is a separate question that needs a browser.

Two things to carry over from the existing file:

- The `@media (prefers-reduced-motion: reduce)` block at the bottom already kills
  every looping animation globally. `wire-flow`, `node-idle` and `drop-hint`
  inherit that for free — **which is exactly why the ambient loops should be CSS,
  not JS springs.** JS-driven motion has to opt in manually (§4.6).
- Class-name reminders from AGENTS.md: `bg-linear-to-b`, `h-6!`, `h-dvh`,
  `h-(--var)`.

### Type scale and density

The current scale (`text-[9px]` … `text-sm`, `tracking-[0.14em]` uppercase mono
labels) is already the right idiom for a studio tool — it reads as hardware.
Don't replace it with a generic SaaS scale. Two additions:

- **`--font-numeric` on every port value and node readout**, not just the hero
  timecode. Tabular figures are already forced for `.font-mono` / `.font-numeric`
  in `@layer base`; a knob readout that jitters between `0.9` and `1.0` is the
  fastest way to make a board feel cheap.
- **One display size for node titles**: `text-[11px] font-semibold
  tracking-[0.14em] uppercase`. Identical to `Panel`'s header, so a node reads as
  a Panel that happens to float.

---

## 3. Library decisions

| Need | Use | Why, and what it costs |
|---|---|---|
| Cross-container drag (rail → lane) | **hand-rolled pointer capture** — *revised, see below* | Zero dependency, 4 KB of bundle, and it mirrors the gesture idiom `Timeline` already proved |
| Reorder (pedal chain), if it ships | `@dnd-kit/sortable` is still worth evaluating | A sortable list is the case dnd-kit is genuinely good at |
| Spring physics, layout transitions, enter/exit | **`motion`** (the current package name for Framer Motion; import from `motion/react`) | `layout`, `AnimatePresence`, and `MotionValue` — the last one is the load-bearing feature here, see §4.5 |
| Icons | **`lucide-react`** — already a dependency | Keep it. No second icon set |
| Styling | **Tailwind v4** — already set up | Keep. Tokens only, no arbitrary hex in components |
| Node graph rendering | **hand-rolled SVG**, *not* `@xyflow/react` | See below |

### Revised: why the rail → lane drag was hand-rolled

The first version of this document recommended `@dnd-kit/core` for it. One of the
reasons given was wrong: *"custom collision detection — which is what mapping
x → seconds requires."* dnd-kit's collision detection is rectangle-based and has
nothing to do with that mapping; the seconds come from the pointer via
`timeAtPointer`, which is code we own either way. dnd-kit does not help with the
genuinely fiddly parts of this gesture — snapping, the sticky header offset, the
scroll offset, edge auto-scroll.

What it does help with is hit-testing while a pointer is captured, and keyboard
pickup. But `document.elementFromPoint` plus a `data-` attribute covers the first
in about ten lines, and the second is already covered by the Phase 2 `+` button,
which was designed as the keyboard and touch path.

Facts checked before deciding: `@dnd-kit/core@6.3.1`, peer `react >=16.8.0` — so
compatibility was not the objection. The objection is proportion. Measured cost of
the hand-rolled version, production build, whole feature including the ghost and
the lane feedback: **+4 KB client JS, +1 KB CSS.** Against a repo whose own
standard is to dynamic-import LAME rather than put 160 KB in the entry chunk, and
which has no UI dependency beyond `lucide-react`, a library for three static drop
targets does not earn its place.

Keep dnd-kit on the table for the pedal chain (`@dnd-kit/sortable`) — a reorderable
list with keyboard support is exactly its strength, and there the alternative is
not ten lines.

### Why not React Flow / xyflow

It is a great library aimed at a problem this app doesn't have. Decision rule:

- **Arbitrary topology** the user authors freely (fan-out, merges, loops,
  pan/zoom over hundreds of nodes) → xyflow earns its weight.
- **Fixed topology** you are *visualising* → hand-rolled SVG is smaller, themes
  natively from your CSS variables, and has no viewport model to fight.

The FX rack is `drive → eq → comp → delay → reverb → output`. A chain. Five nodes,
one edge each, and `lib/guitarFx.ts` builds that order in Web Audio regardless of
what any canvas says. Rendering it needs one `<svg>` with five `<path>`s — roughly
120 lines, no dependency, and `stroke="var(--c-wire-live)"` just works in both
themes.

**Correction, found while building Phase 5.** The paragraph above described the FX
rack as `drive → eq → comp → delay → reverb → output`, "a chain". It is not.
`createFxChain` builds a serial head and then a three-way parallel split:

```
input -> drive -> low -> mid -> high -> comp
comp -+-> dry ---------------------> mixBus
      +-> delay <-> feedback ------> mixBus
      +-> convolver --------------> mixBus
mixBus -> output
```

Delay and reverb are **parallel sends off the compressor**, and the delay has a
feedback loop. Drawing them in a row would have told the user that switching delay
off removes a stage from the signal path, when the dry signal never passed through
it — which is exactly why bypassing the sends does not silence the guitar. The
"parallel sends, a wet/dry split" case the paragraph treats as hypothetical is what
the code already does.

The conclusion survives the correction, though it is now a closer call: a fan-out
and a merge is more graph-like than a chain. But the topology is still **fixed** —
seven nodes, no user-authored edges, no pan or zoom — so there is no viewport model
to buy. Reach for xyflow only if the user is ever meant to author the routing.

Note also the README warning about the Linkwitz-Riley crossover: audio routing here
has verified numerical behaviour that a UI must not quietly reorder.

### Cost control

AGENTS.md: `encodeMp3` is `async` so LAME arrives via `import()` rather than
putting ~160 kB into the initial load. Apply the same standard:

- Import from `motion/react` and prefer **`LazyMotion` + `domAnimation`** with
  `<m.div>` instead of `<motion.div>`, so the full feature set isn't in the entry
  chunk. Load `domMax` (which adds drag + layout projection) only in the editor
  and jam routes.
- Keep every **looping** animation in CSS (`node-idle`, `wire-flow`, the existing
  `rec-pulse`). JS springs are for gestures and one-shot transitions.
- Measure, don't assume: run `npm run build` before and after and compare the
  per-route First Load JS. Treat any regression on `/` (the recorder, which needs
  none of this) as a bug — code-split so the recorder route stays as it is.

### Version check before installing

`react@19.2.4` and `next@16.2.12` are both recent. Verify peer ranges rather than
trusting a version from memory:

```bash
npm info @dnd-kit/core peerDependencies
npm info motion peerDependencies
npm view @dnd-kit/core version
```

---

## 4. Architecture and interaction patterns

### 4.1 Layer contract

The app already uses `z-50` for the sidebar and its scrim, and `z-20` / `z-30`
inside the timeline for the ruler and playhead. Write it down before adding a
drag overlay, because a drag ghost that renders *under* the sidebar is the
classic failure:

| z | Layer |
|---|---|
| 0–10 | Canvas ground, grid, lanes, wires |
| 20 | Sticky ruler / track headers |
| 30 | Playhead, selection ring |
| 40 | Drop indicators, snap guides |
| 50 | Sidebar, drawer, scrim (existing) |
| 60 | **Drag overlay** (`DragOverlay` renders in a portal — must beat the sidebar) |
| 70 | Toasts (existing `ui/Toast.tsx`) |

Add these as tokens (`--z-drag: 60`) so the numbers live in one place.

### 4.2 File structure

Additive. Nothing existing moves — in particular `useJam` and `useEditor` stay
called exactly once in `StudioProviders`, above the router (AGENTS.md: moving
them back into a page restores the bug where a route change closes the
AudioContext and revokes the object URLs).

```
src/
  components/
    board/                     # NEW — reusable workboard primitives, route-agnostic
      BoardCanvas.tsx          #   grid ground + optional pan; owns nothing stateful
      DragLayer.tsx            #   <DndContext> + <DragOverlay>, one per route
      DragGhost.tsx            #   the glass card that follows the pointer
      DropIndicator.tsx        #   snap guide / insertion caret
      Node.tsx                 #   node shell: header, ports, active glow
      Port.tsx                 #   in/out dot + hit area
      Wire.tsx                 #   one SVG path, animated dash when signal flows
      WireLayer.tsx            #   <svg> that measures ports and draws Wires
    editor/
      Timeline.tsx             # EXISTING — keep its pointer-capture drag (§4.4)
      RailAsset.tsx            # NEW — draggable asset card (useDraggable)
      LaneDropZone.tsx         # NEW — per-track drop target (useDroppable)
      TimelineDragLayer.tsx    # NEW — collision detection: x -> seconds
    jam/
      FxRack.tsx               # EXISTING — keep as the accessible fallback
      FxBoard.tsx              # NEW — the same FxSettings rendered as a node graph
  lib/
    motion.ts                  # NEW — spring presets + reduced-motion store
    board.ts                   # NEW — pure geometry: snapping, port anchors, curves
  hooks/
    useReducedMotion.ts        # NEW — useSyncExternalStore over a media query
```

`lib/board.ts` being **pure** matters for a practical reason: AGENTS.md notes
there is no test runner, and that verification is done by compiling libs with
`npx tsc --outDir <tmp> --module commonjs` and running plain Node scripts.
Geometry in a pure module can be checked that way. Geometry inlined in a
component cannot be checked at all, and `lib/timeline.ts` (40/40 checks) is the
precedent to follow.

### 4.3 Pattern: drag an asset from the rail onto a lane

The gesture: pick up an asset card → lanes light up → a caret shows the snapped
insertion time → drop → the clip springs into place.

**Step 1 — the missing hook action.** Nothing works until `useEditor` can place
an asset. Sketch, to be written against the real reducer:

```ts
/**
 * Place an existing asset on a track as a new clip.
 *
 * Separate from addVideoFile: importing and placing are different actions once
 * the rail is a palette. Import puts an asset in the rail; this puts a clip on
 * the timeline.
 */
const addClipFromAsset = useCallback(
  (assetId: string, trackId: string, startSec: number) => {
    const asset = project.assets.find((entry) => entry.id === assetId);
    const track = project.tracks.find((entry) => entry.id === trackId);
    if (!asset || !track || track.locked) return null;

    // A video asset on an audio track is legal — it contributes its audio only.
    // The reverse is not: an audio asset has no frames to show.
    if (track.kind === 'video' && asset.kind !== 'video') return null;

    const clip: Clip = {
      // Reuse the module-local nextId, NOT crypto.randomUUID. The counter is
      // deliberate: bumpIdCounter re-seeds it past a restored draft's ids, and a
      // second id scheme would sidestep that protection.
      id: nextId('clip'),
      assetId,
      trackId,
      start: Math.max(0, startSec),
      inPoint: 0,
      outPoint: asset.durationSec,
      gain: 1,
      fadeInSec: 0,
      fadeOutSec: 0,
      muted: false,
    };

    setProject((current) => ({ ...current, clips: [...current.clips, clip] }));
    return clip.id;
  },
  [project.assets, project.tracks],
);
```

Return the new clip id so the UI can select it and animate its arrival. The field
list is checked against `Clip` in [src/types/editor.ts](src/types/editor.ts) — all
nine fields, no extras — and `setProject` / `nextId` are the real names in
[src/hooks/useEditor.ts](src/hooks/useEditor.ts).

One case the sketch does *not* decide: whether a video asset dropped on the video
lane should also place its audio. Today an import creates both an asset and a
clip; a palette makes "place picture" and "place sound" separable for the first
time. Pick one and write it down, because AGENTS.md is emphatic that
`scheduleAudio` must keep including video-track clips — a UI that places a video
clip on an audio-only lane, or that silently splits a source in two, is exactly
how "the imported video was silent in the monitor and in every export" comes back.

**Step 2 — the draggable card.** `useDraggable` gives an id and a payload; it
does **not** move the element. That is deliberate: the card stays in the rail and
a `DragOverlay` carries the ghost, so the rail never reflows mid-gesture.

```tsx
'use client';

import { useDraggable } from '@dnd-kit/core';
import { GripVertical, Music2, Video } from 'lucide-react';

import { formatDuration } from '@/lib/format';
import type { MediaAsset } from '@/types/editor';

export function RailAsset({ asset }: { asset: MediaAsset }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `asset:${asset.id}`,
    data: { kind: 'asset', assetId: asset.id, assetKind: asset.kind },
  });

  const Icon = asset.kind === 'video' ? Video : Music2;

  return (
    <div
      // dnd-kit's setNodeRef is a callback ref, so passing it straight through
      // satisfies react-hooks/refs. Do not wrap it in a ref object.
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      // touch-none is required or the browser scrolls instead of dragging.
      className={`group flex touch-none items-center gap-2 rounded-lg border bg-panel px-2 py-2 transition-[border-color,box-shadow,opacity] duration-200 ${
        isDragging
          ? 'border-drop/60 opacity-35'
          : 'border-line hover:border-cyan/50 hover:shadow-glow-cyan'
      }`}
    >
      <GripVertical
        aria-hidden
        className="h-3 w-3 shrink-0 text-ink-3 opacity-0 transition-opacity group-hover:opacity-100"
      />
      <Icon
        aria-hidden
        className={`h-3.5 w-3.5 shrink-0 ${asset.kind === 'video' ? 'text-violet' : 'text-cyan'}`}
      />
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink">{asset.name}</span>
      <span className="shrink-0 font-numeric text-[10px] text-ink-3">
        {formatDuration(asset.durationSec)}
      </span>
    </div>
  );
}
```

The source card drops to `opacity-35` rather than disappearing. Removing it
collapses the rail's scroll height mid-drag and yanks the list under the cursor.

**Step 3 — lanes as drop targets, with snapping.** The interesting part is that
dnd-kit reports *which* droppable you are over, not *where in it*. Time comes
from the pointer, and it should reuse the timeline's existing snap logic
(`snapTargets` / `snap` from `lib/timeline.ts`) so a dropped clip lands on the
same grid a dragged clip does.

```tsx
'use client';

import { useDroppable } from '@dnd-kit/core';

import type { Track } from '@/types/editor';

interface LaneDropZoneProps {
  track: Track;
  /** Snapped drop time in seconds, or null when this lane is not the target. */
  previewSec: number | null;
  /** False when the dragged asset cannot live here (e.g. audio on a video lane). */
  isValid: boolean;
  pxPerSec: number;
  children: React.ReactNode;
}

export function LaneDropZone({
  track,
  previewSec,
  isValid,
  pxPerSec,
  children,
}: LaneDropZoneProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `lane:${track.id}`,
    disabled: track.locked,
    data: { kind: 'lane', trackId: track.id, trackKind: track.kind },
  });

  const armed = isOver && isValid;

  return (
    <div
      ref={setNodeRef}
      className={`relative flex-1 bg-inset transition-colors duration-150 ${
        isOver
          ? isValid
            ? 'bg-drop/8 inset-ring-1 inset-ring-drop/45'
            : 'bg-drop-invalid/8 inset-ring-1 inset-ring-drop-invalid/45'
          : ''
      }`}
    >
      {children}

      {/* Insertion caret. Position comes from the same secToPx the clips use, so
          the caret cannot disagree with where the clip lands. */}
      {armed && previewSec !== null ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 z-40 w-0.5 animate-drop-hint bg-drop"
          style={{ left: previewSec * pxPerSec }}
        >
          <span className="absolute -top-0.5 -left-1 h-2 w-2.5 rounded-sm bg-drop" />
          <span className="absolute top-3 left-2 rounded border border-drop/50 bg-veil px-1 font-numeric text-[9px] whitespace-nowrap text-drop backdrop-blur-sm">
            {previewSec.toFixed(2)}s
          </span>
        </span>
      ) : null}
    </div>
  );
}
```

Note `inset-ring-1` (Tailwind v4) rather than a border: a border changes the box
and shifts every clip inside the lane by a pixel when the ring appears. That
1 px jump on drag-enter is very visible.

**Step 4 — wiring, and where the pointer x lives.** `DragMoveEvent` carries
`activatorEvent` plus deltas; the reliable way to get a client x is to track the
pointer and convert with the same arithmetic `Timeline.timeFromPointer` already
uses. Keep it in a ref, not state — this fires every frame.

```tsx
'use client';

import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import type { DragEndEvent, DragMoveEvent, DragStartEvent } from '@dnd-kit/core';
import { useRef, useState } from 'react';

export function TimelineDragLayer({ children /* … editor props */ }) {
  // 6 px before a drag starts: without it, clicking a card to select it is
  // interpreted as a 1 px drag and the click never lands.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const [activeAssetId, setActiveAssetId] = useState<string | null>(null);
  // Per-frame values. State here would re-render the whole timeline at 60 fps —
  // the same reason meters paint from refs (AGENTS.md).
  const pointerXRef = useRef(0);
  const [preview, setPreview] = useState<{ trackId: string; sec: number } | null>(null);

  const onDragStart = (event: DragStartEvent) => {
    setActiveAssetId(String(event.active.data.current?.assetId ?? ''));
  };

  const onDragMove = (event: DragMoveEvent) => {
    if (event.activatorEvent instanceof PointerEvent) {
      pointerXRef.current = event.activatorEvent.clientX + event.delta.x;
    }
    const laneId = event.over?.data.current?.trackId;
    if (!laneId) {
      setPreview(null);
      return;
    }
    // Throttle to snapped values: setPreview only when the snapped second
    // actually changes, so this is a handful of renders per gesture, not 60/s.
    const sec = snappedTimeFromClientX(pointerXRef.current);
    setPreview((current) =>
      current?.trackId === laneId && Math.abs(current.sec - sec) < 1e-3
        ? current
        : { trackId: laneId, sec },
    );
  };

  const onDragEnd = (event: DragEndEvent) => {
    const assetId = event.active.data.current?.assetId;
    const trackId = event.over?.data.current?.trackId;
    if (assetId && trackId && preview) {
      const clipId = addClipFromAsset(assetId, trackId, preview.sec);
      if (clipId) setSelectedClipId(clipId);
    }
    setActiveAssetId(null);
    setPreview(null);
  };

  return (
    <DndContext
      sensors={sensors}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setActiveAssetId(null);
        setPreview(null);
      }}
    >
      {children}
      <DragOverlay dropAnimation={null}>
        {activeAssetId ? <DragGhost assetId={activeAssetId} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
```

`dropAnimation={null}` on purpose: dnd-kit's default flies the ghost back to the
source card, which reads as *rejected*. The clip's own arrival animation
(§4.5) is the success signal, and playing both at once says two contradictory
things.

**Step 5 — the ghost.** This is the one element that should be unambiguously
glass, and the one place a spring belongs.

```tsx
'use client';

import { m } from 'motion/react';

export function DragGhost({ assetId }: { assetId: string }) {
  return (
    <m.div
      initial={{ scale: 0.92, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={SPRING.pickup}
      className="pointer-events-none flex items-center gap-2 rounded-lg border border-drop/60 bg-veil px-2.5 py-2 shadow-lift-drag backdrop-blur-md"
    >
      {/* same icon + name + duration as RailAsset, one line of markup shared */}
    </m.div>
  );
}
```

Tilt is the cheapest "picked up" cue there is: `rotate: -1.5` on `animate` plus
`transformOrigin: 'top left'`. Skip it on touch, where the finger covers the card.

### 4.4 Do not replace the timeline's existing drag

`Timeline.tsx` moves and trims clips with `setPointerCapture`, and its own comment
says why:

> capture keeps events flowing to the clip even when the cursor leaves it (which
> is what happens when you drag quickly) and cannot leak a listener if a
> re-render interrupts the gesture.

That is correct and better than a sensor-based abstraction for this gesture, which
also has to co-exist with scrubbing on the same surface. **dnd-kit's job is the
cross-container gesture (rail → lane) only.** Two consequences:

- Wrapping the timeline in `DndContext` must not swallow the pointerdown on
  clips. The 6 px activation constraint plus dnd-kit only listening on registered
  draggables handles this — but verify by dragging a clip *and* scrubbing after
  wiring it up, because a regression here silently breaks the editor's core
  gesture.
- The trim handles set `touch-none` already. Keep it.

### 4.5 The 60 fps rule, and how motion coexists with it

This is the constraint most likely to be violated by a Framer Motion refactor, so
it gets its own section.

AGENTS.md, "Do not undo these":

> Meters and timecode painting from refs in one rAF loop. Moving them into React
> state re-renders the dashboard 60×/second.
>
> The providers handing React the **same `children` element** on every render.
> Wrapping it … turns each 60 fps playhead tick into a full-app re-render.

A `<motion.div animate={{ x: playhead * pxPerSec }} />` where `playhead` is React
state is exactly the banned pattern with extra steps. The correct tool is a
**`MotionValue`**, which is ref-like: writing to it updates the DOM directly and
does **not** re-render.

```ts
// lib/motion.ts
import { motionValue } from 'motion/react';

/** Playhead position in seconds. Written from the existing rAF loop. */
export const playheadSec = motionValue(0);
```

```tsx
// inside the timeline, alongside the existing rAF loop
const x = useTransform(playheadSec, (sec) => secToPx(sec, pxPerSec));

useAnimationFrame(() => {
  // Same loop that already exists. One extra assignment, zero re-renders.
  playheadSec.set(engineRef.current.currentTime);
}, isPlaying);

return <m.div style={{ x }} className="absolute top-0 bottom-0 z-30 w-px bg-rec" />;
```

Rules that follow:

- **`MotionValue` for anything that changes per frame** — playhead, meters,
  waveform scroll, wire "signal flowing" phase.
- **React state for anything that changes per gesture** — selection, snapped
  preview, node active/bypassed.
- **Never `layout` / `layoutId` on the timeline.** Layout projection measures on
  every commit; on a surface that commits during playback it is a guaranteed
  frame-time problem. Use it on the rail, the node board, and lists (`TakeList`
  reordering) — not the timeline.
- **`will-change` sparingly.** Motion adds it during animation and removes it
  after, which is right. A permanent `will-change: transform` on every clip
  promotes hundreds of layers and makes scrolling *worse*.

### 4.6 Reduced motion

`prefers-reduced-motion` is a browser capability read. AGENTS.md:

> never call a browser capability probe during render … Every route here is
> prerendered, so the server renders the button disabled … and the client renders
> it enabled — a hydration mismatch React reports and cannot patch up.

The same trap applies to `useReducedMotion()` from any animation library if it
resolves differently on server and first client render. Follow the pattern
`lib/theme.ts` already establishes — an external store read through
`useSyncExternalStore`, with a server snapshot that hydration also uses — rather
than `useState` + `useEffect`, which would trip
`react-hooks/set-state-in-effect`.

```ts
// hooks/useReducedMotion.ts
'use client';

import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/** Matches the CSS default: motion is ON until the client says otherwise. */
const SERVER_SNAPSHOT = false;

let snapshot = SERVER_SNAPSHOT;
let query: MediaQueryList | null = null;

function subscribe(listener: () => void): () => void {
  query ??= window.matchMedia(QUERY);
  snapshot = query.matches;
  const onChange = () => {
    snapshot = query!.matches;
    listener();
  };
  query.addEventListener('change', onChange);
  return () => query!.removeEventListener('change', onChange);
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => (query ? snapshot : SERVER_SNAPSHOT),
    () => SERVER_SNAPSHOT,
  );
}
```

Then gate the JS springs on it — the CSS loops are already handled by the
existing media-query block:

```ts
// lib/motion.ts
export const SPRING = {
  /** Card leaving the rail. Snappy, slight overshoot. */
  pickup: { type: 'spring', stiffness: 620, damping: 32, mass: 0.6 },
  /** Clip arriving on a lane. Settles without wobbling a time-accurate object. */
  drop: { type: 'spring', stiffness: 480, damping: 38, mass: 0.8 },
  /** Panels, drawers, sheets. */
  surface: { type: 'spring', stiffness: 300, damping: 30 },
  /** Wire endpoints following a node. Loose enough to read as elastic. */
  wire: { type: 'spring', stiffness: 260, damping: 24 },
} as const;

export const INSTANT = { duration: 0 } as const;
```

`const t = useReducedMotion() ? INSTANT : SPRING.drop;` — one line at each use
site, and the reduced-motion path keeps every colour and position cue while
dropping only the travel.

### 4.7 Pattern: the FX chain as a node board

Same `FxSettings`, drawn as signal flow. Keep `FxRack.tsx` — a vertical list of
labelled sliders is more accessible and better on a phone than any board, and
AGENTS.md is explicit that the jam rails must render at every breakpoint because
`hidden lg:flex` there would leave a phone unable to record. So: **`FxBoard` is
the `lg:` presentation of the same state, never a replacement.**

```tsx
// components/board/Wire.tsx
interface WireProps {
  from: { x: number; y: number };
  to: { x: number; y: number };
  /** Audio is actually passing through — dashes march. */
  live?: boolean;
  /** Bypassed: drawn, but visibly not carrying anything. */
  bypassed?: boolean;
}

export function Wire({ from, to, live, bypassed }: WireProps) {
  // Horizontal cubic: control points pushed out along x by 40% of the span, so
  // the curve leaves and enters each port horizontally. Clamped to 24px so
  // near-vertical neighbours still get a readable bend.
  const dx = Math.max(24, Math.abs(to.x - from.x) * 0.4);
  const d = `M ${from.x} ${from.y} C ${from.x + dx} ${from.y}, ${to.x - dx} ${to.y}, ${to.x} ${to.y}`;

  return (
    <g>
      {/* Halo under the live wire. Widens the glow without blurring the line. */}
      {live ? (
        <path d={d} fill="none" stroke="var(--c-wire-live)" strokeWidth={6} opacity={0.16} />
      ) : null}
      <path
        d={d}
        fill="none"
        strokeWidth={1.5}
        strokeLinecap="round"
        stroke={live ? 'var(--c-wire-live)' : 'var(--c-wire)'}
        strokeDasharray={live ? '4 8' : bypassed ? '2 4' : undefined}
        className={live ? 'animate-wire-flow' : undefined}
      />
    </g>
  );
}
```

Three states, three readings, no colour beyond the ambient palette: **live**
(marching dashes + halo), **bypassed** (fine static dashes), **connected but
silent** (solid hairline).

Port anchors belong in `lib/board.ts` as pure functions of node geometry, not
measured from the DOM. Measuring with `getBoundingClientRect` on every render is
both slow and a source of one-frame-stale wires during a drag; deriving anchors
from the same layout numbers the nodes are positioned with keeps them exact.

```ts
// lib/board.ts
export interface NodeBox { x: number; y: number; w: number; h: number }

/** Output port sits on the right edge, vertically centred. */
export function outPort(box: NodeBox) {
  return { x: box.x + box.w, y: box.y + box.h / 2 };
}

export function inPort(box: NodeBox) {
  return { x: box.x, y: box.y + box.h / 2 };
}

/** Grid snap for free-positioned nodes. 16 matches the CSS grid pitch / 3.5. */
export function snapToGrid(value: number, pitch = 16): number {
  return Math.round(value / pitch) * pitch;
}
```

Reordering the chain with `@dnd-kit/sortable` is the natural next step and the
place to be careful: **the visual order must drive `guitarFx.ts`, or the board
lies about the signal path.** If reordering the audio graph is not implemented,
make the nodes non-sortable. A board that can be rearranged without changing the
sound is worse than a list.

### 4.8 Micro-interaction inventory

Each one earns its place by carrying information — the standard README already
sets ("motion must mean something").

| Interaction | Implementation | What it tells the user |
|---|---|---|
| Node hover | `hover:shadow-glow-cyan`, 200 ms CSS | interactive |
| Node active (audio flowing) | `animate-node-idle` (CSS loop) | this stage is processing |
| Node bypassed | `opacity-45` + fine dashed wire | in the chain, doing nothing |
| Card pickup | `SPRING.pickup`, scale 0.92 → 1, `rotate: -1.5` | detached from the list |
| Lane armed | `inset-ring` + `bg-drop/8`, 150 ms | droppable here |
| Lane refuses | `bg-drop-invalid/8` ring, no caret | not droppable, and why (tooltip) |
| Snap caret | `animate-drop-hint` + numeric readout | the exact second it will land |
| Clip arrival | `SPRING.drop` on scale/opacity | placed, and where |
| Selection | existing `ring-2 ring-ink` | which clip the toolbar acts on |
| Drawer / sheet | `SPRING.surface` + `AnimatePresence` | arrival direction = where it came from |
| Export progress | existing `exportState`, determinate bar | how long is left |
| Toast | existing `toast-in` + `toast-timer` | done, and how long it will linger |

Deliberately **not** on the list: parallax, tilt-on-hover cards, animated
gradient borders, page-load stagger longer than ~250 ms, and anything that moves
while audio is recording. The last one matters most — during a take the only
motion on screen should be the meters, the waveform, and the tally.

### 4.9 Keyboard and pointer parity

A workboard that only works with a mouse is a downgrade from the current list UI,
which is fully keyboard-operable. dnd-kit gives this almost free via
`KeyboardSensor`, but the coordinate getter must be told what a "step" means on a
timeline:

- `Tab` reaches every rail card and every node.
- `Space` / `Enter` picks up; arrows move; `Space` drops; `Escape` cancels.
- On the timeline, ← → step by one snap interval (not one pixel), ↑ ↓ change lane.
  `Timeline.tsx` already has `ArrowLeft` / `ArrowRight` nudging clips by 0.1 s —
  reuse that quantum so keyboard and pointer agree.
- Every drop that is refused must say why in `aria-live`, not just fail silently.

---

## 5. Phasing

Ordered so each phase ships something usable and nothing depends on a later one.

**Phase 1 — tokens and primitives. DONE.** Token additions in `globals.css`,
plus `lib/motion.ts`, `hooks/useReducedMotion.ts`, `lib/board.ts` and
`timeAtPointer` in `lib/timeline.ts`. No dependencies, no visual change.

- `lib/motion.ts` holds plain data, not library calls — the preset shape is what
  `motion` accepts as a `transition`, so adopting it in Phase 4 is an import
  rather than a rewrite, and nothing is added to any bundle until then.
- `timeAtPointer` went into `lib/timeline.ts` rather than `board.ts`: it is
  timeline maths and belongs with the module that already has 40/40 checks.
  `Timeline.tsx` still computes this inline; **both should call the shared
  function** before Phase 3 relies on the two agreeing.
- Verified: `55/55` checks from Node against `board.ts` and `timeAtPointer`,
  compiled per the AGENTS.md method. Includes the `reorder` off-by-one (a forward
  move targets `to - 1` because the splice-out shifts everything left) and a
  round-trip of `timeAtPointer` against `secToPx` at 12/64/320 px/s, which is what
  guarantees the Phase 3 caret and the placed clip cannot disagree.

**Phase 2 — `addClipFromAsset`. DONE.** In `useEditor`, plus a `+` button on each
rail card that places the asset at the playhead on the first unlocked track of its
own kind. Closes the functional gap, and works on touch and with a keyboard — it
stays as the accessible path once dragging lands.

Decisions taken, per §4.3:

- A **video** asset on an **audio** track is allowed (it contributes its own audio,
  which is why `scheduleAudio` includes video-track clips). An **audio** asset on
  the **video** track is refused — a silent gap on V1 that looks like a clip is
  worse than a refusal.
- `startSec` is clamped at 0, not rejected: a drop a few pixels left of the origin
  means "at the start".
- The new clip is selected inside the hook. The toolbar, the Delete keys and the
  gain/fade inspector all act on the selection, so the clip you just placed being
  the one they act on is the only sane default.
- Ids come from the existing `nextId` counter, never `crypto.randomUUID` — see
  `bumpIdCounter`, which re-seeds that counter past a restored draft. A second id
  scheme would sidestep it and alias two files onto one clip.

**Baseline for Phase 4.** Production builds, all four routes prerendered static
throughout:

| After | Client JS | CSS |
|---|---|---|
| Phase 1–2 | 18 files, 1,031 KB | 70 KB |
| Phase 3 (drag, hand-rolled) | 19 files, 1,035 KB | 71 KB |
| Phase 4 (playhead off the render path, editor) | 19 files, 1,037 KB | 71 KB |
| Phase 4b (same, jam) | 19 files, 1,038 KB | 71 KB |
| Phase 5–6 (FX board, glass pass) | 19 files, 1,046 KB | 73 KB |

**+15 KB of JS and +3 KB of CSS for the whole overhaul, phases 1–6.** Both libraries
the first draft of this document recommended — `@dnd-kit/core` and `motion` — were
dropped after measuring what they would have replaced. `package.json` is unchanged
throughout. Both libraries the first draft of this
document recommended were dropped after measuring what they would have replaced; if
a later phase does add one, compare against the Phase 4 row and treat a regression
on `/` — the recorder, which needs none of this — as a bug to code-split away.

**Phase 3 — rail → lane drag. DONE**, hand-rolled instead of on `@dnd-kit/core`
(see the revision note in §3). Phase 2's `+` button stays as the keyboard and touch
path.

What shipped:

- `hooks/useAssetDrag.ts` — the gesture, on `setPointerCapture`, mirroring
  `Timeline`'s idiom. 6 px activation threshold; a press on a card's own buttons is
  never a drag; Escape and `pointercancel` abandon it.
- `lib/timeline.ts` — `canPlaceOnTrack(track, assetKind)`, the **single** source of
  the placement rule. It is read in three places (the hook that creates the clip,
  the drag that previews it, the lane that tints itself) and three copies would
  drift into a UI that offers a drop the hook then refuses.
- `Timeline.tsx` — exports `HEADER_W`, `SCROLLER_ATTR`, `LANE_ATTR`; lanes tint
  while a drag is in flight; the armed lane draws a snap caret with its time.
- `EditorWorkspace.tsx` — `resolveDrop` hit-tests with `document.elementFromPoint`
  and snaps against the same `snapTargets` a dragged clip uses; the glass ghost;
  an `aria-live` line describing the current target.
- `Timeline.tsx` now calls the shared `timeAtPointer` instead of its own copy, which
  was the prerequisite noted in Phase 1.

Two performance decisions that are the point of the hook:

- The ghost is positioned by **writing `transform` directly** from the pointer
  handler. React state at 60 fps would re-render every clip in the timeline on
  every frame — the same rule the meters and the timecode follow.
- React state updates only when the **snapped** target changes, not when the
  pointer moves. A gesture costs a handful of renders instead of sixty a second.

**Known gaps, deliberately not done:** no auto-scroll when the drag reaches the
edge of the timeline (scroll first, then drag); no drag from a touch screen (the
rail is `hidden lg:flex`, and `+` is the touch path); no keyboard pickup (same).

**Phase 4 — motion pass. DONE, and `motion` was not added.** The same
proportionality test that rejected dnd-kit rejects it here.

What `motion` was wanted for, and what replaced it:

| Wanted | Instead |
|---|---|
| `MotionValue` so the playhead does not re-render React | `useAnimationFrame` + a getter, the idiom `recorder/TimeCode` and `LevelMeter` already use |
| Springs on arrival | `--animate-pop-in` already exists in `globals.css`, with the overshoot curve `--ease-spring` |
| `AnimatePresence` exits | Nothing here needs an exit animation badly enough to import a runtime for it |

The real content of this phase turned out to be a **live performance bug**, not
polish. `setPlayhead(next)` was being called from inside `requestAnimationFrame`
(`useEditor`), so during playback the workspace, the timeline, every clip and every
ruler tick re-rendered 60 times a second — precisely the pattern AGENTS.md keeps the
meters and the timecode out of React to avoid.

The fix, and the one thing that made it non-trivial:

- `lib/timeline.ts` gained `playheadFrame` / `samePlayheadFrame` — *what React
  actually renders* from the playhead, namely the whole second and the id of the
  video clip on screen. `commitPlayhead` sets state only when that pair changes.
- **The `clipId` half is a correctness requirement, not an optimisation.**
  `activeVideoAsset` is derived from the committed playhead, so if state stopped
  updating during playback the monitor would keep showing the outgoing clip across
  a cut. Found by reading `useEditor:1287`, not by guessing.
- `syncPlayhead` forces the two back into agreement wherever motion stops —
  `pause`, `endScrub`, end of timeline. Without it, React's copy can be up to a
  second behind and the next re-render snaps the playhead backwards. `endScrub` had
  to sync *before* its early return, which only matters for a scrub that did not
  resume playback.
- Smooth motion now comes from refs: `PlayheadClock` paints the transport readout,
  and `Timeline` paints the playhead line's `left`, both from one animation frame,
  gated on `isPlaying || isScrubbing`.
- Anything reading the playhead at gesture time — clip-drag snapping, the drop
  caret, the `+` button — now calls `getPlayhead()`, because React's copy is
  deliberately stale. The `+` button's tooltip lost its timestamp for the same
  reason: a rendered time there would not have matched where the clip lands.
- `Timeline`'s playhead `aria-label` no longer interpolates the time. A label that
  changed 60×/s was noise to a screen reader and a re-render to produce.

Verified: **23/23** new Node checks, including a 6000-step sweep proving the gate's
second boundary lands exactly where `formatTimecode`'s output changes, and a cut
placed *inside* a second — the case that would have broken the monitor — forcing a
render anyway. A simulated 6 s playback commits **5** renders where the old code
committed 360.

**Phase 4b — the same fix on the jam page. DONE.** `/jam` had the identical bug:
`setPlayhead` inside `requestAnimationFrame`, three `formatTimecode(playhead)`
readouts, and `JamLanes` taking `playhead: number` to position its line.

Simpler than the editor's, for a reason worth recording: **nothing in `useJam` is
derived from the committed playhead.** Jam has one source, not clips that cut from
one to the next, so there is no "which clip is on screen" to force a render for —
the gate is whole seconds alone. Verified by grepping every use of the state, not
assumed from the shape of the editor fix.

- `lib/format.ts` gained `displayedSecond`, deliberately housed **beside
  `formatTimecode`** — both engines gate on it, and if the two ever disagreed about
  granularity the readout would visibly stop keeping time. `playheadFrame` now
  delegates to it, so editor and jam share one definition of "a visible change".
- `PlayheadClock` moved from `components/editor/` to `components/ui/`, since both
  transports use it.
- `JamLanes` paints its playhead line's `left` from one animation frame, gated on
  `isPlaying || isDragging`.
- Every remaining `playheadRef.current = x; setPlayhead(x)` pair in **both** hooks
  now goes through `syncPlayhead` — `seek`, `play`, the resets, the draft restore.
  Writing the ref and the state separately left the gate's bookkeeping stale, which
  is not a visible bug today but is exactly the kind of drift that becomes one.

Verified: **16/16** further Node checks, including a 602,000-step sweep (0→10 min at
1 ms, plus the hour rollover) proving `displayedSecond` changes exactly where
`formatTimecode`'s output does, and a simulation showing 30 s of jam playback commits
**29** renders where the old code committed 1,800.

**Phase 5 — FX board. DONE**, and built differently from the sketch above.

The plan said "`FxBoard.tsx` at `lg:` only, with `FxRack` still rendering below".
Two things changed that:

1. **The topology is not a chain** (see the correction in §3). The board had to draw
   a fan-out and a merge, or it would have misrepresented the signal path.
2. **A breakpoint swap would have duplicated every control.** `FxRack` has five
   pedals with their sliders inline; a second layout of the same parameters is two
   places to keep in sync and a guaranteed divergence. And the jam rail is a bottom
   sheet on phones, so an `lg:`-only board would have hidden the map on exactly the
   screens where the signal path is hardest to picture.

So `FxBoard` is a **map, not a replacement**: it renders at every breakpoint above
`FxRack`, answers "where does my signal go", and leaves every parameter to the rack.
Nodes are switchable — tapping one bypasses that stage — but nothing else.

- `lib/fxGraph.ts` — pure. Nodes and edges with geometry, derived from `FxSettings`.
- `lib/board.ts` — gained `topPort`, `bottomPort`, `verticalWirePath`. The flow is
  vertical because the rail is 256 px on desktop and a sheet on a phone; a
  left-to-right board would need horizontal scrolling in both.
- `components/board/Wire.tsx` — one `<path>` per edge, marching dashes plus a halo
  when live, fine static dashes when not.
- `components/jam/FxBoard.tsx` — the SVG plus absolutely-positioned node chips.

The distinction the board exists to make, and the reason `inPath` and `active` are
separate fields: **a disabled stage stays in the signal path, a disabled send does
not.** Drive gets a null curve, the EQ goes to 0 dB, the compressor goes to ratio 1
— all still in the graph, doing nothing. Only `delayWet` and `reverbWet` actually
reach zero gain. So the board has three readings: shaping (accent + `node-idle`
glow), in-path but inert (plain), and out of path (dimmed).

**Deliberately not draggable.** Reordering nodes would imply reordering the audio,
and `createFxChain` is fixed. A board that rearranges without changing the sound is
worse than no board.

Verified: **44/44** Node checks on `fxGraph` and the new geometry, including
assertions that delay never feeds reverb and vice versa, that the spine stays live
with every effect switched off, that `enabled` with `mix: 0` is not live, that the
three branch nodes share a row without overlapping, and that the serial nodes are
centred. Confirmed in the served markup: seven nodes, `animate-wire-flow`,
`animate-node-idle`, `grid-overlay`.

**Phase 6 — glass and depth pass. DONE**, and deliberately small.

Applied:

- **Jam rails** — `bg-veil backdrop-blur-xl` below `lg`, where they are bottom
  sheets floating over the page, reverting to opaque `lg:bg-base` where they are
  docked columns. This is the rule in §1.1 exactly: glass only where the layer is
  temporary and nothing behind it must be read.
- **FX board ground** — the `grid-overlay` class, which had been written in an
  earlier design pass and then left unused by every component. A board is the one
  surface it belongs on.
- The drag ghost already got its glass in Phase 3.

Deliberately **not** applied, with reasons:

- **Node cards stay opaque.** Wires run underneath them; translucency would let a
  wire appear to pass *through* a node, which reads as a connection that does not
  exist. Correctness beats the effect.
- **`Panel`, the video monitor, the inspector** — this is the exact case the README
  records as removed for washing colour over video and text.
- **`ui/Toast.tsx` stays `bg-solid`.** It floats, so the rule would permit glass,
  but its job is to be *read* at a glance — it carries a filename and a thumbnail.

**Still needs a browser.** The mechanical part is done; the judgement is not. Check
the phone sheets over a bright video frame in both themes and confirm the slider
labels are still legible — that readability call is the one this phase failed on
last time, and it cannot be made from a type-check.

---

## 6. What must still be true afterwards

A UI refactor can silently undo audio-path decisions. Before claiming any phase
is done, re-read the "Do not undo these" list in [AGENTS.md](AGENTS.md). The ones
this work can plausibly break:

- `useJam` and `useEditor` still called **once**, in `StudioProviders`, above the
  router. A `DndContext` or `LazyMotion` provider added in the wrong place can
  push them down the tree.
- `StudioProviders` still hands React the **same `children` element** every
  render. Wrapping `children` in a new provider that has its own state
  reintroduces the full-app re-render per playhead tick. Add drag context *inside*
  a route, not around the app.
- Meters, waveform and timecode still paint from refs in one rAF loop.
- The jam rails still render at every breakpoint.
- Red still means live or broken, nothing else.
- Every route still prerenders without a hydration mismatch — no `navigator`,
  `matchMedia` or `MediaRecorder` read during render.

And the standing caveat from AGENTS.md: live capture, the sync engine, video
export, drafts, the whole jam page and cross-route playback **have never run in a
real browser.** A UI overhaul cannot be reported as working on the strength of a
type-check. The drag gestures in particular need a real pointer, a real touch
screen, and a real keyboard.
