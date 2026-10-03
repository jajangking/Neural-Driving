export type Point = { x: number; y: number };

export type Intersection = Point & { offset: number };

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Segment/segment intersection. Returns the hit point plus how far along
 * segment A..B the hit happened (0 = at A, 1 = at B), or null when they miss.
 */
export function getIntersection(
  A: Point,
  B: Point,
  C: Point,
  D: Point,
): Intersection | null {
  const tTop = (D.x - C.x) * (A.y - C.y) - (D.y - C.y) * (A.x - C.x);
  const uTop = (C.y - A.y) * (A.x - B.x) - (C.x - A.x) * (A.y - B.y);
  const bottom = (D.y - C.y) * (B.x - A.x) - (D.x - C.x) * (B.y - A.y);

  if (bottom === 0) return null;

  const t = tTop / bottom;
  const u = uTop / bottom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;

  return {
    x: lerp(A.x, B.x, t),
    y: lerp(A.y, B.y, t),
    offset: t,
  };
}

/** Do two convex polygons (arrays of points) touch? */
export function polysIntersect(poly1: Point[], poly2: Point[]): boolean {
  for (let i = 0; i < poly1.length; i++) {
    for (let j = 0; j < poly2.length; j++) {
      const touch = getIntersection(
        poly1[i],
        poly1[(i + 1) % poly1.length],
        poly2[j],
        poly2[(j + 1) % poly2.length],
      );
      if (touch) return true;
    }
  }
  return false;
}

/** Map a neuron value in [-1, 1] to a yellow/blue rgba string. */
export function getRGBA(value: number): string {
  const alpha = Math.abs(value);
  const R = value < 0 ? 0 : 255;
  const G = R;
  const B = value > 0 ? 0 : 255;
  return `rgba(${R},${G},${B},${alpha})`;
}
