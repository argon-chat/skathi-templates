import { recordingHeader, metaChunk, eventsChunk, endChunk, decodeRecording, joinBytes } from "../src/events";
import type { Stroke } from "../src/model";

const hz = 240,
  strokes = 3600,
  header = recordingHeader(false);
let state = 45891;
function sample() {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return state / 2 ** 32;
}
const chunks = [
  header,
  metaChunk({
    width: 1920,
    height: 1080,
    paper: "plain",
    dark: false,
    seed: state,
    view: { x: 0, y: 0, angle: 0, zoom: 1 },
  }),
];
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
  chunks.push(
    await eventsChunk([{ kind: "stroke", layer: "layer-1", strokes: [stroke], at: elapsed + 1000 }], elapsed),
  );
  elapsed += 1000;
}
chunks.push(endChunk(elapsed, strokes));
const file = joinBytes(chunks),
  before = 5_766_655;
console.log(
  `${elapsed} ms, ${strokes} strokes, ${hz} samples/s, ${file.length} bytes (${(100 * (1 - file.length / before)).toFixed(2)}% below SKEV v1)`,
);
const result = await decodeRecording(file);
if (result.events.length !== strokes || result.duration !== elapsed) throw new Error("Incomplete synthetic hour.");
