import { expect, test } from "bun:test";
import { floodContours } from "../src/bucket";
import { insidePolygon, transformStroke, translate } from "../src/geometry";
import { LiveStroke, Mesh, tessellate } from "../src/ink";
import type { Stroke } from "../src/model";
import { dabStream, polygonMesh, type Dab } from "../src/pigments";
import { base64, smudgedPixels } from "../src/smudge";

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

test("pressure pulls pigment in fixed pixels, independent of a transformed document path", () => {
  const w = 24,
    h = 20,
    pixels = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x <= 8; x++) {
      const k = (y * w + x) * 4;
      pixels[k] = 255;
      pixels[k + 3] = 255;
    }
  const s: Stroke = {
    ...stroke("smudge"),
    width: 8,
    points: [7, 10, 1, 0, 0, 0, 0, 15, 10, 1, 0, 0, 0, 80],
    patch: { x: 0, y: 0, width: w, height: h, rgba: base64(pixels) },
  };
  const original = smudgedPixels(s)!;
  expect(original.pixels[(10 * w + 12) * 4 + 3]).toBeGreaterThan(0);
  expect(smudgedPixels(transformStroke(s, translate(11, 4)))).toEqual(original);
  const locked = smudgedPixels({ ...s, alphaLocked: true })!;
  expect(locked.pixels[(10 * w + 12) * 4 + 3]).toBe(0);
});
