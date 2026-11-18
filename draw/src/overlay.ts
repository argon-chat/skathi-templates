import { MARK_BYTES } from "./renderer";

/** `[r, g, b, a]`, each 0–255. */
export type Rgba = readonly [number, number, number, number];

/** Screen-space guides drawn over the canvas: lasso, selection frame, handles, symmetry axes. */
export class Marks {
  private bytes = new ArrayBuffer(MARK_BYTES * 1024);
  private f32 = new Float32Array(this.bytes);
  private u8 = new Uint8Array(this.bytes);
  private count = 0;

  reset() {
    this.count = 0;
  }

  view(): Uint8Array {
    return new Uint8Array(this.bytes, 0, this.count * MARK_BYTES);
  }

  line(x0: number, y0: number, x1: number, y1: number, width: number, color: Rgba, dash = 0, offset = 0) {
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 1e-3) return;
    const ux = (x1 - x0) / len;
    const uy = (y1 - y0) / len;
    const h = width / 2 + 1;
    const nx = -uy * h;
    const ny = ux * h;
    const a = [x0 + nx, y0 + ny, offset, h] as const;
    const b = [x0 - nx, y0 - ny, offset, -h] as const;
    const c = [x1 + nx, y1 + ny, offset + len, h] as const;
    const d = [x1 - nx, y1 - ny, offset + len, -h] as const;
    for (const [x, y, u, v] of [a, b, c, b, d, c]) this.vertex(x, y, u, v, color, color, 0, width / 2, dash);
  }

  /** A polyline with its dashes running on across the joints. */
  path(points: readonly number[], width: number, color: Rgba, dash = 0, closed = false) {
    let along = 0;
    const n = points.length;
    for (let i = 0; i + 3 < n + (closed ? 2 : 0); i += 2) {
      const x0 = points[i]!;
      const y0 = points[i + 1]!;
      const x1 = points[(i + 2) % n]!;
      const y1 = points[(i + 3) % n]!;
      this.line(x0, y0, x1, y1, width, color, dash, along);
      along += Math.hypot(x1 - x0, y1 - y0);
    }
  }

  disc(x: number, y: number, r: number, ring: number, color: Rgba, fill: Rgba) {
    this.quad(x, y, r + 1, 1, r, ring, color, fill);
  }

  square(x: number, y: number, half: number, ring: number, color: Rgba, fill: Rgba) {
    this.quad(x, y, half + 1, 2, half, ring, color, fill);
  }

  private quad(x: number, y: number, h: number, kind: number, size: number, ring: number, color: Rgba, fill: Rgba) {
    const corners = [
      [-h, -h],
      [h, -h],
      [-h, h],
      [-h, h],
      [h, -h],
      [h, h],
    ] as const;
    for (const [u, v] of corners) this.vertex(x + u, y + v, u, v, color, fill, kind, size, ring);
  }

  private vertex(
    x: number,
    y: number,
    u: number,
    v: number,
    color: Rgba,
    fill: Rgba,
    kind: number,
    p1: number,
    p2: number,
  ) {
    if ((this.count + 1) * MARK_BYTES > this.bytes.byteLength) this.grow();
    const f = (this.count * MARK_BYTES) / 4;
    const o = this.count * MARK_BYTES;
    this.f32[f] = x;
    this.f32[f + 1] = y;
    this.f32[f + 2] = u;
    this.f32[f + 3] = v;
    this.u8.set(color, o + 16);
    this.u8.set(fill, o + 20);
    this.f32[f + 6] = kind;
    this.f32[f + 7] = p1;
    this.f32[f + 8] = p2;
    this.f32[f + 9] = 0;
    this.count++;
  }

  private grow() {
    const next = new ArrayBuffer(this.bytes.byteLength * 2);
    new Uint8Array(next).set(this.u8);
    this.bytes = next;
    this.f32 = new Float32Array(next);
    this.u8 = new Uint8Array(next);
  }
}
