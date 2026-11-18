import type { Layer, Mode, Paper, Shape, Stroke, Symmetry } from "./model";
import type { View } from "./renderer";
import { version as appVersion } from "../package.json";
import { budget, readLayers, readId, readPaper, readView, layers, layerId, view, type Context } from "./eventDrawing";
import { bad, crc32, indexedCrc32, LayerTable, LIMITS, packChunk, Reader, transform, Writer } from "./eventBinary";
import { WIRE } from "./eventIds";
import { readRecord, writeRecord } from "./eventRecords";
export { joinBytes, LayerTable, packChunk } from "./eventBinary";
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
  shape?: Shape;
  color?: string;
  size?: number;
  active?: string;
  paper?: Paper;
  dark?: boolean;
  symmetry?: Symmetry | null;
}

export type DrawAtomic =
  | { kind: "stroke"; layer: string; strokes: readonly Stroke[] }
  | {
      kind: "edit";
      layer: string;
      removed: readonly number[];
      added: readonly Stroke[];
      copies?: readonly { layer: string; seq: number; as: number; opacity?: number; scope?: number[] }[];
    }
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

const MAGIC = [0x53, 0x4b, 0x45, 0x56];
const FILE_MAJOR = 2,
  FILE_MINOR = 0;
const context = (table = new LayerTable()): Context => ({ table, budget: budget() });
export function recordingHeader(protectedFlag: boolean, created = Date.now(), version = appVersion) {
  const fields = new Writer();
  fields.u32(Number(protectedFlag));
  fields.u64(created);
  fields.text(version);
  const w = new Writer();
  for (const v of MAGIC) w.byte(v);
  w.u16(FILE_MAJOR);
  w.u16(FILE_MINOR);
  w.block(fields.result());
  return w.result();
}
function readHeader(r: Reader) {
  if (!MAGIC.every((v) => r.byte() === v)) bad("expected SKEV signature");
  const major = r.u16(),
    minor = r.u16();
  if (major !== FILE_MAJOR)
    throw new Error(
      `SKEV version ${major}.${minor} is unsupported. Open this recording with a compatible version of Draw.`,
    );
  // A newer minor may append header and record fields. Their byte lengths delimit the known prefix.
  const length = r.uint(65536),
    flagAt = r.pos,
    fields = new Reader(r.raw(length));
  const flags = fields.u32(),
    created = fields.u64(),
    version = fields.text();
  return { flags, flagAt, created, version };
}
export const isProtectedHeader = (bytes: Uint8Array) => (readHeader(new Reader(bytes)).flags & 1) !== 0;
export function setProtection(bytes: Uint8Array, protectedFlag: boolean): void {
  const { flagAt } = readHeader(new Reader(bytes));
  bytes[flagAt] = (bytes[flagAt]! & ~1) | Number(protectedFlag);
}
export function metaChunk(meta: DrawMeta) {
  const w = new Writer();
  w.uint(meta.width);
  w.uint(meta.height);
  view(w, meta.view);
  w.byte(WIRE.paper[meta.paper]);
  w.byte(Number(meta.dark));
  w.u32(meta.seed);
  w.text(meta.author ?? "");
  w.text(meta.title ?? "");
  return packChunk(WIRE.chunk.meta, w.result());
}
function readMeta(r: Reader): DrawMeta {
  const width = r.uint(65536),
    height = r.uint(65536);
  if (!width || !height) bad("empty canvas");
  const camera = readView(r),
    paper = r.left ? readPaper(r) : "plain",
    dark = r.left ? r.byte() : 0,
    seed = r.left ? r.u32() : 0;
  if (dark > 1) bad("invalid theme");
  const author = r.left ? r.text() : "",
    title = r.left ? r.text() : "";
  return {
    width,
    height,
    view: camera,
    paper,
    dark: !!dark,
    seed,
    ...(author ? { author } : {}),
    ...(title ? { title } : {}),
  };
}
export async function snapshotChunk(snapshot: DrawSnapshot, table = new LayerTable()) {
  const w = new Writer();
  layers(w, snapshot.layers, context(table));
  layerId(w, table, snapshot.active);
  return packChunk(WIRE.chunk.snapshot, await transform(w.result(), false));
}
export async function eventsChunk(batch: readonly DrawEvent[], previous: number, table = new LayerTable()) {
  const w = new Writer(),
    ctx = context(table);
  w.uint(batch.length);
  for (const e of batch) {
    writeRecord(w, e, ctx, e.at - previous);
    previous = e.at;
  }
  return packChunk(WIRE.chunk.events, await transform(w.result(), false));
}
export function endChunk(duration: number, count: number) {
  const w = new Writer();
  w.uint(duration);
  w.uint(count);
  return packChunk(WIRE.chunk.end, w.result());
}

interface Frame {
  kind: number;
  start: number;
  payload: number;
  crc: number;
  end: number;
}
function frame(bytes: Uint8Array, start: number): Frame | null {
  const kind = bytes[start];
  if (kind === undefined) return null;
  let size = 0;
  for (let j = 0; j < 4; j++) {
    const byte = bytes[start + 1 + j];
    if (byte === undefined) return null;
    size += (byte & 127) * 128 ** j;
    if (byte < 128) {
      const payload = start + j + 2,
        crc = payload + size,
        end = crc + 4;
      return end <= bytes.length ? { kind, start, payload, crc, end } : null;
    }
  }
  return null;
}
function valid(bytes: Uint8Array, f: Frame) {
  const crc = new DataView(bytes.buffer, bytes.byteOffset + f.crc, 4).getUint32(0, true);
  return crc32(bytes.subarray(f.start, f.crc)) === crc;
}
function survivingChunk(bytes: Uint8Array, start: number) {
  // Any u8 can be the ID of a future chunk. A corrupt length can hide its boundary.
  const tail = bytes.subarray(start),
    view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let indexed: ReturnType<typeof indexedCrc32> | undefined;
  for (let at = tail.length - 6; at >= 0; at--) {
    const f = frame(tail, at);
    if (!f) continue;
    const actual = f.crc - at <= 64 ? crc32(tail.subarray(at, f.crc)) : (indexed ??= indexedCrc32(tail))(at, f.crc);
    if (actual === view.getUint32(f.crc, true)) return true;
  }
  return false;
}
export async function decodeRecording(bytes: Uint8Array, table = new LayerTable()): Promise<DrawRecording> {
  if (bytes.length > LIMITS.file) bad("file too large");
  const r = new Reader(bytes),
    header = readHeader(r),
    ctx = context(table);
  let meta: DrawMeta | null = null,
    initial: DrawSnapshot | null = null,
    declaredDuration = 0,
    count = 0,
    chunks = 0,
    ended = false,
    expanded = 0;
  const events: DrawEvent[] = [],
    time = { at: 0 };
  while (r.left) {
    const start = r.pos,
      f = frame(bytes, start);
    if (!f || !valid(bytes, f)) {
      const next = f && frame(bytes, f.end);
      if ((next && valid(bytes, next)) || survivingChunk(bytes, start + 1))
        bad("chunk CRC32 or length mismatch before an intact chunk");
      break;
    }
    r.pos = f.end;
    if (++chunks > LIMITS.chunks) bad("too many chunks");
    if (f.kind < WIRE.chunk.meta || f.kind > WIRE.chunk.end) continue;
    if (ended) bad("chunk after end");
    const data = bytes.subarray(f.payload, f.crc);
    if (data.length > LIMITS.chunk) bad("chunk too large");
    const packed = f.kind === WIRE.chunk.snapshot || f.kind === WIRE.chunk.events;
    const body = new Reader(
      packed ? await transform(data, true, Math.min(LIMITS.chunk, LIMITS.expanded - expanded)) : data,
    );
    expanded += body.left;
    if (expanded > LIMITS.expanded) bad("expanded file too large");
    if (f.kind === WIRE.chunk.meta) {
      if (meta) bad("duplicate metadata");
      meta = readMeta(body);
    } else if (!meta) bad("missing canvas metadata");
    else if (f.kind === WIRE.chunk.snapshot) {
      if (initial || count) bad("unexpected initial snapshot");
      const list = readLayers(body, ctx),
        active = body.left ? readId(body, table) : list[0]!.id;
      if (!list.some((l) => l.id === active)) bad("unknown active layer");
      initial = { layers: list, active };
    } else if (f.kind === WIRE.chunk.events) {
      const n = body.uint(ctx.budget.records);
      if (n > Math.floor(body.left / 3)) bad("invalid event count");
      count += n;
      for (let i = 0; i < n; i++) {
        const e = readRecord(body, ctx, false, time);
        if (e) events.push({ ...e, at: time.at });
      }
      if (body.left) bad("unexpected event batch suffix");
    } else {
      declaredDuration = body.uint();
      if (declaredDuration < time.at || body.uint() !== count) bad("inconsistent end marker");
      ended = true;
    }
  }
  if (!meta) return bad("missing canvas metadata");
  return {
    meta,
    initial,
    events,
    duration: ended ? declaredDuration : time.at,
    created: header.created,
    version: header.version,
    protected: !!(header.flags & 1),
  };
}
