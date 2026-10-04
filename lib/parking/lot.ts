import type { Point } from "../utils";

/**
 * Geometry for the parking scenario. Everything lives in a top-down XZ plane
 * (metres). The 3D renderer lifts it into Y; the physics/sensors stay 2D.
 */

export type Rect = {
  /** centre */
  cx: number;
  cz: number;
  /** full size */
  w: number;
  d: number;
  /** rotation around Y, radians */
  angle: number;
};

export type Slot = Rect & {
  index: number;
  occupied: boolean;
  /** heading a correctly parked car should have (radians) */
  heading: number;
};

export type LotKind = "parallel" | "perpendicular" | "angled";

export type Pose = { x: number; z: number; angle: number };

/** Blend two spawn poses — used by the training curriculum. */
export function lerpPose(easy: Pose, hard: Pose, t: number): Pose {
  const d = Math.atan2(Math.sin(hard.angle - easy.angle), Math.cos(hard.angle - easy.angle));
  return {
    x: easy.x + (hard.x - easy.x) * t,
    z: easy.z + (hard.z - easy.z) * t,
    angle: easy.angle + d * t,
  };
}

export interface Lot {
  kind: LotKind;
  /** drivable area bounds (half extents from origin) */
  halfW: number;
  halfD: number;
  /** solid obstacles: parked cars, kerbs, pillars */
  obstacles: Obstacle[];
  slots: Slot[];
  target: Slot;
  /** where the learner spawns on the hardest curriculum level */
  start: Pose;
  /** easy spawn: already lined up just outside the bay */
  easyStart: Pose;
}

export type ObstacleKind = "car" | "kerb" | "pillar" | "wall" | "cone";

export interface Obstacle {
  kind: ObstacleKind;
  rect: Rect;
  polygon: Point[];
  /** cosmetic only */
  color: string;
  height: number;
}

export function rectPolygon(r: Rect): Point[] {
  const c = Math.cos(r.angle);
  const s = Math.sin(r.angle);
  const hw = r.w / 2;
  const hd = r.d / 2;
  const corners: [number, number][] = [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ];
  return corners.map(([x, z]) => ({
    x: r.cx + x * c - z * s,
    y: r.cz + x * s + z * c,
  }));
}

function obstacle(
  kind: ObstacleKind,
  rect: Rect,
  color: string,
  height: number,
): Obstacle {
  return { kind, rect, polygon: rectPolygon(rect), color, height };
}

const PARKED_COLORS = [
  "#94a3b8",
  "#64748b",
  "#a3a3a3",
  "#7dd3fc",
  "#fca5a5",
  "#fcd34d",
  "#86efac",
  "#c4b5fd",
];

/** Deterministic pseudo-random so a seed reproduces a lot exactly. */
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

export const CAR_LENGTH = 4.4;
export const CAR_WIDTH = 1.9;

export interface LotOptions {
  kind: LotKind;
  seed: number;
  /** 0..1 — how many neighbouring slots hold a parked car */
  occupancy: number;
  /** extra margin added to the target slot, in metres (difficulty) */
  slack: number;
}

export function buildLot(opts: LotOptions): Lot {
  const rand = mulberry32(opts.seed * 7919 + 13);
  const obstacles: Obstacle[] = [];
  const slots: Slot[] = [];

  const halfW = 22;
  const halfD = 16;

  // Surrounding walls keep the agent inside the lot.
  const wallT = 0.6;
  obstacles.push(
    obstacle(
      "wall",
      { cx: 0, cz: -halfD - wallT / 2, w: halfW * 2 + wallT * 2, d: wallT, angle: 0 },
      "#475569",
      1.1,
    ),
    obstacle(
      "wall",
      { cx: 0, cz: halfD + wallT / 2, w: halfW * 2 + wallT * 2, d: wallT, angle: 0 },
      "#475569",
      1.1,
    ),
    obstacle(
      "wall",
      { cx: -halfW - wallT / 2, cz: 0, w: wallT, d: halfD * 2, angle: 0 },
      "#475569",
      1.1,
    ),
    obstacle(
      "wall",
      { cx: halfW + wallT / 2, cz: 0, w: wallT, d: halfD * 2, angle: 0 },
      "#475569",
      1.1,
    ),
  );

  if (opts.kind === "parallel") {
    // A kerbside row along z = -8. Slots are long and shallow.
    const slotW = CAR_LENGTH + 1.6 + opts.slack; // along X (driving direction)
    const slotD = CAR_WIDTH + 0.7;
    const count = 7;
    const z = -8;
    const startX = -((count - 1) / 2) * slotW;
    const targetIndex = 3;

    for (let i = 0; i < count; i++) {
      const rect: Rect = { cx: startX + i * slotW, cz: z, w: slotW, d: slotD, angle: 0 };
      const occupied =
        i !== targetIndex && rand() < opts.occupancy && i !== targetIndex - 2;
      slots.push({ ...rect, index: i, occupied, heading: 0 });
      if (occupied) {
        obstacles.push(
          obstacle(
            "car",
            { cx: rect.cx, cz: rect.cz, w: CAR_LENGTH, d: CAR_WIDTH, angle: 0 },
            PARKED_COLORS[Math.floor(rand() * PARKED_COLORS.length)],
            1.45,
          ),
        );
      }
    }
    // kerb behind the row
    obstacles.push(
      obstacle(
        "kerb",
        { cx: 0, cz: z - slotD / 2 - 0.25, w: count * slotW, d: 0.5, angle: 0 },
        "#cbd5e1",
        0.35,
      ),
    );

    return {
      kind: opts.kind,
      halfW,
      halfD,
      obstacles,
      slots,
      target: slots[targetIndex],
      start: { x: slots[targetIndex].cx + slotW * 1.7, z: z + 4.2, angle: Math.PI },
      easyStart: { x: slots[targetIndex].cx + 0.6, z: z + 2.3, angle: Math.PI },
    };
  }

  if (opts.kind === "perpendicular") {
    const slotW = CAR_WIDTH + 0.7 + opts.slack;
    const slotD = CAR_LENGTH + 0.8;
    const count = 9;
    const z = -halfD + slotD / 2 + 1;
    const startX = -((count - 1) / 2) * slotW;
    const targetIndex = 4;

    for (let i = 0; i < count; i++) {
      const rect: Rect = { cx: startX + i * slotW, cz: z, w: slotW, d: slotD, angle: 0 };
      const occupied = i !== targetIndex && rand() < opts.occupancy;
      slots.push({ ...rect, index: i, occupied, heading: -Math.PI / 2 });
      if (occupied) {
        obstacles.push(
          obstacle(
            "car",
            { cx: rect.cx, cz: rect.cz, w: CAR_WIDTH, d: CAR_LENGTH, angle: 0 },
            PARKED_COLORS[Math.floor(rand() * PARKED_COLORS.length)],
            1.45,
          ),
        );
      }
    }

    // opposite row, purely as scenery/obstacles
    const z2 = z + slotD + 7.5;
    for (let i = 0; i < count; i++) {
      if (rand() > opts.occupancy * 0.8) continue;
      obstacles.push(
        obstacle(
          "car",
          { cx: startX + i * slotW, cz: z2, w: CAR_WIDTH, d: CAR_LENGTH, angle: 0 },
          PARKED_COLORS[Math.floor(rand() * PARKED_COLORS.length)],
          1.45,
        ),
      );
    }

    return {
      kind: opts.kind,
      halfW,
      halfD,
      obstacles,
      slots,
      target: slots[targetIndex],
      // Approach down the aisle (driving towards -X) with the bay on the left,
      // which is the manoeuvre a human would make.
      start: {
        x: slots[targetIndex].cx + 10,
        z: z + slotD / 2 + 4.2,
        angle: Math.PI,
      },
      easyStart: {
        x: slots[targetIndex].cx,
        z: z + slotD / 2 + 2.6,
        angle: -Math.PI / 2,
      },
    };
  }

  // angled (45°) bays
  const bayAngle = -Math.PI / 4;
  const slotW = CAR_WIDTH + 0.8 + opts.slack;
  const slotD = CAR_LENGTH + 0.6;
  const count = 8;
  const pitch = slotW / Math.cos(Math.PI / 4);
  const startX = -((count - 1) / 2) * pitch;
  const z = -halfD + 7;
  const targetIndex = 4;

  for (let i = 0; i < count; i++) {
    const rect: Rect = {
      cx: startX + i * pitch,
      cz: z,
      w: slotW,
      d: slotD,
      angle: bayAngle,
    };
    const occupied = i !== targetIndex && rand() < opts.occupancy;
    slots.push({ ...rect, index: i, occupied, heading: bayAngle - Math.PI / 2 });
    if (occupied) {
      obstacles.push(
        obstacle(
          "car",
          { cx: rect.cx, cz: rect.cz, w: CAR_WIDTH, d: CAR_LENGTH, angle: bayAngle },
          PARKED_COLORS[Math.floor(rand() * PARKED_COLORS.length)],
          1.45,
        ),
      );
    }
  }

  obstacles.push(
    obstacle("pillar", { cx: -12, cz: 6, w: 1.2, d: 1.2, angle: 0 }, "#64748b", 3),
    obstacle("pillar", { cx: 12, cz: 6, w: 1.2, d: 1.2, angle: 0 }, "#64748b", 3),
  );

  return {
    kind: opts.kind,
    halfW,
    halfD,
    obstacles,
    slots,
    target: slots[targetIndex],
    start: { x: slots[targetIndex].cx + 10, z: z + 6.5, angle: Math.PI },
    easyStart: {
      x: slots[targetIndex].cx + Math.sin(bayAngle) * 3.4,
      z: slots[targetIndex].cz + Math.cos(bayAngle) * 3.4,
      angle: bayAngle - Math.PI / 2,
    },
  };
}
