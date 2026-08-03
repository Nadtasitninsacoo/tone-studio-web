'use client';

import { Power } from 'lucide-react';
import { Children, isValidElement, useRef, type ReactNode, type RefObject } from 'react';

import { useAnimationFrame } from '@/hooks/useAnimationFrame';

/**
 * The furniture every rack is built from.
 *
 * Extracted when the second and third racks arrived. They were private to `AmpRack`
 * while it was the only one; three copies of a stomp-switch row is three places for
 * the switch to stop looking like the other two, and the whole point of the three
 * racks sharing a page is that they read as one instrument with three inputs.
 *
 * Nothing here knows about an amp, a bass or a drum kit. That is the test for
 * whether something belongs in this file.
 */

/** dB with an explicit sign, the way a console prints it. */
export function signed(value: number): string {
  return `${value > 0 ? '+' : ''}${value}dB`;
}

export function Legend({ children }: { children: string }) {
  return (
    <p className="mb-1 font-mono text-[9px] font-semibold tracking-[0.16em] uppercase text-ink-3">
      {children}
    </p>
  );
}

/** One named group of controls. */
/**
 * A titled group of controls, with an optional line naming what is inside it.
 *
 * `contains` exists because the block names describe a **position in the chain** —
 * "Front end", "Output" — and a reader who does not already know the chain cannot
 * tell what is in them. That is not hypothetical: a careful reader went through this
 * rack and reported the compressor and the limiter as *missing features*. Both are
 * here, and have been all along; they are inside "Front end" and "Output".
 *
 * Naming the position is still right — it is what makes the column order legible as
 * a signal path. The subtitle is the cheap half of the fix: keep the structural name,
 * and say what it holds.
 */
export function Block({
  name,
  contains,
  children,
}: {
  name: string;
  /** The stages inside, in signal order. Shown under the title. */
  contains?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-line bg-base p-2">
      <Legend>{name}</Legend>
      {contains ? (
        <p className="-mt-0.5 mb-1 font-mono text-[9px] leading-tight tracking-wide text-ink-3">
          {contains}
        </p>
      ) : null}
      <div className="flex flex-col gap-1">{pairRows(children)}</div>
    </section>
  );
}

/** Knobs sit in a wrapping row so a narrow column reflows instead of clipping. */
export function KnobRow({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center justify-start gap-x-1.5 gap-y-0.5">{children}</div>;
}

/**
 * Put a stage's controls on the same line as its name.
 *
 * A section like GATE was a header row, and then a whole row below it holding one
 * knob — four lines of height for one control, most of it air, repeated down every
 * column of every rack. Beside the header it is one line.
 *
 * Done here rather than by rewriting six racks: `Block` already receives them as
 * siblings, so pairing a `Row` with the `KnobRow` that immediately follows costs
 * one function and reaches every rack at once. **The pairing is positional, and
 * failing it is harmless** — anything between them, or a `KnobRow` standing alone,
 * simply renders as it always did, stacked. That is the whole reason it is safe to
 * do by structure rather than by asking six files to opt in.
 *
 * It wraps: on a narrow column the knobs drop back under the header rather than
 * squeezing, which is the same `flex-wrap` bargain `KnobRow` itself already makes.
 */
function pairRows(children: ReactNode): ReactNode {
  const items = Children.toArray(children);
  const out: ReactNode[] = [];

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const next = items[i + 1];
    const pairable =
      isValidElement(item) && item.type === Row && isValidElement(next) && next.type === KnobRow;

    if (!pairable) {
      out.push(item);
      continue;
    }

    out.push(
      <div key={`pair-${i}`} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <div className="min-w-40 flex-1">{item}</div>
        {next}
      </div>,
    );
    i += 1;
  }

  return out;
}

/** A named stage with a stomp-style enable that dims the controls when off. */
export function Row({
  label,
  enabled,
  onToggle,
  hint,
  accent,
  children,
}: {
  label: string;
  enabled: boolean;
  onToggle: () => void;
  hint: string;
  accent: string;
  children?: ReactNode;
}) {
  return (
    <div className="mt-0.5 flex items-center gap-2 border-t border-line pt-1" title={hint}>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={enabled}
        title={enabled ? `Bypass ${label}` : `Enable ${label}`}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-3 transition-colors duration-200 hover:bg-raised hover:text-ink"
        style={
          enabled
            ? { color: accent, backgroundColor: `color-mix(in srgb, ${accent} 16%, transparent)` }
            : undefined
        }
      >
        <Power aria-hidden className="h-3 w-3" />
      </button>
      <h4
        className={`flex-1 text-[10px] font-semibold tracking-[0.14em] uppercase ${
          enabled ? 'text-ink' : 'text-ink-3'
        }`}
      >
        {label}
      </h4>
      {children}
    </div>
  );
}

/**
 * Gain-reduction readout, painted from an animation frame.
 *
 * The worklets report about 20 times a second and the value changes constantly.
 * Routing it through React state would re-render the whole rack — every knob, every
 * button — at that rate, for one text node.
 */
export function GainReduction({
  label,
  reductionRef,
  active,
}: {
  label: string;
  reductionRef: RefObject<number>;
  active: boolean;
}) {
  const nodeRef = useRef<HTMLSpanElement>(null);
  const lastRef = useRef('');

  useAnimationFrame(() => {
    const value = reductionRef.current ?? 0;
    // Below a tenth of a dB there is nothing to report; showing "-0.0" flickering is
    // worse than showing nothing.
    const text = value <= -0.1 ? value.toFixed(1) : '0.0';
    if (text === lastRef.current) return;
    lastRef.current = text;
    if (nodeRef.current) nodeRef.current.textContent = text;
  }, active);

  return (
    <span
      title="Gain reduction, dB"
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap ${
        active ? 'border-cyan/40 bg-cyan/8 text-cyan' : 'border-line bg-inset text-ink-3'
      }`}
    >
      {label ? <span className="tracking-wider uppercase">{label}</span> : null}
      <span ref={nodeRef} className="font-numeric">
        0.0
      </span>
    </span>
  );
}

/**
 * The bypass switch a rack puts in its panel header.
 *
 * One switch shared by three racks, because it means the same thing in all three:
 * take the whole chain out of the monitor path.
 */
export function BypassSwitch({
  isEnabled,
  onToggle,
  disabled,
  accent,
}: {
  isEnabled: boolean;
  onToggle: () => void;
  disabled?: boolean;
  accent: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={isEnabled}
      title={isEnabled ? 'Bypass the chain' : 'Enable the chain'}
      className="flex h-6 items-center gap-1.5 rounded-md border px-2 font-mono text-[10px] font-bold tracking-wider uppercase transition-colors duration-200 disabled:pointer-events-none disabled:opacity-40"
      style={
        isEnabled
          ? {
              borderColor: accent,
              color: accent,
              backgroundColor: `color-mix(in srgb, ${accent} 14%, transparent)`,
            }
          : undefined
      }
    >
      <Power aria-hidden className="h-3 w-3" />
      {isEnabled ? 'On' : 'Off'}
    </button>
  );
}
