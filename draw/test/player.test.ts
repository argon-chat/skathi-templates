import { expect, test } from "bun:test";
import type { DrawEvent, DrawRecording } from "../src/events";
import { type Layer, type Stroke } from "../src/model";
import { PlaybackTimeline } from "../src/playbackTimeline";

function line(seq: number): Stroke {
  return { seq, tool: "pen", width: 4, color: "ink", points: [10, 20, 1, 0, 0, 0, 4000, 30, 20, 1, 0, 0, 0, 4100] };
}

function recording(events: DrawEvent[], initial?: Layer): DrawRecording {
  return {
    events,
    initial: initial ? { active: initial.id, layers: [initial] } : null,
    duration: events.at(-1)?.at ?? 0,
    protected: false,
    created: 0,
    version: "draw/1",
    meta: { width: 800, height: 600, paper: "dots", dark: false, seed: 1, view: { x: 0, y: 0, angle: 0, zoom: 1 } },
  };
}

const layer = "layer-1";

test("stroke growth follows point time across intervening interface events", () => {
  const tape = new PlaybackTimeline(
    recording([
      { kind: "ui", state: { color: "#ff0000" }, at: 80 },
      { kind: "stroke", layer, strokes: [line(1), line(2)], at: 150 },
    ]),
  );
  expect(tape.frame(49, true).layers[0]!.strokes).toHaveLength(0);
  const middle = tape.frame(100, true);
  expect(middle.cursor?.x).toBe(20);
  expect(middle.layers[0]!.strokes[1]!.points.at(-1)).toBe(4050);
  expect(middle.ui.color).toBe("#ff0000");
  expect(tape.frame(150, true).layers[0]!.strokes).toEqual([line(1), line(2)]);
});

test("hidden undone strokes reappear only if redone, and branching keeps the forward state", () => {
  const tape = new PlaybackTimeline(
    recording([
      { kind: "stroke", layer, strokes: [line(1)], at: 100 },
      { kind: "undo", at: 120 },
      { kind: "redo", at: 150 },
      { kind: "stroke", layer, strokes: [line(2)], at: 300 },
      { kind: "undo", at: 330 },
      { kind: "stroke", layer, strokes: [line(3)], at: 500 },
    ]),
  );
  const ids = (t: number, show: boolean) => tape.frame(t, show).layers[0]!.strokes.map((s) => s.seq);
  expect(ids(100, true)).toEqual([1]);
  expect(ids(100, false)).toEqual([]);
  expect(ids(150, false)).toEqual([1]);
  expect(ids(250, false)).toEqual([1]);
  expect(ids(300, true)).toEqual([1, 2]);
  expect(ids(330, true)).toEqual([1]);
  expect(ids(500, false)).toEqual([1, 3]);
  expect(ids(130, true)).toEqual([]);
});

test("undo restores removed stroke data, layer properties, and commands predating a snapshot", () => {
  const initial: Layer = { id: layer, name: "Paper", visible: true, opacity: 1, strokes: [line(0)] };
  const tape = new PlaybackTimeline(
    recording(
      [
        { kind: "undo", fallback: { kind: "edit", layer, added: [], removed: [0] }, at: 2 },
        { kind: "redo", at: 3 },
        { kind: "layer", id: layer, changes: { name: "Ink", visible: false }, at: 4 },
        { kind: "undo", at: 5 },
        { kind: "edit", layer, removed: [0], added: [line(1)], at: 6 },
        { kind: "clear", at: 7 },
        { kind: "undo", at: 8 },
        { kind: "undo", at: 9 },
      ],
      initial,
    ),
  );
  expect(tape.frame(2, true).layers[0]!.strokes).toHaveLength(0);
  expect(tape.frame(4, true).layers[0]!.visible).toBe(false);
  expect(tape.frame(7, true).layers[0]!.strokes).toHaveLength(0);
  expect(tape.frame(8, true).layers[0]!.strokes[0]!.seq).toBe(1);
  expect(tape.frame(9, true).layers[0]).toEqual(initial);
});

test("fitTo budgets the idle gap first, has an exact endpoint and supports inverse timing", () => {
  const tape = new PlaybackTimeline(
    recording([
      { kind: "stroke", layer, at: 100, strokes: [line(1)] },
      { kind: "stroke", layer, at: 3100, strokes: [line(2)] },
    ]),
  );
  const standard = tape.clock(1000);
  expect(standard.duration).toBe(1200);
  const fitted = tape.clock(1000, 300);
  expect(fitted.played(100)).toBe(100);
  expect(fitted.raw(200)).toBe(3000);
  expect(fitted.raw(250)).toBe(3050);
  expect(fitted.raw(300)).toBe(3100);
  expect(fitted.played(3100)).toBe(300);
});

test("an undo after paused edits addresses the specified command in the resumed document", () => {
  const resumed: Layer = {
    id: layer,
    name: "Layer 1",
    visible: true,
    opacity: 1,
    strokes: [line(1), line(2), line(3)],
  };
  const tape = new PlaybackTimeline(
    recording([
      { kind: "stroke", layer, strokes: [line(1)], at: 100 },
      { kind: "replace", layers: [resumed], at: 110 },
      { kind: "undo", fallback: { kind: "edit", layer, removed: [3], added: [] }, at: 120 },
      { kind: "redo", fallback: { kind: "edit", layer, removed: [], added: [line(3)] }, at: 140 },
    ]),
  );
  expect(tape.frame(120, true).layers[0]!.strokes.map((s) => s.seq)).toEqual([1, 2]);
  expect(tape.frame(140, true).layers[0]!.strokes.map((s) => s.seq)).toEqual([1, 2, 3]);
});

test("backward seeks restore immutable keyframes in a 10,000-stroke layer", () => {
  const events: DrawEvent[] = Array.from({ length: 10_000 }, (_, i) => ({
    kind: "stroke",
    layer,
    at: (i + 1) * 120,
    strokes: [line(i + 1)],
  }));
  const timeline = new PlaybackTimeline(recording(events));
  let worst = 0;
  for (const i of [9999, 128, 7534, 3, 9887, 5000, 1, 10000]) {
    const start = performance.now();
    const frame = timeline.frame(i * 120, true);
    worst = Math.max(worst, performance.now() - start);
    expect(frame.layers[0]!.strokes).toHaveLength(i);
    expect(frame.layers[0]!.strokes.at(-1)!.seq).toBe(i);
  }
  expect(worst).toBeLessThan(200);
});
