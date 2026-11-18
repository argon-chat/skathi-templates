import type { BlendMode, Layer, Paper, RasterPatch, Stroke } from "./model";
import type { View } from "./renderer";
import { coordinate16, fraction16, pressure12 } from "./precision";
import { pigmentDabCount } from "./pigments";
import { estimateStrokeVertices } from "./ink";
import { Writer, Reader, LayerTable, LIMITS, bad, crc32 } from "./eventBinary";
import { WIRE } from "./eventIds";

export interface Budget {
  points: number;
  strokes: number;
  pixels: number;
  dabs: number;
  records: number;
  copies: number;
  removed: number;
  vertices: number;
  vertexCosts: Map<number, number>;
}
export const budget = (): Budget => ({
  points: LIMITS.points,
  strokes: LIMITS.strokes,
  pixels: LIMITS.pixels,
  dabs: LIMITS.dabs,
  records: LIMITS.events,
  copies: LIMITS.strokes,
  removed: LIMITS.removed,
  vertices: LIMITS.vertices,
  vertexCosts: new Map(),
});
export interface Context {
  table: LayerTable;
  budget: Budget;
}
function chargeVertices(ctx: Context, seq: number, count: number) {
  if (!Number.isFinite(count) || count > Math.min(ctx.budget.vertices, LIMITS.verticesPerStroke))
    bad("stroke geometry exceeds the playback vertex budget");
  ctx.budget.vertices -= count;
  // History can restore earlier geometry under the same sequence number. Charge references for its largest incarnation.
  ctx.budget.vertexCosts.set(seq, Math.max(count, ctx.budget.vertexCosts.get(seq) ?? 0));
}
export function chargeCopy(ctx: Context, source: number, result: number) {
  const count = ctx.budget.vertexCosts.get(source);
  if (count === undefined) return bad("copy refers to an unknown stroke");
  chargeVertices(ctx, result, count);
}
export function enumerate<K extends string>(table: Readonly<Record<K, number>>, id: number): K {
  for (const name in table) if (table[name] === id) return name;
  return bad("unknown enum value " + id);
}
export function layerId(w: Writer, table: LayerTable, id: string) {
  w.uint(table.index(id));
}
export function readId(r: Reader, table: LayerTable) {
  return table.name(r.uint(LIMITS.symbols - 1));
}
export function color(w: Writer, value: string) {
  if (value === "ink") {
    w.byte(0);
    return;
  }
  if (!/^#[0-9a-f]{6}$/i.test(value)) bad("invalid colour");
  const rgb = parseInt(value.slice(1), 16);
  w.byte(1);
  w.byte(rgb >>> 16);
  w.byte(rgb >>> 8);
  w.byte(rgb);
}
export function readColor(r: Reader) {
  const tag = r.byte();
  if (!tag) return "ink";
  if (tag !== 1) return bad("unknown colour tag");
  return "#" + (((r.byte() << 16) | (r.byte() << 8) | r.byte()) >>> 0).toString(16).padStart(6, "0").toUpperCase();
}
export function ratio(w: Writer, n: number) {
  w.u16(Math.round(fraction16(n) * 65535));
}
export const readRatio = (r: Reader) => r.u16() / 65535;
export function view(w: Writer, v: View) {
  w.float(v.zoom);
  w.float(v.angle);
  w.float(v.x);
  w.float(v.y);
}
export function readView(r: Reader): View {
  const zoom = r.left ? r.float() : 1;
  if (zoom <= 0) bad("invalid zoom");
  return { zoom, angle: r.left ? r.float() : 0, x: r.left ? r.float() : 0, y: r.left ? r.float() : 0 };
}
export const readPaper = (r: Reader): Paper => enumerate(WIRE.paper, r.byte());
export const readBlend = (r: Reader): BlendMode => enumerate(WIRE.blend, r.byte());

function q(v: number) {
  const n = coordinate16(v) * 16;
  if (Math.abs(n) > 2 ** 35 || !Number.isSafeInteger(n)) bad("coordinate out of range");
  return n;
}
function pointValue(pts: readonly number[], i: number, c: number) {
  const v = pts[i + c]!;
  switch (c) {
    case 0:
    case 1:
      return q(v);
    case 2:
      return Math.round(pressure12(v) * 4095);
    case 3:
    case 4:
      return Math.max(-90, Math.min(90, Math.round(v)));
    case 5:
      return ((Math.round(v) % 360) + 360) % 360;
    default:
      return Math.max(0, Math.round(v - pts[6]!));
  }
}
function columns(w: Writer, p: readonly number[], stride: 2 | 7) {
  const n = p.length / stride;
  if (!Number.isInteger(n) || n > LIMITS.pointsPerStroke) bad("invalid point count");
  let flags = 0;
  for (let c = 0; c < stride; c++)
    for (let i = 0; i < p.length; i += stride)
      if (pointValue(p, i, c) !== 0) {
        flags |= 1 << c;
        break;
      }
  w.byte(flags);
  w.uint(n);
  for (let c = 0; c < stride; c++)
    if (flags & (1 << c)) {
      let previous = 0;
      for (let i = 0; i < p.length; i += stride) {
        let v = pointValue(p, i, c);
        if (c === 6) {
          v = Math.max(previous, v);
          w.uint(v - previous);
        } else w.sint(v - previous);
        previous = v;
      }
    }
}
function readColumns(r: Reader, ctx: Context, stride: 2 | 7) {
  const flags = r.byte(),
    n = r.uint(LIMITS.pointsPerStroke);
  if (flags >= 1 << stride || n > ctx.budget.points) bad("invalid point count");
  ctx.budget.points -= n;
  let used = 0;
  for (let c = 0; c < stride; c++) used += (flags >> c) & 1;
  if (used * n > r.left) bad("truncated point columns");
  const p = new Array<number>(n * stride).fill(0);
  for (let c = 0; c < stride; c++)
    if (flags & (1 << c)) {
      let v = 0;
      for (let i = 0; i < n; i++) {
        v += c === 6 ? r.uint() : r.sint();
        if (
          !Number.isSafeInteger(v) ||
          (c < 2 && Math.abs(v) > 2 ** 35) ||
          (c === 2 && (v < 0 || v > 4095)) ||
          ((c === 3 || c === 4) && Math.abs(v) > 90) ||
          (c === 5 && (v < 0 || v >= 360)) ||
          (c === 6 && v > 7 * 86400_000)
        )
          bad("invalid point column");
        p[i * stride + c] = c < 2 ? v / 16 : c === 2 ? v / 4095 : v;
      }
    }
  return p;
}
const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
function readPng(r: Reader, w: number, h: number, ctx: Context) {
  const n = r.uint(LIMITS.chunk),
    data = r.raw(n);
  if (n < 57 || !pngSignature.every((v, i) => data[i] === v)) return bad("invalid PNG signature");
  const pixels = w * h;
  if (pixels > ctx.budget.pixels) bad("raster pixel limit");
  ctx.budget.pixels -= pixels;
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let idat = false,
    at = 8;
  while (n - at >= 12) {
    const len = dv.getUint32(at),
      kind = dv.getUint32(at + 4),
      end = at + 12 + len;
    if (end > n || crc32(data.subarray(at + 4, end - 4)) !== dv.getUint32(end - 4)) return bad("invalid PNG chunk");
    if (
      at === 8 &&
      (kind !== 0x49484452 ||
        len !== 13 ||
        dv.getUint32(at + 8) !== w ||
        dv.getUint32(at + 12) !== h ||
        data[at + 16] !== 8 ||
        data[at + 17] !== 6 ||
        data[at + 18] !== 0 ||
        data[at + 19] !== 0 ||
        data[at + 20] !== 0)
    )
      bad("invalid RGBA8 PNG header");
    if (kind === 0x49484452 && at !== 8) bad("duplicate PNG header");
    if (kind === 0x49444154) idat = true;
    if (kind === 0x49454e44) {
      if (!idat || len || end !== n) return bad("invalid PNG end");
      return data.slice();
    }
    at = end;
  }
  return bad("incomplete PNG");
}
function patch(w: Writer, p: RasterPatch) {
  w.sint(q(p.x));
  w.sint(q(p.y));
  w.uint(p.width);
  w.uint(p.height);
  w.byte(Number(!!p.darkPng) | (Number(!!p.coveragePng) << 1) | (Number(!!p.transform) << 2));
  w.block(p.png);
  if (p.darkPng) w.block(p.darkPng);
  if (p.coveragePng) w.block(p.coveragePng);
  if (p.transform) for (const v of p.transform) w.float(v);
}
function readPatch(r: Reader, ctx: Context): RasterPatch {
  const x = r.sint() / 16,
    y = r.sint() / 16,
    width = r.uint(LIMITS.patchSide),
    height = r.uint(LIMITS.patchSide),
    flags = r.byte();
  if (!width || !height || flags > 7 || width * height > 2_500_000) bad("invalid raster dimensions");
  const png = readPng(r, width, height, ctx);
  const p: RasterPatch = { x, y, width, height, png };
  if (flags & 1) p.darkPng = readPng(r, width, height, ctx);
  if (flags & 2) p.coveragePng = readPng(r, width, height, ctx);
  if (Math.abs(x) > 2 ** 31 || Math.abs(y) > 2 ** 31) bad("raster origin out of range");
  if (flags & 4) {
    const a = r.float(),
      b = r.float(),
      c = r.float(),
      d = r.float(),
      e = r.float(),
      f = r.float();
    for (const xx of [x, x + width])
      for (const yy of [y, y + height]) {
        const tx = a * xx + c * yy + e,
          ty = b * xx + d * yy + f;
        if (!Number.isFinite(tx) || !Number.isFinite(ty) || Math.abs(tx) > 2 ** 31 || Math.abs(ty) > 2 ** 31)
          bad("raster transform out of range");
      }
    p.transform = [a, b, c, d, e, f];
  }
  return p;
}
function writeStroke(w: Writer, s: Stroke) {
  w.uint(s.seq);
  w.byte(WIRE.tool[s.tool]);
  color(w, s.color);
  w.float(s.width);
  ratio(w, s.opacity ?? 1);
  if (s.tool === "spray") {
    ratio(w, s.density ?? 0.55);
    ratio(w, s.scatter ?? 0.5);
  }
  if (s.tool === "airbrush") {
    ratio(w, s.hardness ?? 0.25);
    ratio(w, s.density ?? 0.55);
  }
  w.u32(s.seed ?? s.seq);
  const flags =
    Number(!!s.shape) |
    (Number(!!s.alphaLocked) << 1) |
    (Number(!!s.contours) << 2) |
    (Number(!!s.patch) << 3) |
    (Number(!!s.scope?.length) << 4);
  w.byte(flags);
  columns(w, s.points, 7);
  if (s.contours) {
    w.uint(s.contours.length);
    for (const p of s.contours) columns(w, p, 2);
  }
  if (s.patch) patch(w, s.patch);
  if (s.scope?.length) {
    w.uint(s.scope.length);
    for (const id of s.scope) w.uint(id);
  }
}
function readStroke(r: Reader, ctx: Context): Stroke {
  if (--ctx.budget.strokes < 0) bad("too many strokes");
  const seq = r.uint(0xffffffff),
    tool = enumerate(WIRE.tool, r.byte()),
    colour = readColor(r),
    width = r.float(),
    opacity = readRatio(r);
  if (width <= 0 || width > 1e6) bad("invalid brush width");
  const s: Stroke = { seq, tool, color: colour, width, opacity, points: [] };
  if (tool === "spray") {
    s.density = readRatio(r);
    s.scatter = readRatio(r);
  }
  if (tool === "airbrush") {
    s.hardness = readRatio(r);
    s.density = readRatio(r);
  }
  s.seed = r.u32();
  const flags = r.byte();
  s.points = readColumns(r, ctx, 7);
  if (!s.points.length) bad("empty stroke");
  if (flags & 1) s.shape = true;
  if (flags & 2) s.alphaLocked = true;
  if (flags & 4) {
    const n = r.uint(4096);
    s.contours = [];
    for (let i = 0; i < n; i++) {
      const p = readColumns(r, ctx, 2);
      if (p.length < 6) bad("incomplete contour");
      s.contours.push(p);
    }
  }
  if (flags & 8) s.patch = readPatch(r, ctx);
  if (flags & 16) {
    const n = r.uint(16);
    s.scope = [];
    for (let j = 0; j < n; j++) s.scope.push(r.uint(0xffffffff));
  }
  if (tool === "airbrush" || tool === "spray") {
    const remaining = Math.min(300_000, ctx.budget.dabs),
      used = pigmentDabCount(s, remaining);
    if (used > remaining) bad("pigment budget exceeded");
    ctx.budget.dabs -= used;
  }
  chargeVertices(ctx, seq, estimateStrokeVertices(s, Math.min(LIMITS.verticesPerStroke, ctx.budget.vertices)));
  return s;
}
export function strokes(w: Writer, list: readonly Stroke[]) {
  w.uint(list.length);
  for (const s of list) {
    const row = new Writer();
    writeStroke(row, s);
    w.block(row.result());
  }
}
export function readStrokes(r: Reader, ctx: Context) {
  const n = r.uint(Math.min(ctx.budget.strokes, LIMITS.strokes));
  if (n > r.left) bad("invalid stroke count");
  const list: Stroke[] = [];
  for (let i = 0; i < n; i++) list.push(readStroke(r.child(), ctx));
  return list;
}
export function layer(w: Writer, l: Layer, ctx: Context) {
  layerId(w, ctx.table, l.id);
  w.text(l.name);
  w.byte(Number(l.visible) | (Number(!!l.clipping) << 1) | (Number(!!l.alphaLocked) << 2));
  ratio(w, l.opacity);
  w.byte(WIRE.blend[l.blendMode ?? "normal"]);
  strokes(w, l.strokes);
}
export function readLayer(r: Reader, ctx: Context): Layer {
  const id = readId(r, ctx.table),
    name = r.left ? r.text() : id,
    flags = r.left ? r.byte() : 1,
    opacity = r.left ? readRatio(r) : 1,
    blendMode = r.left ? readBlend(r) : "normal";
  return {
    id,
    name,
    visible: !!(flags & 1),
    opacity,
    ...(flags & 2 ? { clipping: true } : {}),
    ...(flags & 4 ? { alphaLocked: true } : {}),
    ...(blendMode !== "normal" ? { blendMode } : {}),
    strokes: r.left ? readStrokes(r, ctx) : [],
  };
}
export function layers(w: Writer, list: readonly Layer[], ctx: Context) {
  w.uint(list.length);
  for (const l of list) {
    const row = new Writer();
    layer(row, l, ctx);
    w.block(row.result());
  }
}
export function readLayers(r: Reader, ctx: Context) {
  const n = r.uint(LIMITS.layers);
  if (!n) bad("empty layer table");
  const out: Layer[] = [];
  for (let i = 0; i < n; i++) out.push(readLayer(r.child(), ctx));
  if (new Set(out.map((l) => l.id)).size !== n) bad("duplicate layer symbol");
  return out;
}
