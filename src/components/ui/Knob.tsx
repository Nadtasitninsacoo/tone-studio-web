'use client';

import {
  useCallback,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import {
  pointOnPolygon,
  polygonArcPath,
  polygonPoints,
  quantise,
  type PolygonSpec,
} from '@/lib/gauge';

import { usePressAndHold } from '@/hooks/usePressAndHold';

/**
 * Knob — a rotary control drawn as an octagonal gauge.
 *
 * Why a knob rather than the slider it replaces: an amplifier has a dozen or more
 * continuous controls, and a column of horizontal sliders gives every one of them
 * the same silhouette. Nothing is findable by shape, so reaching for "treble"
 * means reading four labels. A gauge has a *pointer angle*, legible at a glance
 * and from across a room — the reason real amplifiers use them is not decoration.
 *
 * ---------------------------------------------------------------------------
 * Three things that make a web knob usable rather than a novelty.
 *
 * 1. **Vertical drag, not rotation.** Chasing a shape with a pointer is
 *    unpleasant and impossible on a trackpad; every audio application on every
 *    platform maps a knob to vertical movement instead. Full range is 180 px of
 *    travel, and holding Shift stretches that to 720 px for fine work.
 * 2. **A real slider for assistive technology.** The visual is an SVG, but the
 *    element carries `role="slider"` with the value, bounds and text, and
 *    responds to arrows, page keys, Home and End. A control only a mouse can
 *    reach is not finished.
 * 3. **Bipolar controls fill from the centre.** A tone control at 0 dB is *not*
 *    an empty knob — it is a knob doing nothing, and drawing it empty makes −12
 *    and 0 look like the same amount of "off". The gauge grows from `origin`, so
 *    cut and boost read as opposite directions rather than as less and more.
 * ---------------------------------------------------------------------------
 *
 * The geometry lives in `lib/gauge.ts` and is checked from Node: the track is a
 * real octagon, not a circle with eight points suggested along it. Measured, a
 * circle of the same radius departs from the true edge by 7.6% of the radius,
 * which at this size is a visible bulge between the corners.
 */

interface KnobProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  /** Formatted value shown under the knob. */
  readout?: string;
  /** CSS colour for the gauge, e.g. `var(--c-cyan)`. */
  accent: string;
  /**
   * Value the gauge is measured from. Defaults to `min`.
   *
   * Set to 0 for anything bipolar — tone controls, trims — so the fill shows the
   * direction and size of the change rather than the absolute position.
   */
  origin?: number;
  /** Longer explanation for the title attribute. */
  hint?: string;
}

/** Pixels of vertical travel for the full range, and with Shift held. */
const TRAVEL_PX = 180;
const FINE_TRAVEL_PX = 720;

/** The gauge spans 270°, leaving a gap at the bottom where the pointer starts. */
const START_ANGLE = 135;
const SWEEP = 270;

const CENTRE = { x: 24, y: 24 };

/** Octagon, road-sign orientation. See `PolygonSpec.firstVertexDeg`. */
function octagon(circumradius: number): PolygonSpec {
  return { sides: 8, circumradius, firstVertexDeg: 22.5, centre: CENTRE };
}

const TRACK = octagon(18);
const CAP = octagon(12);
const HALO = octagon(21);

export function Knob({
  label,
  value,
  min,
  max,
  step,
  onChange,
  disabled,
  readout,
  accent,
  origin,
  hint,
}: KnobProps) {
  const drag = useRef<{ startY: number; startValue: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const decrementHandlers = usePressAndHold(() => {
    onChange(quantise(value - step, min, max, step));
  });

  const incrementHandlers = usePressAndHold(() => {
    onChange(quantise(value + step, min, max, step));
  });

  const range = max - min || 1;
  const fraction = Math.min(1, Math.max(0, (value - min) / range));
  const originFraction = Math.min(1, Math.max(0, ((origin ?? min) - min) / range));

  const valueAngle = START_ANGLE + fraction * SWEEP;
  const originAngle = START_ANGLE + originFraction * SWEEP;

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (disabled) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { startY: event.clientY, startValue: value };
      setIsDragging(true);
    },
    [disabled, value],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const state = drag.current;
      if (!state) return;
      // Up is more. Measured from where the press started rather than accumulated
      // per event, so a dropped frame cannot leave the knob drifting behind the
      // pointer for the rest of the gesture.
      const travelled = state.startY - event.clientY;
      const perPixel = range / (event.shiftKey ? FINE_TRAVEL_PX : TRAVEL_PX);
      onChange(quantise(state.startValue + travelled * perPixel, min, max, step));
    },
    [max, min, onChange, range, step],
  );

  const endDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = null;
    setIsDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (disabled) return;
      const moves: Record<string, number> = {
        ArrowUp: step,
        ArrowRight: step,
        ArrowDown: -step,
        ArrowLeft: -step,
        PageUp: step * 10,
        PageDown: step * -10,
      };

      if (event.key in moves) {
        event.preventDefault();
        onChange(quantise(value + moves[event.key], min, max, step));
        return;
      }
      if (event.key === 'Home') {
        event.preventDefault();
        onChange(min);
      } else if (event.key === 'End') {
        event.preventDefault();
        onChange(max);
      }
    },
    [disabled, max, min, onChange, step, value],
  );

  const [pointerX, pointerY] = pointOnPolygon(valueAngle, octagon(12.5));
  const [innerX, innerY] = pointOnPolygon(valueAngle, octagon(7));
  // A fill of exactly zero length still renders a dot with a round cap, which
  // reads as a value the control does not have.
  const hasFill = Math.abs(valueAngle - originAngle) > 0.5;

  return (
    <div
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuetext={readout ?? String(value)}
      aria-disabled={disabled || undefined}
      title={hint ? `${label} — ${hint}` : label}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={handleKeyDown}
      className={`flex touch-none flex-col items-center gap-0.5 rounded-lg px-1 py-1 outline-none select-none focus-visible:ring-2 focus-visible:ring-cyan/60 ${
        disabled ? 'pointer-events-none opacity-35' : 'cursor-ns-resize'
      }`}
    >
      <svg viewBox="0 0 48 48" className="h-10 w-10 sm:h-11 sm:w-11" aria-hidden>
        <path
          d={polygonArcPath(START_ANGLE, START_ANGLE + SWEEP, TRACK)}
          fill="none"
          strokeWidth={3.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="stroke-line-strong"
        />
        {hasFill ? (
          <path
            d={polygonArcPath(originAngle, valueAngle, TRACK)}
            fill="none"
            strokeWidth={3.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ stroke: accent }}
          />
        ) : null}

        {/* Cap: a solid octagon for the pointer to sit on. */}
        <polygon
          points={polygonPoints(CAP)}
          className="fill-raised stroke-line"
          strokeWidth={1}
          strokeLinejoin="round"
        />
        <line
          x1={innerX}
          y1={innerY}
          x2={pointerX}
          y2={pointerY}
          strokeWidth={2.5}
          strokeLinecap="round"
          style={{ stroke: accent }}
        />

        {/* An outline while dragging, so the knob being changed stays obvious once
            the pointer has travelled away from it. */}
        {isDragging ? (
          <polygon
            points={polygonPoints(HALO)}
            fill="none"
            strokeWidth={1}
            strokeLinejoin="round"
            style={{ stroke: accent, opacity: 0.4 }}
          />
        ) : null}
      </svg>

      <span className="font-mono text-[8px] leading-none tracking-[0.12em] whitespace-nowrap uppercase text-ink-3">
        {label}
      </span>
      <div className="flex items-center gap-1 mt-0.5" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          disabled={disabled}
          title={`ลดค่า ${label}`}
          className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded border border-line bg-raised font-mono text-[9px] font-bold text-ink-3 hover:text-ink active:scale-95 transition-all duration-100 disabled:pointer-events-none disabled:opacity-35 select-none"
          {...decrementHandlers}
        >
          -
        </button>
        <span className="min-w-8 text-center font-numeric text-[9px] leading-none tabular-nums text-ink-2">
          {readout ?? String(value)}
        </span>
        <button
          type="button"
          disabled={disabled}
          title={`เพิ่มค่า ${label}`}
          className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded border border-line bg-raised font-mono text-[9px] font-bold text-ink-3 hover:text-ink active:scale-95 transition-all duration-100 disabled:pointer-events-none disabled:opacity-35 select-none"
          {...incrementHandlers}
        >
          +
        </button>
      </div>
    </div>
  );
}
