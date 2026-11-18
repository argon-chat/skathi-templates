import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  decodeRecording,
  recordingHeader,
  metaChunk,
  eventsChunk,
  endChunk,
  joinBytes,
  LayerTable,
  packChunk,
  snapshotChunk,
  setProtection,
  isProtectedHeader,
} from "../src/events";
import { crc32, indexedCrc32, LIMITS, Reader, Writer, transform } from "../src/eventBinary";
import { PlaybackTimeline } from "../src/playbackTimeline";
import { WIRE } from "../src/eventIds";
import { encodeFixture, fixture, fixtureStrokes, pixelPng } from "./fixtureV2";
const golden = new URL("./fixtures/all-events-v2.0.skev", import.meta.url);
const prefix = () => [recordingHeader(false, 100, "0.1.0"), metaChunk(fixture.meta)];
const frame = async (payload: Uint8Array) => packChunk(WIRE.chunk.events, await transform(payload, false));

test("the 2.0 golden file decodes to the independently specified drawing", async () => {
  expect(await decodeRecording(new Uint8Array(readFileSync(golden)))).toEqual(fixture);
});
test("all fields, all tools, polygons, binary theme PNGs and nested actions reproduce the golden bytes", async () => {
  expect(await encodeFixture()).toEqual(new Uint8Array(readFileSync(golden)));
});
test("wire identifiers are permanent", () => {
  expect(WIRE).toEqual({
    chunk: { meta: 1, snapshot: 2, events: 3, end: 4 },
    tool: {
      pen: 1,
      brush: 2,
      marker: 3,
      pencil: 4,
      eraser: 5,
      spray: 6,
      airbrush: 7,
      bucket: 8,
      "lasso-fill": 9,
      smudge: 10,
    },
    mode: {
      pen: 1,
      brush: 2,
      marker: 3,
      pencil: 4,
      eraser: 5,
      spray: 6,
      airbrush: 7,
      bucket: 8,
      "lasso-fill": 9,
      smudge: 10,
      select: 11,
      shape: 12,
      eyedropper: 13,
      hand: 14,
    },
    shape: { line: 1, arrow: 2, rect: 3, ellipse: 4 },
    paper: { plain: 0, dots: 1, lines: 2, squares: 3 },
    blend: {
      normal: 0,
      multiply: 1,
      screen: 2,
      overlay: 3,
      darken: 4,
      lighten: 5,
      add: 6,
      "color-dodge": 7,
      "color-burn": 8,
      "soft-light": 9,
      difference: 10,
      hue: 11,
      saturation: 12,
      color: 13,
      luminosity: 14,
    },
    event: {
      stroke: 1,
      edit: 2,
      "add-layer": 3,
      "delete-layer": 4,
      "move-layer": 5,
      layer: 6,
      replace: 7,
      clear: 8,
      undo: 9,
      redo: 10,
      ui: 11,
      view: 12,
      group: 13,
    },
  });
});
test("forward minor headers, unknown chunks and records, appended fields and missing trailing defaults", async () => {
  const source = recordingHeader(false, 100, "0.1.0"),
    header = new Reader(source);
  header.raw(8);
  const previous = header.uint(),
    w = new Writer();
  w.raw(source.subarray(0, 8));
  w.uint(previous + 2);
  w.raw(header.raw(previous));
  w.u16(377);
  const newerHeader = w.result();
  newerHeader[6] = 7;
  const batch = new Writer();
  batch.uint(3);
  batch.byte(215);
  batch.block(Uint8Array.of(12, 91, 92));
  batch.byte(WIRE.event.clear);
  batch.block(Uint8Array.of(6, 81, 84, 91));
  batch.byte(WIRE.event.view);
  batch.block(Uint8Array.of(3));
  const result = await decodeRecording(
    joinBytes([
      newerHeader,
      metaChunk(fixture.meta),
      packChunk(201, Uint8Array.of(1, 2)),
      await frame(batch.result()),
      endChunk(22, 3),
    ]),
  );
  expect(result.events).toEqual([
    { kind: "clear", at: 18 },
    { kind: "view", at: 21, view: { zoom: 1, angle: 0, x: 0, y: 0 } },
  ]);
  expect(result.duration).toBe(22);
});
test("the last valid chunk survives torn payloads, bad tail CRC, zeroes and trailing garbage", async () => {
  const one = await eventsChunk([{ kind: "clear", at: 42 }], 0),
    last = endChunk(50, 1),
    base = joinBytes([...prefix(), one]);
  for (let n = 0; n < last.length; n++)
    expect((await decodeRecording(joinBytes([base, last.subarray(0, n)]))).duration).toBe(42);
  const bad = last.slice();
  bad[bad.length - 1] = bad.at(-1)! ^ 1;
  expect((await decodeRecording(joinBytes([base, bad]))).duration).toBe(42);
  for (const tail of [new Uint8Array(16), Uint8Array.of(0xab, 0xff, 0, 0xff, 21, 34, 55)])
    expect((await decodeRecording(joinBytes([base, last, tail]))).duration).toBe(50);
  await expect(decodeRecording(joinBytes([base, bad, last]))).rejects.toThrow("CRC32");
  await expect(decodeRecording(joinBytes([base, new Uint8Array([3, 254, 255, 255, 9]), last]))).rejects.toThrow(
    "length",
  );
  const tornLength = Uint8Array.of(3, 255, 255, 255, 255);
  const future = packChunk(
    190,
    Uint8Array.from({ length: 4096 }, (_, i) => (i * 11) & 255),
  );
  for (const intact of [last, future]) {
    const damage = [tornLength, Uint8Array.of(29, 75, 0, 247), intact, Uint8Array.of(253, 254)];
    await expect(decodeRecording(joinBytes([base, ...damage]))).rejects.toThrow("CRC32");
    await expect(decodeRecording(joinBytes([base, last, ...damage]))).rejects.toThrow("CRC32");
  }
});

test("indexed CRC agrees with a direct scan at every checkpoint and power-of-two boundary", () => {
  const data = Uint8Array.from({ length: 16402 }, (_, i) => ((i * 13) ^ (i >>> 4)) & 255);
  const range = indexedCrc32(data);
  for (const start of [0, 1, 31, 32, 33, 59, 512, 1001])
    for (let bit = 0; bit < 15; bit++)
      for (const delta of [-1, 0, 1]) {
        const end = Math.min(data.length, start + 2 ** bit + delta);
        expect(range(start, end)).toBe(crc32(data.subarray(start, end)));
      }
});

test("every canonical event can grow by arbitrary trailing fields in a newer minor", async () => {
  const rows = [
    ...fixture.events,
    { kind: "edit" as const, layer: "layer-1", added: [], removed: [], at: fixture.duration },
  ];
  const chunk = new Reader(await eventsChunk(rows, 0));
  expect(chunk.byte()).toBe(WIRE.chunk.events);
  const source = new Reader(await transform(chunk.raw(chunk.uint()), true));
  const count = source.uint(),
    future = new Writer();
  future.uint(count);
  for (let i = 0; i < count; i++) {
    future.byte(source.byte());
    const body = source.child();
    future.block(joinBytes([body.bytes, Uint8Array.of(255, 255, 255)]));
  }
  const snapshot = await snapshotChunk(fixture.initial!);
  const result = await decodeRecording(joinBytes([...prefix(), snapshot, await frame(future.result())]));
  expect(result.events).toEqual(rows);
});
test("future majors, recursive groups, excessive counts and invalid PNGs are rejected", async () => {
  const h = recordingHeader(false);
  h[4] = 3;
  await expect(decodeRecording(h)).rejects.toThrow("SKEV version 3");
  const w = new Writer();
  w.uint(1_000_000_000);
  await expect(decodeRecording(joinBytes([...prefix(), await frame(w.result())]))).rejects.toThrow("limit");
  const nested = Uint8Array.of(1, WIRE.event.group, 5, 0, 1, WIRE.event.group, 1, 0);
  await expect(decodeRecording(joinBytes([...prefix(), await frame(nested)]))).rejects.toThrow("recursive");
  const stroke = { ...fixtureStrokes.at(-1)!, patch: { x: 0, y: 0, width: 4096, height: 4096, png: pixelPng } };
  await expect(
    decodeRecording(
      joinBytes([
        ...prefix(),
        await eventsChunk([{ kind: "stroke", layer: "layer-1", at: 120, strokes: [stroke] }], 0),
      ]),
    ),
  ).rejects.toThrow("raster dimensions");
  const broken = pixelPng.slice();
  broken[broken.length - 1] ^= 1;
  stroke.patch = { x: 0, y: 0, width: 1, height: 1, png: broken };
  await expect(
    decodeRecording(
      joinBytes([
        ...prefix(),
        await eventsChunk([{ kind: "stroke", layer: "layer-1", at: 120, strokes: [stroke] }], 0),
      ]),
    ),
  ).rejects.toThrow("PNG chunk");
});
test("layers use file symbols across chunks, independent of names and z-order", async () => {
  const ctx = new LayerTable(),
    id = "editor:private-layer-id";
  const base = await snapshotChunk(
    { layers: [{ id, name: "Paper", opacity: 1, visible: true, strokes: [] }], active: id },
    ctx,
  );
  const rows = await eventsChunk([{ kind: "stroke", layer: id, strokes: [fixtureStrokes[0]!], at: 42 }], 0, ctx);
  const file = joinBytes([...prefix(), base, rows]);
  const copy = await decodeRecording(file),
    local = await decodeRecording(file, new LayerTable(ctx.entries()));
  expect(copy.initial!.active).toBe("layer-1");
  expect(local.initial!.active).toBe(id);
  expect(copy.events[0]).toMatchObject({ kind: "stroke", layer: "layer-1" });
  expect(local.events[0]).toMatchObject({ kind: "stroke", layer: id });
  setProtection(file, true);
  expect(isProtectedHeader(file)).toBe(true);
  expect((await decodeRecording(file)).protected).toBe(true);
  setProtection(file, false);
  expect(isProtectedHeader(file)).toBe(false);
});
test("point columns retain 12-bit pressure and encode time from the start of each stroke", async () => {
  const points = [3.024, -1.12, 0.4321, -14.6, 18.1, 361, 3_000_000.4, 7.08, -2.98, 0.65, -13.1, 17, 0, 3_000_008.6];
  const row = await eventsChunk(
    [{ kind: "stroke", layer: "layer-1", at: 100, strokes: [{ ...fixtureStrokes[1]!, points }] }],
    0,
  );
  const e = (await decodeRecording(joinBytes([...prefix(), row]))).events[0];
  if (e?.kind !== "stroke") throw new Error("expected stroke");
  expect(e.strokes[0]!.points).toEqual([
    3,
    -1.125,
    Math.round(0.4321 * 4095) / 4095,
    -15,
    18,
    1,
    0,
    7.0625,
    -3,
    Math.round(0.65 * 4095) / 4095,
    -13,
    17,
    0,
    8,
  ]);
});

test("bounds curve expansion and charges reference-only copies for their source geometry", async () => {
  const long = (count: number) => {
    const points: number[] = [];
    for (let i = 0; i < count; i++) points.push(i * 150, 0, 1, 0, 0, 0, i * 10);
    return { ...fixtureStrokes[1]!, points };
  };
  const oversized = await eventsChunk([{ kind: "stroke", layer: "layer-1", strokes: [long(1500)], at: 50 }], 0);
  await expect(decodeRecording(joinBytes([...prefix(), oversized]))).rejects.toThrow("vertex");
  const original = long(180);
  const copies = Array.from({ length: 1500 }, (_, i) => ({ layer: "layer-1", seq: original.seq, as: 1000 + i }));
  const amplified = await eventsChunk(
    [
      { kind: "stroke", layer: "layer-1", strokes: [original], at: 30 },
      { kind: "edit", layer: "layer-1", removed: [], added: [], copies, at: 40 },
    ],
    0,
  );
  await expect(decodeRecording(joinBytes([...prefix(), amplified]))).rejects.toThrow("vertex");
});

test("the initial layer and subsequent layer additions share the live layer limit", async () => {
  const events = Array.from({ length: LIMITS.layers }, (_, i) => ({
    kind: "add-layer" as const,
    at: i,
    index: i + 1,
    layer: { id: `layer-${i + 2}`, name: "New layer", visible: true, opacity: 1, strokes: [] },
  }));
  const doc = await decodeRecording(joinBytes([...prefix(), await eventsChunk(events, 0)]));
  expect(new PlaybackTimeline({ ...doc, events: doc.events.slice(0, -1) }).final.layers).toHaveLength(LIMITS.layers);
  expect(() => new PlaybackTimeline(doc)).toThrow(`${LIMITS.layers} simultaneous layers`);
});
