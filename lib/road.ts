import { lerp, type Point } from "./utils";

export class Road {
  x: number;
  width: number;
  laneCount: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  borders: [Point, Point][];

  constructor(x: number, width: number, laneCount = 3) {
    this.x = x;
    this.width = width;
    this.laneCount = laneCount;

    this.left = x - width / 2;
    this.right = x + width / 2;

    const infinity = 1_000_000;
    this.top = -infinity;
    this.bottom = infinity;

    const topLeft: Point = { x: this.left, y: this.top };
    const topRight: Point = { x: this.right, y: this.top };
    const bottomLeft: Point = { x: this.left, y: this.bottom };
    const bottomRight: Point = { x: this.right, y: this.bottom };

    this.borders = [
      [topLeft, bottomLeft],
      [topRight, bottomRight],
    ];
  }

  /** Center x of a lane index (clamped to the road). */
  getLaneCenter(laneIndex: number): number {
    const laneWidth = this.width / this.laneCount;
    return (
      this.left +
      laneWidth / 2 +
      Math.min(laneIndex, this.laneCount - 1) * laneWidth
    );
  }

  draw(ctx: CanvasRenderingContext2D) {
    ctx.lineWidth = 5;
    ctx.strokeStyle = "#f4f4f5";

    for (let i = 1; i <= this.laneCount - 1; i++) {
      const x = lerp(this.left, this.right, i / this.laneCount);
      ctx.setLineDash([20, 20]);
      ctx.beginPath();
      ctx.moveTo(x, this.top);
      ctx.lineTo(x, this.bottom);
      ctx.stroke();
    }

    ctx.setLineDash([]);
    this.borders.forEach((border) => {
      ctx.beginPath();
      ctx.moveTo(border[0].x, border[0].y);
      ctx.lineTo(border[1].x, border[1].y);
      ctx.stroke();
    });
  }
}
