/**
 * Oklch ↔ sRGB, and the two questions the palette is built by answering.
 *
 * *How saturated can this hue get?* and *does it still clear WCAG AA?* Both are
 * needed because sRGB is not a nice shape: at a fixed lightness the most
 * saturated blue available is roughly a third as chromatic as the most saturated
 * violet, and the lightness where each hue peaks differs by more than 0.2. One
 * chroma applied to every hue therefore cannot be right — it is either dull
 * where the gamut is wide or outside it where the gamut is narrow, and the
 * browser quietly maps the out-of-gamut half back to the boundary. That is what a
 * washed-out palette with hues that look identical to their neighbours *is*.
 *
 * So chroma is measured per hue, at the lightness that theme needs, and the
 * measurement lives here — pure, and checkable from Node like the rest of `lib/`.
 *
 * The conversions are Björn Ottosson's Oklab (public domain). Contrast is WCAG
 * 2.1 relative luminance, which is the ratio the design rules are stated in.
 */

/** Linear-light sRGB, 0..1 per channel. Values outside that are out of gamut. */
export type LinearRgb = readonly [number, number, number];

/** Largest chroma the search will consider. Well past sRGB at every hue. */
const CHROMA_CEILING = 0.45;

/**
 * Gamut tolerance.
 *
 * A channel a hair outside 0..1 rounds to the same byte as one exactly on the
 * boundary, so refusing it would only cost chroma for no visible reason.
 */
const GAMUT_EPSILON = 1e-4;

/** Oklab → linear sRGB. */
export function oklabToLinearRgb(l: number, a: number, b: number): LinearRgb {
  const lCube = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mCube = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const sCube = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return [
    4.0767416621 * lCube - 3.3077115913 * mCube + 0.2309699292 * sCube,
    -1.2684380046 * lCube + 2.6097574011 * mCube - 0.3413193965 * sCube,
    -0.0041960863 * lCube - 0.7034186147 * mCube + 1.707614701 * sCube,
  ];
}

/** Linear sRGB → Oklab. */
export function linearRgbToOklab(r: number, g: number, b: number): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** sRGB transfer function, linear → encoded (0..1). */
export function encodeSrgb(value: number): number {
  return value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
}

/** sRGB transfer function, encoded → linear (0..1). */
export function decodeSrgb(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** Oklch (lightness 0..1, chroma, hue in degrees) → linear sRGB. */
export function oklchToLinearRgb(l: number, c: number, h: number): LinearRgb {
  const radians = (h * Math.PI) / 180;
  return oklabToLinearRgb(l, c * Math.cos(radians), c * Math.sin(radians));
}

/** Whether an oklch triple can be shown in sRGB without being mapped back. */
export function isInGamut(l: number, c: number, h: number): boolean {
  const [r, g, b] = oklchToLinearRgb(l, c, h);
  return (
    r >= -GAMUT_EPSILON &&
    r <= 1 + GAMUT_EPSILON &&
    g >= -GAMUT_EPSILON &&
    g <= 1 + GAMUT_EPSILON &&
    b >= -GAMUT_EPSILON &&
    b <= 1 + GAMUT_EPSILON
  );
}

/**
 * The most chromatic version of this hue that sRGB can actually show at this
 * lightness.
 *
 * A binary search rather than a formula: the sRGB gamut boundary in Oklch has no
 * closed form (it is the image of a cube under a non-linear map). Twenty-four
 * halvings of a 0.45 range resolve it to ~2.7e-8, far below anything visible, and
 * cost about a microsecond.
 *
 * Monotonicity is what makes the search valid: the gamut is star-shaped about the
 * achromatic axis, so if chroma `x` is inside, everything below `x` is too.
 */
export function maxChromaFor(l: number, h: number): number {
  if (!isInGamut(l, 0, h)) return 0;

  let inside = 0;
  let outside = CHROMA_CEILING;
  for (let step = 0; step < 24; step += 1) {
    const middle = (inside + outside) / 2;
    if (isInGamut(l, middle, h)) inside = middle;
    else outside = middle;
  }
  return inside;
}

/** Oklch → `#rrggbb`, clamped. Out-of-gamut input is clipped, so check first. */
export function oklchToHex(l: number, c: number, h: number): string {
  const channels = oklchToLinearRgb(l, c, h).map((value) => {
    const clamped = Math.min(1, Math.max(0, value));
    return Math.round(encodeSrgb(clamped) * 255);
  });
  return `#${channels.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

/** `#rrggbb` → oklch. For checking a token against the value it claims to be. */
export function hexToOklch(hex: string): { l: number; c: number; h: number } {
  const channel = (at: number) => decodeSrgb(parseInt(hex.slice(at, at + 2), 16) / 255);
  const [l, a, b] = linearRgbToOklab(channel(1), channel(3), channel(5));
  const hue = (Math.atan2(b, a) * 180) / Math.PI;
  return { l, c: Math.hypot(a, b), h: hue < 0 ? hue + 360 : hue };
}

/** WCAG 2.1 relative luminance of an `#rrggbb` colour. */
export function relativeLuminance(hex: string): number {
  const channel = (at: number) => decodeSrgb(parseInt(hex.slice(at, at + 2), 16) / 255);
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** WCAG 2.1 contrast ratio between two `#rrggbb` colours. 1..21. */
export function contrastRatio(a: string, b: string): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}
