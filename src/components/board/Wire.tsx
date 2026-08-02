interface WireProps {
  /** Path data from `lib/board`'s wire helpers. */
  d: string;
  /** Carrying signal right now — dashes march along it. */
  live: boolean;
}

/**
 * Wire — one connector on a signal-flow board.
 *
 * Hand-rolled SVG rather than a graph library. The topology it draws is fixed
 * (see `lib/ampGraph`), so there is no viewport, no pan/zoom and no node dragging
 * to model; what is left is one `<path>` per edge, which themes straight from the
 * CSS variables and costs nothing.
 *
 * Two states, and the distinction carries information: a **live** wire marches
 * (its dash offset animates via `animate-wire-flow`) and gets a soft halo, while a
 * silent one is a fine static dash. Colour stays in the ambient palette — red
 * means live-or-broken everywhere else in this app, and a wire carrying audio is
 * neither.
 */
export function Wire({ d, live }: WireProps) {
  return (
    <g>
      {/* Halo under the live wire. A wider, faint copy rather than a blur filter:
          filters force the whole SVG onto its own surface every frame. */}
      {live ? (
        <path d={d} fill="none" stroke="var(--c-wire-live)" strokeWidth={5} opacity={0.16} />
      ) : null}

      <path
        d={d}
        fill="none"
        strokeWidth={1.5}
        strokeLinecap="round"
        stroke={live ? 'var(--c-wire-live)' : 'var(--c-wire)'}
        strokeDasharray={live ? '4 8' : '2 5'}
        className={live ? 'animate-wire-flow' : undefined}
      />
    </g>
  );
}
