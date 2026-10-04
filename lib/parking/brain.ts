import { lerp } from "../utils";
import type { LevelData, NetworkData } from "../network";

/**
 * Parking needs finer control than the track car's binary-threshold network:
 * a 0/1 step activation cannot express "a little bit of steering while
 * creeping backwards". This is the same serialisable shape (levels with
 * weights + biases, so brains stay exportable/importable) but with tanh
 * hidden layers and tanh outputs that are then thresholded into controls.
 */
export class ParkBrain implements NetworkData {
  levels: LevelData[];

  constructor(neuronCounts: number[]) {
    this.levels = [];
    for (let i = 0; i < neuronCounts.length - 1; i++) {
      this.levels.push(ParkBrain.randomLevel(neuronCounts[i], neuronCounts[i + 1]));
    }
  }

  private static randomLevel(inputCount: number, outputCount: number): LevelData {
    // Xavier-ish init keeps early generations from saturating tanh.
    const scale = Math.sqrt(2 / (inputCount + outputCount)) * 2.2;
    const weights: number[][] = [];
    for (let i = 0; i < inputCount; i++) {
      const row: number[] = [];
      for (let j = 0; j < outputCount; j++) row.push((Math.random() * 2 - 1) * scale);
      weights.push(row);
    }
    return {
      inputs: new Array(inputCount).fill(0),
      outputs: new Array(outputCount).fill(0),
      biases: new Array(outputCount).fill(0).map(() => (Math.random() * 2 - 1) * 0.3),
      weights,
    };
  }

  static feedForward(inputs: number[], brain: NetworkData): number[] {
    let signal = inputs;
    for (let l = 0; l < brain.levels.length; l++) {
      const level = brain.levels[l];
      const out = new Array<number>(level.outputs.length);
      for (let j = 0; j < level.outputs.length; j++) {
        let sum = level.biases[j];
        for (let i = 0; i < level.weights.length; i++) {
          sum += (signal[i] ?? 0) * level.weights[i][j];
        }
        out[j] = Math.tanh(sum);
      }
      level.outputs = out;
      signal = out;
    }
    return signal;
  }

  /**
   * Gaussian perturbation of a fraction of the genome — much better at fine
   * tuning than uniformly lerping every weight toward noise.
   */
  static mutate(brain: NetworkData, amount = 0.15, rate = 0.5) {
    for (const level of brain.levels) {
      for (let j = 0; j < level.biases.length; j++) {
        if (Math.random() < rate) level.biases[j] += gauss() * amount;
      }
      for (const row of level.weights) {
        for (let j = 0; j < row.length; j++) {
          if (Math.random() < rate) row[j] += gauss() * amount;
          else if (Math.random() < 0.01) row[j] = lerp(row[j], gauss(), 0.5);
        }
      }
    }
  }

  /** Uniform crossover of two parents. */
  static crossover(a: NetworkData, b: NetworkData): NetworkData {
    const child = ParkBrain.clone(a);
    child.levels.forEach((level, li) => {
      const other = b.levels[li];
      if (!other) return;
      for (let j = 0; j < level.biases.length; j++) {
        if (Math.random() < 0.5) level.biases[j] = other.biases[j];
      }
      for (let i = 0; i < level.weights.length; i++) {
        for (let j = 0; j < level.weights[i].length; j++) {
          if (Math.random() < 0.5) level.weights[i][j] = other.weights[i][j];
        }
      }
    });
    return child;
  }

  static clone(brain: NetworkData): NetworkData {
    return {
      levels: brain.levels.map((l) => ({
        inputs: [...l.inputs],
        outputs: [...l.outputs],
        biases: [...l.biases],
        weights: l.weights.map((r) => [...r]),
      })),
    };
  }
}

function gauss(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
