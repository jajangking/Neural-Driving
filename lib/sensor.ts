import { getIntersection, lerp, type Intersection, type Point } from "./utils";

export interface SensorHost {
  x: number;
  y: number;
  angle: number;
}

export interface Obstacle {
  polygon: Point[];
}

export class Sensor {
  rayCount: number;
  rayLength: number;
  raySpread: number;
  rays: [Point, Point][];
  readings: (Intersection | null)[];

  constructor(rayCount = 7, rayLength = 180, raySpread = Math.PI / 2) {
    this.rayCount = rayCount;
    this.rayLength = rayLength;
    this.raySpread = raySpread;
    this.rays = [];
    this.readings = [];
  }

  update(
    host: SensorHost,
    roadBorders: [Point, Point][],
    obstacles: Obstacle[],
  ) {
    this.castRays(host);
    this.readings = this.rays.map((ray) =>
      Sensor.getReading(ray, roadBorders, obstacles),
    );
  }

  /** Sensor values normalised to [0, 1]: 0 = nothing seen, 1 = touching. */
  getValues(): number[] {
    return this.readings.map((r) => (r === null ? 0 : 1 - r.offset));
  }

  private castRays(host: SensorHost) {
    this.rays = [];
    for (let i = 0; i < this.rayCount; i++) {
      const rayAngle =
        lerp(
          this.raySpread / 2,
          -this.raySpread / 2,
          this.rayCount === 1 ? 0.5 : i / (this.rayCount - 1),
        ) + host.angle;

      const start: Point = { x: host.x, y: host.y };
      const end: Point = {
        x: host.x - Math.sin(rayAngle) * this.rayLength,
        y: host.y - Math.cos(rayAngle) * this.rayLength,
      };
      this.rays.push([start, end]);
    }
  }

  private static getReading(
    ray: [Point, Point],
    roadBorders: [Point, Point][],
    obstacles: Obstacle[],
  ): Intersection | null {
    const touches: Intersection[] = [];

    for (const border of roadBorders) {
      const touch = getIntersection(ray[0], ray[1], border[0], border[1]);
      if (touch) touches.push(touch);
    }

    for (const obstacle of obstacles) {
      const poly = obstacle.polygon;
      for (let j = 0; j < poly.length; j++) {
        const touch = getIntersection(
          ray[0],
          ray[1],
          poly[j],
          poly[(j + 1) % poly.length],
        );
        if (touch) touches.push(touch);
      }
    }

    if (touches.length === 0) return null;
    const offsets = touches.map((t) => t.offset);
    const minOffset = Math.min(...offsets);
    return touches.find((t) => t.offset === minOffset) ?? null;
  }

  draw(ctx: CanvasRenderingContext2D) {
    for (let i = 0; i < this.rayCount; i++) {
      const ray = this.rays[i];
      if (!ray) continue;
      const end = this.readings[i] ?? ray[1];

      ctx.lineWidth = 2;
      ctx.strokeStyle = "#facc15";
      ctx.beginPath();
      ctx.moveTo(ray[0].x, ray[0].y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();

      ctx.strokeStyle = "#1f2937";
      ctx.beginPath();
      ctx.moveTo(ray[1].x, ray[1].y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
    }
  }
}
