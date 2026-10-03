import { Car, type Controls } from "./car";
import { NeuralNetwork, type NetworkData } from "./network";
import { Road } from "./road";

export interface SimulationConfig {
  population: number;
  mutationRate: number;
  rayCount: number;
  hiddenLayers: number[];
  laneCount: number;
  trafficDensity: number;
  maxSpeed: number;
}

export const DEFAULT_CONFIG: SimulationConfig = {
  population: 150,
  mutationRate: 0.2,
  rayCount: 7,
  hiddenLayers: [8],
  laneCount: 3,
  trafficDensity: 0.55,
  maxSpeed: 4,
};

export interface SimulationStats {
  generation: number;
  alive: number;
  population: number;
  distance: number;
  bestDistance: number;
  speed: number;
  ticks: number;
}

const CAR_WIDTH = 30;
const CAR_HEIGHT = 50;
const ROW_SPACING = 240;
const IDLE_LIMIT = 260;

export class Simulation {
  config: SimulationConfig;
  road: Road;
  cars: Car[] = [];
  traffic: Car[] = [];
  bestCar!: Car;
  playerCar: Car | null = null;

  generation = 1;
  bestDistanceEver = 0;
  ticks = 0;

  private seedBrain: NetworkData | null = null;
  private trafficFrontier = 0;

  constructor(config: Partial<SimulationConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.road = new Road(0, this.config.laneCount * 110, this.config.laneCount);
    this.reset();
  }

  /** Rebuild everything, optionally starting from a saved brain. */
  reset(seedBrain: NetworkData | null = this.seedBrain) {
    this.seedBrain = seedBrain;
    this.road = new Road(0, this.config.laneCount * 110, this.config.laneCount);
    this.ticks = 0;
    this.cars = this.generateCars();
    this.bestCar = this.cars[0];
    this.traffic = [];
    this.trafficFrontier = -ROW_SPACING;
    this.ensureTraffic();
    if (this.playerCar) this.spawnPlayer();
  }

  nextGeneration() {
    const champion = this.cars.reduce(
      (best, car) => (car.fitness > best.fitness ? car : best),
      this.cars[0],
    );
    if (champion.brain) {
      this.seedBrain = JSON.parse(
        JSON.stringify(champion.brain),
      ) as NetworkData;
    }
    this.generation++;
    this.reset(this.seedBrain);
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
    this.reset(data);
  }

  clearBrain() {
    this.seedBrain = null;
    this.generation = 1;
    this.bestDistanceEver = 0;
    this.reset(null);
  }

  spawnPlayer() {
    this.playerCar = new Car(
      this.road.getLaneCenter(Math.floor(this.config.laneCount / 2)),
      100,
      CAR_WIDTH,
      CAR_HEIGHT,
      { controlType: "KEYS", color: "#f472b6", maxSpeed: this.config.maxSpeed },
    );
  }

  removePlayer() {
    this.playerCar = null;
  }

  private generateCars(): Car[] {
    const cars: Car[] = [];
    for (let i = 0; i < this.config.population; i++) {
      const car = new Car(
        this.road.getLaneCenter(Math.floor(this.config.laneCount / 2)),
        0,
        CAR_WIDTH,
        CAR_HEIGHT,
        {
          controlType: "AI",
          maxSpeed: this.config.maxSpeed,
          rayCount: this.config.rayCount,
          hiddenLayers: this.config.hiddenLayers,
          color: "#38bdf8",
        },
      );
      if (this.seedBrain && car.brain) {
        try {
          car.brain = NeuralNetwork.fromJSON(this.seedBrain);
          if (i !== 0) {
            NeuralNetwork.mutate(car.brain, this.config.mutationRate);
          }
        } catch {
          // incompatible saved brain -> keep the random one
        }
      }
      cars.push(car);
    }
    return cars;
  }

  /** Keep generating traffic rows ahead of the leader, drop rows behind. */
  private ensureTraffic() {
    const horizon = this.bestCar ? this.bestCar.y - 3000 : -3000;
    while (this.trafficFrontier > horizon) {
      this.trafficFrontier -= ROW_SPACING;
      const lanes = [...Array(this.config.laneCount).keys()];
      // shuffle
      for (let i = lanes.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [lanes[i], lanes[j]] = [lanes[j], lanes[i]];
      }
      const maxBlocked = Math.max(1, this.config.laneCount - 1);
      const blocked = Math.max(
        1,
        Math.min(maxBlocked, Math.round(this.config.trafficDensity * maxBlocked)),
      );
      for (let i = 0; i < blocked; i++) {
        this.traffic.push(
          new Car(
            this.road.getLaneCenter(lanes[i]),
            this.trafficFrontier - Math.random() * 60,
            CAR_WIDTH,
            CAR_HEIGHT,
            {
              controlType: "DUMMY",
              maxSpeed: 1.6 + Math.random() * 0.8,
              color: "#fb7185",
            },
          ),
        );
      }
    }

    // drop cars that are far behind, and the ones that raced far ahead
    const behind = (this.bestCar?.y ?? 0) + 1200;
    const ahead = (this.bestCar?.y ?? 0) - 4500;
    this.traffic = this.traffic.filter((t) => t.y < behind && t.y > ahead);
  }

  /** Advance the world one tick. Returns true when the generation ended. */
  step(keyControls?: Controls): boolean {
    this.ticks++;
    this.ensureTraffic();

    for (const t of this.traffic) {
      t.controls.forward = true;
      t.update(this.road.borders, []);
    }

    for (const car of this.cars) {
      car.update(this.road.borders, this.traffic);
    }

    if (this.playerCar) {
      this.playerCar.update(this.road.borders, this.traffic, keyControls);
    }

    this.bestCar = this.cars.reduce(
      (best, car) => (car.fitness > best.fitness ? car : best),
      this.cars[0],
    );
    this.bestDistanceEver = Math.max(this.bestDistanceEver, this.bestCar.fitness);

    const alive = this.cars.filter((c) => !c.damaged);
    const stalled =
      alive.length > 0 && alive.every((c) => c.idleTicks > IDLE_LIMIT);

    if (alive.length === 0 || stalled) {
      this.nextGeneration();
      return true;
    }
    return false;
  }

  get stats(): SimulationStats {
    return {
      generation: this.generation,
      alive: this.cars.filter((c) => !c.damaged).length,
      population: this.cars.length,
      distance: Math.max(0, Math.round(this.bestCar?.fitness ?? 0)),
      bestDistance: Math.round(this.bestDistanceEver),
      speed: Number((this.bestCar?.speed ?? 0).toFixed(2)),
      ticks: this.ticks,
    };
  }

  render(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    options: { showSensors?: boolean; showGhosts?: boolean } = {},
  ) {
    const { showSensors = true, showGhosts = true } = options;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.translate(width / 2, -(this.bestCar?.y ?? 0) + height * 0.72);

    // road surface
    ctx.fillStyle = "#334155";
    ctx.fillRect(
      this.road.left,
      (this.bestCar?.y ?? 0) - height,
      this.road.width,
      height * 3,
    );

    this.road.draw(ctx);

    for (const t of this.traffic) t.draw(ctx);

    if (showGhosts) {
      for (const car of this.cars) {
        if (car === this.bestCar) continue;
        car.draw(ctx, { alpha: car.damaged ? 0.08 : 0.2 });
      }
    }

    if (this.bestCar) {
      this.bestCar.draw(ctx, { drawSensor: showSensors });
    }
    if (this.playerCar) {
      this.playerCar.draw(ctx, { drawSensor: false });
    }

    ctx.restore();
  }
}
