import { expect, test } from "bun:test";
import {
  decodeRecording,
  endChunk,
  eventsChunk,
  joinBytes,
  metaChunk,
  packChunk,
  recordingHeader,
  snapshotChunk,
  type DrawAction,
  type DrawMeta,
} from "../src/events";
import { TOOLS, type Layer, type Stroke } from "../src/model";

const view = { x: 15, y: -2, angle: 0.2, zoom: 1.5 };
const meta: DrawMeta = {
  width: 1920,
  height: 1080,
  view,
  paper: "dots",
  dark: true,
  seed: 123,
  author: "Ира",
  title: "Дым",
};
const stroke: Stroke = {
  seq: 1,
  tool: "pen",
  width: 8,
  color: "#ff1122",
  seed: 0xdeadbeef,
  opacity: 0.3,
  points: [-150.0625, -14, 1, -62, 26, 329, 1034, 310.625, 5, 12345 / 65535, 8, -90, 359, 2048],
};
const layer: Layer = { id: "layer-1", name: "Ink", opacity: 1, visible: true, strokes: [stroke] };
const initial = { layers: [layer], active: layer.id };
const prefix = () => [recordingHeader(true, 1771771771771, "draw-test/1"), metaChunk(meta)];

test("round trips every event, tool, brush property, snapshot and protected header", async () => {
  const actions: DrawAction[] = [
    {
      kind: "stroke",
      layer: layer.id,
      strokes: TOOLS.map((tool, i) => ({
        ...stroke,
        tool,
        seq: i + 2,
        hardness: 0.4,
        density: 0.9,
        scatter: 0.5,
        alphaLocked: true,
        ...(tool === "bucket"
          ? {
              contours: [
                [0, 0, 15, 0, 15, 15, 0, 15],
                [3, 3, 3, 4, 4, 4],
              ],
            }
          : {}),
        ...(tool === "smudge"
          ? { width: 1, points: [1, 2, 1, 0, 0, 0, 10], patch: { x: 1, y: 2, width: 1, height: 1, rgba: "/wAA/w==" } }
          : {}),
      })),
    },
    { kind: "edit", layer: layer.id, removed: [1], added: [stroke] },
    {
      kind: "add-layer",
      layer: { ...layer, id: "layer-2", blendMode: "color-burn", clipping: true, alphaLocked: false },
      index: 1,
    },
    { kind: "delete-layer", id: "layer-2" },
    { kind: "move-layer", from: 0, to: 1 },
    {
      kind: "layer",
      id: layer.id,
      changes: { name: "Glow", opacity: 0.9, visible: false, blendMode: "screen", clipping: true, alphaLocked: true },
    },
    { kind: "replace", layers: [layer] },
    { kind: "clear" },
    { kind: "undo", fallback: { kind: "replace", layers: [layer] } },
    { kind: "redo" },
    {
      kind: "ui",
      state: {
        mode: "smudge",
        color: "ink",
        size: 15,
        active: layer.id,
        paper: "dots",
        dark: false,
        symmetry: { mirror: true, segments: 3, x: 0, y: 8 },
      },
    },
    { kind: "view", view },
  ];
  const events = actions.map((action, i) => ({ ...action, at: i * 111 }));
  const parts = [
    ...prefix(),
    await snapshotChunk(initial),
    await eventsChunk(events.slice(0, 2), 0),
    await eventsChunk(events.slice(2), events[1]!.at),
    endChunk(3000, events.length),
  ];
  const loaded = await decodeRecording(joinBytes(parts));
  expect(loaded).toEqual({
    meta,
    initial,
    events,
    duration: 3000,
    protected: true,
    created: 1771771771771,
    version: "draw-test/1",
  });
});

test("accepts every possible truncation of the last event chunk up to its CRC", async () => {
  const events = [{ kind: "stroke" as const, layer: layer.id, strokes: [stroke], at: 2031 }];
  const base = joinBytes([...prefix(), await eventsChunk(events, 0)]);
  const extra = await eventsChunk([{ kind: "clear", at: 2277 }], 2031);
  for (let cut = 0; cut < extra.length; cut++) {
    const loaded = await decodeRecording(joinBytes([base, extra.subarray(0, cut)]));
    expect(loaded.events).toEqual(events);
    expect(loaded.duration).toBe(2031);
  }
});

test("reports CRC errors in complete chunks", async () => {
  const data = joinBytes([...prefix(), endChunk(0, 0)]);
  data[data.length - 1] = data[data.length - 1]! ^ 1;
  await expect(decodeRecording(data)).rejects.toThrow("CRC32");
});

test("skips unknown framed chunks and rejects an unsupported major version", async () => {
  const data = joinBytes([...prefix(), packChunk(211, new Uint8Array([10, 20, 30])), endChunk(0, 0)]);
  expect((await decodeRecording(data)).events).toEqual([]);
  data[4] = 2;
  await expect(decodeRecording(data)).rejects.toThrow("SKEV version 2");
});

test("quantizes coordinates, pressure and timestamps at the specified precision", async () => {
  const original = [10.022, -17.11, 0.4321, -22, 42, 121, 11.3, -4.912, 9.25, 0.66, 3, -4, 45, 20.8];
  const bytes = await eventsChunk(
    [{ kind: "stroke", layer: layer.id, strokes: [{ ...stroke, points: original }], at: 22 }],
    0,
  );
  const e = (await decodeRecording(joinBytes([...prefix(), bytes]))).events[0];
  if (e?.kind !== "stroke") throw new Error("Expected stroke");
  for (let i = 0; i < original.length; i++) {
    const delta = Math.abs(e.strokes[0]!.points[i]! - original[i]!);
    expect(delta).toBeLessThanOrEqual([1 / 32, 1 / 32, 1 / 65535, 0, 0, 0, 0.5][i % 7]!);
  }
});

test("validates raster dimensions, sampled brush footprint and pigment work before playback", async () => {
  const smudge: Stroke = {
    ...stroke,
    tool: "smudge",
    width: 1,
    points: [0, 0, 1, 0, 0, 0, 0],
    patch: { x: 0, y: 0, width: 1, height: 1, rgba: "AAAAAA==" },
  };
  const cases: Stroke[] = [
    { ...smudge, patch: { ...smudge.patch!, width: 8193 } },
    { ...smudge, patch: { ...smudge.patch!, rgba: "AAAAAAAA" } },
    { ...smudge, patch: { ...smudge.patch!, transform: [1, 0, 1, 0, 0, 0] } },
    { ...smudge, points: [1e12, 0, 1, 0, 0, 0, 0] },
    { ...stroke, tool: "spray", points: [0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1e12] },
    { ...stroke, tool: "airbrush", points: [0, 0, 1, 0, 0, 0, 0, 1e12, 0, 1, 0, 0, 0, 10] },
  ];
  for (const item of cases) {
    const chunk = await eventsChunk([{ kind: "stroke", layer: layer.id, strokes: [item], at: 0 }], 0);
    await expect(decodeRecording(joinBytes([...prefix(), chunk]))).rejects.toThrow("invalid stroke event");
  }
});
