import type { DrawAction, DrawAtomic, DrawMutation, DrawUi } from "./events";
import type { Layer, Symmetry } from "./model";
import { Reader, Writer, bad, LIMITS } from "./eventBinary";
import { WIRE } from "./eventIds";
import {
  chargeCopy,
  enumerate,
  layer,
  readLayer,
  layerId,
  readId,
  layers,
  readLayers,
  view,
  readView,
  color,
  readColor,
  ratio,
  readRatio,
  strokes,
  readStrokes,
  readPaper,
  readBlend,
  type Context,
} from "./eventDrawing";
type Action<K extends DrawAction["kind"]> = Extract<DrawAction, { kind: K }>;
type Write<K extends DrawAction["kind"]> = (w: Writer, e: Action<K>, ctx: Context) => void;
type Read<K extends DrawAction["kind"]> = (r: Reader, ctx: Context) => Action<K>;
function codec<K extends DrawAction["kind"]>(kind: K, fields: string, write: Write<K>, read: Read<K>) {
  return {
    id: WIRE.event[kind],
    fields,
    write(w: Writer, e: DrawAction, ctx: Context) {
      if (e.kind !== kind) bad("event type mismatch");
      write(w, e as Action<K>, ctx);
    },
    read,
  };
}
const b = (r: Reader) => {
  const n = r.byte();
  if (n > 1) bad("invalid boolean");
  return n === 1;
};
function writeEdit(w: Writer, e: Action<"edit">, ctx: Context) {
  layerId(w, ctx.table, e.layer);
  w.uint(e.removed.length);
  for (const seq of e.removed) w.uint(seq);
  strokes(w, e.added);
  const copies = e.copies ?? [];
  w.uint(copies.length);
  for (const copy of copies) {
    layerId(w, ctx.table, copy.layer);
    w.uint(copy.seq);
    w.uint(copy.as);
    w.byte(Number(copy.opacity !== undefined) | (Number(!!copy.scope) << 1));
    if (copy.opacity !== undefined) ratio(w, copy.opacity);
    if (copy.scope) {
      w.uint(copy.scope.length);
      for (const id of copy.scope) w.uint(id);
    }
  }
}
function readEdit(r: Reader, ctx: Context): Action<"edit"> {
  const id = readId(r, ctx.table),
    count = r.uint(Math.min(ctx.budget.removed, LIMITS.strokes));
  if (count > r.left) bad("invalid removed count");
  ctx.budget.removed -= count;
  const removed: number[] = [];
  for (let i = 0; i < count; i++) removed.push(r.uint(0xffffffff));
  const added = r.left ? readStrokes(r, ctx) : [],
    n = r.left ? r.uint(ctx.budget.copies) : 0;
  if (n * 4 > r.left) bad("invalid copy count");
  ctx.budget.copies -= n;
  const copies: NonNullable<Action<"edit">["copies"]>[number][] = [];
  for (let i = 0; i < n; i++) {
    const layer = readId(r, ctx.table),
      seq = r.uint(0xffffffff),
      as = r.uint(0xffffffff),
      flags = r.byte();
    const copy: NonNullable<Action<"edit">["copies"]>[number] = { layer, seq, as };
    if (flags & 1) copy.opacity = readRatio(r);
    if (flags & 2) {
      copy.scope = [];
      const size = r.uint(16);
      for (let j = 0; j < size; j++) copy.scope.push(r.uint(0xffffffff));
    }
    chargeCopy(ctx, seq, as);
    copies.push(copy);
  }
  return { kind: "edit", layer: id, removed, added, ...(n ? { copies } : {}) };
}
function writeProperties(w: Writer, e: Action<"layer">, ctx: Context) {
  layerId(w, ctx.table, e.id);
  const p = e.changes;
  w.byte(
    Number(p.name !== undefined) |
      (Number(p.visible !== undefined) << 1) |
      (Number(p.opacity !== undefined) << 2) |
      (Number(p.blendMode !== undefined) << 3) |
      (Number(p.clipping !== undefined) << 4) |
      (Number(p.alphaLocked !== undefined) << 5),
  );
  if (p.name !== undefined) w.text(p.name);
  if (p.visible !== undefined) w.byte(Number(p.visible));
  if (p.opacity !== undefined) ratio(w, p.opacity);
  if (p.blendMode !== undefined) w.byte(WIRE.blend[p.blendMode]);
  if (p.clipping !== undefined) w.byte(Number(p.clipping));
  if (p.alphaLocked !== undefined) w.byte(Number(p.alphaLocked));
}
function readProperties(r: Reader, ctx: Context): Action<"layer"> {
  const id = readId(r, ctx.table),
    mask = r.left ? r.byte() : 0;
  const changes: Partial<Omit<Layer, "id" | "strokes">> = {};
  if (mask & 1) changes.name = r.text();
  if (mask & 2) changes.visible = b(r);
  if (mask & 4) changes.opacity = readRatio(r);
  if (mask & 8) changes.blendMode = readBlend(r);
  if (mask & 16) changes.clipping = b(r);
  if (mask & 32) changes.alphaLocked = b(r);
  return { kind: "layer", id, changes };
}
function writeSymmetry(w: Writer, s: Symmetry | null) {
  w.byte(s ? 1 : 0);
  if (s) {
    w.byte(Number(s.mirror));
    w.byte(s.segments);
    w.float(s.x);
    w.float(s.y);
  }
}
function readSymmetry(r: Reader): Symmetry | null {
  if (!b(r)) return null;
  const mirror = b(r),
    segments = r.byte();
  if (segments < 1 || segments > 12) bad("invalid symmetry");
  return { mirror, segments, x: r.float(), y: r.float() };
}
function writeUi(w: Writer, e: Action<"ui">, ctx: Context) {
  const s = e.state;
  w.byte(
    Number(s.mode !== undefined) |
      (Number(s.color !== undefined) << 1) |
      (Number(s.size !== undefined) << 2) |
      (Number(s.active !== undefined) << 3) |
      (Number(s.paper !== undefined) << 4) |
      (Number(s.dark !== undefined) << 5) |
      (Number(s.symmetry !== undefined) << 6) |
      (Number(s.shape !== undefined) << 7),
  );
  if (s.mode !== undefined) w.byte(WIRE.mode[s.mode]);
  if (s.color !== undefined) color(w, s.color);
  if (s.size !== undefined) w.float(s.size);
  if (s.active !== undefined) layerId(w, ctx.table, s.active);
  if (s.paper !== undefined) w.byte(WIRE.paper[s.paper]);
  if (s.dark !== undefined) w.byte(Number(s.dark));
  if (s.symmetry !== undefined) writeSymmetry(w, s.symmetry);
  if (s.shape !== undefined) w.byte(WIRE.shape[s.shape]);
}
function readUi(r: Reader, ctx: Context): Action<"ui"> {
  const s: DrawUi = {},
    mask = r.left ? r.byte() : 0;
  if (mask & 1) s.mode = enumerate(WIRE.mode, r.byte());
  if (mask & 2) s.color = readColor(r);
  if (mask & 4) {
    s.size = r.float();
    if (s.size <= 0) bad("invalid brush size");
  }
  if (mask & 8) s.active = readId(r, ctx.table);
  if (mask & 16) s.paper = readPaper(r);
  if (mask & 32) s.dark = b(r);
  if (mask & 64) s.symmetry = readSymmetry(r);
  if (mask & 128) s.shape = enumerate(WIRE.shape, r.byte());
  return { kind: "ui", state: s };
}
function writeHistory(w: Writer, e: Action<"undo"> | Action<"redo">, ctx: Context) {
  w.byte(Number(!!e.fallback));
  if (e.fallback) writeRecord(w, e.fallback, ctx);
}
function readHistory(r: Reader, ctx: Context): { fallback?: DrawMutation } {
  if (!r.left || !b(r)) return {};
  const e = readRecord(r, ctx);
  if (!e) return {};
  if (e.kind === "undo" || e.kind === "redo" || e.kind === "view" || e.kind === "ui")
    return bad("invalid history fallback");
  return { fallback: e };
}
function readGroup(r: Reader, ctx: Context): Action<"group"> {
  const n = r.uint(4096);
  if (n * 2 > r.left) bad("invalid group length");
  const changes: DrawAtomic[] = [];
  for (let i = 0; i < n; i++) {
    const m = readRecord(r, ctx, true);
    if (!m) continue;
    if (m.kind === "undo" || m.kind === "redo" || m.kind === "group" || m.kind === "ui" || m.kind === "view")
      bad("unexpected group member");
    else changes.push(m);
  }
  return { kind: "group", changes, ...(r.left && b(r) ? { active: readId(r, ctx.table) } : {}) };
}
// Each record has a u8 ID and a byte length. Top-level payloads start with dt. Absent trailing extensions use the defaults below.
export const EVENT_SCHEMA = {
  stroke: codec(
    "stroke",
    "layer:symbol, count:varuint; each stroke is length-prefixed: seq:varuint, tool:u8, color:tag/RGB, width:f64, opacity:u16=1, spray(density:u16=.55,scatter:u16=.5) or airbrush(hardness:u16=.25,density:u16=.55), seed:u32=seq, flags:u8(shape,alphaLock,contours,patch,scope), points:columns, contours:xyColumns[]?, patch:(x:i16grid,y:i16grid,w:varuint,h:varuint,flags:u8,light:PNG,dark:PNG?,coverage:PNG?,transform:f64[6]?)?, scope:seq[]?",
    (w, e, c) => {
      layerId(w, c.table, e.layer);
      strokes(w, e.strokes);
    },
    (r, c) => {
      const id = readId(r, c.table),
        list = readStrokes(r, c);
      if (!list.length) bad("empty stroke group");
      return { kind: "stroke", layer: id, strokes: list };
    },
  ),
  edit: codec(
    "edit",
    "layer:symbol, removed:seq[], added:stroke[]=[], copies:(layer,seq,as,flags,opacity?,scope?)[]=[]",
    writeEdit,
    readEdit,
  ),
  "add-layer": codec(
    "add-layer",
    "index:varuint, layer:layer",
    (w, e, c) => {
      w.uint(e.index);
      layer(w, e.layer, c);
    },
    (r, c) => {
      const index = r.uint(LIMITS.layers);
      return { kind: "add-layer", index, layer: readLayer(r, c) };
    },
  ),
  "delete-layer": codec(
    "delete-layer",
    "id:symbol",
    (w, e, c) => layerId(w, c.table, e.id),
    (r, c) => ({ kind: "delete-layer", id: readId(r, c.table) }),
  ),
  "move-layer": codec(
    "move-layer",
    "from:varuint, to:varuint",
    (w, e) => {
      w.uint(e.from);
      w.uint(e.to);
    },
    (r) => ({ kind: "move-layer", from: r.uint(LIMITS.layers), to: r.uint(LIMITS.layers) }),
  ),
  layer: codec(
    "layer",
    "id:symbol, mask:u8=0, name:utf8?,visible:u8?,opacity:u16?,blend:u8?,clip:u8?,alphaLock:u8?",
    writeProperties,
    readProperties,
  ),
  replace: codec(
    "replace",
    "layers:layer[]",
    (w, e, c) => layers(w, e.layers, c),
    (r, c) => ({ kind: "replace", layers: readLayers(r, c) }),
  ),
  clear: codec(
    "clear",
    "",
    () => {},
    () => ({ kind: "clear" }),
  ),
  undo: codec("undo", "hasFallback:u8=0, fallback:record?", writeHistory, (r, c) => ({
    kind: "undo",
    ...readHistory(r, c),
  })),
  redo: codec("redo", "hasFallback:u8=0, fallback:record?", writeHistory, (r, c) => ({
    kind: "redo",
    ...readHistory(r, c),
  })),
  ui: codec(
    "ui",
    "mask:u8=0, mode:u8?,color:tag/RGB?,size:f64?,active:symbol?,paper:u8?,dark:u8?,symmetry:(present,mirror,segments,x:f64,y:f64)?,shape:u8?",
    writeUi,
    readUi,
  ),
  view: codec(
    "view",
    "zoom:f64=1, angle:f64=0, x:f64=0, y:f64=0",
    (w, e) => view(w, e.view),
    (r) => ({ kind: "view", view: readView(r) }),
  ),
  group: codec(
    "group",
    "changes:record[], hasActive:u8=0, active:symbol?",
    (w, e, c) => {
      w.uint(e.changes.length);
      for (const m of e.changes) writeRecord(w, m, c);
      w.byte(Number(e.active !== undefined));
      if (e.active !== undefined) layerId(w, c.table, e.active);
    },
    readGroup,
  ),
};
export function writeRecord(w: Writer, e: DrawAction, ctx: Context, dt?: number) {
  const row = new Writer();
  if (dt !== undefined) row.uint(dt);
  const schema = EVENT_SCHEMA[e.kind];
  schema.write(row, e, ctx);
  w.byte(schema.id);
  w.block(row.result());
}
const readers = new Map<number, (r: Reader, c: Context) => DrawAction>(
  Object.values(EVENT_SCHEMA).map((s) => [s.id, s.read]),
);
export function readRecord(
  r: Reader,
  ctx: Context,
  atomicOnly = false,
  timeline?: { at: number },
): DrawAction | undefined {
  if (--ctx.budget.records < 0) bad("event budget exceeded");
  const id = r.byte(),
    row = r.child();
  if (timeline) {
    timeline.at += row.uint();
    if (!Number.isSafeInteger(timeline.at)) bad("invalid event time");
  }
  if (!timeline && (id === WIRE.event.undo || id === WIRE.event.redo || (atomicOnly && id === WIRE.event.group)))
    bad("recursive event");
  return readers.get(id)?.(row, ctx);
}
