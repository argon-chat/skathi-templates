import { STRIDE, type Shape, type Stroke, type Symmetry } from "./model";

export interface Point {
  x: number;
  y: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** `x' = a·x + c·y + e`, `y' = b·x + d·y + f`, as in canvas and SVG. */
export type Affine = readonly [a: number, b: number, c: number, d: number, e: number, f: number];

export const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

export function multiply(m: Affine, n: Affine): Affine {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export const translate = (x: number, y: number): Affine => [1, 0, 0, 1, x, y];
export const rotate = (angle: number): Affine => [
  Math.cos(angle),
  Math.sin(angle),
  -Math.sin(angle),
  Math.cos(angle),
  0,
  0,
];
export const scale = (sx: number, sy: number): Affine => [sx, 0, 0, sy, 0, 0];

/** `m` applied about `(x, y)` rather than the origin. */
export const about = (x: number, y: number, m: Affine) => multiply(translate(x, y), multiply(m, translate(-x, -y)));

export const apply = (m: Affine, x: number, y: number): Point => ({
  x: m[0] * x + m[2] * y + m[4],
  y: m[1] * x + m[3] * y + m[5],
});

export const isIdentity = (m: Affine) => m.every((v, i) => v === IDENTITY[i]);

export function transformStroke(stroke: Stroke, m: Affine, seq = stroke.seq): Stroke {
  const points = stroke.points.slice();
  for (let i = 0; i < points.length; i += STRIDE) {
    const p = apply(m, points[i]!, points[i + 1]!);
    points[i] = p.x;
    points[i + 1] = p.y;
  }
  const width = stroke.width * Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
  const result: Stroke = { ...stroke, seq, points, width };
  if (stroke.contours)
    result.contours = stroke.contours.map((ring) => {
      const out: number[] = [];
      for (let i = 0; i < ring.length; i += 2) {
        const p = apply(m, ring[i]!, ring[i + 1]!);
        out.push(p.x, p.y);
      }
      return out;
    });
  if (stroke.patch) result.patch = { ...stroke.patch, transform: [...multiply(m, stroke.patch.transform ?? IDENTITY)] };
  return result;
}

export function insidePolygon(x: number, y: number, poly: readonly number[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const xi = poly[i]!;
    const yi = poly[i + 1]!;
    const xj = poly[j]!;
    const yj = poly[j + 1]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Squared distance from `(x, y)` to the stroke's polyline. */
export function distanceToStroke(stroke: Stroke, x: number, y: number): number {
  const p = stroke.points;
  let best = Infinity;
  for (let i = 0; i < p.length; i += STRIDE) {
    const ax = p[i]!;
    const ay = p[i + 1]!;
    const bx = p[i + STRIDE] ?? ax;
    const by = p[i + STRIDE + 1] ?? ay;
    const dx = bx - ax;
    const dy = by - ay;
    const len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len)) : 0;
    best = Math.min(best, (ax + dx * t - x) ** 2 + (ay + dy * t - y) ** 2);
  }
  return best;
}

export function union(a: Bounds | null, b: Bounds): Bounds {
  if (!a) return { ...b };
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

/**
 * The outline of a shape dragged from `a` to `b` in screen space, as screen points. `constrain`
 * snaps lines to 45° and makes rectangles square and ellipses round.
 */
export function shapePath(kind: Shape, a: Point, b: Point, constrain: boolean, head: number): Point[] {
  let { x, y } = b;
  if (constrain && (kind === "line" || kind === "arrow")) {
    const angle = Math.round(Math.atan2(y - a.y, x - a.x) / (Math.PI / 4)) * (Math.PI / 4);
    const len = Math.hypot(x - a.x, y - a.y);
    x = a.x + Math.cos(angle) * len;
    y = a.y + Math.sin(angle) * len;
  } else if (constrain) {
    const side = Math.max(Math.abs(x - a.x), Math.abs(y - a.y));
    x = a.x + Math.sign(x - a.x || 1) * side;
    y = a.y + Math.sign(y - a.y || 1) * side;
  }
  switch (kind) {
    case "line":
      return [a, { x, y }];
    case "arrow": {
      const angle = Math.atan2(y - a.y, x - a.x);
      const len = Math.min(head, Math.hypot(x - a.x, y - a.y) * 0.5);
      const wing = (side: number) => ({
        x: x - Math.cos(angle + side * 0.5) * len,
        y: y - Math.sin(angle + side * 0.5) * len,
      });
      return [a, { x, y }, wing(1), { x, y }, wing(-1)];
    }
    case "rect":
      return [a, { x, y: a.y }, { x, y }, { x: a.x, y }, a];
    case "ellipse": {
      const cx = (a.x + x) / 2;
      const cy = (a.y + y) / 2;
      const rx = Math.abs(x - a.x) / 2;
      const ry = Math.abs(y - a.y) / 2;
      const n = Math.max(24, Math.min(160, Math.round((rx + ry) / 3)));
      const out: Point[] = [];
      for (let i = 0; i <= n; i++) {
        const t = (i / n) * Math.PI * 2 - Math.PI / 2;
        out.push({ x: cx + Math.cos(t) * rx, y: cy + Math.sin(t) * ry });
      }
      return out;
    }
  }
}

/** The copies a stroke gets under `symmetry`: the identity first. */
export function symmetryTransforms(s: Symmetry | null): Affine[] {
  if (!s) return [IDENTITY];
  const out: Affine[] = [];
  const n = Math.max(1, Math.round(s.segments));
  for (let i = 0; i < n; i++) {
    const turn = about(s.x, s.y, rotate((i / n) * Math.PI * 2));
    out.push(turn);
    if (s.mirror) out.push(multiply(turn, about(s.x, s.y, scale(-1, 1))));
  }
  return out;
}
