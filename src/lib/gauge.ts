/**
 * Regular-polygon gauge geometry.
 *
 * Pure: no DOM, no React, so the paths the knobs draw can be measured from Node
 * rather than eyeballed in a browser. That matters more than it sounds — a gauge
 * that is a *circle* sampled at eight points, rather than a real octagon, looks
 * correct at the vertices and wrong everywhere between them, and the difference
 * is a few pixels that no code review catches.
 */

/** Degrees to radians. */
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

export interface PolygonSpec {
  /** Number of sides. 8 for the amp's knobs. */
  sides: number;
  /** Distance from the centre to a **vertex**. */
  circumradius: number;
  /**
   * Angle of the first vertex, in degrees, clockwise from the positive x-axis.
   *
   * For an octagon, 22.5° gives the flat-topped, flat-sided shape of a road sign
   * and puts edge midpoints at 135° and 405° — which is what makes a 270° gauge
   * symmetric about the vertical instead of visibly lopsided at the bottom.
   */
  firstVertexDeg: number;
  /** Centre, in the same units as the radius. */
  centre: { x: number; y: number };
}

/**
 * Distance from the centre to the polygon's edge at a given angle.
 *
 * The standard formula: apothem divided by the cosine of the angle to the
 * nearest vertex. Returns the circumradius at a vertex and the apothem at an
 * edge midpoint, and varies smoothly in between — which is exactly what makes
 * the drawn edge straight.
 */
export function polygonRadius(angleDeg: number, spec: PolygonSpec): number {
  const sideAngle = 360 / spec.sides;
  const halfSide = sideAngle / 2;
  const offset = (((angleDeg - spec.firstVertexDeg) % sideAngle) + sideAngle) % sideAngle;
  return (spec.circumradius * Math.cos(toRadians(halfSide))) / Math.cos(toRadians(offset - halfSide));
}

/** A point on the polygon's outline at the given angle. */
export function pointOnPolygon(angleDeg: number, spec: PolygonSpec): [number, number] {
  const radius = polygonRadius(angleDeg, spec);
  const radians = toRadians(angleDeg);
  return [spec.centre.x + radius * Math.cos(radians), spec.centre.y + radius * Math.sin(radians)];
}

/**
 * Every vertex angle strictly inside a sweep, in the order the sweep visits them.
 *
 * These are what make the path a polygon rather than a polyline approximation of
 * one: emitting only the endpoints would cut the corner off any sweep that spans
 * a vertex, and emitting a fixed number of samples would round the corners of the
 * ones it does not land on.
 */
export function verticesBetween(fromDeg: number, toDeg: number, spec: PolygonSpec): number[] {
  const sideAngle = 360 / spec.sides;
  const low = Math.min(fromDeg, toDeg);
  const high = Math.max(fromDeg, toDeg);

  const angles: number[] = [];
  const first = Math.ceil((low - spec.firstVertexDeg) / sideAngle);
  const last = Math.floor((high - spec.firstVertexDeg) / sideAngle);

  for (let k = first; k <= last; k += 1) {
    const angle = spec.firstVertexDeg + k * sideAngle;
    if (angle > low && angle < high) angles.push(angle);
  }
  return toDeg >= fromDeg ? angles : angles.reverse();
}

/** SVG polyline along the polygon's edge, from one angle to another. */
export function polygonArcPath(fromDeg: number, toDeg: number, spec: PolygonSpec): string {
  const points = [fromDeg, ...verticesBetween(fromDeg, toDeg, spec), toDeg];
  return points
    .map((angle, index) => {
      const [x, y] = pointOnPolygon(angle, spec);
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
}

/** The closed outline, as an SVG `points` list. */
export function polygonPoints(spec: PolygonSpec): string {
  const sideAngle = 360 / spec.sides;
  const points: string[] = [];
  for (let k = 0; k < spec.sides; k += 1) {
    const [x, y] = pointOnPolygon(spec.firstVertexDeg + k * sideAngle, spec);
    points.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return points.join(' ');
}

/**
 * Snap a value to its control's step and clamp it to the range.
 *
 * The final `toFixed` is not cosmetic: `Math.round(x / 0.1) * 0.1` produces
 * 0.30000000000000004, which reaches the readout and then the settings object.
 */
export function quantise(value: number, min: number, max: number, step: number): number {
  const snapped = Math.round((value - min) / step) * step + min;
  const decimals = (String(step).split('.')[1] ?? '').length;
  return Number(Math.min(max, Math.max(min, snapped)).toFixed(decimals));
}
