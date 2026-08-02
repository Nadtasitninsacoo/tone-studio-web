/**
 * Accent colour store for the amp's knobs.
 *
 * An external store read through `useSyncExternalStore`, not React state, for the
 * same reason `lib/theme.ts` is one: the value lives in `localStorage`, and
 * reading storage during render makes the first client render disagree with the
 * server HTML. Every route here is prerendered, so that disagreement is a
 * hydration error rather than a flicker.
 *
 * The server snapshot and the first client snapshot are deliberately the same
 * constant; the stored value arrives on the first subscription, which is after
 * hydration.
 *
 * ---------------------------------------------------------------------------
 * The free hue, and why it is one CSS variable rather than a colour string.
 *
 * A preset accent resolves to `var(--c-cyan)`, which is defined twice in
 * `globals.css` — a bright value for the dark theme and a darkened one that clears
 * WCAG AA on white. A hue chosen at runtime has to do the same, and a JS-generated
 * `oklch(...)` string cannot: it would carry one fixed lightness, correct in one
 * theme and wrong in the other.
 *
 * So the picker writes **numbers** — never a colour — and `globals.css` builds the
 * colour from them once per theme. The numbers survive a theme toggle; a string
 * would not.
 *
 * ---------------------------------------------------------------------------
 * Why there are five numbers rather than one.
 *
 * The first version wrote the hue alone and each theme paired it with a constant
 * lightness and chroma: `oklch(0.8 0.15 var(--c-accent-hue))`. Measured against
 * the sRGB gamut, that constant is **outside it for 45 of 72 hues** in the dark
 * theme and 30 of 72 in the light one — so for most of the wheel the browser was
 * quietly mapping the colour back to the boundary. Hues whose gamut is narrow
 * (blue, cyan, green) all landed on the same wall, which is exactly why
 * neighbouring degrees looked identical and the whole rail looked washed out. The
 * only clip-free constant is *lower* still — 0.089 — i.e. duller everywhere.
 *
 * There is no one number that works, because sRGB is not a nice shape: at a fixed
 * lightness the most saturated violet is three times as chromatic as the most
 * saturated blue, and each hue's peak sits at a different lightness. So both are
 * measured per hue instead, per theme, by `accentTone` — the most saturated
 * (lightness, chroma) pair for that hue that still clears WCAG AA on that theme's
 * chip surface. Across all 360 hues that yields chroma 0.09–0.30 (light) and
 * 0.14–0.31 (dark) with a worst-case contrast of 4.60:1, where the old constant
 * gave 0.12 and 0.15 with half the wheel clipped.
 *
 * They are still only numbers, and still one write per theme, so the property
 * this file's design rests on is unchanged.
 * ---------------------------------------------------------------------------
 */

import { contrastRatio, maxChromaFor, oklchToHex } from './oklch';

export type AccentId =
  | 'cyan'
  | 'blue'
  | 'violet'
  | 'teal'
  | 'green'
  | 'rec'
  | 'orange'
  | 'amber'
  | 'pink'
  | 'custom';

export interface Accent {
  id: AccentId;
  label: string;
  /**
   * The colour, as a CSS value ready to drop into a style attribute.
   *
   * A `var()` reference rather than a literal, so a theme change re-resolves it
   * without anything re-rendering.
   */
  colour: string;
}

/**
 * The offered accents: the app's own nine hues, plus anything on the rail.
 *
 * Every one is a token defined per theme in `globals.css`, never a literal
 * invented here, so they all darken on white and brighten on black together. A
 * knob in a colour that appears nowhere else in the interface reads as a different
 * application, which is why the named set and the interface's palette are the same
 * set — orange, blue and true green were added to *both* rather than to a picker.
 *
 * Red is offered because it was asked for, with one caveat worth knowing: on this
 * page red otherwise means *recording or broken*. Picking it makes the knobs the
 * same colour as the transport's record indicator, which is a legibility cost the
 * user is entitled to accept.
 */
export const ACCENTS: readonly Accent[] = [
  { id: 'cyan', label: 'ฟ้า', colour: 'var(--c-cyan)' },
  { id: 'blue', label: 'น้ำเงิน', colour: 'var(--c-blue)' },
  { id: 'teal', label: 'เขียวมิ้นท์', colour: 'var(--c-teal)' },
  { id: 'green', label: 'เขียว', colour: 'var(--c-green)' },
  { id: 'violet', label: 'ม่วง', colour: 'var(--c-violet)' },
  { id: 'amber', label: 'เหลือง', colour: 'var(--c-amber)' },
  { id: 'orange', label: 'ส้ม', colour: 'var(--c-orange)' },
  { id: 'pink', label: 'ชมพู', colour: 'var(--c-pink)' },
  { id: 'rec', label: 'แดง', colour: 'var(--c-rec)' },
  { id: 'custom', label: 'เลือกเอง', colour: 'var(--c-accent-custom)' },
];

/**
 * Where the app's own hues sit on the rail, in degrees.
 *
 * Markers only — `AccentRail` draws a tick at each so the interface's palette is
 * findable by dragging. These are the **measured** oklch hues of the tokens (the
 * dark-theme values; the light ones share the hue and differ only in lightness and
 * chroma), so a tick and the token under it are the same colour rather than
 * approximately the same. The tokens remain the source of truth.
 */
export const ACCENT_MARKERS: readonly { id: AccentId; hue: number }[] = [
  { id: 'rec', hue: 18 },
  { id: 'orange', hue: 50 },
  { id: 'amber', hue: 78 },
  { id: 'green', hue: 145 },
  { id: 'teal', hue: 182 },
  { id: 'cyan', hue: 211 },
  { id: 'blue', hue: 258 },
  { id: 'violet', hue: 293 },
  { id: 'pink', hue: 350 },
];

/** The two themes, for anything that has to produce a value for both. */
export type ThemeName = 'light' | 'dark';

/**
 * The surface a coloured chip actually sits on, per theme.
 *
 * The *strictest* one, not the page background: in the light theme panels are pure
 * white (the darkest text is hardest to read there), and in the dark theme the
 * raised surface is the lightest thing a bright accent has to survive. Checking
 * against the page background instead would pass colours that are unreadable in
 * the one place they are used.
 */
export const ACCENT_SURFACE: Record<ThemeName, string> = {
  light: '#ffffff',
  dark: '#1c1f2b',
};

/**
 * Lightness the search is allowed to consider, per theme.
 *
 * Bounded so an accent stays recognisably an accent: the light theme cannot drift
 * so pale it disappears into white, and the dark theme is capped at 0.85 so the
 * palette stays one family rather than three — the gamut would happily give
 * neon-green at 0.95, which reads as a different design.
 */
const LIGHTNESS_RANGE: Record<ThemeName, readonly [number, number]> = {
  light: [0.3, 0.68],
  dark: [0.58, 0.85],
};

/** Step of the lightness search. 0.005 is finer than the eye resolves. */
const LIGHTNESS_STEP = 0.005;

/**
 * How much of the gamut edge to take.
 *
 * Not all of it: rounding to eight bits per channel can push a colour that sits
 * exactly on the boundary just outside, and the browser answers that by mapping it
 * back — which moves the hue slightly. 4% of headroom is invisible and makes the
 * value stable.
 */
const CHROMA_FILL = 0.96;

/**
 * Contrast floor. AA for small text is 4.5:1; the extra 0.1 is margin, because a
 * value chosen at exactly the limit fails the moment a surface is nudged.
 */
const MIN_CONTRAST = 4.6;

/** Memoised, keyed `theme:hue`. A slider drag asks for the same hue repeatedly. */
const toneCache = new Map<string, AccentTone>();

/** Lightness and chroma for one hue in one theme. Feeds `oklch()` in CSS. */
export interface AccentTone {
  l: number;
  c: number;
}

/**
 * The most saturated version of `hue` this theme can show and still be readable.
 *
 * Walks the allowed lightness range, takes the sRGB gamut's own chroma limit at
 * each step, keeps the candidates that clear AA on that theme's chip surface, and
 * returns the most chromatic of them. That is the whole reason the palette is
 * vivid rather than pastel — the answer differs by more than 3× across the wheel,
 * and no constant can stand in for it.
 *
 * Never returns nothing: a hue with no AA-passing candidate (there are none, but
 * the bound moves if the surfaces change) falls back to the darkest end of the
 * range, which is the most readable thing available.
 */
export function accentTone(hue: number, theme: ThemeName): AccentTone {
  const wrapped = ((Math.round(hue) % 360) + 360) % 360;
  const key = `${theme}:${wrapped}`;
  const cached = toneCache.get(key);
  if (cached) return cached;

  const [low, high] = LIGHTNESS_RANGE[theme];
  const surface = ACCENT_SURFACE[theme];
  let best: AccentTone | null = null;

  for (let l = low; l <= high + 1e-9; l += LIGHTNESS_STEP) {
    const c = maxChromaFor(l, wrapped) * CHROMA_FILL;
    if (contrastRatio(oklchToHex(l, c, wrapped), surface) < MIN_CONTRAST) continue;
    if (!best || c > best.c) best = { l, c };
  }

  const tone = best ?? { l: low, c: maxChromaFor(low, wrapped) * CHROMA_FILL };
  toneCache.set(key, tone);
  return tone;
}

export const ACCENT_STORAGE_KEY = 'gr-accent';
export const ACCENT_HUE_STORAGE_KEY = 'gr-accent-hue';

/** The CSS custom property the hue is written to. Consumed by `globals.css`. */
export const ACCENT_HUE_PROPERTY = '--c-accent-hue';

/**
 * Where each theme's measured tone is written.
 *
 * Two pairs, not one, because these are set as inline styles on `<html>` — which
 * outranks both theme blocks in the cascade. A single `--c-accent-l` would give
 * the dark theme the light theme's lightness the moment the toggle was pressed;
 * each theme reads its own name instead, and the toggle changes nothing here.
 */
export const ACCENT_TONE_PROPERTIES: Record<ThemeName, { l: string; c: string }> = {
  light: { l: '--c-accent-l-light', c: '--c-accent-c-light' },
  dark: { l: '--c-accent-l-dark', c: '--c-accent-c-dark' },
};

const DEFAULT_ACCENT: AccentId = 'cyan';
/**
 * The interface's own cyan, to the degree.
 *
 * It used to be 195 — "cyan-adjacent" — which was three degrees of teal away from
 * the token it was meant to sit beside. Now that the markers carry the tokens'
 * measured hues, the default *is* the cyan marker, so the picker opens on the
 * colour the rest of the app is already using rather than near it.
 */
const DEFAULT_HUE = 211;

const IDS: readonly AccentId[] = [
  'cyan',
  'blue',
  'violet',
  'teal',
  'green',
  'rec',
  'orange',
  'amber',
  'pink',
  'custom',
];

let current: AccentId = DEFAULT_ACCENT;
let currentHue = DEFAULT_HUE;
let started = false;

const listeners = new Set<() => void>();

function isAccent(value: string | null): value is AccentId {
  return value !== null && (IDS as readonly string[]).includes(value);
}

/** Degrees. Anything else — 361, −4, NaN, "blue" — is refused, not coerced. */
function readHue(value: string | null): number | null {
  if (value === null) return null;
  const hue = Number(value);
  if (!Number.isFinite(hue) || hue < 0 || hue > 360) return null;
  return Math.round(hue);
}

/**
 * Push the hue, and both themes' measured tone, into CSS.
 *
 * Written even when `custom` is not the selected accent, because the swatch that
 * *offers* custom is painted in the chosen hue — the properties have to be live
 * before the mode is.
 *
 * Five properties in one call, deliberately: a hue whose tone had not landed yet
 * would be shown at the previous hue's lightness for a frame, which on a drag is a
 * visible flicker of the wrong colour.
 */
function applyHue(hue: number): void {
  if (typeof document === 'undefined') return;

  const style = document.documentElement.style;
  style.setProperty(ACCENT_HUE_PROPERTY, `${hue}`);

  for (const theme of ['light', 'dark'] as const) {
    const tone = accentTone(hue, theme);
    const property = ACCENT_TONE_PROPERTIES[theme];
    style.setProperty(property.l, tone.l.toFixed(3));
    style.setProperty(property.c, tone.c.toFixed(3));
  }
}

/** Read the persisted choice once, on first subscription. */
function start(): void {
  if (started || typeof window === 'undefined') return;
  started = true;

  try {
    const stored = window.localStorage.getItem(ACCENT_STORAGE_KEY);
    if (isAccent(stored)) current = stored;
    const hue = readHue(window.localStorage.getItem(ACCENT_HUE_STORAGE_KEY));
    if (hue !== null) currentHue = hue;
  } catch {
    // Private browsing / storage disabled — the default is perfectly usable.
  }

  applyHue(currentHue);
}

export function subscribeAccent(listener: () => void): () => void {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getAccentSnapshot(): AccentId {
  start();
  return current;
}

export function getServerAccentSnapshot(): AccentId {
  return DEFAULT_ACCENT;
}

/**
 * Hue snapshots, kept separate from the id.
 *
 * Two primitives rather than one object: `useSyncExternalStore` compares snapshots
 * by identity, so a getter returning `{ id, hue }` would allocate a fresh object on
 * every call and re-render forever.
 */
export function getAccentHueSnapshot(): number {
  start();
  return currentHue;
}

export function getServerAccentHueSnapshot(): number {
  return DEFAULT_HUE;
}

export function setAccent(next: AccentId): void {
  if (next === current) return;
  current = next;

  try {
    window.localStorage.setItem(ACCENT_STORAGE_KEY, next);
  } catch {
    // Non-fatal: the choice still applies for this session.
  }

  listeners.forEach((listener) => listener());
}

/**
 * Choose a hue, and select the custom accent with it.
 *
 * Selecting is part of moving the slider on purpose: a hue control that changes
 * nothing until a second button is pressed is a control that appears broken.
 */
export function setAccentHue(hue: number): void {
  const next = Math.min(360, Math.max(0, Math.round(hue)));
  if (next === currentHue && current === 'custom') return;

  currentHue = next;
  current = 'custom';
  applyHue(next);

  try {
    window.localStorage.setItem(ACCENT_HUE_STORAGE_KEY, `${next}`);
    window.localStorage.setItem(ACCENT_STORAGE_KEY, 'custom');
  } catch {
    // Non-fatal.
  }

  listeners.forEach((listener) => listener());
}

/** The chosen accent's descriptor. */
export function accentById(id: AccentId): Accent {
  return ACCENTS.find((accent) => accent.id === id) ?? ACCENTS[0];
}
