import {
  decodeRecording,
  endChunk,
  eventsChunk,
  joinBytes,
  LayerTable,
  metaChunk,
  recordingHeader,
  type DrawAction,
} from "../src/events";
import { type Layer, type Stroke, type Tool } from "../src/model";
import { Renderer, meshOf } from "../src/renderer";
import { SmudgeSession } from "../src/smudge";

const width = 1000,
  height = 700;
const tools: Tool[] = ["pen", "brush", "marker", "pencil", "spray", "airbrush", "eraser", "lasso-fill"];

function smudgePath(index: number, count: number) {
  const points: number[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / (count - 1)) * Math.PI * 2;
    const x = 500 + (index < 2 ? 385 : 90) * Math.sin(a * 1.5 + index) * Math.cos(a);
    const y = 350 + (index < 2 ? 230 : 100) * Math.sin(a * 2.5 + index);
    points.push(x, y, 0.8, 0, 0, 0, i * 4);
  }
  return points;
}

function measureSimulation(size: number) {
  const points = smudgePath(0, 3000);
  const session = new SmudgeSession({ seq: 1, tool: "smudge", width: size, color: "ink", points });
  const colors = new Uint32Array(width * height);
  for (let i = 0; i < colors.length; i++) colors[i] = 0xff000000 | (((i * 1664525 + 3904223) >>> 3) & 0xffffff);
  session.supply({ x: 0, y: 0, width, height, light: colors });
  const deltas: number[] = [];
  for (let end = 10; end <= 3000; end += 10) {
    const start = performance.now();
    session.advance(points, end);
    deltas.push(performance.now() - start);
  }
  const total = deltas.reduce((a, b) => a + b, 0);
  deltas.sort((a, b) => a - b);
  return { width: size, totalCpuMs: Math.round(total), tenPointsP95Ms: Number(deltas[284]!.toFixed(2)) };
}

export async function mixedRecording(canvas: HTMLCanvasElement) {
  const paint = await Renderer.create(canvas);
  paint.resize(width, height, 1);
  try {
    const layers: Layer[] = Array.from({ length: 3 }, (_, i) => ({
      id: `layer-${i + 1}`,
      name: `Layer ${i + 1}`,
      visible: true,
      opacity: 1,
      strokes: [],
    }));
    const table = new LayerTable();
    const chunks = [
      recordingHeader(false),
      metaChunk({ width, height, view: { x: 0, y: 0, zoom: 1, angle: 0 }, paper: "plain", dark: false, seed: 39 }),
    ];
    let at = 0,
      events = 0,
      seq = 1;
    const record = async (action: DrawAction, dt: number) => {
      chunks.push(await eventsChunk([{ ...action, at: at + dt }], at, table));
      at += dt;
      events++;
    };
    for (let i = 1; i < layers.length; i++) await record({ kind: "add-layer", index: i, layer: layers[i]! }, 100);
    let seed = 39;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 256; i++) {
      const layer = layers[i % 3]!,
        tool = tools[i % 8]!;
      const points: number[] = [];
      let x = 80 + rand() * 820,
        y = 60 + rand() * 580;
      for (let j = 0; j < 44; j++) {
        points.push(x, y, 0.4 + rand() * 0.5, 20, 10, 0, j * 8);
        x += (rand() - 0.4) * 13;
        y += (rand() - 0.5) * 13;
      }
      const color = i % 4 === 0 ? "ink" : ["#FF4343", "#3477F9", "#339B39"][i % 3]!;
      const s: Stroke = { seq: seq++, tool, width: tool === "pen" ? 4 : 14, color, points, seed: seq };
      layer.strokes = [...layer.strokes, s];
      await record({ kind: "stroke", strokes: [s], layer: layer.id }, 1400);
    }
    await record({ kind: "undo" }, 150);
    await record({ kind: "redo" }, 150);
    paint.setLayers(layers);
    const bytesBeforeSmudge = chunks.reduce((s, b) => s + b.byteLength, 0);
    const results = [];
    for (const [index, size] of [100, 26, 35, 42, 24, 32].entries()) {
      const layer = layers[index % 3]!,
        count = index < 2 ? 3000 : 100;
      const s: Stroke = { seq: seq++, tool: "smudge", width: size, color: "ink", points: smudgePath(index, count) };
      const start = performance.now();
      const result = await paint.smudge(s, layer.id);
      const completeMs = Math.round(performance.now() - start);
      const meshStart = performance.now(),
        mesh = meshOf(result),
        meshMs = performance.now() - meshStart;
      layer.strokes = [...layer.strokes, result];
      paint.setLayers(layers);
      const p = result.patch;
      if (!p) throw new Error("Smudge path did not cross any ink");
      const png = [p.png, p.darkPng, p.coveragePng].filter((b): b is Uint8Array => !!b);
      results.push({
        width: size,
        points: count,
        completeMs,
        meshMs,
        vertices: mesh.vertices,
        crop: [p.width, p.height],
        PNG: png.map((b) => b.length),
        pngTypes: png.map((b) => b[25]),
      });
      await record({ kind: "stroke", strokes: [result], layer: layer.id }, count * 4 + 500);
    }
    chunks.push(endChunk(at, events));
    const file = joinBytes(chunks),
      decoded = await decodeRecording(file);
    if (decoded.events.length !== events) throw new Error("Incomplete mixed recording");
    const report = {
      duration: at,
      events,
      bytes: file.length,
      bytesBeforeSmudge,
      count: decoded.events.length,
      results,
      sims: [100, 26].map(measureSimulation),
    };
    return { file, report };
  } finally {
    paint.destroy();
  }
}
