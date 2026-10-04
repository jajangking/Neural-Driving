import { Car } from "./car";
import { stepCarOnTrack } from "./drive";
import { NeuralNetwork, type NetworkData } from "./network";
import { drawTrack } from "./render";
import { getScene } from "./scenes";
import { TrafficCar } from "./traffic";
import type { Track } from "./track";

export interface RaceEntry {
  name: string;
  color: string;
  brain: NetworkData;
}

export interface RaceOptions {
  sceneId: string;
  seed: number;
  laneCount: number;
  trafficDensity: number;
  maxSpeed: number;
  targetLaps: number;
  zoom: number;
  maxTicks?: number;
}

export interface Standing {
  name: string;
  color: string;
  lap: number;
  progress: number;
  gap: number;
  speed: number;
  status: "racing" | "crashed" | "finished" | "dnf";
  position: number;
  timeSec: number | null;
}

const CAR_W = 30;
const CAR_H = 50;
const IDLE_LIMIT = 420;
const TICKS_PER_SEC = 60;

export class Race {
  track: Track;
  options: RaceOptions;
  cars: Car[] = [];
  entries: RaceEntry[];
  traffic: TrafficCar[] = [];
  ticks = 0;
  over = false;
  winner: string | null = null;
  private finishTick = new Map<Car, number>();

  constructor(entries: RaceEntry[], options: RaceOptions) {
    this.entries = entries;
    this.options = { maxTicks: 60 * 60 * 5, ...options };
    const scene = getScene(options.sceneId);
    this.track = scene.build(options.laneCount, options.seed);
    this.buildGrid();
    this.traffic = this.buildTraffic();
  }

  restart() {
    this.ticks = 0;
    this.over = false;
    this.winner = null;
    this.finishTick.clear();
    this.buildGrid();
    this.traffic = this.buildTraffic();
  }

  private buildGrid() {
    this.cars = this.entries.map((entry, i) => {
      const shape = (() => {
        try {
          return NeuralNetwork.shape(NeuralNetwork.fromJSON(entry.brain));
        } catch {
          return [7, 8, 4];
        }
      })();
      const rayCount = shape[0];

      // staggered grid, starting from the middle lanes outwards
      const order = Race.gridLanes(this.track.laneCount);
      const lane = order[i % order.length];
      const row = Math.floor(i / order.length);
      const pose = this.track.poseAt(
        40 + row * 70,
        this.track.laneOffset(lane),
      );

      const car = new Car(pose.x, pose.y, CAR_W, CAR_H, {
        controlType: "AI",
        maxSpeed: this.options.maxSpeed,
        rayCount,
        color: entry.color,
      });
      car.angle = pose.angle;
      try {
        car.brain = NeuralNetwork.fromJSON(entry.brain);
      } catch {
        /* keep random brain */
      }
      return car;
    });
  }

  /** Lane order for the starting grid: middle lanes first. */
  static gridLanes(laneCount: number): number[] {
    const mid = (laneCount - 1) / 2;
    return [...Array(laneCount).keys()].sort(
      (a, b) => Math.abs(a - mid) - Math.abs(b - mid),
    );
  }

  private buildTraffic(): TrafficCar[] {
    const cars: TrafficCar[] = [];
    const lanes = this.options.laneCount;
    const density = this.options.trafficDensity;
    if (density <= 0) return cars;

    const spacing = 280;
    const window = this.track.closed ? this.track.total : this.track.total;
    const rows = Math.floor(window / spacing);
    for (let r = 1; r <= rows; r++) {
      const dist = 600 + r * spacing;
      if (dist > this.track.total - 400) break;
      const perRow = Math.min(
        lanes - 1,
        Math.round(density * (lanes - 1) + (Math.random() < density ? 1 : 0)),
      );
      const pool = [...Array(lanes).keys()].sort(() => Math.random() - 0.5);
      for (let i = 0; i < perRow; i++) {
        cars.push(
          new TrafficCar(dist + Math.random() * 90, pool[i], 1.4 + Math.random() * 0.8),
        );
      }
    }
    return cars;
  }

  get leader(): Car {
    return this.cars.reduce(
      (best, c) => (c.progress > best.progress ? c : best),
      this.cars[0],
    );
  }

  step() {
    if (this.over) return;
    this.ticks++;

    for (const t of this.traffic) t.update(this.track);

    for (const car of this.cars) {
      if (car.damaged || car.finished) continue;
      stepCarOnTrack(this.track, car, this.traffic);

      // lap target on closed circuits
      if (this.track.closed && car.laps >= this.options.targetLaps) {
        car.finished = true;
      }
      if (car.finished && !this.finishTick.has(car)) {
        this.finishTick.set(car, this.ticks);
      }
      if (car.idleTicks > IDLE_LIMIT) car.damaged = true;
    }

    const stillRacing = this.cars.filter((c) => !c.damaged && !c.finished);
    const anyFinished = this.cars.some((c) => c.finished);

    if (anyFinished || stillRacing.length === 0 || this.ticks >= (this.options.maxTicks ?? Infinity)) {
      this.over = true;
      this.winner = this.standings[0]?.name ?? null;
    }
  }

  get standings(): Standing[] {
    const rows = this.cars.map((car, i) => {
      const entry = this.entries[i];
      const tick = this.finishTick.get(car) ?? null;
      const status: Standing["status"] = car.finished
        ? "finished"
        : car.damaged
          ? this.over
            ? "dnf"
            : "crashed"
          : "racing";
      return {
        name: entry.name,
        color: entry.color,
        lap: car.laps + (this.track.closed ? 1 : 0),
        progress: Math.round(car.bestProgress),
        gap: 0,
        speed: Number(car.speed.toFixed(2)),
        status,
        position: 0,
        timeSec: tick === null ? null : Number((tick / TICKS_PER_SEC).toFixed(2)),
      };
    });

    rows.sort((a, b) => {
      const af = a.status === "finished" ? 1 : 0;
      const bf = b.status === "finished" ? 1 : 0;
      if (af !== bf) return bf - af;
      if (af && bf && a.timeSec !== null && b.timeSec !== null) {
        return a.timeSec - b.timeSec;
      }
      return b.progress - a.progress;
    });

    const lead = rows[0]?.progress ?? 0;
    rows.forEach((r, i) => {
      r.position = i + 1;
      r.gap = lead - r.progress;
    });
    return rows;
  }

  render(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    options: { showSensors?: boolean } = {},
  ) {
    const { showSensors = false } = options;
    const cam = this.leader ?? { x: 0, y: 0 };
    const zoom = this.options.zoom;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#0e1627";
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-cam.x, -cam.y);

    drawTrack(ctx, this.track);

    for (const t of this.traffic) {
      if (Math.abs(t.x - cam.x) > 2200 || Math.abs(t.y - cam.y) > 2200) continue;
      t.draw(ctx);
    }

    this.cars.forEach((car, i) => {
      car.draw(ctx, { drawSensor: showSensors && !car.damaged, alpha: car.damaged ? 0.45 : 1 });

      // name tag
      const entry = this.entries[i];
      ctx.save();
      ctx.font = "600 14px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(2,6,23,0.85)";
      ctx.fillStyle = entry.color;
      const label = car.finished ? `${entry.name} ✓` : car.damaged ? `${entry.name} ✕` : entry.name;
      ctx.strokeText(label, car.x, car.y - 42);
      ctx.fillText(label, car.x, car.y - 42);
      ctx.restore();
    });

    ctx.restore();
  }
}
