import type { Track } from "./track";

/** Shared track painter used by both training and race mode. */
export function drawTrack(ctx: CanvasRenderingContext2D, track: Track) {
  const { leftEdge, rightEdge, centerline, closed, laneCount, width } = track;
  const n = centerline.length;

  // asphalt
  ctx.beginPath();
  ctx.moveTo(leftEdge[0].x, leftEdge[0].y);
  for (let i = 1; i < n; i++) ctx.lineTo(leftEdge[i].x, leftEdge[i].y);
  if (closed) ctx.lineTo(leftEdge[0].x, leftEdge[0].y);
  for (let i = n - 1; i >= 0; i--) ctx.lineTo(rightEdge[i].x, rightEdge[i].y);
  ctx.closePath();
  ctx.fillStyle = "#334155";
  ctx.fill("evenodd");

  // lane markings
  ctx.setLineDash([22, 22]);
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(226,232,240,0.55)";
  const laneWidth = width / laneCount;
  for (let k = 1; k < laneCount; k++) {
    const offset = width / 2 - k * laneWidth;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const p = centerline[i];
      const nx = track.normals[i].x * offset;
      const ny = track.normals[i].y * offset;
      if (i === 0) ctx.moveTo(p.x + nx, p.y + ny);
      else ctx.lineTo(p.x + nx, p.y + ny);
    }
    if (closed) ctx.closePath();
    ctx.stroke();
  }

  // edges
  ctx.setLineDash([]);
  ctx.lineWidth = 6;
  ctx.strokeStyle = "#f8fafc";
  for (const edge of [leftEdge, rightEdge]) {
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      if (i === 0) ctx.moveTo(edge[i].x, edge[i].y);
      else ctx.lineTo(edge[i].x, edge[i].y);
    }
    if (closed) ctx.closePath();
    ctx.stroke();
  }

  // start / finish lines
  ctx.setLineDash([14, 14]);
  ctx.lineWidth = 10;
  ctx.strokeStyle = "#facc15";
  ctx.beginPath();
  ctx.moveTo(leftEdge[0].x, leftEdge[0].y);
  ctx.lineTo(rightEdge[0].x, rightEdge[0].y);
  ctx.stroke();

  if (!closed) {
    ctx.strokeStyle = "#4ade80";
    ctx.beginPath();
    ctx.moveTo(leftEdge[n - 1].x, leftEdge[n - 1].y);
    ctx.lineTo(rightEdge[n - 1].x, rightEdge[n - 1].y);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // static obstacles
  for (const o of track.obstacles) {
    ctx.fillStyle = o.kind === "cone" ? "#fb923c" : "#e11d48";
    ctx.beginPath();
    ctx.moveTo(o.polygon[0].x, o.polygon[0].y);
    for (let i = 1; i < o.polygon.length; i++) {
      ctx.lineTo(o.polygon[i].x, o.polygon[i].y);
    }
    ctx.closePath();
    ctx.fill();
  }
}
