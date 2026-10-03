import { mulberry32, Track, type Obstacle } from "./track";
import type { Point } from "./utils";

export interface SceneDef {
  id: string;
  name: string;
  description: string;
  closed: boolean;
  defaultLanes: number;
  defaultTraffic: number;
  randomizable: boolean;
  build: (laneCount: number, seed: number) => Track;
}

const LANE_WIDTH = 110;

function rectPolygon(
  cx: number,
  cy: number,
  w: number,
  h: number,
  angle = 0,
): Point[] {
  const pts: Point[] = [];
  const corners: [number, number][] = [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ];
  for (const [dx, dy] of corners) {
    pts.push({
      x: cx + dx * Math.cos(angle) - dy * Math.sin(angle),
      y: cy + dx * Math.sin(angle) + dy * Math.cos(angle),
    });
  }
  return pts;
}

/** ---------- track generators ---------- */

function highway(laneCount: number): Track {
  const points: Point[] = [];
  for (let y = 0; y >= -26000; y -= 200) points.push({ x: 0, y });
  return new Track({
    id: "highway",
    name: "Highway",
    closed: false,
    width: laneCount * LANE_WIDTH,
    laneCount,
    points,
  });
}

function serpentine(laneCount: number, seed: number): Track {
  const rand = mulberry32(seed);
  const amp = 420 + rand() * 320;
  const wavelength = 1600 + rand() * 900;
  const points: Point[] = [];
  for (let y = 0; y >= -22000; y -= 60) {
    points.push({
      x: Math.sin((y / wavelength) * Math.PI * 2) * amp,
      y,
    });
  }
  return new Track({
    id: "serpentine",
    name: "Jalan Berkelok",
    closed: false,
    width: laneCount * LANE_WIDTH,
    laneCount,
    points,
  });
}

function oval(laneCount: number): Track {
  const rx = 900;
  const ry = 1500;
  const points: Point[] = [];
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 90) {
    points.push({ x: Math.sin(a) * rx, y: -Math.cos(a) * ry + ry });
  }
  return new Track({
    id: "oval",
    name: "Sirkuit Oval",
    closed: true,
    width: laneCount * LANE_WIDTH,
    laneCount,
    points,
  });
}

function grandPrix(laneCount: number, seed: number): Track {
  const rand = mulberry32(seed);
  const lobes = 3 + Math.floor(rand() * 3);
  const phase = rand() * Math.PI * 2;
  const base = 1500;
  const wobble = 420 + rand() * 260;
  const points: Point[] = [];
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 180) {
    const r =
      base +
      Math.sin(a * lobes + phase) * wobble +
      Math.sin(a * (lobes + 2) - phase) * (wobble * 0.35);
    points.push({ x: Math.sin(a) * r, y: -Math.cos(a) * r + base });
  }
  return new Track({
    id: "grandprix",
    name: "Sirkuit GP",
    closed: true,
    width: laneCount * LANE_WIDTH,
    laneCount,
    points,
  });
}

function slalom(laneCount: number, seed: number): Track {
  const rand = mulberry32(seed);
  const points: Point[] = [];
  for (let y = 0; y >= -20000; y -= 200) points.push({ x: 0, y });

  const width = laneCount * LANE_WIDTH;
  const obstacles: Obstacle[] = [];
  let side = rand() > 0.5 ? 1 : -1;
  for (let y = -600; y >= -19500; y -= 420 + rand() * 180) {
    const span = width * (0.42 + rand() * 0.18);
    const cx = side * (width / 2 - span / 2);
    obstacles.push({
      polygon: rectPolygon(cx, y, span, 46),
      kind: "barrier",
    });
    side *= -1;
  }

  return new Track({
    id: "slalom",
    name: "Slalom",
    closed: false,
    width,
    laneCount,
    points,
    obstacles,
  });
}

function chicane(laneCount: number, seed: number): Track {
  const rand = mulberry32(seed);
  const points: Point[] = [];
  let x = 0;
  for (let y = 0; y >= -24000; y -= 80) {
    const t = -y;
    const shift =
      Math.sin(t / 900) * 300 +
      Math.sin(t / 2400 + rand() * 0.001) * 700 +
      Math.sin(t / 420) * 90;
    x = shift;
    points.push({ x, y });
  }
  const width = laneCount * LANE_WIDTH;
  const obstacles: Obstacle[] = [];
  for (let i = 0; i < points.length; i += 90) {
    if (rand() > 0.55) continue;
    const p = points[i];
    const lateral = (rand() * 2 - 1) * (width / 2 - 70);
    obstacles.push({ polygon: rectPolygon(p.x + lateral, p.y, 40, 40), kind: "cone" });
  }
  return new Track({
    id: "chicane",
    name: "Rally Chicane",
    closed: false,
    width,
    laneCount,
    points,
    obstacles,
  });
}

export const SCENES: SceneDef[] = [
  {
    id: "highway",
    name: "Highway",
    description: "Jalan lurus padat — fokus menyalip.",
    closed: false,
    defaultLanes: 3,
    defaultTraffic: 0.55,
    randomizable: false,
    build: (lanes) => highway(lanes),
  },
  {
    id: "serpentine",
    name: "Jalan Berkelok",
    description: "Tikungan S panjang, lalu lintas sedang.",
    closed: false,
    defaultLanes: 3,
    defaultTraffic: 0.4,
    randomizable: true,
    build: (lanes, seed) => serpentine(lanes, seed),
  },
  {
    id: "oval",
    name: "Sirkuit Oval",
    description: "Loop tertutup — hitung lap, bukan jarak lurus.",
    closed: true,
    defaultLanes: 3,
    defaultTraffic: 0.35,
    randomizable: false,
    build: (lanes) => oval(lanes),
  },
  {
    id: "grandprix",
    name: "Sirkuit GP",
    description: "Loop acak berliku dengan hairpin.",
    closed: true,
    defaultLanes: 3,
    defaultTraffic: 0.3,
    randomizable: true,
    build: (lanes, seed) => grandPrix(lanes, seed),
  },
  {
    id: "slalom",
    name: "Slalom",
    description: "Barrier zig-zag, nyaris tanpa lalu lintas.",
    closed: false,
    defaultLanes: 3,
    defaultTraffic: 0.12,
    randomizable: true,
    build: (lanes, seed) => slalom(lanes, seed),
  },
  {
    id: "chicane",
    name: "Rally Chicane",
    description: "Berkelok + kerucut acak. Mode tersulit.",
    closed: false,
    defaultLanes: 3,
    defaultTraffic: 0.3,
    randomizable: true,
    build: (lanes, seed) => chicane(lanes, seed),
  },
];

export function getScene(id: string): SceneDef {
  return SCENES.find((s) => s.id === id) ?? SCENES[0];
}
