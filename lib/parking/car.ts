import type { NetworkData } from "../network";
import { ParkBrain } from "./brain";
import { clamp, getIntersection, polysIntersect, type Point } from "../utils";
import {
  CAR_LENGTH,
  CAR_WIDTH,
  rectPolygon,
  type Lot,
  type Obstacle,
  type Slot,
} from "./lot";

/**
 * Kinematic bicycle model — unlike the arcade car used on the track, parking
 * needs a real steering geometry so reversing swings the nose the right way.
 *
 * Convention: position is (x, z) in metres, heading `angle` points along
 * (cos angle, sin angle). Steering is a wheel angle in radians.
 */

export interface ParkControls {
  throttle: boolean;
  brake: boolean;
  left: boolean;
  right: boolean;
  reverse: boolean;
}

export const NO_CONTROLS: ParkControls = {
  throttle: false,
  brake: false,
  left: false,
  right: false,
  reverse: false,
};

export const SENSOR_RANGE = 14;
/** Extra brain inputs appended after the range sensors. */
export const EXTRA_INPUTS = 9;
export const OUTPUTS = 3;

export interface ParkCarOptions {
  rayCount?: number;
  hiddenLayers?: number[];
  color?: string;
  brain?: NetworkData | null;
  manual?: boolean;
}

export interface SensorRay {
  from: Point;
  to: Point;
  hit: Point | null;
  value: number;
}

export class ParkCar {
  x: number;
  z: number;
  angle: number;

  readonly length = CAR_LENGTH;
  readonly width = CAR_WIDTH;
  readonly wheelBase = 2.65;

  speed = 0;
  steer = 0;
  maxSteer = (36 * Math.PI) / 180;
  steerRate = 1.9; // rad/s
  maxSpeed = 4.2; // m/s forward
  maxReverse = 2.6;
  enginePower = 5.2; // m/s^2
  brakePower = 9;
  rollingDrag = 1.6;

  /** -1..1 continuous steering command from the brain (manual uses buttons) */
  steerTarget = 0;
  crashed = false;
  parked = false;
  /** seconds held inside the slot below the stop threshold */
  settleTime = 0;
  time = 0;
  color: string;

  brain: NetworkData | null;
  manual: boolean;
  rayCount: number;
  rays: SensorRay[] = [];
  controls: ParkControls = { ...NO_CONTROLS };

  polygon: Point[] = [];

  /** Scoring bookkeeping */
  bestScore = 0;
  score = 0;
  distanceToTarget = Infinity;
  closestApproach = Infinity;
  containment = 0;
  headingError = Math.PI;
  insideSlot = false;
  contactPenalty = 0;

  constructor(
    x: number,
    z: number,
    angle: number,
    options: ParkCarOptions = {},
  ) {
    this.x = x;
    this.z = z;
    this.angle = angle;
    this.color = options.color ?? "#38bdf8";
    this.manual = options.manual ?? false;
    this.rayCount = options.rayCount ?? 12;
    this.brain =
      options.brain ??
      (this.manual
        ? null
        : new ParkBrain([
            this.rayCount + EXTRA_INPUTS,
            ...(options.hiddenLayers ?? [12, 8]),
            OUTPUTS,
          ]));
    this.polygon = this.buildPolygon();
  }

  /** GA fitness — crashing is heavily discounted, parking is rewarded. */
  get fitness(): number {
    let f = this.bestScore;
    if (this.crashed) f = f * 0.5 - 25;
    if (this.parked) f += 120;
    return f;
  }

  buildPolygon(): Point[] {
    return rectPolygon({
      cx: this.x,
      cz: this.z,
      w: this.length,
      d: this.width,
      angle: this.angle,
    });
  }

  /** Corner positions of the four wheels, for the 3D renderer. */
  get forward(): Point {
    return { x: Math.cos(this.angle), y: Math.sin(this.angle) };
  }

  update(dt: number, lot: Lot, manualControls?: ParkControls) {
    if (this.crashed || this.parked) {
      this.castRays(lot.obstacles);
      return;
    }

    this.time += dt;
    this.castRays(lot.obstacles);

    if (this.manual && manualControls) {
      this.controls = manualControls;
    } else if (this.brain) {
      const out = ParkBrain.feedForward(this.brainInputs(lot.target), this.brain);
      // out[0]: drive axis (+ forward / - reverse), out[1]: steering axis,
      // out[2]: brake. Dead zones stop the car from buzzing in place.
      const drive = out[0];
      const steerCmd = out[1];
      this.controls = {
        throttle: drive > 0.12,
        reverse: drive < -0.12,
        left: steerCmd > 0.12,
        right: steerCmd < -0.12,
        brake: out[2] > 0.45,
      };
      this.steerTarget = Math.max(-1, Math.min(1, steerCmd));
    }

    this.drive(dt);
    this.polygon = this.buildPolygon();
    this.checkCollision(lot.obstacles);
    this.evaluate(lot.target, dt);
  }

  /**
   * Sensors + goal information. The goal channels are what make parking
   * learnable: pure range sensors cannot tell the car where the empty bay is.
   */
  brainInputs(target: Slot): number[] {
    const rays = this.rays.map((r) => r.value);

    // target offset in the car's own frame
    const dx = target.cx - this.x;
    const dz = target.cz - this.z;
    const c = Math.cos(-this.angle);
    const s = Math.sin(-this.angle);
    const fx = dx * c - dz * s; // ahead(+) / behind(-)
    const fz = dx * s + dz * c; // left/right
    const dist = Math.hypot(dx, dz);

    const headErr = angleDiff(target.heading, this.angle);

    // Error expressed in the *bay's* frame: how far off the bay axis the car
    // is (lateral) and how deep inside it sits (longitudinal). This is the
    // information a human reads off the mirrors, and it makes the manoeuvre
    // far more learnable than car-frame offsets alone.
    const sc = Math.cos(-target.heading);
    const ss = Math.sin(-target.heading);
    const lx = dx * sc - dz * ss;
    const lz = dx * ss + dz * sc;

    return [
      ...rays,
      clamp(fx / 20, -1, 1),
      clamp(fz / 20, -1, 1),
      clamp(1 - dist / 25, 0, 1),
      Math.sin(headErr),
      Math.cos(headErr),
      clamp(this.speed / this.maxSpeed, -1, 1),
      clamp(lx / 10, -1, 1),
      clamp(lz / 10, -1, 1),
      clamp(this.steer / this.maxSteer, -1, 1),
    ];
  }

  private drive(dt: number) {
    const c = this.controls;

    // steering
    const target = this.manual
      ? (c.left ? this.maxSteer : c.right ? -this.maxSteer : 0)
      : this.steerTarget * this.maxSteer;
    const delta = clamp(target - this.steer, -this.steerRate * dt, this.steerRate * dt);
    this.steer += delta;
    if (!c.left && !c.right && Math.abs(this.steer) < 0.01) this.steer = 0;

    // longitudinal
    let accel = 0;
    if (c.throttle && !c.reverse) accel += this.enginePower;
    if (c.reverse && !c.throttle) accel -= this.enginePower * 0.8;
    if (c.brake) {
      const stopping = -Math.sign(this.speed) * this.brakePower;
      accel += stopping;
      if (Math.abs(this.speed) < 0.2) this.speed = 0;
    }
    // rolling resistance
    accel -= Math.sign(this.speed) * this.rollingDrag * (c.throttle || c.reverse ? 0.3 : 1);

    this.speed += accel * dt;
    this.speed = clamp(this.speed, -this.maxReverse, this.maxSpeed);
    if (!c.throttle && !c.reverse && Math.abs(this.speed) < 0.08) this.speed = 0;

    // bicycle kinematics about the rear axle
    const beta = Math.atan(0.5 * Math.tan(this.steer));
    this.x += this.speed * Math.cos(this.angle + beta) * dt;
    this.z += this.speed * Math.sin(this.angle + beta) * dt;
    this.angle +=
      (this.speed / this.wheelBase) * Math.sin(beta) * 2 * dt;
  }

  private checkCollision(obstacles: Obstacle[]) {
    for (const o of obstacles) {
      if (polysIntersect(this.polygon, o.polygon)) {
        this.crashed = true;
        this.speed = 0;
        return;
      }
    }
  }

  /** Fitness: approach, align, stop inside the bay. */
  private evaluate(target: Slot, dt: number) {
    const dist = Math.hypot(target.cx - this.x, target.cz - this.z);
    this.distanceToTarget = dist;
    const headErr = Math.abs(normalizeHalf(angleDiff(target.heading, this.angle)));
    this.headingError = headErr;

    const inside = containsPolygon(target, this.polygon);
    this.insideSlot = inside;
    // Smooth containment (0..1) instead of all-or-nothing: the GA needs to see
    // partial credit for getting the nose into the bay.
    const containment = containmentFraction(target, this.polygon);
    this.containment = containment;

    // Exponential proximity gives a much steeper gradient near the bay than a
    // linear term, which is what lets the GA keep improving once it is close.
    const proximity = Math.exp(-dist / 5);
    const align = clamp(1 - headErr / (Math.PI / 2), 0, 1);
    if (dist < this.closestApproach) this.closestApproach = dist;

    // Being close while crooked is worth little — that is what pushes the
    // population from "dive at the bay" towards "line up, then enter".
    const alignSq = align * align;
    let score = 130 * proximity * (0.3 + 0.7 * alignSq) + 110 * containment * alignSq;
    if (inside) {
      score += 60 + 60 * align;
      if (Math.abs(this.speed) < 0.15) {
        this.settleTime += dt;
        score += Math.min(this.settleTime, 2) * 35;
      } else {
        this.settleTime = 0;
      }
    } else {
      this.settleTime = 0;
    }
    score -= this.contactPenalty;
    score -= this.time * 0.35; // prefer brisk manoeuvres

    this.score = score;
    if (score > this.bestScore) this.bestScore = score;

    if (inside && align > 0.86 && this.settleTime > 0.8) {
      this.parked = true;
      this.speed = 0;
    }
  }

  private castRays(obstacles: Obstacle[]) {
    this.rays = [];
    const origin: Point = {
      x: this.x + Math.cos(this.angle) * this.length * 0.15,
      y: this.z + Math.sin(this.angle) * this.length * 0.15,
    };

    for (let i = 0; i < this.rayCount; i++) {
      const a = this.angle + (i / this.rayCount) * Math.PI * 2;
      const to: Point = {
        x: origin.x + Math.cos(a) * SENSOR_RANGE,
        y: origin.y + Math.sin(a) * SENSOR_RANGE,
      };

      let best: Point | null = null;
      let bestOffset = 1;
      for (const o of obstacles) {
        const poly = o.polygon;
        for (let j = 0; j < poly.length; j++) {
          const hit = getIntersection(origin, to, poly[j], poly[(j + 1) % poly.length]);
          if (hit && hit.offset < bestOffset) {
            bestOffset = hit.offset;
            best = { x: hit.x, y: hit.y };
          }
        }
      }

      this.rays.push({
        from: origin,
        to,
        hit: best,
        value: best ? 1 - bestOffset : 0,
      });
    }
  }
}

export function angleDiff(a: number, b: number): number {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

/** Parking is symmetric: nose-in and tail-in both count as aligned. */
export function normalizeHalf(a: number): number {
  let x = a;
  while (x > Math.PI / 2) x -= Math.PI;
  while (x < -Math.PI / 2) x += Math.PI;
  return x;
}

/** How much of the car is inside the bay, 0..1 (smooth, for fitness shaping). */
export function containmentFraction(slot: Slot, polygon: Point[]): number {
  const c = Math.cos(-slot.angle);
  const s = Math.sin(-slot.angle);
  const hw = slot.w / 2;
  const hd = slot.d / 2;
  let total = 0;
  for (const p of polygon) {
    const dx = p.x - slot.cx;
    const dz = p.y - slot.cz;
    const lx = dx * c - dz * s;
    const lz = dx * s + dz * c;
    const ex = Math.max(0, Math.abs(lx) - hw);
    const ez = Math.max(0, Math.abs(lz) - hd);
    total += Math.exp(-(ex + ez) / 0.9);
  }
  return total / polygon.length;
}

/** Are all four car corners inside the (rotated) slot rectangle? */
export function containsPolygon(slot: Slot, polygon: Point[]): boolean {
  const c = Math.cos(-slot.angle);
  const s = Math.sin(-slot.angle);
  const hw = slot.w / 2 + 0.12;
  const hd = slot.d / 2 + 0.12;
  for (const p of polygon) {
    const dx = p.x - slot.cx;
    const dz = p.y - slot.cz;
    const lx = dx * c - dz * s;
    const lz = dx * s + dz * c;
    if (Math.abs(lx) > hw || Math.abs(lz) > hd) return false;
  }
  return true;
}
