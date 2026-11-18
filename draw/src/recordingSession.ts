import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch, type ComputedRef } from "vue";
import { PlaybackTimeline } from "./playbackTimeline";
import { decodeRecording, RECORDING_MIME, type DrawUi } from "./events";
import { reconcileDrawing, uiChanges, type JournalEdit } from "./recordingChanges";
import { LIMITS } from "./eventBinary";
import { EventRecorder, type RecordingState } from "./recorder";
import { createPlayer, type PlayerFrame } from "./player";
import type { View } from "./renderer";
import type { useSketchbook } from "./sketchbook";
import type { useSurface } from "./surface";

interface Options {
  book: ReturnType<typeof useSketchbook>;
  surface: ReturnType<typeof useSurface>;
  ui: ComputedRef<DrawUi>;
  notify(message: string): void;
  dismiss(): void;
  restore(frame: PlayerFrame): void;
}

export function useRecordingSession({ book, surface, ui, notify, dismiss, restore }: Options) {
  const rec = new EventRecorder(
    (e) => {
      sync();
      notify(e.message);
    },
    (generation, revision) => book.acknowledge(generation, revision),
  );
  const state = ref<RecordingState>("idle"),
    elapsed = ref(0),
    ready = ref(false),
    busy = ref(false);
  const protect = ref(false),
    title = ref(""),
    author = ref("");
  const active = computed(() => state.value === "paused" || state.value === "recording" || state.value === "error");
  const error = ref("");
  const stamp = computed(() => {
    const sec = Math.floor(elapsed.value / 1000);
    return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0");
  });
  const shown = shallowRef<PlayerFrame | null>(null);
  const cursor = shallowRef<{ x: number; y: number; r: number; label: string; color: string } | null>(null);
  let known = new WeakSet<object>();
  let cameraKey: readonly unknown[] = [];
  let originalView: View | null = null;
  let clock: ReturnType<typeof setInterval> | undefined;
  let pendingView: ReturnType<typeof setTimeout> | undefined;
  let previousView = -Infinity;
  let recovering = true;
  let initialized!: () => void;
  const initialization = new Promise<void>((resolve) => {
    initialized = resolve;
  });
  let checkpointAt = 0;
  let gesture = 0;
  let recordedUi: DrawUi = {};
  surface.enableInput(false);
  surface.onCancelDraft(() => {
    gesture++;
    rec.checkpoint(null);
  });
  function sync() {
    state.value = rec.state;
    elapsed.value = rec.elapsed;
    error.value = rec.error;
  }
  function emitView() {
    clearTimeout(pendingView);
    pendingView = undefined;
    if (rec.state !== "recording" || shown.value) return;
    rec.record({ kind: "view", view: surface.getView() });
    previousView = performance.now();
  }
  const off = surface.onView(() => {
    if (recovering || rec.state !== "recording" || originalView || pendingView !== undefined) return;
    const wait = 100 - (performance.now() - previousView);
    if (wait <= 0) emitView();
    else pendingView = setTimeout(emitView, wait);
  });
  book.onCommand((command, direction, mutation) => {
    if (rec.state !== "recording" && rec.state !== "paused") return;
    let action =
      direction === "do" ? mutation() : { kind: direction, ...(!known.has(command) && { fallback: mutation() }) };
    if (direction === "do") known.add(command);
    if (rec.state !== "recording" && action.kind === "stroke")
      action = { kind: "edit", layer: action.layer, added: action.strokes, removed: [] };
    const edit: JournalEdit = { generation: rec.generation, revision: book.revision(), at: rec.elapsed, action };
    book.enqueue(edit);
    rec.record(action, edit.revision, edit.at);
  });
  function publishUi(state: DrawUi) {
    for (const delta of uiChanges(recordedUi, state)) rec.record({ kind: "ui", state: delta });
    recordedUi = { ...state, ...(state.symmetry && { symmetry: { ...state.symmetry } }) };
  }
  watch(ui, (state) => {
    if (!recovering && rec.state === "recording" && !originalView) publishUi(state);
  });
  watch(
    protect,
    (value) => {
      if (!recovering && rec.generation)
        void rec.setProtected(value).catch((e) => {
          sync();
          notify(String(e));
        });
    },
    { flush: "sync" },
  );
  let authorWidth = 1,
    authorHeight = 1;
  function resized() {
    requestAnimationFrame(() => {
      if (shown.value) present(shown.value);
    });
  }
  function present(frame: PlayerFrame) {
    shown.value = frame;
    surface.present(frame.layers, frame.ui.dark ?? false, frame.ui.paper ?? "plain");
    const key =
      player.camera.value === "fit"
        ? [player.finalLayers.value, innerWidth, innerHeight]
        : [frame.view.x, frame.view.y, frame.view.angle, frame.view.zoom, innerWidth, innerHeight];
    if (key.length !== cameraKey.length || key.some((v, i) => v !== cameraKey[i])) {
      cameraKey = key;
      if (player.camera.value === "fit") surface.fitContent(player.finalLayers.value, 0);
      else {
        const scale = Math.min(innerWidth / authorWidth, innerHeight / authorHeight);
        surface.setView({
          angle: frame.view.angle,
          zoom: frame.view.zoom * scale,
          x: frame.view.x * scale + (innerWidth - authorWidth * scale) / 2,
          y: frame.view.y * scale + (innerHeight - authorHeight * scale) / 2,
        });
      }
    }
    const p = frame.cursor;
    cursor.value = p
      ? {
          ...surface.toScreen(p.x, p.y),
          r: Math.max(3, (p.width * surface.zoom.value) / 2),
          label: p.tool,
          color: p.color === "ink" ? (frame.ui.dark ? "#f2f2f4" : "#1c1c1e") : p.color,
        }
      : null;
  }
  const player = createPlayer({
    settled: surface.rastersReady,
    async prepare(file, isCurrent) {
      await surface.preparePlayback(file, isCurrent);
      if (isCurrent()) {
        authorWidth = file.meta.width;
        authorHeight = file.meta.height;
        cameraKey = [];
      }
    },
    enter() {
      originalView = surface.getView();
      dismiss();
      surface.beginPlayback();
    },
    present,
    close(keep, frame) {
      shown.value = null;
      cursor.value = null;
      cameraKey = [];
      if (keep) {
        book.replace(frame.layers);
        book.selectLayer(frame.active);
        restore(frame);
      } else if (originalView) surface.setView(originalView);
      originalView = null;
      surface.endPlayback();
    },
  });
  async function task(fn: () => Promise<void>) {
    if (busy.value) return;
    busy.value = true;
    try {
      await fn();
    } catch (e) {
      if ((e as { name?: unknown })?.name !== "AbortError")
        notify(e instanceof Error ? e.message : "The recording could not be opened or saved.");
    } finally {
      sync();
      busy.value = false;
    }
  }
  const start = () =>
    task(async () => {
      const { layers, active } = book;
      const first = layers.value[0];
      const empty =
        layers.value.length === 1 &&
        first?.id === "layer-1" &&
        first.name === "Layer 1" &&
        first.visible &&
        first.opacity === 1 &&
        !first.clipping &&
        !first.alphaLocked &&
        (!first.blendMode || first.blendMode === "normal") &&
        !first.strokes.length;
      known = new WeakSet();
      recordedUi = { paper: ui.value.paper ?? "plain", dark: ui.value.dark ?? false, active: active.value };
      await rec.start(
        {
          width: innerWidth,
          height: innerHeight,
          view: surface.getView(),
          paper: ui.value.paper ?? "plain",
          dark: ui.value.dark ?? false,
          seed: 1,
          ...(title.value && { title: title.value }),
          ...(author.value && { author: author.value }),
        },
        empty ? null : { layers: layers.value, active: active.value },
        protect.value,
        book.revision(),
      );
      publishUi(ui.value);
      dismiss();
    });
  const pause = () =>
    task(async () => {
      if (pendingView !== undefined) emitView();
      await Promise.all([rec.pause(), book.flush()]);
    });
  const resume = () =>
    task(async () => {
      if (book.documentBusy.value) throw new Error("Finish the current paint operation before resuming.");
      book.documentBusy.value = true;
      try {
        await rec.resume(await pendingEdits());
      } finally {
        book.documentBusy.value = false;
      }
      publishUi(ui.value);
      emitView();
      dismiss();
    });
  const stop = () =>
    task(async () => {
      if (pendingView !== undefined) emitView();
      await Promise.all([rec.stop(), book.flush()]);
      book.acknowledge(rec.generation, book.revision());
    });
  async function open(bytes: Uint8Array) {
    await initialization;
    if (surface.painting()) throw new Error("Finish the current stroke before opening a recording.");
    if (active.value) throw new Error("Stop the current recording before opening another.");
    return player.open(bytes);
  }
  const types = [{ description: "Draw recording", accept: { [RECORDING_MIME]: [".skev"] } }];
  async function openFile(file: File) {
    if (file.size > LIMITS.file) throw new Error("This recording exceeds the playback size limit.");
    await open(new Uint8Array(await file.arrayBuffer()));
  }
  const loadFile = (file: File) => task(() => openFile(file));
  const choose = () =>
    task(async () => {
      if (typeof showOpenFilePicker === "function") {
        const [file] = await showOpenFilePicker({ types, multiple: false });
        if (file) await openFile(await file.getFile());
      } else document.getElementById("record-file")?.click();
    });
  const save = () =>
    task(async () => {
      const filename = (title.value.trim() || "Drawing") + ".skev";
      const target =
        typeof showSaveFilePicker === "function"
          ? await showSaveFilePicker({ id: "draw-events", suggestedName: filename, types })
          : null;
      const data = await rec.bytes(protect.value);
      new PlaybackTimeline(await decodeRecording(data));
      const blob = new Blob([data], { type: RECORDING_MIME });
      if (target) {
        const writer = await target.createWritable();
        try {
          await writer.write(blob);
          await writer.close();
        } catch (e) {
          await writer.abort().catch(() => {});
          throw e;
        }
      } else {
        const a = document.createElement("a"),
          url = URL.createObjectURL(blob);
        a.setAttribute("href", url);
        a.setAttribute("download", filename);
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      }
      notify("Saved " + (target?.name ?? filename));
    });
  const preview = () =>
    task(async () => {
      await open(await rec.bytes(protect.value));
    });
  function drop(e: DragEvent) {
    const f = e.dataTransfer?.files[0];
    if (f?.name.toLowerCase().endsWith(".skev")) {
      e.preventDefault();
      void loadFile(f);
    }
  }
  function fileInput(e: Event) {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    if (f) void loadFile(f);
    input.value = "";
  }
  book.onFlush(async () => {
    if (rec.state !== "idle" && rec.state !== "error") {
      if (pendingView !== undefined) emitView();
      await rec.flush();
    }
  }, notify);
  async function pendingEdits(): Promise<JournalEdit[]> {
    const saved = rec.savedDocumentRevision;
    const rows = await book.journalEdits(rec.generation, saved);
    if (
      book.revision() <= saved ||
      (rows.length === book.revision() - saved && rows.every((e, i) => e.revision === saved + i + 1))
    )
      return rows;
    const last = new PlaybackTimeline(await rec.readDocument()).final;
    known = new WeakSet();
    return [
      {
        generation: rec.generation,
        revision: book.revision(),
        at: rec.elapsed,
        action: reconcileDrawing(last.layers, book.layers.value, book.active.value),
      },
    ];
  }
  async function reconcile() {
    if (rec.state !== "paused" && rec.state !== "recording") return;
    const saved = rec.savedDocumentRevision;
    const last = new PlaybackTimeline(await rec.readDocument()).final;
    recordedUi = last.ui;
    if (book.revision() < saved) {
      book.recoverDocument(last.layers, last.active, saved);
      await book.flush();
    }
    if (book.revision() === saved && rec.state === "recording") {
      restore(last);
      surface.setView(last.view);
    }
    book.acknowledge(rec.generation, saved);
    if (rec.state === "recording") {
      const edits = await pendingEdits();
      for (const edit of edits) rec.record(edit.action, edit.revision, edit.at);
      if (edits.length) await rec.flush();
      const stroke = await rec.interruptedStroke(book.revision());
      if (stroke) {
        book.addStrokes(stroke.strokes, stroke.layer);
        await Promise.all([book.flush(), rec.flush()]);
      }
      publishUi(ui.value);
    }
  }
  const retry = () =>
    task(async () => {
      if (await rec.retry()) {
        known = new WeakSet();
        protect.value = rec.protected;
        title.value = rec.metadata?.title ?? "";
        author.value = rec.metadata?.author ?? "";
      }
      try {
        await reconcile();
      } catch (e) {
        rec.fail(e);
        throw e;
      }
      sync();
    });
  onMounted(async () => {
    addEventListener("resize", resized);
    try {
      await rec.recover();
      protect.value = rec.protected;
      title.value = rec.metadata?.title ?? "";
      author.value = rec.metadata?.author ?? "";
      sync();
      if (!book.ready.value)
        await new Promise<void>((resolve) => {
          const unwatch = watch(book.ready, () => {
            unwatch();
            resolve();
          });
        });
      await reconcile();
    } catch (e) {
      rec.fail(e);
      sync();
      notify(e instanceof Error ? e.message : "Could not restore the recording.");
    } finally {
      ready.value = true;
      clock = setInterval(() => {
        if (rec.state !== "recording") return;
        elapsed.value = rec.elapsed;
        if (surface.painting() && performance.now() - checkpointAt >= 1750) {
          checkpointAt = performance.now();
          const revision = book.revision(),
            generation = gesture;
          void surface
            .checkpoint()
            .then((stroke) => {
              if (stroke && generation === gesture && book.revision() === revision && surface.painting())
                rec.checkpoint(stroke, revision);
            })
            .catch((e) => notify(String(e)));
        }
      }, 250);
      recovering = false;
      initialized();
      surface.enableInput(true);
    }
  });
  onBeforeUnmount(() => {
    removeEventListener("resize", resized);
    off();
    clearInterval(clock);
    clearTimeout(pendingView);
    player.exit();
  });
  return {
    state,
    error,
    retry,
    stamp,
    ready,
    busy,
    active,
    protect,
    title,
    author,
    player,
    shown,
    cursor,
    start,
    pause,
    resume,
    stop,
    choose,
    save,
    preview,
    drop,
    fileInput,
    open,
  };
}
