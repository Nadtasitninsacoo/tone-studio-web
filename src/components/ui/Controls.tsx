import type { ReactNode } from 'react';

/**
 * Small controls shared by the editor's clip inspector and the jam page's racks.
 *
 * Extracted when the second caller appeared rather than the third: these encode
 * the app's control sizing and the `.fader` styling, and a divergent copy would
 * show up immediately as two slightly different sliders on adjacent screens.
 */

interface MiniSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  /** Right-aligned readout, e.g. a formatted dB or percentage value. */
  readout?: string;
  /** Custom CSS class for the input element */
  inputClassName?: string;
}

/** Compact labelled slider. */
export function MiniSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  disabled,
  readout,
  inputClassName,
}: MiniSliderProps) {
  return (
    <label
      className={`flex flex-col gap-0.5 min-w-[70px] flex-1 select-none ${disabled ? 'opacity-40' : ''}`}
    >
      {label ? (
        <span className="font-mono text-[9px] tracking-wider uppercase text-ink-3">
          {label}
        </span>
      ) : null}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className={`fader h-4! w-full ${inputClassName ?? ''}`}
      />
      {readout ? (
        <span className="text-center font-mono text-[9px] tabular-nums text-ink-2 mt-0.5">
          {readout}
        </span>
      ) : null}
    </label>
  );
}

interface IconToggleProps {
  onClick: () => void;
  active: boolean;
  /** Classes applied when active — the colour carries the meaning here. */
  activeClass: string;
  title: string;
  children: ReactNode;
}

/** Small square toggle, used in track and layer headers. */
export function IconToggle({ onClick, active, activeClass, title, children }: IconToggleProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className={`flex h-5 w-5 items-center justify-center rounded transition-colors duration-200 ${
        active ? activeClass : 'text-ink-3 hover:bg-raised hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}
