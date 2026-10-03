import { Level, NeuralNetwork } from "./network";
import { getRGBA, lerp } from "./utils";

const OUTPUT_LABELS = ["\u2191", "\u2190", "\u2192", "\u2193"];

export class Visualizer {
  static drawNetwork(
    ctx: CanvasRenderingContext2D,
    network: NeuralNetwork,
    left: number,
    top: number,
    width: number,
    height: number,
  ) {
    const levelHeight = height / network.levels.length;

    for (let i = network.levels.length - 1; i >= 0; i--) {
      const levelTop =
        top +
        lerp(
          height - levelHeight,
          0,
          network.levels.length === 1 ? 0.5 : i / (network.levels.length - 1),
        );

      ctx.setLineDash([7, 3]);
      Visualizer.drawLevel(
        ctx,
        network.levels[i],
        left,
        levelTop,
        width,
        levelHeight,
        i === network.levels.length - 1 ? OUTPUT_LABELS : [],
      );
    }
  }

  private static drawLevel(
    ctx: CanvasRenderingContext2D,
    level: Level,
    left: number,
    top: number,
    width: number,
    height: number,
    outputLabels: string[],
  ) {
    const right = left + width;
    const bottom = top + height;
    const { inputs, outputs, weights, biases } = level;
    const nodeRadius = 16;

    for (let i = 0; i < inputs.length; i++) {
      for (let j = 0; j < outputs.length; j++) {
        ctx.beginPath();
        ctx.moveTo(Visualizer.nodeX(inputs, i, left, right), bottom);
        ctx.lineTo(Visualizer.nodeX(outputs, j, left, right), top);
        ctx.lineWidth = 2;
        ctx.strokeStyle = getRGBA(weights[i][j]);
        ctx.stroke();
      }
    }

    for (let i = 0; i < inputs.length; i++) {
      const x = Visualizer.nodeX(inputs, i, left, right);
      ctx.beginPath();
      ctx.arc(x, bottom, nodeRadius, 0, Math.PI * 2);
      ctx.fillStyle = "#020617";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, bottom, nodeRadius * 0.6, 0, Math.PI * 2);
      ctx.fillStyle = getRGBA(inputs[i]);
      ctx.fill();
    }

    for (let i = 0; i < outputs.length; i++) {
      const x = Visualizer.nodeX(outputs, i, left, right);
      ctx.beginPath();
      ctx.arc(x, top, nodeRadius, 0, Math.PI * 2);
      ctx.fillStyle = "#020617";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, top, nodeRadius * 0.6, 0, Math.PI * 2);
      ctx.fillStyle = getRGBA(outputs[i]);
      ctx.fill();

      ctx.beginPath();
      ctx.lineWidth = 2;
      ctx.arc(x, top, nodeRadius * 0.8, 0, Math.PI * 2);
      ctx.strokeStyle = getRGBA(biases[i]);
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);

      if (outputLabels[i]) {
        ctx.beginPath();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#0f172a";
        ctx.strokeStyle = "#f8fafc";
        ctx.font = `${nodeRadius}px system-ui, sans-serif`;
        ctx.fillText(outputLabels[i], x, top + nodeRadius * 0.1);
        ctx.lineWidth = 0.5;
        ctx.strokeText(outputLabels[i], x, top + nodeRadius * 0.1);
      }
    }
  }

  private static nodeX(
    nodes: number[],
    index: number,
    left: number,
    right: number,
  ): number {
    return lerp(
      left,
      right,
      nodes.length === 1 ? 0.5 : index / (nodes.length - 1),
    );
  }
}
