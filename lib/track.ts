import type { Point } from "./utils";

export type Segment = [Point, Point];

export interface Obstacle {
  polygon: Point[];
  kind?: "barrier" | "cone";
}

export interface Pose {
  x: number;
  y: number;
  angle: number;
}

/** Deterministic PRNG so a seed always rebuilds the same track. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function resample(raw: Point[], spacing: number, closed: boolean): Point[] {
  const pts = closed ? [...raw, raw[0]] : raw;
  const out: Point[] = [pts[0]];
  let carry = 0;

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0) continue;
    let d = spacing - carry;
    while (d <= len) {
      const t = d / len;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      d += spacing;
    }
    carry = len - (d - spacing);
  }

  if (closed && out.length > 1) out.pop();
  return out;
}

export class Track {
  readonly id: string;
  readonly name: string;
  readonly closed: boolean;
  readonly width: number;
  readonly laneCount: number;
  readonly centerline: Point[];
  readonly normals: Point[];
  readonly cumulative: number[];
  readonly total: number;
  readonly leftEdge: Point[];
  readonly rightEdge: Point[];
  readonly obstacles: Obstacle[];

  constructor(opts: {
    id: string;
    name: string;
    closed: boolean;
    width: number;
    laneCount: number;
    points: Point[];
    spacing?: number;
    obstacles?: Obstacle[];
  }) {
    this.id = opts.id;
    this.name = opts.name;
    this.closed = opts.closed;
    this.width = opts.width;
    this.laneCount = opts.laneCount;
    this.centerline = resample(opts.points, opts.spacing ?? 24, opts.closed);

    const n = this.centerline.length;
    this.normals = [];
    for (let i = 0; i < n; i++) {
      const prev = this.centerline[this.wrap(i - 1)];
      const next = this.centerline[this.wrap(i + 1)];
      const tx = next.x - prev.x;
      const ty = next.y - prev.y;
      const len = Math.hypot(tx, ty) || 1;
      this.normals.push({ x: -ty / len, y: tx / len });
    }

    this.cumulative = [0];
    for (let i = 1; i < n; i++) {
      const a = this.centerline[i - 1];
      const b = this.centerline[i];
      this.cumulative.push(this.cumulative[i - 1] + Math.hypot(b.x - a.x, b.y - a.y));
    }
    const lastGap = this.closed
      ? Math.hypot(
          this.centerline[0].x - this.centerline[n - 1].x,
          this.centerline[0].y - this.centerline[n - 1].y,
        )
      : 0;
    this.total = this.cumulative[n - 1] + lastGap;

    const half = this.width / 2;
    this.leftEdge = this.centerline.map((p, i) => ({
      x: p.x + this.normals[i].x * half,
      y: p.y + this.normals[i].y * half,
    }));
    this.rightEdge = this.centerline.map((p, i) => ({
      x: p.x - this.normals[i].x * half,
      y: p.y - this.normals[i].y * half,
    }));

    this.obstacles = opts.obstacles ?? [];
  }

  private wrap(i: number): number {
    const n = this.centerline.length;
    if (this.closed) return ((i % n) + n) % n;
    return Math.max(0, Math.min(n - 1, i));
  }

  /** Pose at a distance along the track, offset sideways by `lateral` px. */
  poseAt(distance: number, lateral = 0): Pose {
    const n = this.centerline.length;
    let d = distance;
    if (this.closed) d = ((d % this.total) + this.total) % this.total;
    d = Math.max(0, Math.min(this.total, d));

    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.cumulative[mid] <= d) lo = mid;
      else hi = mid - 1;
    }
    const i = lo;
    const j = this.wrap(i + 1);
    const segLen = Math.max(
      1e-6,
      (j === 0 ? this.total : this.cumulative[j]) - this.cumulative[i],
    );
    const t = Math.max(0, Math.min(1, (d - this.cumulative[i]) / segLen));

    const a = this.centerline[i];
    const b = this.centerline[j];
    const nx = this.normals[i].x;
    const ny = this.normals[i].y;

    const x = a.x + (b.x - a.x) * t + nx * lateral;
    const y = a.y + (b.y - a.y) * t + ny * lateral;
    // canvas convention: angle 0 = facing up (-y)
    const angle = Math.atan2(-(b.x - a.x), -(b.y - a.y));

    return { x, y, angle };
  }

  /** Lane center offset from the centerline (lane 0 = leftmost). */
  laneOffset(lane: number): number {
    const laneWidth = this.width / this.laneCount;
    return this.width / 2 - laneWidth / 2 - lane * laneWidth;
  }

  startPose(lane = Math.floor(this.laneCount / 2)): Pose {
    return this.poseAt(40, this.laneOffset(lane));
  }

  /** Nearest centerline index, searched in a window around a hint. */
  nearestIndex(p: Point, hint = 0, span = 40): number {
    const n = this.centerline.length;
    let best = hint;
    let bestDist = Infinity;
    for (let k = -span; k <= span; k++) {
      const i = this.wrap(hint + k);
      const c = this.centerline[i];
      const d = (c.x - p.x) ** 2 + (c.y - p.y) ** 2;
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
      if (!this.closed && (hint + k < 0 || hint + k > n - 1)) continue;
    }
    return best;
  }

  distanceAtIndex(i: number): number {
    return this.cumulative[this.wrap(i)];
  }

  /** Wall segments close to a centerline index — keeps raycasting cheap. */
  segmentsNear(index: number, span = 6): Segment[] {
    const segs: Segment[] = [];
    for (let k = -span; k <= span; k++) {
      const i = this.wrap(index + k);
      const j = this.wrap(index + k + 1);
      if (!this.closed && index + k + 1 > this.centerline.length - 1) continue;
      if (!this.closed && index + k < 0) continue;
      segs.push([this.leftEdge[i], this.leftEdge[j]]);
      segs.push([this.rightEdge[i], this.rightEdge[j]]);
    }
    if (!this.closed) {
      const n = this.centerline.length - 1;
      if (index <= span) segs.push([this.leftEdge[0], this.rightEdge[0]]);
      if (index >= n - span) segs.push([this.leftEdge[n], this.rightEdge[n]]);
    }
    return segs;
  }
}
