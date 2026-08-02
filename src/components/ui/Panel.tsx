import type { ReactNode } from 'react';

interface PanelProps {
  /** Small uppercase label in the panel header, e.g. "TRANSPORT". */
  title?: string;
  /** Optional icon rendered left of the title. */
  icon?: ReactNode;
  /** Right-aligned header slot for chips, counters or actions. */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Remove body padding when the child manages its own spacing (lists, tables). */
  flush?: boolean;
  /**
   * Marks the panel as genuinely capturing audio. Draws a red top strip only —
   * a thin, unmissable indicator that costs no legibility.
   *
   * Reserved for recording. It is NOT for "busy" or "playing": tinting a whole
   * panel red for playback was actively misleading.
   */
  live?: boolean;
}

/**
 * Panel — the surface primitive every module sits on.
 *
 * Opaque background, one clearly visible hairline border, no decoration behind the
 * content. An earlier version layered translucent glass over animated colour
 * glows; it photographed well and was unusable, washing colour across video and
 * text. Contrast wins over atmosphere.
 */
export function Panel({
  title,
  icon,
  actions,
  children,
  className = '',
  flush,
  live,
}: PanelProps) {
  return (
    <section
      className={`relative flex flex-col overflow-hidden rounded-xl border bg-panel shadow-panel transition-colors duration-200 ${
        live ? 'border-rec/60' : 'border-line'
      } ${className}`}
    >
      {/* Recording indicator: a solid strip, no animation over content. */}
      {live ? <span aria-hidden className="absolute inset-x-0 top-0 h-0.5 bg-rec" /> : null}

      {title ? (
        <header className="flex items-center justify-between gap-2 border-b border-line bg-raised px-3 py-2 sm:px-3.5">
          <div className="flex min-w-0 items-center gap-2 text-ink-2">
            {icon}
            <h2 className="truncate text-[11px] font-semibold tracking-[0.14em] uppercase sm:text-xs">
              {title}
            </h2>
          </div>
          {actions ? (
            <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">{actions}</div>
          ) : null}
        </header>
      ) : null}

      <div className={flush ? 'flex-1' : 'flex-1 p-2.5 sm:p-3'}>{children}</div>
    </section>
  );
}

interface ChipProps {
  children: ReactNode;
  /**
   * Visual weight. `muted` for metadata, `strong` for the active/armed state,
   * `hot` for anything approaching clipping, `danger` for live recording.
   */
  tone?: 'muted' | 'strong' | 'hot' | 'danger';
  className?: string;
  title?: string;
}

/** Chip — compact monospace metadata tag (sample rate, bit depth, channels). */
export function Chip({ children, tone = 'muted', className = '', title }: ChipProps) {
  const tones: Record<NonNullable<ChipProps['tone']>, string> = {
    muted: 'border-line bg-inset text-ink-2',
    strong: 'border-cyan/50 bg-cyan/12 text-cyan',
    hot: 'border-rec/45 bg-rec/10 text-rec',
    danger: 'border-rec/60 bg-rec/15 text-rec',
  };

  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-wide whitespace-nowrap uppercase sm:px-2 ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
