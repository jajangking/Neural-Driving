import { Car, type Controls } from "./car";
import { NeuralNetwork, type NetworkData } from "./network";
import { getScene, SCENES, type SceneDef } from "./scenes";
import { TrafficCar } from "./traffic";
import { stepCarOnTrack } from "./drive";
import { drawTrack } from "./render";
import type { Track } from "./track";

export interface SimulationConfig {
  sceneId: string;
  seed: number;
  population: number;
  mutationRate: number;
  rayCount: number;
  hiddenLayers: number[];
  laneCount: number;
  trafficDensity: number;
  maxSpeed: number;
  zoom: number;
}

export const DEFAULT_CONFIG: SimulationConfig = {
  sceneId: "highway",
  seed: 1,
  population: 150,
  mutationRate: 0.2,
  rayCount: 7,
  hiddenLayers: [8],
  laneCount: 3,
  trafficDensity: 0.55,
  maxSpeed: 4,
  zoom: 0.85,
};

export interface SimulationStats {
  sceneName: string;
  generation: number;
  alive: number;
  population: number;
  distance: number;
  bestDistance: number;
  laps: number;
  progressPct: number;
  speed: number;
  finished: number;
  ticks: number;
}

const CAR_W = 30;
const CAR_H = 50;
const IDLE_LIMIT = 300;
const VIEW_AHEAD = 2600;
const VIEW_BEHIND = 900;

export class Simulation {
  config: SimulationConfig;
  scene: SceneDef;
  track!: Track;
  cars: Car[] = [];
  traffic: TrafficCar[] = [];
  bestCar!: Car;
  playerCar: Car | null = null;

  generation = 1;
  bestDistanceEver = 0;
  ticks = 0;

  private seedBrain: NetworkData | null = null;

  constructor(config: Partial<SimulationConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.scene = getScene(this.config.sceneId);
    this.buildWorld();
  }

  /** Switch scene/circuit. Keeps the learned brain by default. */
  setScene(sceneId: string, options: { keepBrain?: boolean; seed?: number } = {}) {
    const { keepBrain = true, seed } = options;
    this.scene = getScene(sceneId);
    this.config.sceneId = this.scene.id;
    this.config.laneCount = this.scene.defaultLanes;
    this.config.trafficDensity = this.scene.defaultTraffic;
    if (seed !== undefined) this.config.seed = seed;
    if (!keepBrain) this.seedBrain = null;
    this.generation = 1;
    this.bestDistanceEver = 0;
    this.buildWorld();
  }

  /** New random layout for scenes that support it. */
  randomizeScene() {
    this.config.seed = Math.floor(Math.random() * 1e9);
    this.bestDistanceEver = 0;
    this.buildWorld();
  }

  reset(seedBrain: NetworkData | null = this.seedBrain) {
    this.seedBrain = seedBrain;
    this.buildWorld();
  }

  nextGeneration() {
    const champion = this.cars.reduce(
      (best, car) => (car.fitness > best.fitness ? car : best),
      this.cars[0],
    );
    if (champion?.brain) {
      this.seedBrain = JSON.parse(JSON.stringify(champion.brain)) as NetworkData;
    }
    this.generation++;
    this.buildWorld();
  }

  setConfig(partial: Partial<SimulationConfig>) {
    this.config = { ...this.config, ...partial };
  }

  getBrain(): NetworkData | null {
    return this.bestCar?.brain
      ? (JSON.parse(JSON.stringify(this.bestCar.brain)) as NetworkData)
      : this.seedBrain;
  }

  loadBrain(data: NetworkData) {
    this.seedBrain = data;
    this.generation = 1;
    this.bestDistanceEver = 0;
    this.buildWorld();
  }

  clearBrain() {
    this.seedBrain = null;
    this.generation = 1;
    this.bestDistanceEver = 0;
    this.buildWorld();
  }

  spawnPlayer() {
    const pose = this.track.startPose(0);
    const car = new Car(pose.x, pose.y, CAR_W, CAR_H, {
      controlType: "KEYS",
      color: "#f472b6",
      maxSpeed: this.config.maxSpeed,
    });
    car.angle = pose.angle;
    this.playerCar = car;
  }

  removePlayer() {
    this.playerCar = null;
  }

  // ---------------------------------------------------------------- world

  private buildWorld() {
    this.track = this.scene.build(this.config.laneCount, this.config.seed);
    this.ticks = 0;
    this.cars = this.generateCars();
    this.bestCar = this.cars[0];
    this.traffic = this.generateTraffic();
    if (this.playerCar) this.spawnPlayer();
  }

  private generateCars(): Car[] {
    const pose = this.track.startPose();
    const cars: Car[] = [];
    for (let i = 0; i < this.config.population; i++) {
      const car = new Car(pose.x, pose.y, CAR_W, CAR_H, {
        controlType: "AI",
        maxSpeed: this.config.maxSpeed,
        rayCount: this.config.rayCount,
        hiddenLayers: this.config.hiddenLayers,
        color: "#38bdf8",
      });
      car.angle = pose.angle;
      if (this.seedBrain && car.brain) {
        try {
          car.brain = NeuralNetwork.fromJSON(this.seedBrain);
          if (i !== 0) NeuralNetwork.mutate(car.brain, this.config.mutationRate);
        } catch {
          /* incompatible saved brain -> keep random one */
        }
      }
      cars.push(car);
    }
    return cars;
  }

  private generateTraffic(): TrafficCar[] {
    const cars: TrafficCar[] = [];
    const lanes = this.config.laneCount;
    const density = this.config.trafficDensity;
    const spacing = 260;
    const window = this.track.closed ? this.track.total : 6000;
    const rows = Math.floor(window / spacing);

    for (let r = 1; r <= rows; r++) {
      const dist = 400 + r * spacing;
      if (!this.track.closed && dist > this.track.total - 400) break;
      const perRow = Math.max(
        0,
        Math.min(lanes - 1, Math.round(density * (lanes - 1) + (Math.random() < density ? 1 : 0))),
      );
      const pool = [...Array(lanes).keys()].sort(() => Math.random() - 0.5);
      for (let i = 0; i < perRow; i++) {
        cars.push(
          new TrafficCar(
            dist + Math.random() * 80,
            pool[i],
            1.4 + Math.random() * 0.9,
          ),
        );
      }
    }
    return cars;
  }

  /** Recycle traffic that fell far behind the leader (open tracks only). */
  private recycleTraffic(leaderDist: number) {
    if (this.track.closed) return;
    for (const t of this.traffic) {
      if (t.dist < leaderDist - VIEW_BEHIND) {
        t.dist = leaderDist + VIEW_AHEAD + Math.random() * 1200;
        t.lane = Math.floor(Math.random() * this.config.laneCount);
        t.speed = 1.4 + Math.random() * 0.9;
      }
      if (t.dist > this.track.total) t.dist = this.track.total;
    }
  }

  // ----------------------------------------------------------------- loop

  /** Advance one tick. Returns true when a new generation started. */
  step(keyControls?: Controls): boolean {
    this.ticks++;
    const leaderDist = this.bestCar?.progress ?? 0;
    this.recycleTraffic(leaderDist);

    for (const t of this.traffic) t.update(this.track);

    const nearbyTraffic = this.traffic.filter(
      (t) =>
        Math.abs(t.x - (this.bestCar?.x ?? 0)) < 1800 &&
        Math.abs(t.y - (this.bestCar?.y ?? 0)) < 1800,
    );

    for (const car of this.cars) this.updateCar(car, nearbyTraffic);
    if (this.playerCar) this.updateCar(this.playerCar, nearbyTraffic, keyControls);

    this.bestCar = this.cars.reduce(
      (best, car) => (car.fitness > best.fitness ? car : best),
      this.cars[0],
    );
    this.bestDistanceEver = Math.max(this.bestDistanceEver, this.bestCar.fitness);

    const active = this.cars.filter((c) => !c.damaged && !c.finished);
    const stalled = active.length > 0 && active.every((c) => c.idleTicks > IDLE_LIMIT);

    if (active.length === 0 || stalled) {
      this.nextGeneration();
      return true;
    }
    return false;
  }

  private updateCar(car: Car, traffic: TrafficCar[], keyControls?: Controls) {
    stepCarOnTrack(this.track, car, traffic, keyControls);
  }

  get stats(): SimulationStats {
    const best = this.bestCar;
    return {
      sceneName: this.scene.name,
      generation: this.generation,
      alive: this.cars.filter((c) => !c.damaged && !c.finished).length,
      population: this.cars.length,
      distance: Math.max(0, Math.round(best?.fitness ?? 0)),
      bestDistance: Math.round(this.bestDistanceEver),
      laps: best?.laps ?? 0,
      progressPct: this.track.closed
        ? Math.round((((best?.progress ?? 0) % this.track.total) / this.track.total) * 100)
        : Math.round(((best?.progress ?? 0) / this.track.total) * 100),
      speed: Number((best?.speed ?? 0).toFixed(2)),
      finished: this.cars.filter((c) => c.finished).length,
      ticks: this.ticks,
    };
  }

  // --------------------------------------------------------------- render

  render(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    options: { showSensors?: boolean; showGhosts?: boolean } = {},
  ) {
    const { showSensors = true, showGhosts = true } = options;
    const cam = this.bestCar ?? { x: 0, y: 0 };
    const zoom = this.config.zoom;

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

    if (showGhosts) {
      for (const car of this.cars) {
        if (car === this.bestCar) continue;
        car.draw(ctx, { alpha: car.damaged ? 0.07 : 0.22 });
      }
    }

    this.bestCar?.draw(ctx, { drawSensor: showSensors });
    this.playerCar?.draw(ctx, { drawSensor: false });

    ctx.restore();
  }
}

export { SCENES };
