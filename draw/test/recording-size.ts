import { recordingHeader, metaChunk, eventsChunk, endChunk } from "../src/events";
import type { Stroke } from "../src/model";

const hz = 240,
  strokes = 3600,
  header = recordingHeader(false);
let state = 45891;
function sample() {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return state / 2 ** 32;
}
let bytes =
  header.length +
  metaChunk({
    width: 1920,
    height: 1080,
    paper: "plain",
    dark: false,
    seed: state,
    view: { x: 0, y: 0, angle: 0, zoom: 1 },
  }).length;
let elapsed = 0;
for (let seq = 1; seq <= strokes; seq++) {
  const points: number[] = [];
  const x = sample() * 1920,
    y = sample() * 1080,
    a = sample() * 6.28;
  for (let i = 0; i < hz; i++) {
    const u = i / hz,
      curve = 30 * Math.sin(u * 6.28 + a);
    points.push(
      x + 250 * u * Math.cos(a) - curve * Math.sin(a) + sample(),
      y + 250 * u * Math.sin(a) + curve * Math.cos(a) + sample(),
      0.2 + 0.55 * Math.sin(u * Math.PI) + sample() * 0.08,
      Math.round(15 * Math.cos(u + a) + sample() * 2),
      Math.round(24 * Math.sin(u + a) + sample() * 2),
      Math.round(80 + 12 * Math.sin(u + a)),
      Math.round(elapsed + u * 1000),
    );
  }
  const stroke: Stroke = { seq, tool: "pencil", color: "ink", width: 3.4, seed: state, points };
  bytes += (await eventsChunk([{ kind: "stroke", layer: "layer-1", strokes: [stroke], at: elapsed + 1000 }], elapsed))
    .length;
  elapsed += 1000;
}
bytes += endChunk(elapsed, strokes).length;
console.log(`${elapsed} ms, ${strokes} strokes, ${hz} samples/s, ${bytes} bytes (${(bytes / 1e6).toFixed(3)} MB)`);
