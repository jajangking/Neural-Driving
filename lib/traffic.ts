import type { Track } from "./track";
import type { Point } from "./utils";

const W = 30;
const H = 50;

/** A dumb car that just cruises along a lane of the track. */
export class TrafficCar {
  dist: number;
  lane: number;
  speed: number;
  color: string;
  x = 0;
  y = 0;
  angle = 0;
  polygon: Point[] = [];

  constructor(dist: number, lane: number, speed: number, color = "#fb7185") {
    this.dist = dist;
    this.lane = lane;
    this.speed = speed;
    this.color = color;
  }

  update(track: Track) {
    this.dist += this.speed;
    if (track.closed) this.dist = ((this.dist % track.total) + track.total) % track.total;

    const pose = track.poseAt(this.dist, track.laneOffset(this.lane));
    this.x = pose.x;
    this.y = pose.y;
    this.angle = pose.angle;
    this.polygon = this.buildPolygon();
  }

  private buildPolygon(): Point[] {
    const rad = Math.hypot(W, H) / 2;
    const alpha = Math.atan2(W, H);
    const a = this.angle;
    return [
      { x: this.x - Math.sin(a - alpha) * rad, y: this.y - Math.cos(a - alpha) * rad },
      { x: this.x - Math.sin(a + alpha) * rad, y: this.y - Math.cos(a + alpha) * rad },
      {
        x: this.x - Math.sin(Math.PI + a - alpha) * rad,
        y: this.y - Math.cos(Math.PI + a - alpha) * rad,
      },
      {
        x: this.x - Math.sin(Math.PI + a + alpha) * rad,
        y: this.y - Math.cos(Math.PI + a + alpha) * rad,
      },
    ];
  }

  draw(ctx: CanvasRenderingContext2D) {
    if (this.polygon.length === 0) return;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.moveTo(this.polygon[0].x, this.polygon[0].y);
    for (let i = 1; i < this.polygon.length; i++) {
      ctx.lineTo(this.polygon[i].x, this.polygon[i].y);
    }
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "rgba(15,23,42,0.5)";
    ctx.beginPath();
    ctx.arc(
      this.x - Math.sin(this.angle) * (H / 4),
      this.y - Math.cos(this.angle) * (H / 4),
      W / 4,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
}
