import { NeuralNetwork } from "./network";
import { Sensor, type Obstacle } from "./sensor";
import { polysIntersect, type Point } from "./utils";

export type ControlType = "AI" | "KEYS" | "DUMMY";

export interface Controls {
  forward: boolean;
  left: boolean;
  right: boolean;
  reverse: boolean;
}

export interface CarOptions {
  controlType?: ControlType;
  maxSpeed?: number;
  color?: string;
  rayCount?: number;
  hiddenLayers?: number[];
}

export class Car {
  x: number;
  y: number;
  width: number;
  height: number;

  speed = 0;
  acceleration = 0.2;
  maxSpeed: number;
  friction = 0.05;
  angle = 0;
  damaged = false;

  controlType: ControlType;
  color: string;
  useBrain: boolean;

  controls: Controls = {
    forward: false,
    left: false,
    right: false,
    reverse: false,
  };

  sensor: Sensor | null = null;
  brain: NeuralNetwork | null = null;
  polygon: Point[] = [];

  /** Progress bookkeeping along the current track. */
  trackIndex = 0;
  progress = 0;
  bestProgress = 0;
  laps = 0;
  idleTicks = 0;
  finished = false;

  constructor(
    x: number,
    y: number,
    width: number,
    height: number,
    options: CarOptions = {},
  ) {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;

    this.controlType = options.controlType ?? "AI";
    this.maxSpeed = options.maxSpeed ?? 3;
    this.color = options.color ?? "#38bdf8";
    this.useBrain = this.controlType === "AI";

    if (this.controlType !== "DUMMY") {
      const rayCount = options.rayCount ?? 7;
      this.sensor = new Sensor(rayCount);
      const hidden = options.hiddenLayers ?? [8];
      this.brain = new NeuralNetwork([rayCount, ...hidden, 4]);
    }

    this.polygon = this.createPolygon();
  }

  /** Distance covered along the track — the genetic algorithm's fitness. */
  get fitness(): number {
    return this.bestProgress;
  }

  update(
    roadBorders: [Point, Point][],
    traffic: Obstacle[],
    keyControls?: Controls,
  ) {
    if (!this.damaged && !this.finished) {
      this.move(keyControls);
      this.polygon = this.createPolygon();
      this.damaged = this.assessDamage(roadBorders, traffic);
    }

    if (this.sensor) {
      this.sensor.update(this, roadBorders, traffic);
      if (this.useBrain && this.brain && !this.damaged && !this.finished) {
        const outputs = NeuralNetwork.feedForward(
          this.sensor.getValues(),
          this.brain,
        );
        this.controls.forward = Boolean(outputs[0]);
        this.controls.left = Boolean(outputs[1]);
        this.controls.right = Boolean(outputs[2]);
        this.controls.reverse = Boolean(outputs[3]);
      }
    }
  }

  private assessDamage(
    roadBorders: [Point, Point][],
    traffic: Obstacle[],
  ): boolean {
    for (const border of roadBorders) {
      if (polysIntersect(this.polygon, [border[0], border[1]])) return true;
    }
    for (const other of traffic) {
      if (other.polygon === this.polygon) continue;
      if (polysIntersect(this.polygon, other.polygon)) return true;
    }
    return false;
  }

  private createPolygon(): Point[] {
    const points: Point[] = [];
    const rad = Math.hypot(this.width, this.height) / 2;
    const alpha = Math.atan2(this.width, this.height);

    points.push({
      x: this.x - Math.sin(this.angle - alpha) * rad,
      y: this.y - Math.cos(this.angle - alpha) * rad,
    });
    points.push({
      x: this.x - Math.sin(this.angle + alpha) * rad,
      y: this.y - Math.cos(this.angle + alpha) * rad,
    });
    points.push({
      x: this.x - Math.sin(Math.PI + this.angle - alpha) * rad,
      y: this.y - Math.cos(Math.PI + this.angle - alpha) * rad,
    });
    points.push({
      x: this.x - Math.sin(Math.PI + this.angle + alpha) * rad,
      y: this.y - Math.cos(Math.PI + this.angle + alpha) * rad,
    });

    return points;
  }

  private move(keyControls?: Controls) {
    const c = this.controlType === "KEYS" && keyControls ? keyControls : this.controls;

    if (c.forward) this.speed += this.acceleration;
    if (c.reverse) this.speed -= this.acceleration;

    if (this.speed > this.maxSpeed) this.speed = this.maxSpeed;
    if (this.speed < -this.maxSpeed / 2) this.speed = -this.maxSpeed / 2;

    if (this.speed > 0) this.speed -= this.friction;
    if (this.speed < 0) this.speed += this.friction;
    if (Math.abs(this.speed) < this.friction) this.speed = 0;

    if (this.speed !== 0) {
      const flip = this.speed > 0 ? 1 : -1;
      if (c.left) this.angle += 0.03 * flip;
      if (c.right) this.angle -= 0.03 * flip;
    }

    this.x -= Math.sin(this.angle) * this.speed;
    this.y -= Math.cos(this.angle) * this.speed;
  }

  draw(
    ctx: CanvasRenderingContext2D,
    options: { drawSensor?: boolean; alpha?: number } = {},
  ) {
    ctx.save();
    ctx.globalAlpha = options.alpha ?? 1;

    ctx.fillStyle = this.damaged ? "#4b5563" : this.color;
    ctx.beginPath();
    ctx.moveTo(this.polygon[0].x, this.polygon[0].y);
    for (let i = 1; i < this.polygon.length; i++) {
      ctx.lineTo(this.polygon[i].x, this.polygon[i].y);
    }
    ctx.closePath();
    ctx.fill();

    // windshield, so the car has a visible heading
    if (!this.damaged) {
      const noseX = this.x - Math.sin(this.angle) * (this.height / 4);
      const noseY = this.y - Math.cos(this.angle) * (this.height / 4);
      ctx.fillStyle = "rgba(15,23,42,0.55)";
      ctx.beginPath();
      ctx.arc(noseX, noseY, this.width / 4, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();

    if (this.sensor && options.drawSensor) {
      this.sensor.draw(ctx);
    }
  }
}
