'use client';

import { useAccent } from '@/hooks/useAccent';
import { ACCENT_MARKERS, setAccentHue } from '@/lib/accent';

/**
 * AccentRail — one long colour rail for the knob accent.
 *
 * ---------------------------------------------------------------------------
 * This replaces seven swatches and a 16px slider, and the swatches are not missed.
 *
 * The old control offered six named hues as square buttons plus a token slider for
 * "something else", which put the interesting control last and smallest. It also
 * implied the six were different in kind from the seventh — they were not. Every
 * accent, named or not, ends up as one number that `globals.css` turns into a colour
 * twice, once per theme, so a hue chosen by dragging is exactly as theme-correct as
 * a hue that had a name. There was nothing for the named list to protect.
 *
 * So: one rail, the full sweep, land anywhere. The app's own nine hues stay on it as
 * **markers** — `pointer-events-none`, so they never intercept a drag — because
 * knowing where the interface's own cyan sits is worth a 1px tick, and being able to
 * drag onto it is the whole point of a continuous control. The ticks are ink rather
 * than each hue's own colour, which would be invisible against the sweep under it.
 *
 * The track is an oklch sweep rather than the usual `hsl()` rainbow, and every stop
 * carries its own hue's **measured** lightness and chroma — the most saturated pair
 * that still clears WCAG AA, which is what `setAccentHue` will hand the graph if you
 * stop there. It used to be one fixed lightness and chroma for the whole sweep, on
 * the grounds that even brightness stops the rail looking banded. That was true, and
 * it was also a rail advertising colours the accent could not produce: the constant
 * chroma sat outside sRGB for most of the wheel, so both the rail and the swatch were
 * being mapped back onto the gamut wall — pastel, with neighbouring degrees
 * indistinguishable. See `accentTone` in `lib/accent.ts` and `--rail-sweep` in
 * `globals.css`.
 * ---------------------------------------------------------------------------
 */
export function AccentRail() {
  const { hue, accent } = useAccent();

  return (
    <div className="flex items-center gap-1.5" title={`สีปุ่มหมุน — ${hue}°`}>
      <div className="relative h-5 w-36 shrink-0 sm:w-52">
        {/* The markers sit under the input and never take a pointer event, so a drag
            that crosses one is still a drag. */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-full">
          {ACCENT_MARKERS.map((marker) => (
            <span
              key={marker.id}
              className="absolute top-0 h-full w-px bg-ink/45"
              style={{ left: `${(marker.hue / 360) * 100}%` }}
            />
          ))}
        </div>

        <input
          type="range"
          min={0}
          max={360}
          step={1}
          value={hue}
          onChange={(event) => setAccentHue(Number(event.target.value))}
          aria-label="สีปุ่มหมุน"
          className="hue-slider absolute inset-0 h-full w-full cursor-pointer appearance-none rounded-md border border-line bg-transparent"
        />
      </div>

      {/* The result, at the size a swatch used to be. It is the one place the chosen
          colour is shown against nothing else, which is where a hue that looked fine
          on a knob turns out to be unreadable. */}
      <span
        aria-hidden
        className="h-4 w-4 shrink-0 rounded-sm border border-line"
        style={{ backgroundColor: accent.colour }}
      />
    </div>
  );
}
