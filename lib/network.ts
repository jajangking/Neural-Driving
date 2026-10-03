import { lerp } from "./utils";

export interface LevelData {
  inputs: number[];
  outputs: number[];
  biases: number[];
  weights: number[][];
}

export interface NetworkData {
  levels: LevelData[];
}

export class Level implements LevelData {
  inputs: number[];
  outputs: number[];
  biases: number[];
  weights: number[][];

  constructor(inputCount: number, outputCount: number) {
    this.inputs = new Array(inputCount).fill(0);
    this.outputs = new Array(outputCount).fill(0);
    this.biases = new Array(outputCount).fill(0);
    this.weights = [];
    for (let i = 0; i < inputCount; i++) {
      this.weights.push(new Array(outputCount).fill(0));
    }
    Level.randomize(this);
  }

  static randomize(level: Level) {
    for (let i = 0; i < level.inputs.length; i++) {
      for (let j = 0; j < level.outputs.length; j++) {
        level.weights[i][j] = Math.random() * 2 - 1;
      }
    }
    for (let i = 0; i < level.biases.length; i++) {
      level.biases[i] = Math.random() * 2 - 1;
    }
  }

  /** Binary threshold activation: fires when the weighted sum beats the bias. */
  static feedForward(givenInputs: number[], level: Level): number[] {
    for (let i = 0; i < level.inputs.length; i++) {
      level.inputs[i] = givenInputs[i];
    }

    for (let i = 0; i < level.outputs.length; i++) {
      let sum = 0;
      for (let j = 0; j < level.inputs.length; j++) {
        sum += level.inputs[j] * level.weights[j][i];
      }
      level.outputs[i] = sum > level.biases[i] ? 1 : 0;
    }

    return level.outputs;
  }
}

export class NeuralNetwork {
  levels: Level[];

  /** @param neuronCounts e.g. [5, 6, 4] -> 5 sensors, 6 hidden, 4 controls */
  constructor(neuronCounts: number[]) {
    this.levels = [];
    for (let i = 0; i < neuronCounts.length - 1; i++) {
      this.levels.push(new Level(neuronCounts[i], neuronCounts[i + 1]));
    }
  }

  static feedForward(givenInputs: number[], network: NeuralNetwork): number[] {
    let outputs = Level.feedForward(givenInputs, network.levels[0]);
    for (let i = 1; i < network.levels.length; i++) {
      outputs = Level.feedForward(outputs, network.levels[i]);
    }
    return outputs;
  }

  /** amount = 0 keeps the brain, 1 fully randomizes it. */
  static mutate(network: NeuralNetwork, amount = 0.1) {
    network.levels.forEach((level) => {
      for (let i = 0; i < level.biases.length; i++) {
        level.biases[i] = lerp(level.biases[i], Math.random() * 2 - 1, amount);
      }
      for (let i = 0; i < level.weights.length; i++) {
        for (let j = 0; j < level.weights[i].length; j++) {
          level.weights[i][j] = lerp(
            level.weights[i][j],
            Math.random() * 2 - 1,
            amount,
          );
        }
      }
    });
  }

  static clone(network: NeuralNetwork): NeuralNetwork {
    return NeuralNetwork.fromJSON(JSON.parse(JSON.stringify(network)));
  }

  static fromJSON(data: NetworkData): NeuralNetwork {
    const net = Object.create(NeuralNetwork.prototype) as NeuralNetwork;
    net.levels = data.levels.map((levelData) => {
      const level = Object.create(Level.prototype) as Level;
      level.inputs = [...levelData.inputs];
      level.outputs = [...levelData.outputs];
      level.biases = [...levelData.biases];
      level.weights = levelData.weights.map((row) => [...row]);
      return level;
    });
    return net;
  }

  /** Shape of the network, e.g. [5, 6, 4]. */
  static shape(network: NeuralNetwork): number[] {
    const counts = network.levels.map((l) => l.inputs.length);
    counts.push(network.levels[network.levels.length - 1].outputs.length);
    return counts;
  }
}
