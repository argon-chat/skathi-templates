import { STRIDE, type RasterPatch, type Stroke } from "./model";

export function base64(bytes: Uint8Array) {
  let text = "";
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
}

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface RasterPlanes extends PixelRect {
  light: Uint32Array;
  dark?: Uint32Array;
  coverage?: Uint32Array;
}
const decoded = new WeakMap<Uint8Array, RasterPlanes>();
const decoding = new WeakMap<Uint8Array, Promise<RasterPlanes>>();
export const cachedRaster = (patch: RasterPatch) => decoded.get(patch.png);

function words(pixels: Uint8ClampedArray) {
  return new Uint32Array(pixels.buffer, pixels.byteOffset, pixels.length / 4);
}
function bytes(pixels: Uint32Array) {
  return new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.byteLength);
}

export async function encodePng(pixels: Uint8ClampedArray, w: number, h: number) {
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not encode the paint sample.");
  const im = ctx.createImageData(w, h);
  im.data.set(pixels);
  ctx.putImageData(im, 0, 0);
  const blob = await canvas.convertToBlob({ type: "image/png" });
  return new Uint8Array(await blob.arrayBuffer());
}
async function decodePng(png: Uint8Array, w: number, h: number) {
  const bmp = await createImageBitmap(new Blob([new Uint8Array(png)], { type: "image/png" }));
  try {
    if (bmp.width !== w || bmp.height !== h) throw new Error("Paint sample dimensions do not match its PNG.");
    const ctx = new OffscreenCanvas(w, h).getContext("2d");
    if (!ctx) throw new Error("Could not read the paint sample.");
    ctx.drawImage(bmp, 0, 0);
    return words(ctx.getImageData(0, 0, w, h).data);
  } finally {
    bmp.close();
  }
}
export function loadRaster(patch: RasterPatch): Promise<RasterPlanes> {
  const ready = cachedRaster(patch);
  if (ready) return Promise.resolve(ready);
  const running = decoding.get(patch.png);
  if (running) return running;
  const job = (async () => {
    const { x, y, width, height } = patch;
    const [light, dark, coverage] = await Promise.all([
      decodePng(patch.png, width, height),
      patch.darkPng ? decodePng(patch.darkPng, width, height) : undefined,
      patch.coveragePng ? decodePng(patch.coveragePng, width, height) : undefined,
    ]);
    const planes = { x, y, width, height, light, ...(dark && { dark }), ...(coverage && { coverage }) };
    decoded.set(patch.png, planes);
    return planes;
  })().finally(() => decoding.delete(patch.png));
  decoding.set(patch.png, job);
  return job;
}
export async function packRaster(planes: RasterPlanes): Promise<RasterPatch> {
  const { x, y, width, height, light, dark, coverage } = planes;
  if (
    width > 4096 ||
    height > 4096 ||
    width * height > 2500000 ||
    width * height * (1 + Number(!!dark) + Number(!!coverage)) > 6000000
  )
    throw new Error("This paint sample exceeds the recording pixel limit.");
  const [png, darkPng, coveragePng] = await Promise.all([
    encodePng(bytes(light), width, height),
    dark ? encodePng(bytes(dark), width, height) : undefined,
    coverage ? encodePng(bytes(coverage), width, height) : undefined,
  ]);
  const patch = { x, y, width, height, png, ...(darkPng && { darkPng }), ...(coveragePng && { coveragePng }) };
  decoded.set(png, planes);
  return patch;
}
export const pngUrl = (png: Uint8Array) => "data:image/png;base64," + base64(png);
export const drawingPixels = (pixels: Uint8ClampedArray) => words(pixels);

function premultiply(colors: Uint32Array) {
  const p = bytes(colors);
  for (let i = 0; i < p.length; i += 4) {
    const a = p[i + 3]!;
    if (a === 255) continue;
    for (let c = 0; c < 3; c++) p[i + c] = (p[i + c]! * a) / 255;
  }
}
function straight(v: number) {
  const a = v >>> 24;
  if (a === 255 || a === 0) return v;
  const un = (c: number) => Math.min(255, Math.round((c * 255) / a));
  return (a << 24) | (un((v >>> 16) & 255) << 16) | (un((v >>> 8) & 255) << 8) | un(v & 255);
}
function copyRect(from: Uint32Array, src: PixelRect, to: Uint32Array, dst: PixelRect) {
  for (let y = 0; y < src.height; y++) {
    const at = (y + src.y - dst.y) * dst.width + src.x - dst.x;
    to.set(from.subarray(y * src.width, (y + 1) * src.width), at);
  }
}
const same = (a: Uint32Array, b: Uint32Array) => a.length === b.length && a.every((v, i) => v === b[i]);

// Alternating byte lanes can be interpolated together without carry between channels.
function mixRgba(from: number, to: number, weight: number) {
  const lanes = 0xff00ff,
    keep = 256 - weight;
  const rb = (((from & lanes) * keep + (to & lanes) * weight + 0x800080) >>> 8) & lanes;
  const ga = ((((from >>> 8) & lanes) * keep + ((to >>> 8) & lanes) * weight + 0x800080) >>> 8) & lanes;
  return ((ga << 8) | rb) >>> 0;
}
function transfer(
  image: Uint32Array,
  i: number,
  paint: Uint32Array,
  j: number,
  weight: number,
  pick: number,
  locked: boolean,
) {
  const old = image[i]!,
    carried = paint[j]!;
  if (old === carried) return false;
  let next = mixRgba(old, carried, weight);
  if (locked && old >>> 24 !== next >>> 24) {
    const alpha = old >>> 24,
      a = next >>> 24;
    const channel = (shift: number) => (a ? Math.min(255, Math.round((((next >>> shift) & 255) * alpha) / a)) : 0);
    next = ((alpha << 24) | (channel(16) << 16) | (channel(8) << 8) | channel(0)) >>> 0;
  }
  paint[j] = mixRgba(carried, old, pick);
  image[i] = next;
  return next !== old;
}
export class SmudgeSession {
  private working: RasterPlanes | null = null;
  private offsets: Int16Array;
  private weights: Float32Array;
  private brush: Uint32Array;
  private nightBrush: Uint32Array;
  private lx = 0;
  private ly = 0;
  private cx = 0;
  private cy = 0;
  private minX = Infinity;
  private minY = Infinity;
  private maxX = -Infinity;
  private maxY = -Infinity;
  private dirtyLeft = Infinity;
  private dirtyTop = Infinity;
  private dirtyRight = -Infinity;
  private dirtyBottom = -Infinity;
  processed = 0;

  get workspace(): PixelRect | null {
    return this.working;
  }

  constructor(private stroke: Stroke) {
    const radius = Math.max(1, stroke.width / 2);
    const n = Math.ceil(radius);
    const offsets: number[] = [],
      weights: number[] = [];
    for (let dy = -n; dy <= n; dy++)
      for (let dx = -n; dx <= n; dx++) {
        const q = (dx * dx + dy * dy) / (radius * radius);
        if (q < 1) {
          offsets.push(dx, dy);
          weights.push((1 - q) ** 2);
        }
      }
    this.offsets = new Int16Array(offsets);
    this.weights = new Float32Array(weights);
    this.brush = new Uint32Array(weights.length);
    this.nightBrush = new Uint32Array(weights.length);
  }

  bounds(points: readonly number[], count: number): PixelRect | null {
    if (count <= this.processed) return null;
    const pad = Math.ceil(this.stroke.width / 2) + 2;
    let left = Infinity,
      top = Infinity,
      right = -Infinity,
      bottom = -Infinity;
    for (let n = this.processed; n < count; n++) {
      const k = n * STRIDE,
        x = points[k]!,
        y = points[k + 1]!;
      left = Math.min(left, x - pad);
      right = Math.max(right, x + pad);
      top = Math.min(top, y - pad);
      bottom = Math.max(bottom, y + pad);
    }
    const prev = this.working;
    if (prev && left >= prev.x && top >= prev.y && right < prev.x + prev.width && bottom < prev.y + prev.height)
      return null;
    const x = Math.min(prev?.x ?? Infinity, Math.floor(left / 128) * 128),
      y = Math.min(prev?.y ?? Infinity, Math.floor(top / 128) * 128);
    const width = Math.max(prev ? prev.x + prev.width : -Infinity, Math.ceil((right + 1) / 128) * 128) - x;
    const height = Math.max(prev ? prev.y + prev.height : -Infinity, Math.ceil((bottom + 1) / 128) * 128) - y;
    if (width > 4352 || height > 4352 || width * height > 3_000_000)
      throw new Error("This smudge exceeds the document-resolution paint sample limit.");
    return { x, y, width, height };
  }
  supply(sample: RasterPlanes) {
    premultiply(sample.light);
    if (sample.dark) premultiply(sample.dark);
    const coverage = new Uint32Array(sample.width * sample.height);
    coverage.fill(0xff000000);
    const prev = this.working;
    if (prev) {
      copyRect(prev.light, prev, sample.light, sample);
      if (sample.dark) copyRect(prev.dark ?? prev.light, prev, sample.dark, sample);
      copyRect(prev.coverage!, prev, coverage, sample);
    }
    this.working = { ...sample, coverage };
  }

  advance(points: readonly number[], count: number) {
    const sample = this.working;
    if (!sample) return;
    const light = sample.light,
      dark = sample.dark,
      locked = !!this.stroke.alphaLocked;
    let left = Infinity,
      right = -Infinity,
      top = Infinity,
      bottom = -Infinity;
    for (let n = this.processed; n < count; n++) {
      const k = n * STRIDE,
        x = points[k]!,
        y = points[k + 1]!;
      if (n === 0) {
        this.cx = Math.round(x);
        this.cy = Math.round(y);
        for (let d = 0; d < this.weights.length; d++) {
          const dx = this.offsets[2 * d]!,
            dy = this.offsets[2 * d + 1]!;
          const i = (this.cy + dy - sample.y) * sample.width + this.cx + dx - sample.x;
          this.brush[d] = light[i]!;
          if (dark) this.nightBrush[d] = dark[i]!;
        }
      } else {
        const steps = Math.max(
          1,
          Math.ceil(Math.hypot(x - this.lx, y - this.ly) / Math.max(1, this.stroke.width * 0.08)),
        );
        const pressure = points[k + 2]!,
          strength = pressure * (this.stroke.opacity ?? 1) * 0.86 * 256,
          pick = Math.round((0.04 + 0.08 * (1 - pressure)) * 256);
        for (let j = 1; j <= steps; j++) {
          const cx = Math.round(this.lx + ((x - this.lx) * j) / steps),
            cy = Math.round(this.ly + ((y - this.ly) * j) / steps);
          if (this.cx === cx && this.cy === cy) continue;
          this.cx = cx;
          this.cy = cy;
          for (let d = 0; d < this.weights.length; d++) {
            const px = cx + this.offsets[2 * d]!,
              py = cy + this.offsets[2 * d + 1]!,
              cell = (py - sample.y) * sample.width + px - sample.x;
            const weight = Math.round(this.weights[d]! * strength);
            const changed = transfer(light, cell, this.brush, d, weight, pick, locked);
            const changedDark = dark ? transfer(dark, cell, this.nightBrush, d, weight, pick, locked) : false;
            if (!changed && !changedDark) continue;
            if ((sample.coverage![cell]! & 0xffffff) === 0) sample.coverage![cell] = 0xff000000 | (n + 1);
            if (px < left) left = px;
            if (px > right) right = px;
            if (py < top) top = py;
            if (py > bottom) bottom = py;
          }
        }
      }
      this.lx = x;
      this.ly = y;
      this.processed = n + 1;
    }
    this.dirtyLeft = Math.min(this.dirtyLeft, left);
    this.dirtyRight = Math.max(this.dirtyRight, right);
    this.dirtyTop = Math.min(this.dirtyTop, top);
    this.dirtyBottom = Math.max(this.dirtyBottom, bottom);
    this.minX = Math.min(this.minX, left);
    this.maxX = Math.max(this.maxX, right);
    this.minY = Math.min(this.minY, top);
    this.maxY = Math.max(this.maxY, bottom);
  }
  result(dirty = false, consume = dirty): RasterPlanes | null {
    const x = dirty ? this.dirtyLeft : this.minX,
      y = dirty ? this.dirtyTop : this.minY;
    if (!Number.isFinite(x) || !this.working) return null;
    const s = this.working,
      width = (dirty ? this.dirtyRight : this.maxX) - x + 1,
      height = (dirty ? this.dirtyBottom : this.maxY) - y + 1;
    if (consume) {
      this.dirtyLeft = Infinity;
      this.dirtyTop = Infinity;
      this.dirtyRight = -Infinity;
      this.dirtyBottom = -Infinity;
    }
    const light = new Uint32Array(width * height),
      dark = s.dark ? new Uint32Array(width * height) : undefined;
    const coverage = new Uint32Array(width * height);
    for (let row = 0; row < height; row++)
      for (let col = 0; col < width; col++) {
        const dst = row * width + col,
          src = (row + y - s.y) * s.width + col + x - s.x;
        coverage[dst] = s.coverage![src]!;
        if (!(coverage[dst]! & 0xffffff)) continue;
        light[dst] = straight(s.light[src]!);
        if (dark) dark[dst] = straight(s.dark![src]!);
      }
    return { x, y, width, height, light, coverage, ...(dark && !same(light, dark) && { dark }) };
  }
}

export async function upgradeRaster(stroke: Stroke): Promise<Stroke> {
  const old = stroke.patch;
  if (!old || old.png instanceof Uint8Array || !("rgba" in old) || typeof old.rgba !== "string") return stroke;
  const raw = atob(old.rgba),
    px = new Uint8ClampedArray(raw.length);
  for (let i = 0; i < raw.length; i++) px[i] = raw.charCodeAt(i);
  const { x, y, width, height, transform } = old;
  if (px.length !== width * height * 4) throw new Error("The saved paint sample is incomplete.");
  let planes: RasterPlanes | null = { x, y, width, height, light: words(px) };
  if (stroke.tool === "smudge") {
    const m = transform;
    const points = stroke.points.slice();
    let scaled = stroke.width;
    if (m) {
      const det = m[0] * m[3] - m[1] * m[2];
      scaled /= Math.sqrt(Math.abs(det));
      for (let i = 0; i < points.length; i += STRIDE) {
        const x = points[i]! - m[4],
          y = points[i + 1]! - m[5];
        points[i] = (m[3] * x - m[2] * y) / det;
        points[i + 1] = (m[0] * y - m[1] * x) / det;
      }
    }
    const session = new SmudgeSession({ ...stroke, width: scaled });
    session.supply(planes);
    session.advance(points, points.length / STRIDE);
    planes = session.result();
  }
  if (!planes) {
    const { patch: _, ...empty } = stroke;
    return empty;
  }
  const patch = await packRaster(planes);
  if (transform) patch.transform = transform;
  return { ...stroke, patch };
}
