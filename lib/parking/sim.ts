import type { NetworkData } from "../network";
import { ParkBrain } from "./brain";
import { ParkCar, type ParkControls } from "./car";
import { buildLot, lerpPose, type Lot, type LotKind } from "./lot";

export interface ParkingConfig {
  kind: LotKind;
  seed: number;
  population: number;
  mutationRate: number;
  rayCount: number;
  hiddenLayers: number[];
  occupancy: number;
  /** extra room in the bay, metres */
  slack: number;
  /** seconds per attempt before the generation is cut */
  episodeSeconds: number;
  /** reshuffle the lot every generation so the brain generalises */
  randomizeLot: boolean;
  /** start easy (lined up next to the bay) and back the spawn off as the
   * population succeeds — without this the task is far too sparse to learn */
  curriculum: boolean;
}

export const DEFAULT_PARKING_CONFIG: ParkingConfig = {
  kind: "perpendicular",
  seed: 7,
  population: 120,
  mutationRate: 0.18,
  rayCount: 12,
  hiddenLayers: [14, 10],
  occupancy: 0.75,
  slack: 0.35,
  episodeSeconds: 22,
  randomizeLot: false,
  curriculum: true,
};

export interface ParkingStats {
  generation: number;
  alive: number;
  population: number;
  parked: number;
  crashed: number;
  bestScore: number;
  allTimeBest: number;
  distance: number;
  headingErrorDeg: number;
  speed: number;
  elapsed: number;
  episodeSeconds: number;
  successRate: number;
  /** curriculum difficulty, 0 = spawn next to the bay, 1 = far end of aisle */
  level: number;
  insideSlot: boolean;
  gear: "D" | "R" | "N";
  steerDeg: number;
}

export const DT = 1 / 30;

export class ParkingSim {
  config: ParkingConfig;
  lot!: Lot;
  cars: ParkCar[] = [];
  best!: ParkCar;
  generation = 1;
  elapsed = 0;
  allTimeBest = 0;
  bestBrain: NetworkData | null = null;
  /** top performers carried into the next generation */
  elites: NetworkData[] = [];
  /** success history, newest last */
  history: boolean[] = [];
  manual = false;
  level = 0;
  manualControls: ParkControls | null = null;

  constructor(config: Partial<ParkingConfig> = {}, brain?: NetworkData | null) {
    this.config = { ...DEFAULT_PARKING_CONFIG, ...config };
    if (brain) {
      this.bestBrain = brain;
      this.elites = [brain];
    }
    this.reset(true);
  }

  setConfig(patch: Partial<ParkingConfig>) {
    const keepBrain =
      (patch.rayCount === undefined || patch.rayCount === this.config.rayCount) &&
      (patch.hiddenLayers === undefined ||
        patch.hiddenLayers.join() === this.config.hiddenLayers.join());
    this.config = { ...this.config, ...patch };
    if (!keepBrain) {
      this.bestBrain = null;
      this.elites = [];
    }
    this.generation = 1;
    this.history = [];
    this.allTimeBest = 0;
    this.reset(true);
  }

  loadBrain(brain: NetworkData) {
    this.bestBrain = brain;
    this.elites = [brain];
    this.generation = 1;
    this.reset(true);
  }

  private lotSeed(): number {
    const { seed, randomizeLot } = this.config;
    return randomizeLot ? seed + this.generation * 31 : seed;
  }

  reset(rebuildLot = false) {
    if (rebuildLot || !this.lot) {
      this.lot = buildLot({
        kind: this.config.kind,
        seed: this.lotSeed(),
        occupancy: this.config.occupancy,
        slack: this.config.slack,
      });
    }
    this.elapsed = 0;
    this.spawn();
  }

  private spawn() {
    const { population, rayCount, hiddenLayers, mutationRate, curriculum } = this.config;
    const pose = curriculum
      ? lerpPose(this.lot.easyStart, this.lot.start, this.level)
      : this.lot.start;
    const { x, z, angle } = pose;
    const pop = Math.max(2, population);
    this.cars = [];

    for (let i = 0; i < pop; i++) {
      const car = new ParkCar(x, z, angle, {
        rayCount,
        hiddenLayers,
        color: i === 0 ? "#38bdf8" : "#64748b",
      });

      const parents = this.elites;
      if (parents.length) {
        if (i === 0) {
          // elitism: the champion is carried over untouched
          car.brain = ParkBrain.clone(parents[0]);
        } else {
          const a = parents[i % parents.length];
          const b = parents[Math.floor(Math.random() * parents.length)];
          const child = parents.length > 1 ? ParkBrain.crossover(a, b) : ParkBrain.clone(a);
          // a spread of mutation strengths: fine tuners + bold explorers
          const strength = mutationRate * (0.25 + (i / pop) * 2.2);
          ParkBrain.mutate(child, strength, 0.35 + (i / pop) * 0.5);
          car.brain = child;
        }
      }
      this.cars.push(car);
    }
    this.best = this.cars[0];
    this.best.color = "#38bdf8";
  }

  /** Single hero car driven by the keyboard. */
  startManual() {
    this.manual = true;
    const { x, z, angle } = this.lot.start;
    const car = new ParkCar(x, z, angle, {
      rayCount: this.config.rayCount,
      manual: true,
      color: "#f472b6",
    });
    this.cars = [car];
    this.best = car;
    this.elapsed = 0;
  }

  stopManual() {
    this.manual = false;
    this.reset();
  }

  step(controls?: ParkControls) {
    this.elapsed += DT;
    let alive = 0;

    for (const car of this.cars) {
      const wasDone = car.crashed || car.parked;
      car.update(DT, this.lot, controls);
      if (!car.crashed && !car.parked) alive++;
      else if (!wasDone && car === this.best) {
        /* keep camera on it */
      }
    }

    // champion of this generation so far
    let champ = this.cars[0];
    for (const car of this.cars) if (car.fitness > champ.fitness) champ = car;
    for (const car of this.cars) car.color = car === champ ? "#38bdf8" : "#64748b";
    this.best = champ;

    if (this.manual) return;

    const timeUp = this.elapsed >= this.config.episodeSeconds;
    if (alive === 0 || timeUp) this.nextGeneration();
  }

  private nextGeneration() {
    const ranked = [...this.cars]
      .filter((c) => c.brain)
      .sort((a, b) => b.fitness - a.fitness);
    const champ = ranked[0] ?? this.cars[0];

    const eliteCount = Math.max(2, Math.round(this.cars.length * 0.12));
    const fresh = ranked.slice(0, eliteCount).map((c) => ParkBrain.clone(c.brain!));

    // Keep the all-time champion in the gene pool: scores can regress when the
    // lot is reshuffled, and losing the best brain throws away real progress.
    if (this.bestBrain && champ.fitness < this.allTimeBest) {
      fresh.unshift(ParkBrain.clone(this.bestBrain));
    }
    this.elites = fresh;

    if (champ.brain && champ.fitness >= this.allTimeBest) {
      this.allTimeBest = champ.fitness;
      this.bestBrain = ParkBrain.clone(champ.brain);
    }

    const succeeded = this.cars.some((c) => c.parked);
    this.history.push(succeeded);
    if (this.history.length > 20) this.history.shift();

    if (this.config.curriculum) {
      // Promote when the population can park from here, ease off when it stalls.
      const parkedCount = this.cars.filter((c) => c.parked).length;
      if (parkedCount >= Math.max(2, this.cars.length * 0.03)) {
        this.level = Math.min(1, this.level + 0.06);
      } else if (succeeded) {
        this.level = Math.min(1, this.level + 0.035);
      } else {
        this.level = Math.max(0, this.level - 0.008);
      }
    }

    this.generation++;
    this.reset(true);
  }

  stats(): ParkingStats {
    const b = this.best;
    const alive = this.cars.filter((c) => !c.crashed && !c.parked).length;
    const parked = this.cars.filter((c) => c.parked).length;
    const crashed = this.cars.filter((c) => c.crashed).length;
    const successes = this.history.filter(Boolean).length;

    return {
      generation: this.generation,
      alive,
      population: this.cars.length,
      parked,
      crashed,
      bestScore: Math.round(b?.bestScore ?? 0),
      allTimeBest: Math.round(this.allTimeBest),
      distance: b?.distanceToTarget ?? 0,
      headingErrorDeg: ((b?.headingError ?? 0) * 180) / Math.PI,
      speed: b?.speed ?? 0,
      elapsed: this.elapsed,
      episodeSeconds: this.config.episodeSeconds,
      successRate: this.history.length ? successes / this.history.length : 0,
      level: this.level,
      insideSlot: b?.insideSlot ?? false,
      gear: !b || b.speed === 0 ? "N" : b.speed > 0 ? "D" : "R",
      steerDeg: ((b?.steer ?? 0) * 180) / Math.PI,
    };
  }
}
