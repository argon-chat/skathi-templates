import { dabStream, pathBounds, polygonMesh, strokeRings, type Dab } from "./pigments";
import { smudgedPixels } from "./smudge";
import { apply, IDENTITY, type Bounds } from "./geometry";
import { rgb, STRIDE, type Stroke, type Tool } from "./model";

export type { Bounds };

/**
 * x, y (float32), edge/a/b/ink-flag (snorm8x4), colour (unorm8x4), depth (float32), then the
 * stroke's own coordinates: distance along it and across it (float32 × 2).
 */
export const VERTEX_BYTES = 28;
const DEPTH_STEPS = 2 ** 23;
const SHARP = 0.6;

export class Mesh {
  count = 0;
  private bytes: ArrayBuffer;
  private f32: Float32Array;
  private i8: Int8Array;
  private u8: Uint8Array;
  private red = 0;
  private green = 0;
  private blue = 0;
  private alpha = 255;
  private ink = 0;
  private depth = 0;
  private noise = 0;

  constructor(capacity = 1024) {
    this.bytes = new ArrayBuffer(capacity * VERTEX_BYTES);
    this.f32 = new Float32Array(this.bytes);
    this.i8 = new Int8Array(this.bytes);
    this.u8 = new Uint8Array(this.bytes);
  }

  style(stroke: Stroke) {
    const [r, g, b] = stroke.color === "ink" ? [0, 0, 0] : rgb(stroke.color);
    const alpha = (stroke.tool === "marker" ? 0.4 : stroke.tool === "pencil" ? 0.92 : 1) * (stroke.opacity ?? 1);
    this.noise = stroke.tool === "pencil" ? (stroke.seed ?? 0) % 65521 : 0;
    this.red = r;
    this.green = g;
    this.blue = b;
    this.alpha = Math.round(alpha * 255);
    const phase = this.noise % 127;
    this.ink = stroke.color === "ink" ? phase + 1 : -phase;
    this.depth = Math.min(stroke.seq, DEPTH_STEPS) / DEPTH_STEPS;
  }

  rgba(r: number, g: number, b: number, a: number) {
    this.red = r;
    this.green = g;
    this.blue = b;
    this.alpha = a;
    this.ink = 0;
  }

  reset() {
    this.count = 0;
  }

  vertex(x: number, y: number, edge: number, a: number, b: number, u: number, v: number) {
    if ((this.count + 1) * VERTEX_BYTES > this.bytes.byteLength) this.grow();
    const f = this.count * 7;
    const o = this.count * VERTEX_BYTES + 8;
    this.f32[f] = x;
    this.f32[f + 1] = y;
    this.i8[o] = Math.round(edge * 127);
    this.i8[o + 1] = Math.round(a * 127);
    this.i8[o + 2] = Math.round(b * 127);
    this.i8[o + 3] = this.ink;
    this.u8[o + 4] = this.red;
    this.u8[o + 5] = this.green;
    this.u8[o + 6] = this.blue;
    this.u8[o + 7] = this.alpha;
    this.f32[f + 4] = this.depth;
    this.f32[f + 5] = u + this.noise;
    this.f32[f + 6] = v;
    this.count++;
  }

  /** The vertices from `from` on, without copying. */
  view(from = 0): Uint8Array {
    return new Uint8Array(this.bytes, from * VERTEX_BYTES, (this.count - from) * VERTEX_BYTES);
  }

  private grow() {
    const next = new ArrayBuffer(this.bytes.byteLength * 2);
    new Uint8Array(next).set(this.u8);
    this.bytes = next;
    this.f32 = new Float32Array(next);
    this.i8 = new Int8Array(next);
    this.u8 = new Uint8Array(next);
  }
}

/** Radius, density and shading of a tool at one reading. */
function shape(tool: Tool, width: number, p: number, tiltX: number, tiltY: number): [number, number, number] {
  const half = width / 2;
  const tilt = Math.min(1, Math.hypot(tiltX, tiltY) / 60);
  switch (tool) {
    case "pen":
      return [half * (0.25 + 0.95 * p ** 0.8), 1, 0];
    case "brush":
      return [half * (0.25 + 0.95 * p) * (1 + 1.8 * tilt), 1, 0];
    case "marker":
      return [half, 1, 0];
    case "pencil":
      return [half * (0.8 + 0.3 * p) * (1 + 2.4 * tilt), Math.min(1, (0.35 + 0.65 * p) * (1 - 0.15 * tilt)), tilt];
    case "bucket":
    case "lasso-fill":
    case "spray":
    case "airbrush":
    case "smudge":
      return [half, 1, 0];
    case "eraser":
      return [half * (0.8 + 0.4 * p), 1, 0];
  }
}

const tapers = (tool: Tool) => tool === "pen" || tool === "brush";
const taperLength = (width: number) => 4 + width * 2.5;
const ease = (t: number) => 0.4 + 0.6 * (1 - (1 - Math.min(1, t)) ** 2);

/** Round caps and joins, mitred ribbon between them. Emits triangles into a mesh. */
class Ribbon {
  // prev: the last sample with its left/right edge points; cur: the pending sample.
  px = 0;
  py = 0;
  pr = 0;
  pa = 0;
  pb = 0;
  ps = 0;
  lx = 0;
  ly = 0;
  rx = 0;
  ry = 0;
  cx = 0;
  cy = 0;
  cr = 0;
  ca = 0;
  cb = 0;
  cs = 0;
  dirX = 1;
  dirY = 0;
  hasPrev = false;
  hasCur = false;

  constructor(public mesh: Mesh) {}

  clone(mesh: Mesh): Ribbon {
    return Object.assign(new Ribbon(mesh), { ...this, mesh });
  }

  push(x: number, y: number, r: number, a: number, b: number, s: number) {
    if (!this.hasPrev) {
      Object.assign(this, { px: x, py: y, pr: r, pa: a, pb: b, ps: s, hasPrev: true });
      return;
    }
    if (!this.hasCur) {
      const dx = x - this.px;
      const dy = y - this.py;
      const d = Math.hypot(dx, dy);
      if (d < 0.05) {
        this.pr = Math.max(this.pr, r);
        return;
      }
      this.dirX = dx / d;
      this.dirY = dy / d;
      const nx = -dy / d;
      const ny = dx / d;
      this.lx = this.px + nx * this.pr;
      this.ly = this.py + ny * this.pr;
      this.rx = this.px - nx * this.pr;
      this.ry = this.py - ny * this.pr;
      this.dot(this.px, this.py, this.pr, this.pa, this.pb, this.ps);
      Object.assign(this, { cx: x, cy: y, cr: r, ca: a, cb: b, cs: s, hasCur: true });
      return;
    }
    const ox = x - this.cx;
    const oy = y - this.cy;
    const dOut = Math.hypot(ox, oy);
    if (dOut < 0.05) return;
    const ix = this.cx - this.px;
    const iy = this.cy - this.py;
    const dIn = Math.hypot(ix, iy) || 1;
    const inX = -iy / dIn;
    const inY = ix / dIn;
    const outX = -oy / dOut;
    const outY = ox / dOut;
    const cos = (ix * ox + iy * oy) / (dIn * dOut);
    if (cos < SHARP) {
      this.quad(inX, inY);
      this.dirX = inY;
      this.dirY = -inX;
      this.dot(this.cx, this.cy, this.cr, this.ca, this.cb, this.cs);
      this.advance(
        this.cx + outX * this.cr,
        this.cy + outY * this.cr,
        this.cx - outX * this.cr,
        this.cy - outY * this.cr,
      );
    } else {
      let mx = inX + outX;
      let my = inY + outY;
      const m = Math.hypot(mx, my) || 1;
      mx /= m;
      my /= m;
      const k = 1 / Math.max(mx * inX + my * inY, 0.5);
      this.quad(mx * k, my * k);
    }
    this.dirX = ox / dOut;
    this.dirY = oy / dOut;
    this.cx = x;
    this.cy = y;
    this.cr = r;
    this.ca = a;
    this.cb = b;
    this.cs = s;
  }

  finish() {
    if (!this.hasPrev) return;
    if (!this.hasCur) {
      this.dot(this.px, this.py, this.pr, this.pa, this.pb, this.ps);
      return;
    }
    const dx = this.cx - this.px;
    const dy = this.cy - this.py;
    const d = Math.hypot(dx, dy) || 1;
    this.dirX = dx / d;
    this.dirY = dy / d;
    this.quad(-dy / d, dx / d);
    this.dot(this.px, this.py, this.pr, this.pa, this.pb, this.ps);
  }

  /** The quad from prev to cur, cur's edge points at cur ± n·r; then cur becomes prev. */
  private quad(nx: number, ny: number) {
    let lx = this.cx + nx * this.cr;
    let ly = this.cy + ny * this.cr;
    let rx = this.cx - nx * this.cr;
    let ry = this.cy - ny * this.cr;
    // On the inside of a bend tighter than the radius, the edge would run backwards and fold
    // the ribbon over itself; it stays put instead.
    const dx = this.cx - this.px;
    const dy = this.cy - this.py;
    if ((lx - this.lx) * dx + (ly - this.ly) * dy < 0) {
      lx = this.lx;
      ly = this.ly;
    }
    if ((rx - this.rx) * dx + (ry - this.ry) * dy < 0) {
      rx = this.rx;
      ry = this.ry;
    }
    const m = this.mesh;
    const { ps, pr, cs, cr } = this;
    m.vertex(this.lx, this.ly, 1, this.pa, this.pb, ps, pr);
    m.vertex(this.rx, this.ry, -1, this.pa, this.pb, ps, -pr);
    m.vertex(lx, ly, 1, this.ca, this.cb, cs, cr);
    m.vertex(this.rx, this.ry, -1, this.pa, this.pb, ps, -pr);
    m.vertex(rx, ry, -1, this.ca, this.cb, cs, -cr);
    m.vertex(lx, ly, 1, this.ca, this.cb, cs, cr);
    this.advance(lx, ly, rx, ry);
  }

  private advance(lx: number, ly: number, rx: number, ry: number) {
    this.px = this.cx;
    this.py = this.cy;
    this.pr = this.cr;
    this.pa = this.ca;
    this.pb = this.cb;
    this.ps = this.cs;
    this.lx = lx;
    this.ly = ly;
    this.rx = rx;
    this.ry = ry;
  }

  private dot(x: number, y: number, r: number, a: number, b: number, s: number) {
    const n = Math.min(40, Math.max(12, Math.round(8 + r * 1.5)));
    const m = this.mesh;
    const { dirX, dirY } = this;
    let ac = 1;
    let as = 0;
    for (let i = 1; i <= n; i++) {
      const t = (i / n) * Math.PI * 2;
      const bc = Math.cos(t);
      const bs = Math.sin(t);
      // Rim offsets in the stroke's frame: along it (c) and across it (s).
      m.vertex(x, y, 0, a, b, s, 0);
      m.vertex(x + (ac * dirX - as * dirY) * r, y + (ac * dirY + as * dirX) * r, 1, a, b, s + ac * r, as * r);
      m.vertex(x + (bc * dirX - bs * dirY) * r, y + (bc * dirY + bs * dirX) * r, 1, a, b, s + bc * r, bs * r);
      ac = bc;
      as = bs;
    }
  }
}

type Sink = (x: number, y: number, p: number, tiltX: number, tiltY: number) => void;

/** The centripetal Catmull–Rom curve from point i to i + 1, without its first sample. */
function curve(pts: ArrayLike<number>, count: number, i: number, after: ArrayLike<number> | null, sink: Sink) {
  const k0 = Math.max(i - 1, 0) * STRIDE;
  const k1 = i * STRIDE;
  const k2 = (i + 1) * STRIDE;
  const x0 = pts[k0]!,
    y0 = pts[k0 + 1]!;
  const x1 = pts[k1]!,
    y1 = pts[k1 + 1]!;
  const x2 = pts[k2]!,
    y2 = pts[k2 + 1]!;
  let x3 = x2,
    y3 = y2;
  if (i + 2 < count) {
    x3 = pts[k2 + STRIDE]!;
    y3 = pts[k2 + STRIDE + 1]!;
  } else if (after) {
    x3 = after[0]!;
    y3 = after[1]!;
  }
  const len = Math.hypot(x2 - x1, y2 - y1);
  const turn = Math.abs(
    Math.atan2((x2 - x0) * (y3 - y1) - (y2 - y0) * (x3 - x1), (x2 - x0) * (x3 - x1) + (y2 - y0) * (y3 - y1)),
  );
  const n = Math.min(48, Math.max(1, Math.ceil(len / 1.5), Math.ceil(turn / 0.08)));
  const t1 = Math.max(Math.sqrt(Math.hypot(x1 - x0, y1 - y0)), 1e-3);
  const t2 = t1 + Math.max(Math.sqrt(len), 1e-3);
  const t3 = t2 + Math.max(Math.sqrt(Math.hypot(x3 - x2, y3 - y2)), 1e-3);
  for (let s = 1; s <= n; s++) {
    const u = s / n;
    const t = t1 + (t2 - t1) * u;
    const a1x = ((t1 - t) * x0 + t * x1) / t1;
    const a1y = ((t1 - t) * y0 + t * y1) / t1;
    const a2x = ((t2 - t) * x1 + (t - t1) * x2) / (t2 - t1);
    const a2y = ((t2 - t) * y1 + (t - t1) * y2) / (t2 - t1);
    const a3x = ((t3 - t) * x2 + (t - t2) * x3) / (t3 - t2);
    const a3y = ((t3 - t) * y2 + (t - t2) * y3) / (t3 - t2);
    const b1x = ((t2 - t) * a1x + t * a2x) / t2;
    const b1y = ((t2 - t) * a1y + t * a2y) / t2;
    const b2x = ((t3 - t) * a2x + (t - t1) * a3x) / (t3 - t1);
    const b2y = ((t3 - t) * a2y + (t - t1) * a3y) / (t3 - t1);
    const x = ((t2 - t) * b1x + (t - t1) * b2x) / (t2 - t1);
    const y = ((t2 - t) * b1y + (t - t1) * b2y) / (t2 - t1);
    const lerp = (o: number) => pts[k1 + o]! + (pts[k2 + o]! - pts[k1 + o]!) * u;
    sink(x, y, lerp(2), lerp(3), lerp(4));
  }
}

type Trace = (x: number, y: number, r: number, a: number, b: number, s: number) => void;

/** Walks the finished stroke's outline samples: centre, radius, density, shading and distance along it. */
export function trace(stroke: Stroke, out: Trace): Bounds {
  const { tool, width, points } = stroke;
  const count = points.length / STRIDE;
  const samples: number[] = [];
  let s = 0;
  let lx = points[0] ?? 0;
  let ly = points[1] ?? 0;
  const sink: Sink = (x, y, p, tx, ty) => {
    s += Math.hypot(x - lx, y - ly);
    lx = x;
    ly = y;
    samples.push(x, y, p, tx, ty, s);
  };
  for (let i = 0; i < count; i++) {
    const k = i * STRIDE;
    if (i === 0 || stroke.shape) sink(points[k]!, points[k + 1]!, points[k + 2]!, points[k + 3]!, points[k + 4]!);
    else curve(points, count, i - 1, null, sink);
  }
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const L = taperLength(width);
  const tapered = !stroke.shape && tapers(tool) && samples.length > 6;
  const endL = Math.min(L, s * 0.45);
  for (let j = 0; j < samples.length; j += 6) {
    const x = samples[j]!;
    const y = samples[j + 1]!;
    const at = samples[j + 5]!;
    let [r, a, b] = shape(tool, width, samples[j + 2]!, samples[j + 3]!, samples[j + 4]!);
    if (tapered) r *= ease(at / L) * ease((s - at) / Math.max(endL, 1e-3));
    out(x, y, r, a, b, at);
    bounds.minX = Math.min(bounds.minX, x - r);
    bounds.minY = Math.min(bounds.minY, y - r);
    bounds.maxX = Math.max(bounds.maxX, x + r);
    bounds.maxY = Math.max(bounds.maxY, y + r);
  }
  return bounds;
}

/** The whole stroke, end taper included: what is stored on the GPU once committed. */
export function tessellate(stroke: Stroke, mesh: Mesh): Bounds {
  mesh.style(stroke);
  if (stroke.tool === "bucket" && stroke.patch) {
    const patch = stroke.patch,
      m = patch.transform ?? IDENTITY;
    const bounds: Bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
    for (const [u, v] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [0, 1],
      [1, 0],
      [1, 1],
    ] as const) {
      const x = u * patch.width,
        y = v * patch.height;
      const q = apply(m, patch.x + x, patch.y + y);
      mesh.vertex(q.x, q.y, 0, 1, 0, x, y);
      bounds.minX = Math.min(bounds.minX, q.x);
      bounds.maxX = Math.max(bounds.maxX, q.x);
      bounds.minY = Math.min(bounds.minY, q.y);
      bounds.maxY = Math.max(bounds.maxY, q.y);
    }
    return bounds;
  }
  if (stroke.tool === "bucket" || stroke.tool === "lasso-fill") {
    polygonMesh(strokeRings(stroke), (x, y) => mesh.vertex(x, y, 0, 1, 0, 0, 0));
    return pathBounds(stroke);
  }
  if (stroke.tool === "spray" || stroke.tool === "airbrush") {
    const emit = dabVertex(mesh, stroke);
    const add = dabStream(stroke);
    for (let i = 0; i < stroke.points.length; i += STRIDE) add(i, emit);
    return pathBounds(stroke, stroke.width * (stroke.tool === "spray" ? 2 : 0.5));
  }
  if (stroke.tool === "smudge") {
    const patch = stroke.patch,
      result = smudgedPixels(stroke);
    if (patch && result) {
      const { pixels, mask, w, h } = result;
      const m = patch.transform ?? IDENTITY;
      const vertex = (x: number, y: number) => {
        const q = apply(m, x + patch.x, y + patch.y);
        mesh.vertex(q.x, q.y, 0, 1, 0, 0, 0);
      };
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w;) {
          const k = (y * w + x) * 4;
          if (!mask[k / 4]) {
            x++;
            continue;
          }
          let end = x + 1;
          while (
            end < w &&
            mask[y * w + end] &&
            pixels[(y * w + end) * 4] === pixels[k] &&
            pixels[(y * w + end) * 4 + 1] === pixels[k + 1] &&
            pixels[(y * w + end) * 4 + 2] === pixels[k + 2] &&
            pixels[(y * w + end) * 4 + 3] === pixels[k + 3]
          )
            end++;
          mesh.rgba(pixels[k]!, pixels[k + 1]!, pixels[k + 2]!, pixels[k + 3]!);
          vertex(x, y);
          vertex(end, y);
          vertex(x, y + 1);
          vertex(x, y + 1);
          vertex(end, y);
          vertex(end, y + 1);
          x = end;
        }
    }
    return pathBounds(stroke, stroke.width / 2 + 1);
  }
  const ribbon = new Ribbon(mesh);
  const bounds = trace(stroke, (x, y, r, a, b, s) => ribbon.push(x, y, r, a, b, s));
  ribbon.finish();
  return bounds;
}

function dabVertex(mesh: Mesh, stroke: Stroke) {
  return ({ x, y, radius, opacity }: Dab) => mesh.vertex(x, y, 0, opacity, stroke.hardness ?? 0.25, radius, 0);
}

/** Geometry the renderer draws while a stroke is in progress. */
export interface LiveSource {
  readonly stroke: Stroke;
  readonly settled: Mesh;
  readonly tail: Mesh;
}

/** A shape being dragged out: rebuilt whole on every move, since every point moves. */
export class LiveShape implements LiveSource {
  readonly settled = new Mesh(1);
  readonly tail = new Mesh(2048);

  constructor(readonly stroke: Stroke) {}

  set(points: number[]) {
    this.stroke.points = points;
    this.tail.reset();
    if (points.length) tessellate(this.stroke, this.tail);
  }
}

/** A stroke being drawn: settled geometry is appended once, the moving end is rebuilt each frame. */
export class LiveStroke implements LiveSource {
  readonly settled = new Mesh(4096);
  readonly tail = new Mesh(1024);
  private ribbon: Ribbon;
  private dabs: ReturnType<typeof dabStream> | null = null;
  private finalized = 0;
  private s = 0;
  private lx = 0;
  private ly = 0;

  constructor(readonly stroke: Stroke) {
    this.settled.style(stroke);
    this.tail.style(stroke);
    this.ribbon = new Ribbon(this.settled);
    if (stroke.tool === "spray" || stroke.tool === "airbrush") this.dabs = dabStream(stroke);
  }

  get count() {
    return this.stroke.points.length / STRIDE;
  }

  add(x: number, y: number, p: number, tiltX: number, tiltY: number, twist: number, t: number) {
    const pts = this.stroke.points;
    pts.push(x, y, p, tiltX, tiltY, twist, t);
    const count = this.count;
    if (this.dabs) {
      this.dabs(pts.length - STRIDE, dabVertex(this.settled, this.stroke));
      return;
    }
    if (this.stroke.tool === "lasso-fill" || this.stroke.tool === "smudge" || this.stroke.tool === "bucket") return;
    if (count === 1) {
      this.lx = x;
      this.ly = y;
      this.emit(this.ribbon, x, y, p, tiltX, tiltY);
    }
    while (this.finalized + 2 < count) curve(pts, count, this.finalized++, null, this.sinkFor(this.ribbon));
  }

  /** Rebuilds the tail: the last curve, then the predicted readings, each `[x, y]` in document space. */
  build(predicted: readonly (readonly [number, number])[]) {
    this.tail.reset();
    if (this.dabs) return;
    if (this.stroke.tool === "lasso-fill" || this.stroke.tool === "smudge" || this.stroke.tool === "bucket") {
      tessellate(this.stroke, this.tail);
      return;
    }
    const ribbon = this.ribbon.clone(this.tail);
    const { s, lx, ly } = this;
    const pts = this.stroke.points;
    const count = this.count;
    const sink = this.sinkFor(ribbon);
    if (count >= 2) curve(pts, count, count - 2, predicted[0] ?? null, sink);
    const last = (count - 1) * STRIDE;
    for (const [x, y] of predicted) sink(x, y, pts[last + 2]!, pts[last + 3]!, pts[last + 4]!);
    ribbon.finish();
    Object.assign(this, { s, lx, ly });
  }

  private sinkFor(ribbon: Ribbon): Sink {
    return (x, y, p, tx, ty) => this.emit(ribbon, x, y, p, tx, ty);
  }

  private emit(ribbon: Ribbon, x: number, y: number, p: number, tx: number, ty: number) {
    const { tool, width } = this.stroke;
    this.s += Math.hypot(x - this.lx, y - this.ly);
    this.lx = x;
    this.ly = y;
    let [r, a, b] = shape(tool, width, p, tx, ty);
    if (tapers(tool)) r *= ease(this.s / taperLength(width));
    ribbon.push(x, y, r, a, b, this.s);
  }
}

/** One-euro filter: smooths jitter when slow, follows closely when fast. */
export class OneEuro {
  private value: number | null = null;
  private slope = 0;
  private at = 0;

  constructor(
    private minCutoff: number,
    private beta: number,
  ) {}

  filter(v: number, ms: number): number {
    if (this.value === null) {
      this.value = v;
      this.at = ms;
      return v;
    }
    const dt = Math.max(ms - this.at, 1) / 1000;
    this.at = ms;
    const alpha = (cutoff: number) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
    this.slope += alpha(1.2) * ((v - this.value) / dt - this.slope);
    this.value += alpha(this.minCutoff + this.beta * Math.abs(this.slope)) * (v - this.value);
    return this.value;
  }
}

/**
 * Pointer smoothing in screen pixels. At 0 it only takes out jitter; towards 1 the line also
 * trails the pointer on a string, so it only bends where the hand meant it to.
 */
export class Stabilizer {
  private readonly fx: OneEuro;
  private readonly fy: OneEuro;
  private readonly fp = new OneEuro(4, 0.02);
  private readonly rope: number;
  private x = 0;
  private y = 0;
  private started = false;

  constructor(amount: number) {
    const a = Math.min(1, Math.max(0, amount));
    const cutoff = 6 * (1 - 0.8 * a);
    const beta = 0.04 * (1 - 0.75 * a);
    this.fx = new OneEuro(cutoff, beta);
    this.fy = new OneEuro(cutoff, beta);
    this.rope = a * a * 28;
  }

  /** The filtered position, or null while the pointer is still inside the string's slack. */
  position(x: number, y: number, ms: number): { x: number; y: number } | null {
    const fx = this.fx.filter(x, ms);
    const fy = this.fy.filter(y, ms);
    if (!this.started) {
      this.started = true;
      this.x = fx;
      this.y = fy;
      return { x: fx, y: fy };
    }
    const d = Math.hypot(fx - this.x, fy - this.y);
    if (d <= this.rope) return this.rope ? null : { x: fx, y: fy };
    const k = (d - this.rope) / d;
    this.x += (fx - this.x) * k;
    this.y += (fy - this.y) * k;
    return { x: this.x, y: this.y };
  }

  pressure(p: number, ms: number): number {
    return this.fp.filter(p, ms);
  }

  get trailing(): boolean {
    return this.rope > 0;
  }
}
