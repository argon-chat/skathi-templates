import { STRIDE, type Stroke } from "./model";
import type { Bounds } from "./geometry";

export interface Dab {
  x: number;
  y: number;
  radius: number;
  opacity: number;
}

export function dabStream(stroke: Stroke) {
  let seed = (stroke.seed ?? stroke.seq) >>> 0;
  let credit = 0;
  function random() {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  }
  return (i: number, emit: (dab: Dab) => void) => {
    const p = stroke.points;
    const prev = Math.max(0, i - STRIDE);
    const dx = p[i]! - p[prev]!;
    const dy = p[i + 1]! - p[prev + 1]!;
    const distance = Math.hypot(dx, dy);
    const pressure = p[i + 2]!;
    const ms = i ? Math.max(0, p[i + 6]! - p[prev + 6]!) : 18;
    const spray = stroke.tool === "spray";
    const density = 0.1 + 0.9 * (stroke.density ?? 0.55);
    const rate = spray ? (0.08 + pressure * 0.65) * density : 0.055;
    const amount = Math.max(ms * rate, distance / Math.max(1, stroke.width * (spray ? 0.12 : 0.17)));
    const start = credit;
    credit += amount;
    const count = Math.floor(credit);
    credit -= count;
    const tiltX = p[i + 3]!,
      tiltY = p[i + 4]!;
    const tilt = Math.min(1, Math.hypot(tiltX, tiltY) / 70);
    const angle = Math.atan2(tiltY, tiltX);
    for (let k = 0; k < Math.max(count, i === 0 ? 1 : 0); k++) {
      const u = Math.min(1, (k + 1 - start) / Math.max(0.001, amount));
      let x = p[prev]! + dx * u,
        y = p[prev + 1]! + dy * u;
      let radius = stroke.width * 0.5;
      if (spray) {
        const r = Math.sqrt(random()) * stroke.width;
        const a = random() * Math.PI * 2;
        const ox = r * Math.cos(a) * (1 + 0.8 * tilt);
        const oy = r * Math.sin(a) * (1 - 0.45 * tilt);
        x += ox * Math.cos(angle) - oy * Math.sin(angle);
        y += ox * Math.sin(angle) + oy * Math.cos(angle);
        const scatter = stroke.scatter ?? 0.5;
        radius = Math.max(0.45, stroke.width * 0.042 * (1 + (random() * 2 - 1) * scatter));
      }
      emit({ x, y, radius, opacity: spray ? 0.7 + random() * 0.3 : (0.035 + pressure * 0.23) * density });
    }
  };
}

export function strokeRings(stroke: Stroke): number[][] {
  if (stroke.contours) return stroke.contours;
  const ring: number[] = [];
  for (let i = 0; i < stroke.points.length; i += STRIDE) ring.push(stroke.points[i]!, stroke.points[i + 1]!);
  return [ring];
}

export function pathBounds(stroke: Stroke, pad = 0): Bounds {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const points = stroke.contours ?? [stroke.points];
  const stride = stroke.contours ? 2 : STRIDE;
  for (const p of points)
    for (let i = 0; i < p.length; i += stride) {
      b.minX = Math.min(b.minX, p[i]! - pad);
      b.minY = Math.min(b.minY, p[i + 1]! - pad);
      b.maxX = Math.max(b.maxX, p[i]! + pad);
      b.maxY = Math.max(b.maxY, p[i + 1]! + pad);
    }
  return b;
}

interface Edge {
  x: number;
  y: number;
  end: number;
  slope: number;
}

export function polygonMesh(rings: number[][], vertex: (x: number, y: number) => void) {
  const edges: Edge[] = [];
  const levels = new Set<number>();
  for (const p of rings)
    for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
      const ax = p[i]!,
        ay = p[i + 1]!,
        bx = p[j]!,
        by = p[j + 1]!;
      if (ay === by) continue;
      edges.push({ x: ay < by ? ax : bx, y: Math.min(ay, by), end: Math.max(ay, by), slope: (bx - ax) / (by - ay) });
      levels.add(ay);
      levels.add(by);
    }
  edges.sort((a, b) => a.y - b.y);
  const ys = [...levels].sort((a, b) => a - b);
  const at = (e: Edge, y: number) => e.x + (y - e.y) * e.slope;
  let first = 0,
    active: Edge[] = [];
  for (let i = 1; i < ys.length; i++) {
    const y = ys[i - 1]!,
      end = ys[i]!;
    active = active.filter((e) => e.end > y);
    while (first < edges.length && edges[first]!.y <= y) active.push(edges[first++]!);
    const cuts = [y, end];
    active.sort((a, b) => at(a, y) - at(b, y) || a.slope - b.slope);
    const byEnd: Edge[] = [];
    for (const edge of active) {
      let j = byEnd.length;
      const endX = at(edge, end);
      while (j && at(byEnd[j - 1]!, end) > endX) {
        const left = byEnd[j - 1]!;
        const cross = y + (at(edge, y) - at(left, y)) / (left.slope - edge.slope);
        if (cross > y && cross < end) cuts.push(cross);
        byEnd[j] = left;
        j--;
      }
      byEnd[j] = edge;
    }
    cuts.sort((a, b) => a - b);
    for (let c = 1; c < cuts.length; c++) {
      const top = cuts[c - 1]!,
        bottom = cuts[c]!;
      if (top === bottom) continue;
      const mid = (top + bottom) / 2;
      active.sort((a, b) => at(a, mid) - at(b, mid));
      for (let j = 0; j + 1 < active.length; j += 2) {
        const l = active[j]!,
          r = active[j + 1]!;
        vertex(at(l, top), top);
        vertex(at(r, top), top);
        vertex(at(l, bottom), bottom);
        vertex(at(l, bottom), bottom);
        vertex(at(r, top), top);
        vertex(at(r, bottom), bottom);
      }
    }
  }
}
