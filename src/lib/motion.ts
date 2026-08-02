/**
 * Motion presets for the workboard layer.
 *
 * Plain data on purpose. Nothing here imports an animation library, so the
 * presets cost nothing at runtime and every route keeps its current bundle; the
 * shape matches what Framer Motion / `motion` accepts as a `transition`, so
 * adopting it later is an import, not a rewrite. See DESIGN-OVERHAUL.md §4.5 for
 * why the playhead must move through a `MotionValue` rather than React state.
 *
 * These are for GESTURES and one-shot arrivals. Every looping animation stays in
 * CSS (`globals.css`), where the `prefers-reduced-motion` block already handles
 * it — JS-driven motion has to consult `useReducedMotion` by hand.
 */

export interface Spring {
  type: 'spring';
  stiffness: number;
  damping: number;
  mass?: number;
}

export interface Timed {
  duration: number;
  ease?: readonly [number, number, number, number];
}

/** `--ease-drop` from globals.css, so CSS and JS settle identically. */
export const EASE_DROP = [0.2, 0.9, 0.2, 1] as const;

export const SPRING = {
  /** A card leaving the rail. Snappy, with just enough overshoot to read as lifted. */
  pickup: { type: 'spring', stiffness: 620, damping: 32, mass: 0.6 },
  /**
   * A clip arriving on a lane. Damped harder than `pickup`: a time-accurate
   * object that wobbles after landing looks like it is still deciding where it is.
   */
  drop: { type: 'spring', stiffness: 480, damping: 38, mass: 0.8 },
  /** Panels, drawers, sheets — anything the size of a surface rather than a chip. */
  surface: { type: 'spring', stiffness: 300, damping: 30 },
  /** A wire endpoint trailing its node. Loose enough to read as elastic. */
  wire: { type: 'spring', stiffness: 260, damping: 24 },
} as const satisfies Record<string, Spring>;

/**
 * The reduced-motion transition. Not "a fast spring" — zero duration, so the
 * element is simply where it belongs. Every colour and position cue survives;
 * only the travel is dropped.
 */
export const INSTANT: Timed = { duration: 0 };

/** Pick a transition for the user's motion preference. */
export function transition(preset: Spring, prefersReduced: boolean): Spring | Timed {
  return prefersReduced ? INSTANT : preset;
}
