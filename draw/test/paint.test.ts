import { expect, test } from "bun:test";
import { floodContours } from "../src/bucket";
import { insidePolygon, transformStroke, translate } from "../src/geometry";
import { LiveStroke, Mesh, tessellate } from "../src/ink";
import type { Stroke } from "../src/model";
import { dabStream, polygonMesh, type Dab } from "../src/pigments";
import { SmudgeSession, drawingPixels } from "../src/smudge";

function stroke(tool: Stroke["tool"]): Stroke {
  return {
    seq: 8,
    tool,
    width: 4,
    color: "#aaff00",
    seed: 123,
    points: [8, 8, 0.7, 0, 0, 0, 0, 8, 8, 0.7, 20, 20, 0, 120, 12, 9, 0.9, 45, 10, 0, 180],
  };
}

test("spray and airbrush keep depositing while still, with identical live and committed instances", () => {
  for (const tool of ["spray", "airbrush"] as const) {
    const s = stroke(tool);
    const live = new LiveStroke({ ...s, points: [] });
    const add = dabStream(s);
    const dabs: Dab[] = [];
    for (let i = 0; i < s.points.length; i += 7) {
      const [x, y, p, tx, ty, tw, t] = s.points.slice(i, i + 7) as [
        number,
        number,
        number,
        number,
        number,
        number,
        number,
      ];
      live.add(x, y, p, tx, ty, tw, t);
      add(i, (d) => dabs.push(d));
      if (i === 7) expect(dabs.length).toBeGreaterThan(2);
    }
    const committed = new Mesh();
    tessellate(s, committed);
    expect(live.settled.view()).toEqual(committed.view());
    expect(committed.count).toBe(dabs.length);
    if (tool === "spray") {
      const other = new Mesh();
      tessellate({ ...s, seed: 124 }, other);
      expect(other.view()).not.toEqual(committed.view());
    }
  }
});

test("bucket traces holes, rejects open regions, closes a gap and expands under the line", () => {
  const n = 24,
    px = new Uint8ClampedArray(n * n * 4);
  const set = (x: number, y: number, a: number) => {
    px[(y * n + x) * 4 + 3] = a;
  };
  for (let i = 3; i <= 20; i++) {
    set(i, 3, 255);
    set(i, 20, 255);
    set(3, i, 255);
    set(20, i, 255);
  }
  for (let y = 10; y <= 14; y++) for (let x = 10; x <= 14; x++) set(x, y, 255);
  const fill = (gap = 0, expand = 0) => floodContours(px, n, n, 6, 6, 0, 0, { gap, expand, tolerance: 0 });
  const covered = (rings: number[][] | null, x: number, y: number) =>
    rings?.filter((r) => insidePolygon(x, y, r)).length === 1;
  const rings = fill();
  expect(rings?.length).toBe(2);
  expect(covered(rings, 6, 6)).toBe(true);
  expect(covered(rings, 12, 12)).toBe(false);
  expect(covered(rings, 3.5, 8.5)).toBe(false);
  expect(covered(fill(0, 1), 3.5, 8.5)).toBe(true);
  set(8, 3, 0);
  expect(fill()).toBeNull();
  expect(covered(fill(1), 8.5, 6.5)).toBe(true);
});

test("even-odd triangulation accounts for a self crossing and a hole", () => {
  const area = (r: number[][]) => {
    let sum = 0;
    const vertices: number[] = [];
    polygonMesh(r, (x, y) => {
      vertices.push(x, y);
      if (vertices.length === 6) {
        const [x0, y0, x1, y1, x2, y2] = vertices as [number, number, number, number, number, number];
        sum += Math.abs((x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0)) / 2;
        vertices.length = 0;
      }
    });
    return sum;
  };
  expect(area([[0, 0, 10, 10, 0, 10, 10, 0]])).toBe(50);
  expect(
    area([
      [0, 0, 10, 0, 10, 10, 0, 10],
      [2, 2, 8, 2, 8, 8, 2, 8],
    ]),
  ).toBe(64);
});

test("the smudge updates only the new prefix, crops its result and renders as one transformed quad", () => {
  const width = 24,
    height = 20;
  const brush: Stroke = {
    ...stroke("smudge"),
    width: 8,
    points: [7, 10, 1, 0, 0, 0, 0, 11, 10, 1, 0, 0, 0, 40, 15, 10, 1, 0, 0, 0, 80],
  };
  const simulate = (locked: boolean, split: boolean) => {
    const px = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++)
      for (let x = 0; x <= 8; x++) {
        const k = (y * width + x) * 4;
        px[k] = 255;
        px[k + 3] = 255;
      }
    const session = new SmudgeSession({ ...brush, alphaLocked: locked });
    session.supply({ x: 0, y: 0, width, height, light: drawingPixels(px) });
    if (split) {
      session.advance(brush.points, 2);
      expect(session.processed).toBe(2);
    }
    session.advance(brush.points, 3);
    const result = session.result(false, true);
    session.advance(brush.points, 3);
    expect(session.result(true)).toBeNull();
    return result;
  };
  const a = simulate(false, true)!;
  expect(a).toEqual(simulate(false, false));
  expect(a.width * a.height).toBeLessThan(width * height);
  expect(a.light[(10 - a.y) * a.width + 12 - a.x]! >>> 24).toBeGreaterThan(0);
  expect(simulate(true, true)).toBeNull();
  const s = { ...brush, patch: { x: a.x, y: a.y, width: a.width, height: a.height, png: new Uint8Array([1]) } };
  const m = new Mesh(),
    moved = new Mesh();
  const b = tessellate(s, m),
    t = tessellate(transformStroke(s, translate(11, 4)), moved);
  expect(m.count).toBe(6);
  expect(moved.count).toBe(6);
  expect(t.minX).toBe(b.minX + 11);
  expect(t.minY).toBe(b.minY + 4);
});
