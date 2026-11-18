import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { appWindow } from "@skathi-native/runtime";
import type { DrawMutation } from "./events";
import { BLEND_MODES, isColor, STRIDE, TOOLS, type Layer, type Stroke, type Tool } from "./model";

type Properties = Partial<Pick<Layer, "visible" | "alphaLocked" | "clipping" | "blendMode">>;
type Command =
  | { kind: "edit"; layer: string; removed: readonly Stroke[]; added: readonly Stroke[] }
  | { kind: "add-layer"; layer: Layer; index: number }
  | { kind: "delete-layer"; layer: Layer; index: number }
  | { kind: "move-layer"; from: number; to: number }
  | { kind: "rename-layer"; id: string; from: string; to: string }
  | { kind: "layer-opacity"; id: string; from: number; to: number }
  | { kind: "properties"; id: string; from: Properties; to: Properties }
  | { kind: "replace" | "clear"; before: readonly Layer[]; after: readonly Layer[] };

type Write =
  | { kind: "put"; layer: string; stroke: Stroke }
  | { kind: "delete"; layer: string; seq: number }
  | { kind: "drop"; layer: string }
  | { kind: "wipe" };

interface StrokeRecord extends Stroke {
  layer: string;
}

interface DocumentRecord {
  version: 1;
  editedWhilePaused?: boolean;
  layers: (Omit<Layer, "strokes" | "opacity"> & { opacity?: number })[];
  active: string;
  seq: number;
}

const HISTORY = 200;

function record(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object";
}

const unit = (v: unknown) => v === undefined || (typeof v === "number" && v >= 0 && v <= 1);

function strokeRecord(v: unknown): v is StrokeRecord {
  return (
    record(v) &&
    typeof v.layer === "string" &&
    Number.isInteger(v.seq) &&
    TOOLS.includes(v.tool as Tool) &&
    isColor(v.color) &&
    typeof v.width === "number" &&
    v.width > 0 &&
    unit(v.opacity) &&
    (v.shape === undefined || typeof v.shape === "boolean") &&
    Array.isArray(v.points) &&
    v.points.length > 0 &&
    v.points.length % STRIDE === 0 &&
    v.points.every(Number.isFinite)
  );
}

function documentRecord(v: unknown): v is DocumentRecord {
  return (
    record(v) &&
    v.version === 1 &&
    typeof v.active === "string" &&
    Number.isInteger(v.seq) &&
    Array.isArray(v.layers) &&
    v.layers.length > 0 &&
    v.layers.every(
      (l: unknown) =>
        record(l) &&
        typeof l.id === "string" &&
        typeof l.name === "string" &&
        typeof l.visible === "boolean" &&
        unit(l.opacity) &&
        (l.blendMode === undefined || BLEND_MODES.some((m) => m === l.blendMode)) &&
        (l.clipping === undefined || typeof l.clipping === "boolean") &&
        (l.alphaLocked === undefined || typeof l.alphaLocked === "boolean"),
    )
  );
}

const request = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

function openBook(): Promise<IDBDatabase> {
  const open = indexedDB.open("skathi-draw-ink", 2);
  open.onupgradeneeded = (e) => {
    const db = open.result;
    if (e.oldVersion < 1) {
      db.createObjectStore("strokes");
      db.createObjectStore("document");
    }
    if (e.oldVersion < 2) db.createObjectStore("prefs");
  };
  return request(open);
}

const blank = (n: number): Layer => ({ id: `layer-${n}`, name: `Layer ${n}`, visible: true, opacity: 1, strokes: [] });

function bySeq(strokes: readonly Stroke[], removed: readonly Stroke[], added: readonly Stroke[]): Stroke[] {
  const gone = new Set(removed);
  const kept = gone.size ? strokes.filter((s) => !gone.has(s)) : [...strokes];
  const top = kept.at(-1)?.seq ?? -Infinity;
  if (added.every((s) => s.seq > top)) return kept.concat([...added].sort((a, b) => a.seq - b.seq));
  return kept.concat(added).sort((a, b) => a.seq - b.seq);
}

/** The drawing: its layers, undo history and an IndexedDB copy written a stroke at a time. */
export function useSketchbook() {
  let emit: ((command: object, direction: "do" | "undo" | "redo", mutation: () => DrawMutation) => void) | undefined;
  function publish(c: Command, direction: "do" | "undo" | "redo", stroke = false) {
    emit?.(c, direction, () => {
      const forward = direction !== "undo";
      switch (c.kind) {
        case "edit": {
          if (stroke && forward) return { kind: "stroke", layer: c.layer, strokes: c.added };
          return {
            kind: "edit",
            layer: c.layer,
            removed: (forward ? c.removed : c.added).map((s) => s.seq),
            added: forward ? c.added : c.removed,
          };
        }
        case "add-layer":
        case "delete-layer":
          return (c.kind === "add-layer") === forward
            ? { kind: "add-layer", layer: c.layer, index: c.index }
            : { kind: "delete-layer", id: c.layer.id };
        case "move-layer":
          return { kind: "move-layer", from: forward ? c.from : c.to, to: forward ? c.to : c.from };
        case "rename-layer":
          return { kind: "layer", id: c.id, changes: { name: forward ? c.to : c.from } };
        case "layer-opacity":
          return { kind: "layer", id: c.id, changes: { opacity: forward ? c.to : c.from } };
        case "properties":
          return { kind: "layer", id: c.id, changes: forward ? c.to : c.from };
        case "clear":
          return forward ? { kind: "clear" } : { kind: "replace", layers: c.before };
        case "replace":
          return { kind: "replace", layers: forward ? c.after : c.before };
      }
    });
  }
  const layers = shallowRef<readonly Layer[]>([blank(1)]);
  const active = ref("layer-1");
  const ready = ref(false);
  const done = shallowRef<readonly Command[]>([]);
  const undone = shallowRef<readonly Command[]>([]);
  const canUndo = computed(() => done.value.length > 0);
  const canRedo = computed(() => undone.value.length > 0);
  const strokeCount = computed(() => layers.value.reduce((n, l) => n + l.strokes.length, 0));
  let seq = 1;
  let editedWhilePaused = false;
  let db: IDBDatabase | undefined;
  let writes: Write[] = [];
  let documentChanged = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Promise<boolean> | undefined;
  let closed = false;
  let closeAfterFailedRetry = false;
  let closeApproved = false;
  let closingTask = false;
  let flushExtra: (() => Promise<void>) | undefined;
  let prefsTimer: ReturnType<typeof setTimeout> | undefined;
  let prefsValue: unknown;
  let loadedPrefs: unknown;

  const index = (id: string) => layers.value.findIndex((l) => l.id === id);
  const activeLayer = () => layers.value.find((l) => l.id === active.value);

  function persist(write?: Write) {
    if (write?.kind === "wipe") writes = [];
    if (write) writes.push(write);
    documentChanged = true;
    clearTimeout(timer);
    timer = setTimeout(() => void flush(), 400);
  }

  async function flush(): Promise<boolean> {
    clearTimeout(timer);
    while (pending) await pending;
    if (!documentChanged || !db) return !documentChanged;
    const batch = writes;
    const doc: DocumentRecord = {
      version: 1,
      editedWhilePaused,
      layers: layers.value.map(({ strokes: _strokes, ...properties }) => properties),
      active: active.value,
      seq,
    };
    writes = [];
    documentChanged = false;
    const database = db;
    const write = new Promise<void>((resolve, reject) => {
      const tx = database.transaction(["strokes", "document"], "readwrite");
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
      const strokes = tx.objectStore("strokes");
      for (const w of batch) {
        if (w.kind === "wipe") strokes.clear();
        else if (w.kind === "put") strokes.put({ ...w.stroke, layer: w.layer }, [w.layer, w.stroke.seq]);
        else if (w.kind === "delete") strokes.delete([w.layer, w.seq]);
        else strokes.delete(IDBKeyRange.bound([w.layer, -Infinity], [w.layer, Infinity]));
      }
      tx.objectStore("document").put(doc, "current");
    }).then(
      () => true,
      () => {
        writes = [...batch, ...writes];
        documentChanged = true;
        return false;
      },
    );
    pending = write;
    const ok = await write;
    if (pending === write) pending = undefined;
    return ok;
  }

  function setLayers(next: readonly Layer[]) {
    layers.value = next;
    if (!next.some((l) => l.id === active.value)) active.value = next.at(-1)?.id ?? "";
  }

  function apply(c: Command, forward: boolean) {
    const list = [...layers.value];
    switch (c.kind) {
      case "edit": {
        const i = index(c.layer);
        const layer = list[i];
        if (!layer) return;
        const [removed, added] = forward ? [c.removed, c.added] : [c.added, c.removed];
        list[i] = { ...layer, strokes: bySeq(layer.strokes, removed, added) };
        for (const s of removed) persist({ kind: "delete", layer: c.layer, seq: s.seq });
        for (const stroke of added) persist({ kind: "put", layer: c.layer, stroke });
        break;
      }
      case "add-layer":
      case "delete-layer": {
        const adding = (c.kind === "add-layer") === forward;
        if (adding) {
          list.splice(c.index, 0, c.layer);
          active.value = c.layer.id;
          for (const stroke of c.layer.strokes) persist({ kind: "put", layer: c.layer.id, stroke });
        } else {
          list.splice(c.index, 1);
          if (active.value === c.layer.id) active.value = list[Math.max(0, c.index - 1)]?.id ?? "";
          persist({ kind: "drop", layer: c.layer.id });
        }
        persist();
        break;
      }
      case "move-layer": {
        const [from, to] = forward ? [c.from, c.to] : [c.to, c.from];
        list.splice(to, 0, ...list.splice(from, 1));
        persist();
        break;
      }
      case "rename-layer":
      case "layer-opacity": {
        const i = index(c.id);
        const layer = list[i];
        if (layer && c.kind === "rename-layer") list[i] = { ...layer, name: forward ? c.to : c.from };
        if (layer && c.kind === "layer-opacity") list[i] = { ...layer, opacity: forward ? c.to : c.from };
        persist();
        break;
      }
      case "properties": {
        const i = index(c.id);
        if (list[i]) list[i] = { ...list[i]!, ...(forward ? c.to : c.from) };
        persist();
        break;
      }
      case "clear":
      case "replace": {
        const next = forward ? c.after : c.before;
        persist({ kind: "wipe" });
        for (const layer of next) for (const stroke of layer.strokes) persist({ kind: "put", layer: layer.id, stroke });
        const keep = next.some((l) => l.id === active.value);
        setLayers(next);
        if (!keep) active.value = next.at(-1)?.id ?? "";
        return;
      }
    }
    setLayers(list);
  }

  function run(c: Command, stroke = false) {
    if (!ready.value) return;
    closeAfterFailedRetry = false;
    apply(c, true);
    done.value = [...done.value.slice(1 - HISTORY), c];
    undone.value = [];
    publish(c, "do", stroke);
  }

  function undo() {
    const c = done.value.at(-1);
    if (!c) return;
    apply(c, false);
    done.value = done.value.slice(0, -1);
    undone.value = [...undone.value, c];
    publish(c, "undo");
  }

  function redo() {
    const c = undone.value.at(-1);
    if (!c) return;
    apply(c, true);
    undone.value = undone.value.slice(0, -1);
    done.value = [...done.value, c];
    publish(c, "redo");
  }

  /** A stroke number, unique in this drawing and above every earlier one. */
  const nextSeq = () => seq++;

  /** Adds strokes to the active layer as one step: a stroke, or a stroke and its mirrored copies. */
  function addStrokes(strokes: readonly Stroke[]) {
    const layer = activeLayer();
    if (layer?.visible && strokes.length) run({ kind: "edit", layer: layer.id, removed: [], added: strokes }, true);
  }

  /** Replaces `removed` with `added` in one layer, as one step. */
  function edit(layer: string, removed: readonly Stroke[], added: readonly Stroke[]) {
    if (index(layer) >= 0 && (removed.length || added.length)) run({ kind: "edit", layer, removed, added });
  }

  function addLayer() {
    let n = layers.value.length + 1;
    while (layers.value.some((l) => l.id === `layer-${n}`)) n++;
    run({ kind: "add-layer", layer: blank(n), index: index(active.value) + 1 });
  }

  function duplicateLayer(id: string) {
    const i = index(id);
    const layer = layers.value[i];
    if (!layer) return;
    let n = layers.value.length + 1;
    while (layers.value.some((l) => l.id === `layer-${n}`)) n++;
    const strokes = layer.strokes.map((s) => ({ ...s, seq: nextSeq() }));
    run({
      kind: "add-layer",
      layer: { ...layer, id: `layer-${n}`, name: `${layer.name} copy`, strokes },
      index: i + 1,
    });
  }

  /**
   * Folds a layer into the one below it. Its strokes move over in order, above the lower layer's,
   * and keep their look: the layer's opacity is carried into each stroke.
   */
  function mergeDown(id: string) {
    const i = index(id);
    const upper = layers.value[i];
    const lower = layers.value[i - 1];
    if (!upper || !lower) return;
    const carried = upper.strokes.map((s) => ({
      ...s,
      seq: nextSeq(),
      opacity: Math.min(1, (s.opacity ?? 1) * (upper.opacity / Math.max(lower.opacity, 1e-3))),
    }));
    const merged: Layer = {
      ...lower,
      visible: lower.visible || upper.visible,
      strokes: [...lower.strokes, ...carried],
    };
    const after = layers.value.filter((l) => l !== upper).map((l) => (l === lower ? merged : l));
    run({ kind: "replace", before: layers.value, after });
    active.value = lower.id;
  }

  function deleteLayer(id: string) {
    const i = index(id);
    const layer = layers.value[i];
    if (layer && layers.value.length > 1) run({ kind: "delete-layer", layer, index: i });
  }

  function moveLayer(id: string, to: number) {
    const from = index(id);
    if (from >= 0 && to >= 0 && to < layers.value.length && to !== from) run({ kind: "move-layer", from, to });
  }

  function renameLayer(id: string, name: string) {
    const layer = layers.value[index(id)];
    const to = name.trim();
    if (layer && to && to !== layer.name) run({ kind: "rename-layer", id, from: layer.name, to });
  }

  /** Shows `opacity` on the layer while a slider moves, without a step in the history. */
  function previewOpacity(id: string, opacity: number) {
    setLayers(layers.value.map((l) => (l.id === id ? { ...l, opacity } : l)));
  }

  function setOpacity(id: string, from: number, to: number) {
    if (from === to) return previewOpacity(id, to);
    previewOpacity(id, from);
    run({ kind: "layer-opacity", id, from, to });
  }

  function toggleLayer(id: string) {
    const l = layers.value[index(id)];
    if (l) setProperties(id, { visible: !l.visible });
  }

  function setProperties(id: string, to: Properties) {
    const l = layers.value[index(id)];
    if (!l) return;
    const from: Properties = {};
    if (to.visible !== undefined) from.visible = l.visible;
    if (to.clipping !== undefined) from.clipping = l.clipping ?? false;
    if (to.alphaLocked !== undefined) from.alphaLocked = l.alphaLocked ?? false;
    if (to.blendMode !== undefined) from.blendMode = l.blendMode ?? "normal";
    run({ kind: "properties", id, to, from });
  }

  function selectLayer(id: string) {
    if (index(id) < 0 || id === active.value) return;
    active.value = id;
    persist();
  }

  function replace(after: readonly Layer[]) {
    for (const l of after) for (const s of l.strokes) seq = Math.max(seq, s.seq + 1);
    run({ kind: "replace", before: layers.value, after });
  }

  function recoverDocument(after: readonly Layer[], activeId: string) {
    for (const l of after) for (const s of l.strokes) seq = Math.max(seq, s.seq + 1);
    apply({ kind: "replace", before: layers.value, after }, true);
    selectLayer(activeId);
    done.value = [];
    undone.value = [];
  }

  function clear() {
    if (strokeCount.value)
      run({ kind: "clear", before: layers.value, after: layers.value.map((l) => ({ ...l, strokes: [] })) });
  }

  /** App settings kept beside the drawing, written a moment after the last change. */
  function savePrefs(value: unknown) {
    prefsValue = value;
    clearTimeout(prefsTimer);
    prefsTimer = setTimeout(writePrefs, 300);
  }

  function writePrefs() {
    clearTimeout(prefsTimer);
    if (!db || prefsValue === undefined) return;
    try {
      db.transaction("prefs", "readwrite").objectStore("prefs").put(prefsValue, "current");
      prefsValue = undefined;
    } catch {}
  }

  function closing(event: Event) {
    writePrefs();
    if (closeApproved || closeAfterFailedRetry) return;
    event.preventDefault();
    if (closingTask) return;
    closingTask = true;
    void Promise.all([flush(), flushExtra?.()])
      .then(([ok]) => {
        if (ok || !db) {
          closeApproved = true;
          appWindow.close();
        } else closeAfterFailedRetry = true;
      })
      .catch(() => {
        closeAfterFailedRetry = true;
      })
      .finally(() => {
        closingTask = false;
      });
  }

  async function load(database: IDBDatabase) {
    const tx = database.transaction(["strokes", "document", "prefs"]);
    const [doc, rows, prefs] = await Promise.all([
      request(tx.objectStore("document").get("current")),
      request(tx.objectStore("strokes").getAll()),
      request(tx.objectStore("prefs").get("current")),
    ]);
    loadedPrefs = prefs;
    if (!documentRecord(doc)) return;
    const byLayer = new Map<string, Stroke[]>(doc.layers.map((l) => [l.id, []]));
    let top = doc.seq;
    for (const row of rows) {
      if (!strokeRecord(row)) continue;
      const { layer, ...stroke } = row;
      byLayer.get(layer)?.push(stroke);
      top = Math.max(top, stroke.seq + 1);
    }
    seq = top;
    editedWhilePaused = doc.editedWhilePaused === true;
    layers.value = doc.layers.map((l) => ({
      ...l,
      opacity: l.opacity ?? 1,
      strokes: byLayer.get(l.id)!.sort((a, b) => a.seq - b.seq),
    }));
    active.value = doc.layers.some((l) => l.id === doc.active) ? doc.active : doc.layers[0]!.id;
  }

  onMounted(async () => {
    try {
      db = await openBook();
      if (closed) {
        db.close();
        return;
      }
      await load(db);
    } catch {
      db?.close();
      db = undefined;
    } finally {
      ready.value = true;
    }
  });

  appWindow.addEventListener("close-requested", closing);
  onBeforeUnmount(() => {
    closed = true;
    appWindow.removeEventListener("close-requested", closing);
    writePrefs();
    void flush().finally(() => db?.close());
  });

  return {
    layers,
    active,
    ready,
    canUndo,
    canRedo,
    strokeCount,
    nextSeq,
    addStrokes,
    edit,
    addLayer,
    duplicateLayer,
    mergeDown,
    deleteLayer,
    moveLayer,
    renameLayer,
    previewOpacity,
    setOpacity,
    toggleLayer,
    setProperties,
    onCommand(fn: NonNullable<typeof emit>) {
      emit = fn;
    },
    selectLayer,
    replace,
    recoverDocument,
    clear,
    undo,
    redo,
    flush,
    savePrefs,
    editedWhilePaused: () => editedWhilePaused,
    markPausedEdits(value: boolean) {
      if (editedWhilePaused !== value) {
        editedWhilePaused = value;
        persist();
      }
    },
    onFlush(fn: () => Promise<void>) {
      flushExtra = fn;
    },
    /** The settings stored last time, once `ready`; undefined when there were none. */
    prefs: () => loadedPrefs,
  };
}
