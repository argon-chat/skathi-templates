import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { appWindow } from "@skathi-native/runtime";
import type { DrawAtomic, DrawMutation } from "./events";
import type { JournalEdit } from "./recordingChanges";
import { canonicalStroke, fraction16 } from "./precision";
import { upgradeRaster } from "./smudge";
import { BLEND_MODES, isColor, STRIDE, TOOLS, type Layer, type Stroke, type Tool } from "./model";

type Properties = Partial<Pick<Layer, "visible" | "alphaLocked" | "clipping" | "blendMode">>;
type Copies = NonNullable<Extract<DrawAtomic, { kind: "edit" }>["copies"]>;
type AtomicCommand =
  | { kind: "edit"; layer: string; removed: readonly Stroke[]; added: readonly Stroke[]; copies?: Copies }
  | { kind: "add-layer"; layer: Layer; index: number }
  | { kind: "delete-layer"; layer: Layer; index: number }
  | { kind: "move-layer"; from: number; to: number }
  | { kind: "rename-layer"; id: string; from: string; to: string }
  | { kind: "layer-opacity"; id: string; from: number; to: number }
  | { kind: "properties"; id: string; from: Properties; to: Properties }
  | { kind: "replace" | "clear"; before: readonly Layer[]; after: readonly Layer[] };
type Command = AtomicCommand | { kind: "group"; steps: readonly AtomicCommand[]; active: string; previous: string };

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
  revision?: number;
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
    (v.revision === undefined ||
      (typeof v.revision === "number" && Number.isSafeInteger(v.revision) && v.revision >= 0)) &&
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
  const open = indexedDB.open("skathi-draw-ink", 3);
  open.onupgradeneeded = (e) => {
    const db = open.result;
    if (e.oldVersion < 1) {
      db.createObjectStore("strokes");
      db.createObjectStore("document");
    }
    if (e.oldVersion < 2) db.createObjectStore("prefs");
    if (e.oldVersion < 3) db.createObjectStore("recordingOutbox");
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
  function atomic(c: AtomicCommand, forward: boolean, stroke: boolean): DrawAtomic {
    switch (c.kind) {
      case "edit": {
        if (stroke && forward) return { kind: "stroke", layer: c.layer, strokes: c.added };
        const copies = forward ? c.copies : undefined;
        const copied = new Set(copies?.map((copy) => copy.as));
        return {
          kind: "edit",
          layer: c.layer,
          removed: (forward ? c.removed : c.added).map((s) => s.seq),
          added: forward ? (copies ? c.added.filter((s) => !copied.has(s.seq)) : c.added) : c.removed,
          ...(copies?.length && { copies }),
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
  }
  function publish(c: Command, direction: "do" | "undo" | "redo", stroke = false) {
    emit?.(c, direction, () => {
      const forward = direction !== "undo";
      if (c.kind !== "group") return atomic(c, forward, stroke);
      const steps = forward ? c.steps : [...c.steps].reverse();
      return {
        kind: "group",
        changes: steps.map((step) => atomic(step, forward, false)),
        active: forward ? c.active : c.previous,
      };
    });
  }
  const layers = shallowRef<readonly Layer[]>([blank(1)]);
  const active = ref("layer-1");
  const ready = ref(false);
  const documentBusy = ref(false);
  const done = shallowRef<readonly Command[]>([]);
  const undone = shallowRef<readonly Command[]>([]);
  const canUndo = computed(() => done.value.length > 0);
  const canRedo = computed(() => undone.value.length > 0);
  const strokeCount = computed(() => layers.value.reduce((n, l) => n + l.strokes.length, 0));
  let seq = 1;
  let revision = 0;
  const unsaved = new Map<number, JournalEdit>();
  const acknowledged = new Map<number, number>();
  const pruned = new Map<number, number>();
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
  let closeWarning: ((message: string) => void) | undefined;
  let prefsTimer: ReturnType<typeof setTimeout> | undefined;
  let prefsValue: unknown;
  let loadedPrefs: unknown;

  const index = (id: string) => layers.value.findIndex((l) => l.id === id);

  function persist(write?: Write) {
    if (write?.kind === "wipe") writes = [];
    if (write) writes.push(write);
    documentChanged = true;
    if (timer === undefined) timer = setTimeout(() => void flush(), 400);
  }

  async function flush(): Promise<boolean> {
    clearTimeout(timer);
    timer = undefined;
    while (pending) await pending;
    if ((!documentChanged && !unsaved.size && !acknowledged.size) || !db) return !documentChanged;
    const batch = writes;
    const additions = [...unsaved.values()];
    const confirmations = [...acknowledged];
    unsaved.clear();
    acknowledged.clear();
    const doc: DocumentRecord = {
      version: 1,
      revision,
      layers: layers.value.map(({ strokes: _strokes, ...properties }) => ({
        ...properties,
        opacity: fraction16(properties.opacity),
      })),
      active: active.value,
      seq,
    };
    writes = [];
    documentChanged = false;
    const database = db;
    const write = new Promise<void>((resolve, reject) => {
      const tx = database.transaction(["strokes", "document", "recordingOutbox"], "readwrite");
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
      const journal = tx.objectStore("recordingOutbox");
      for (const edit of additions) journal.put(edit, [edit.generation, edit.revision]);
      for (const [generation, last] of confirmations)
        journal.delete(IDBKeyRange.bound([generation, 0], [generation, last]));
    }).then(
      () => true,
      () => {
        writes = [...batch, ...writes];
        for (const edit of additions) unsaved.set(edit.revision, edit);
        for (const [generation, last] of confirmations)
          acknowledged.set(generation, Math.max(last, acknowledged.get(generation) ?? 0));
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
    if (c.kind === "group") {
      const target = forward ? c.active : c.previous;
      for (const step of forward ? c.steps : [...c.steps].reverse()) apply(step, forward);
      selectLayer(target);
      return;
    }
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
    if (!ready.value || documentBusy.value) return;
    closeAfterFailedRetry = false;
    apply(c, true);
    done.value = [...done.value.slice(1 - HISTORY), c];
    undone.value = [];
    revision++;
    publish(c, "do", stroke);
  }

  function undo() {
    const c = done.value.at(-1);
    if (!c || documentBusy.value) return;
    apply(c, false);
    done.value = done.value.slice(0, -1);
    undone.value = [...undone.value, c];
    revision++;
    publish(c, "undo");
  }

  function redo() {
    const c = undone.value.at(-1);
    if (!c || documentBusy.value) return;
    apply(c, true);
    undone.value = undone.value.slice(0, -1);
    done.value = [...done.value, c];
    revision++;
    publish(c, "redo");
  }

  /** A stroke number, unique in this drawing and above every earlier one. */
  const nextSeq = () => seq++;

  /** Adds strokes to the active layer as one step: a stroke, or a stroke and its mirrored copies. */
  function addStrokes(strokes: readonly Stroke[], target = active.value) {
    const layer = layers.value[index(target)];
    if (layer?.visible && strokes.length && !documentBusy.value) {
      for (const stroke of strokes) seq = Math.max(seq, stroke.seq + 1);
      run({ kind: "edit", layer: layer.id, removed: [], added: strokes }, true);
    }
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
    const strokes = layer.strokes.map((s) => ({ ...s, seed: s.seed ?? s.seq, seq: nextSeq() }));
    const target = `layer-${n}`;
    run({
      kind: "group",
      active: target,
      previous: active.value,
      steps: [
        { kind: "add-layer", layer: { ...layer, id: target, name: `${layer.name} copy`, strokes: [] }, index: i + 1 },
        {
          kind: "edit",
          layer: target,
          removed: [],
          added: strokes,
          copies: layer.strokes.map((s, i) => ({ layer: id, seq: s.seq, as: strokes[i]!.seq })),
        },
      ],
    });
  }

  /**
   * Folds a layer into the one below it. Its strokes move over in order, above the lower layer's,
   * and keep their look: the layer's opacity is carried into each stroke.
   */
  function mergeDown(id: string, precomposited?: Layer) {
    const i = index(id);
    const upper = layers.value[i];
    const lower = layers.value[i - 1];
    if (!upper || !lower || (precomposited && precomposited.id !== lower.id)) return;
    const steps: AtomicCommand[] = [];
    if (precomposited) {
      const carried = precomposited.strokes;
      const before = new Set(lower.strokes),
        after = new Set(carried);
      const added = carried.filter((s) => !before.has(s));
      const removed = lower.strokes.filter((s) => !after.has(s));
      for (const s of added) seq = Math.max(seq, s.seq + 1);
      if (added.length || removed.length) steps.push({ kind: "edit", layer: lower.id, removed, added });
    } else {
      const separate =
        upper.strokes.some((s) => (s.tool === "eraser" || s.tool === "smudge") && !s.scope?.length) ||
        (upper.strokes[0]?.scope?.[0] !== undefined && upper.strokes[0].scope[0] === lower.strokes.at(-1)?.scope?.[0]);
      const group = seq;
      const added: Stroke[] = [],
        copies: Copies[number][] = [];
      const transfer = (s: Stroke, source: Layer, as: number, wrap: boolean) => {
        const opacity = fraction16((s.opacity ?? 1) * source.opacity);
        const scope = wrap ? [group, ...(s.scope ?? [])] : s.scope;
        const changes = { ...(opacity !== (s.opacity ?? 1) && { opacity }), ...(wrap && scope && { scope }) };
        added.push({ ...s, ...changes, seed: s.seed ?? s.seq, seq: as });
        copies.push({ layer: source.id, seq: s.seq, as, ...changes });
      };
      const removed = lower.opacity === 1 ? [] : lower.strokes;
      for (const s of removed) transfer(s, lower, s.seq, false);
      for (const s of upper.strokes) transfer(s, upper, nextSeq(), separate);
      if (added.length || removed.length) steps.push({ kind: "edit", layer: lower.id, removed, added, copies });
      if (lower.opacity !== 1) steps.push({ kind: "layer-opacity", id: lower.id, from: lower.opacity, to: 1 });
    }
    const properties = (l: Layer): Required<Properties> => ({
      visible: l.visible,
      alphaLocked: l.alphaLocked ?? false,
      clipping: l.clipping ?? false,
      blendMode: l.blendMode ?? "normal",
    });
    const from = properties(lower),
      to = precomposited ? properties(precomposited) : { ...from, visible: lower.visible || upper.visible };
    if (
      from.visible !== to.visible ||
      from.alphaLocked !== to.alphaLocked ||
      from.clipping !== to.clipping ||
      from.blendMode !== to.blendMode
    )
      steps.push({ kind: "properties", id: lower.id, from, to });
    if (precomposited && precomposited.opacity !== lower.opacity)
      steps.push({ kind: "layer-opacity", id: lower.id, from: lower.opacity, to: precomposited.opacity });
    if (precomposited && precomposited.name !== lower.name)
      steps.push({ kind: "rename-layer", id: lower.id, from: lower.name, to: precomposited.name });
    steps.push({ kind: "delete-layer", layer: upper, index: i });
    run({ kind: "group", steps, active: lower.id, previous: active.value });
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
    if (documentBusy.value) return;
    setLayers(layers.value.map((l) => (l.id === id ? { ...l, opacity } : l)));
  }

  function setOpacity(id: string, from: number, to: number) {
    from = fraction16(from);
    to = fraction16(to);
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
    if (documentBusy.value || index(id) < 0 || id === active.value) return;
    active.value = id;
    persist();
  }

  function replace(after: readonly Layer[]) {
    after = after.map((l) => {
      const opacity = fraction16(l.opacity);
      return l.opacity === opacity ? l : { ...l, opacity };
    });
    for (const l of after) for (const s of l.strokes) seq = Math.max(seq, s.seq + 1);
    run({ kind: "replace", before: layers.value, after });
  }

  function recoverDocument(after: readonly Layer[], activeId: string, lastRevision: number) {
    for (const l of after) for (const s of l.strokes) seq = Math.max(seq, s.seq + 1);
    apply({ kind: "replace", before: layers.value, after }, true);
    selectLayer(activeId);
    revision = lastRevision;
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
    const timeout = setTimeout(() => {
      closeAfterFailedRetry = true;
      closeWarning?.("Draw is still saving. Close again to leave before it finishes.");
    }, 3000);
    const save = async () => {
      for (;;) {
        if (closeAfterFailedRetry) return false;
        if (documentBusy.value) {
          await new Promise<void>((resolve) => setTimeout(resolve, 16));
          continue;
        }
        const at = revision;
        await flushExtra?.();
        if (!(await flush())) return false;
        if (!documentBusy.value && !documentChanged && at === revision) return true;
      }
    };
    void save()
      .then((ok) => {
        if (ok || !db) {
          closeApproved = true;
          appWindow.close();
        } else if (!closeAfterFailedRetry) {
          closeAfterFailedRetry = true;
          closeWarning?.("Draw could not finish saving. Close again to leave.");
        }
      })
      .catch(() => {
        closeAfterFailedRetry = true;
        closeWarning?.("Draw could not finish saving. Close again to leave.");
      })
      .finally(() => {
        clearTimeout(timeout);
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
    const upgrades: Write[] = [];
    let top = doc.seq;
    for (const row of rows) {
      if (!strokeRecord(row)) continue;
      const { layer, ...stroke } = row;
      const upgraded = await upgradeRaster(stroke);
      const canonical = canonicalStroke(upgraded);
      byLayer.get(layer)?.push(canonical);
      if (upgraded !== stroke && byLayer.has(layer)) upgrades.push({ kind: "put", layer, stroke: canonical });
      top = Math.max(top, stroke.seq + 1);
    }
    seq = top;
    revision = doc.revision ?? 0;
    layers.value = doc.layers.map((l) => ({
      ...l,
      opacity: fraction16(l.opacity ?? 1),
      strokes: byLayer.get(l.id)!.sort((a, b) => a.seq - b.seq),
    }));
    active.value = doc.layers.some((l) => l.id === doc.active) ? doc.active : doc.layers[0]!.id;
    if (upgrades.length) {
      writes.push(...upgrades);
      persist();
    }
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
    documentBusy,
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
    revision: () => revision,
    enqueue(edit: JournalEdit) {
      unsaved.set(edit.revision, edit);
      persist();
    },
    async journalEdits(generation: number, after: number): Promise<JournalEdit[]> {
      if (!db) return [...unsaved.values()].filter((e) => e.generation === generation && e.revision > after);
      if (!(await flush())) throw new Error("Draw could not save the document changes. Free some storage and retry.");
      const rows = await request(
        db
          .transaction("recordingOutbox")
          .objectStore("recordingOutbox")
          .getAll(IDBKeyRange.bound([generation, after + 1], [generation, Infinity])),
      );
      return rows.filter(
        (e): e is JournalEdit =>
          record(e) &&
          e.generation === generation &&
          Number.isSafeInteger(e.revision) &&
          typeof e.at === "number" &&
          Number.isFinite(e.at) &&
          record(e.action) &&
          typeof e.action.kind === "string",
      );
    },
    acknowledge(generation: number, last: number) {
      if ((pruned.get(generation) ?? -1) >= last) return;
      pruned.set(generation, last);
      for (const [n, edit] of unsaved) if (edit.generation === generation && n <= last) unsaved.delete(n);
      acknowledged.set(generation, Math.max(last, acknowledged.get(generation) ?? 0));
      persist();
    },
    onFlush(fn: () => Promise<void>, warning?: (message: string) => void) {
      flushExtra = fn;
      closeWarning = warning;
    },
    /** The settings stored last time, once `ready`; undefined when there were none. */
    prefs: () => loadedPrefs,
  };
}
