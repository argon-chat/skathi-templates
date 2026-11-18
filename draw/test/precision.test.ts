import { expect, test } from "bun:test";
import { eventsChunk, decodeRecording, joinBytes, metaChunk, recordingHeader, endChunk } from "../src/events";
import { transformStroke } from "../src/geometry";
import { Mesh, tessellate } from "../src/ink";
import { canonicalStroke } from "../src/precision";

test("an off-grid spray transform round-trips with byte-identical particles", async () => {
  const points = Array.from({ length: 96 }, (_, i) => [
    i * 1.48,
    23 * Math.sin(i / 12),
    0.38 + i / 220,
    24,
    -9,
    18,
    6400 + i * 4,
  ]).flat();
  const stroke = transformStroke(
    canonicalStroke({
      seq: 12,
      tool: "spray",
      color: "ink",
      width: 8.4,
      density: 0.731,
      scatter: 0.612,
      opacity: 0.783,
      points,
    }),
    [1.123, 0.297, -0.352, 0.918, 12.234, -3.172],
    39,
  );
  const bytes = joinBytes([
    recordingHeader(false),
    metaChunk({
      width: 640,
      height: 480,
      paper: "plain",
      dark: false,
      seed: 0,
      view: { x: 0, y: 0, angle: 0, zoom: 1 },
    }),
    await eventsChunk([{ kind: "stroke", layer: "layer-1", strokes: [stroke], at: 450 }], 0),
    endChunk(450, 1),
  ]);
  const replayed = (await decodeRecording(bytes)).events[0];
  if (replayed?.kind !== "stroke") throw Error("Missing stroke");
  const before = new Mesh(),
    after = new Mesh();
  tessellate(stroke, before);
  tessellate(replayed.strokes[0]!, after);
  expect(before.count).toBeGreaterThan(16);
  expect(after.view()).toEqual(before.view());
});
