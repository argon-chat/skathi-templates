import {
  BLEND_MODES,
  isColor,
  isTool,
  MODES,
  PAPERS,
  STRIDE,
  TOOL_INFO,
  type Layer,
  type Mode,
  type Paper,
  type Stroke,
  type Symmetry,
} from "./model";
import type { View } from "./renderer";

export const RECORDING_MIME = "application/x-skathi-draw-events";

export interface DrawMeta {
  width: number;
  height: number;
  view: View;
  paper: Paper;
  dark: boolean;
  seed: number;
  author?: string;
  title?: string;
}

export interface DrawSnapshot {
  layers: readonly Layer[];
  active: string;
}

export interface DrawUi {
  mode?: Mode;
  color?: string;
  size?: number;
  active?: string;
  paper?: Paper;
  dark?: boolean;
  symmetry?: Symmetry | null;
}

export type DrawAtomic =
  | { kind: "stroke"; layer: string; strokes: readonly Stroke[] }
  | { kind: "edit"; layer: string; removed: readonly number[]; added: readonly Stroke[] }
  | { kind: "add-layer"; layer: Layer; index: number }
  | { kind: "delete-layer"; id: string }
  | { kind: "move-layer"; from: number; to: number }
  | { kind: "layer"; id: string; changes: Partial<Omit<Layer, "id" | "strokes">> }
  | { kind: "replace"; layers: readonly Layer[] }
  | { kind: "clear" };
export type DrawMutation = DrawAtomic | { kind: "group"; changes: readonly DrawAtomic[]; active?: string };

export type DrawAction =
  | DrawMutation
  | { kind: "undo"; fallback?: DrawMutation }
  | { kind: "redo"; fallback?: DrawMutation }
  | { kind: "ui"; state: DrawUi }
  | { kind: "view"; view: View };
export type DrawEvent = DrawAction & { at: number };
export interface DrawRecording {
  meta: DrawMeta;
  initial: DrawSnapshot | null;
  events: DrawEvent[];
  duration: number;
  protected: boolean;
  created: number;
  version: string;
}

const kinds: DrawAction["kind"][] = [
  "stroke",
  "edit",
  "add-layer",
  "delete-layer",
  "move-layer",
  "layer",
  "replace",
  "clear",
  "undo",
  "redo",
  "ui",
  "view",
  "group",
];
const META = 1,
  SNAPSHOT = 2,
  EVENTS = 3,
  END = 4;
const LIMIT = 128 * 1024 * 1024;
const MAX_POINTS = 8_000_000;
const MAX_FILE = 512 * 1024 * 1024;
type Bytes = Uint8Array<ArrayBuffer>;

interface Deflater {
  writable: { getWriter(): { write(bytes: Bytes): Promise<void>; close(): Promise<void> } };
  readable: {
    getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }>; cancel(reason?: unknown): Promise<void> };
  };
}
declare const CompressionStream: new (format: "deflate-raw") => Deflater;
declare const DecompressionStream: new (format: "deflate-raw") => Deflater;
declare const TextEncoder: new () => { encode(text: string): Bytes };
declare const TextDecoder: new (name?: string, options?: { fatal: boolean }) => { decode(bytes: Uint8Array): string };
const utf8 = new TextEncoder();
const decodeUtf8 = new TextDecoder("utf-8", { fatal: true });

const bad = (detail: string): never => {
  throw new Error(`Invalid SKEV recording (${detail}).`);
};
const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const coordinate = (v: unknown): v is number => finite(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER / 16;
const positive = (v: unknown): v is number => finite(v) && v > 0;
const natural = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const unit = (v: unknown) => finite(v) && v >= 0 && v <= 1;
const optional = (v: unknown, check: (x: unknown) => boolean) => v === undefined || check(v);
const string = (v: unknown): v is string => typeof v === "string";
const bool = (v: unknown): v is boolean => typeof v === "boolean";
const paper = (v: unknown): v is Paper => PAPERS.some((kind) => kind === v);
const view = (v: unknown): v is View => record(v) && positive(v.zoom) && finite(v.angle) && finite(v.x) && finite(v.y);
function meta(v: unknown): v is DrawMeta {
  return (
    record(v) &&
    positive(v.width) &&
    positive(v.height) &&
    view(v.view) &&
    paper(v.paper) &&
    bool(v.dark) &&
    natural(v.seed) &&
    optional(v.author, string) &&
    optional(v.title, string)
  );
}
function patch(v: unknown): boolean {
  if (
    !record(v) ||
    !coordinate(v.x) ||
    !coordinate(v.y) ||
    !positive(v.width) ||
    !positive(v.height) ||
    !natural(v.width) ||
    !natural(v.height) ||
    !string(v.rgba)
  )
    return false;
  const pixels = v.width * v.height;
  return (
    v.width <= 8192 &&
    v.height <= 8192 &&
    pixels <= 16_777_216 &&
    v.rgba.length === Math.ceil((pixels * 4) / 3) * 4 &&
    /^[A-Za-z0-9+/]*={0,2}$/.test(v.rgba) &&
    (v.rgba.endsWith("==") ? 2 : v.rgba.endsWith("=") ? 1 : 0) === (3 - ((pixels * 4) % 3)) % 3 &&
    (v.transform === undefined ||
      (Array.isArray(v.transform) && v.transform.length === 6 && v.transform.every(coordinate)))
  );
}
const contours = (v: unknown) =>
  Array.isArray(v) &&
  v.every((r: unknown) => Array.isArray(r) && r.length >= 6 && r.length % 2 === 0 && r.every(coordinate));
function renderable(s: Stroke) {
  const points = s.points;
  if (s.tool === "spray" || s.tool === "airbrush") {
    let dabs = 1;
    const spray = s.tool === "spray";
    const spacing = Math.max(1, s.width * (spray ? 0.12 : 0.17));
    for (let i = STRIDE; i < points.length; i += STRIDE) {
      const j = i - STRIDE;
      const distance = Math.hypot(points[i]! - points[j]!, points[i + 1]! - points[j + 1]!);
      const rate = spray ? (0.08 + points[i + 2]! * 0.65) * (0.1 + 0.9 * (s.density ?? 0.55)) : 0.055;
      dabs += Math.max((points[i + 6]! - points[j + 6]!) * rate, distance / spacing);
      if (dabs > 1_000_000) return false;
    }
  }
  if (s.patch && s.tool === "smudge") {
    const p = s.patch;
    const [a, b, c, d, e, f] = p.transform ?? [1, 0, 0, 1, 0, 0];
    const det = a * d - b * c;
    if (!finite(det) || Math.abs(det) < 1e-9) return false;
    const diameter = s.width / Math.sqrt(Math.abs(det));
    if (diameter > Math.min(TOOL_INFO.smudge.max + 1, p.width + 2, p.height + 2)) return false;
    // The sample covers the whole path. Allow the half quantum introduced by file coordinates, in local space.
    const ex = Math.min(p.width, 1 + (Math.abs(d) + Math.abs(c)) / (32 * Math.abs(det)));
    const ey = Math.min(p.height, 1 + (Math.abs(a) + Math.abs(b)) / (32 * Math.abs(det)));
    for (let i = 0; i < points.length; i += STRIDE) {
      const dx = points[i]! - e,
        dy = points[i + 1]! - f;
      const x = (d * dx - c * dy) / det - p.x,
        y = (-b * dx + a * dy) / det - p.y;
      if (x < -ex || x > p.width + ex || y < -ey || y > p.height + ey) return false;
    }
  }
  return true;
}
function stroke(v: unknown): v is Stroke {
  return (
    record(v) &&
    natural(v.seq) &&
    isTool(v.tool) &&
    isColor(v.color) &&
    positive(v.width) &&
    optional(v.opacity, unit) &&
    optional(v.shape, bool) &&
    optional(v.seed, natural) &&
    optional(v.hardness, unit) &&
    optional(v.density, unit) &&
    optional(v.scatter, unit) &&
    optional(v.alphaLocked, bool) &&
    optional(v.contours, contours) &&
    optional(v.patch, patch) &&
    Array.isArray(v.points) &&
    v.points.length >= STRIDE &&
    v.points.length % STRIDE === 0
  );
}
const strokes = (v: unknown): v is Stroke[] => Array.isArray(v) && v.every((s: unknown) => stroke(s) && renderable(s));
function layerProps(v: Record<string, unknown>) {
  return (
    optional(v.name, string) &&
    optional(v.visible, bool) &&
    optional(v.opacity, unit) &&
    optional(v.blendMode, (s) => BLEND_MODES.some((b) => b === s)) &&
    optional(v.clipping, bool) &&
    optional(v.alphaLocked, bool)
  );
}
function layer(v: unknown): v is Layer {
  return (
    record(v) &&
    string(v.id) &&
    string(v.name) &&
    bool(v.visible) &&
    unit(v.opacity) &&
    layerProps(v) &&
    strokes(v.strokes)
  );
}
const layers = (v: unknown): v is Layer[] =>
  Array.isArray(v) && v.length > 0 && v.every(layer) && new Set(v.map((l) => l.id)).size === v.length;
function snapshot(v: unknown): v is DrawSnapshot {
  return record(v) && string(v.active) && layers(v.layers) && v.layers.some((l) => l.id === v.active);
}
function ui(v: unknown): v is DrawUi {
  return (
    record(v) &&
    optional(v.mode, (m) => MODES.some((k) => k === m)) &&
    optional(v.color, isColor) &&
    optional(v.size, positive) &&
    optional(v.active, string) &&
    optional(v.paper, paper) &&
    optional(v.dark, bool) &&
    (v.symmetry == null ||
      (record(v.symmetry) &&
        bool(v.symmetry.mirror) &&
        natural(v.symmetry.segments) &&
        v.symmetry.segments >= 1 &&
        v.symmetry.segments <= 12 &&
        finite(v.symmetry.x) &&
        finite(v.symmetry.y)))
  );
}
function atomic(v: Record<string, unknown>): boolean {
  switch (v.kind) {
    case "stroke":
      return string(v.layer) && strokes(v.strokes) && v.strokes.length > 0;
    case "edit":
      return string(v.layer) && Array.isArray(v.removed) && v.removed.every(natural) && strokes(v.added);
    case "add-layer":
      return layer(v.layer) && natural(v.index);
    case "delete-layer":
      return string(v.id);
    case "move-layer":
      return natural(v.from) && natural(v.to);
    case "layer":
      return (
        string(v.id) &&
        record(v.changes) &&
        layerProps(v.changes) &&
        Object.keys(v.changes).every((k) =>
          ["name", "visible", "opacity", "blendMode", "clipping", "alphaLocked"].includes(k),
        )
      );
    case "replace":
      return layers(v.layers);
    case "clear":
      return true;
    default:
      return false;
  }
}
function mutation(v: Record<string, unknown>): boolean {
  return v.kind === "group"
    ? optional(v.active, string) &&
        Array.isArray(v.changes) &&
        v.changes.length > 0 &&
        v.changes.every((m: unknown) => record(m) && atomic(m))
    : atomic(v);
}
function action(v: unknown): v is DrawAction {
  if (!record(v)) return false;
  switch (v.kind) {
    case "ui":
      return ui(v.state);
    case "view":
      return view(v.view);
    case "undo":
    case "redo":
      return v.fallback === undefined || (record(v.fallback) && mutation(v.fallback));
    default:
      return mutation(v);
  }
}

class Writer {
  private buffer = new Uint8Array(256);
  private length = 0;
  private reserve(n: number) {
    if (this.length + n <= this.buffer.length) return;
    if (this.length + n > LIMIT) bad("chunk too large");
    const larger = new Uint8Array(Math.min(LIMIT, Math.max(this.buffer.length * 2, this.length + n)));
    larger.set(this.buffer);
    this.buffer = larger;
  }
  byte(v: number) {
    this.reserve(1);
    this.buffer[this.length++] = v;
  }
  u16(v: number) {
    this.byte(v);
    this.byte(v >>> 8);
  }
  u32(v: number) {
    this.u16(v);
    this.u16(v >>> 16);
  }
  uint(v: number) {
    if (!natural(v)) bad("invalid integer");
    while (v >= 128) {
      this.byte(128 + (v % 128));
      v = Math.floor(v / 128);
    }
    this.byte(v);
  }
  signed(v: number) {
    this.uint(v < 0 ? -v * 2 - 1 : v * 2);
  }
  bytes(v: Uint8Array) {
    this.reserve(v.length);
    this.buffer.set(v, this.length);
    this.length += v.length;
  }
  text(v: string) {
    const b = utf8.encode(v);
    this.uint(b.length);
    this.bytes(b);
  }
  result() {
    return this.buffer.subarray(0, this.length);
  }
}

class Reader {
  at = 0;
  constructor(
    readonly bytes: Uint8Array,
    readonly pointBudget = { left: MAX_POINTS },
  ) {}
  get left() {
    return this.bytes.length - this.at;
  }
  take(n: number) {
    if (n > this.left) bad("incomplete payload");
    const start = this.at;
    this.at += n;
    return this.bytes.subarray(start, this.at);
  }
  byte(): number {
    return this.bytes[this.at++] ?? bad("incomplete payload");
  }
  u16() {
    return this.byte() + this.byte() * 256;
  }
  u32() {
    return this.u16() + this.u16() * 65536;
  }
  uint(): number {
    let value = 0;
    for (let i = 0; i <= 7; i++) {
      const b = this.byte();
      value += (b % 128) * 128 ** i;
      if (b < 128) return natural(value) ? value : bad("oversized integer");
    }
    return bad("oversized integer");
  }
  signed() {
    const n = this.uint();
    return n % 2 ? -(n + 1) / 2 : n / 2;
  }
  text() {
    return decodeUtf8.decode(this.take(this.uint()));
  }
  end() {
    if (this.left) bad("unexpected payload bytes");
  }
}

function writePoints(w: Writer, pts: readonly number[]) {
  w.uint(pts.length / STRIDE);
  let x = 0,
    y = 0,
    t = 0;
  for (let i = 0; i < pts.length; i += STRIDE) {
    const nx = Math.round(pts[i]! * 16),
      ny = Math.round(pts[i + 1]! * 16);
    const nt = Math.max(t, Math.round(pts[i + 6]!));
    w.signed(nx - x);
    w.signed(ny - y);
    w.u16(Math.round(Math.max(0, Math.min(1, pts[i + 2]!)) * 65535));
    w.byte(Math.round(pts[i + 3]!));
    w.byte(Math.round(pts[i + 4]!));
    w.u16(Math.round(pts[i + 5]!));
    w.uint(nt - t);
    x = nx;
    y = ny;
    t = nt;
  }
}
function readPoints(r: Reader) {
  const count = r.uint();
  if (count > Math.floor(r.left / 9) || count > 2_000_000 || count > r.pointBudget.left) bad("invalid point count");
  r.pointBudget.left -= count;
  const pts: number[] = [];
  let x = 0,
    y = 0,
    t = 0;
  for (let i = 0; i < count; i++) {
    x += r.signed();
    y += r.signed();
    const pressure = r.u16() / 65535,
      tx = r.byte(),
      ty = r.byte(),
      twist = r.u16();
    t += r.uint();
    if (!Number.isSafeInteger(t) || !Number.isSafeInteger(x) || !Number.isSafeInteger(y)) bad("invalid point");
    pts.push(x / 16, y / 16, pressure, (tx << 24) >> 24, (ty << 24) >> 24, twist, t);
  }
  return pts;
}
// Keep tool properties extensible while storing the large point arrays in their own binary layout.
function writeBody(w: Writer, value: unknown) {
  const pointLists: number[][] = [];
  w.text(
    JSON.stringify(value, (key, item: unknown) => {
      if (key !== "points" || !Array.isArray(item)) return item;
      pointLists.push(item);
      return null;
    }),
  );
  for (const pts of pointLists) writePoints(w, pts);
}
function readBody(r: Reader): unknown {
  return JSON.parse(r.text(), (key, value: unknown): unknown => {
    if (key !== "points") return value;
    return value === null ? readPoints(r) : bad("invalid points");
  });
}

export function joinBytes(parts: readonly Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
async function deflate(input: Bytes, decode = false): Promise<Bytes> {
  const stream = decode ? new DecompressionStream("deflate-raw") : new CompressionStream("deflate-raw");
  const reader = stream.readable.getReader(),
    writer = stream.writable.getWriter();
  const read = async () => {
    const parts: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) return joinBytes(parts);
      if (!value) continue;
      total += value.length;
      if (total > LIMIT) {
        await reader.cancel();
        bad("expanded chunk too large");
      }
      parts.push(value);
    }
  };
  const write = async () => {
    // The host may inflate one write into a single native buffer before the reader can check its size.
    const step = decode ? 8192 : Math.max(input.length, 1);
    for (let i = 0; i < input.length; i += step) await writer.write(input.subarray(i, i + step));
    await writer.close();
  };
  const [out] = await Promise.all([read(), write()]);
  return out;
}
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let c = index;
  for (let i = 0; i < 8; i++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  return c >>> 0;
});
function crc32(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]!) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
export function packChunk(id: number, payload: Uint8Array): Bytes {
  const w = new Writer();
  w.byte(id);
  w.uint(payload.length);
  w.bytes(payload);
  w.u32(crc32(w.result()));
  return w.result();
}
export function recordingHeader(protectedFlag: boolean, created = Date.now(), version = "draw/1"): Bytes {
  const w = new Writer();
  w.bytes(utf8.encode("SKEV"));
  w.u16(1);
  w.u16(0);
  w.u32(protectedFlag ? 1 : 0);
  w.u32(created >>> 0);
  w.u32(Math.floor(created / 2 ** 32));
  w.text(version);
  return w.result();
}
export function metaChunk(value: DrawMeta) {
  const w = new Writer();
  writeBody(w, value);
  return packChunk(META, w.result());
}
export async function snapshotChunk(value: DrawSnapshot) {
  const w = new Writer();
  writeBody(w, value);
  return packChunk(SNAPSHOT, await deflate(w.result()));
}
export async function eventsChunk(batch: readonly DrawEvent[], previous: number) {
  const w = new Writer();
  w.uint(batch.length);
  for (const event of batch) {
    const { kind, at, ...payload } = event;
    w.uint(at - previous);
    w.byte(kinds.indexOf(kind) + 1);
    writeBody(w, payload);
    previous = at;
  }
  return packChunk(EVENTS, await deflate(w.result()));
}
export function endChunk(duration: number, count: number) {
  const w = new Writer();
  w.uint(duration);
  w.uint(count);
  return packChunk(END, w.result());
}
export async function decodeRecording(bytes: Uint8Array): Promise<DrawRecording> {
  if (bytes.length > MAX_FILE) bad("recording too large");
  const r = new Reader(bytes);
  if (decodeUtf8.decode(r.take(4)) !== "SKEV") bad("expected SKEV signature");
  const major = r.u16();
  r.u16();
  if (major !== 1)
    throw new Error(`SKEV version ${major} is unsupported. Open this recording with a compatible version of Draw.`);
  const protectedFlag = (r.u32() & 1) !== 0;
  const created = r.u32() + r.u32() * 2 ** 32,
    version = r.text();
  const events: DrawEvent[] = [];
  let settings: DrawMeta | null = null,
    initial: DrawSnapshot | null = null,
    at = 0,
    duration = 0,
    ended = false;
  let expanded = 0;
  while (r.left) {
    const start = r.at;
    const kind = r.byte();
    let end = r.at;
    while (end < bytes.length && bytes[end]! >= 128 && end - r.at < 8) end++;
    if (end === bytes.length) break;
    const length = r.uint();
    if (length + 4 > r.left) break;
    const payload = r.take(length),
      checksum = crc32(bytes.subarray(start, r.at));
    if (r.u32() !== checksum) bad("chunk CRC32 mismatch");
    if (kind < META || kind > END) continue;
    if (length > LIMIT) bad("chunk too large");
    if (ended) bad("content after end");
    const body = new Reader(
      kind === EVENTS || kind === SNAPSHOT
        ? await deflate(new Uint8Array(payload.buffer as ArrayBuffer, payload.byteOffset, payload.byteLength), true)
        : payload,
      r.pointBudget,
    );
    expanded += body.left;
    if (expanded > MAX_FILE) bad("expanded recording too large");
    if (kind === META) {
      const value = readBody(body);
      if (settings || !meta(value)) return bad("invalid metadata");
      settings = value;
    } else if (kind === SNAPSHOT) {
      const value = readBody(body);
      if (initial || events.length || !snapshot(value)) return bad("invalid initial snapshot");
      initial = value;
    } else if (kind === EVENTS) {
      const count = body.uint();
      if (count > Math.floor(body.left / 5) || count + events.length > 2_000_000) bad("invalid event count");
      for (let i = 0; i < count; i++) {
        at += body.uint();
        const name = kinds[body.byte() - 1],
          fields = readBody(body);
        if (!name || !record(fields) || !natural(at)) return bad("invalid event");
        const event = { ...fields, kind: name };
        if (!action(event)) return bad(`invalid ${name} event`);
        events.push({ ...event, at });
      }
    } else {
      duration = body.uint();
      if (duration < at || body.uint() !== events.length) bad("inconsistent end marker");
      ended = true;
    }
    body.end();
  }
  if (!settings) return bad("missing canvas metadata");
  return {
    meta: settings,
    initial,
    events,
    duration: Math.max(duration, at),
    protected: protectedFlag,
    created,
    version,
  };
}
