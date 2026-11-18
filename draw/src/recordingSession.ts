import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch, type ComputedRef } from "vue";
import type { DrawUi } from "./events";
import { PlaybackTimeline } from "./playbackTimeline";
import { decodeRecording, RECORDING_MIME } from "./events";
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
  const rec = new EventRecorder((e) => notify(e.message));
  const state = ref<RecordingState>("idle"),
    elapsed = ref(0),
    ready = ref(false),
    busy = ref(false);
  const protect = ref(false),
    title = ref(""),
    author = ref("");
  const active = computed(() => state.value === "paused" || state.value === "recording");
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
  let checkpointAt = 0;
  surface.enableInput(false);
  surface.onCancelDraft(() => rec.checkpoint(null));
  function sync() {
    state.value = rec.state;
    elapsed.value = rec.elapsed;
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
    if (rec.state === "paused") book.markPausedEdits(true);
    if (rec.state !== "recording") return;
    if (direction === "do") {
      known.add(command);
      rec.record(mutation());
    } else rec.record({ kind: direction, ...(!known.has(command) && { fallback: mutation() }) });
  });
  watch(ui, (state) => {
    if (!recovering && rec.state === "recording" && !originalView) rec.record({ kind: "ui", state });
  });
  const player = createPlayer({
    prepare: surface.preparePlayback,
    enter() {
      originalView = surface.getView();
      dismiss();
      surface.beginPlayback();
    },
    present(frame) {
      shown.value = frame;
      surface.present(frame.layers, frame.ui.dark ?? false, frame.ui.paper ?? "plain");
      const key =
        player.camera.value === "fit"
          ? [player.finalLayers.value, innerWidth, innerHeight]
          : [frame.view.x, frame.view.y, frame.view.angle, frame.view.zoom];
      if (key.length !== cameraKey.length || key.some((v, i) => v !== cameraKey[i])) {
        cameraKey = key;
        if (player.camera.value === "fit") surface.fitContent(player.finalLayers.value);
        else surface.setView(frame.view);
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
    },
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
      book.markPausedEdits(false);
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
      );
      rec.record({ kind: "ui", state: ui.value });
      dismiss();
    });
  const pause = () =>
    task(async () => {
      if (pendingView !== undefined) emitView();
      await Promise.all([rec.pause(), book.flush()]);
    });
  const resume = () =>
    task(async () => {
      await rec.resume();
      if (book.editedWhilePaused()) {
        known = new WeakSet();
        rec.record({ kind: "replace", layers: book.layers.value });
        await rec.flush();
        book.markPausedEdits(false);
      }
      rec.record({ kind: "ui", state: ui.value });
      emitView();
      dismiss();
    });
  const stop = () =>
    task(async () => {
      if (pendingView !== undefined) emitView();
      await Promise.all([rec.stop(), book.flush()]);
    });
  async function open(bytes: Uint8Array) {
    if (!ready.value || surface.painting()) throw new Error("Finish the current stroke before opening a recording.");
    if (active.value) throw new Error("Stop the current recording before opening another.");
    return player.open(bytes);
  }
  const types = [{ description: "Draw recording", accept: { [RECORDING_MIME]: [".skev"] } }];
  const loadFile = (file: File) =>
    task(async () => {
      await open(new Uint8Array(await file.arrayBuffer()));
    });
  const choose = () =>
    task(async () => {
      if (typeof showOpenFilePicker === "function") {
        const [file] = await showOpenFilePicker({ types, multiple: false });
        if (file) await open(new Uint8Array(await (await file.getFile()).arrayBuffer()));
      } else document.getElementById("record-file")?.click();
    });
  const save = () =>
    task(async () => {
      const filename = (title.value.trim() || "Drawing") + ".skev";
      const target =
        typeof showSaveFilePicker === "function"
          ? await showSaveFilePicker({ id: "draw-events", suggestedName: filename, types })
          : null;
      const blob = new Blob([await rec.bytes(protect.value)], { type: RECORDING_MIME });
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
    if (rec.state === "recording" || rec.state === "paused") {
      if (pendingView !== undefined) emitView();
      await rec.flush();
    }
  });
  onMounted(async () => {
    try {
      await rec.recover();
      protect.value = rec.protected;
      sync();
      if (!book.ready.value)
        await new Promise<void>((resolve) => {
          const unwatch = watch(book.ready, () => {
            unwatch();
            resolve();
          });
        });
      if (state.value === "recording" || state.value === "paused") {
        const last = new PlaybackTimeline(await decodeRecording(await rec.bytes())).final;
        if (state.value === "recording" || !book.editedWhilePaused()) {
          book.recoverDocument(last.layers, last.active);
          restore(last);
          surface.setView(last.view);
        }
      }
      ready.value = true;
      clock = setInterval(() => {
        if (rec.state !== "recording") return;
        elapsed.value = rec.elapsed;
        if (surface.painting() && performance.now() - checkpointAt >= 1750) {
          checkpointAt = performance.now();
          void surface
            .checkpoint()
            .then((stroke) => {
              if (stroke) rec.checkpoint(stroke);
            })
            .catch((e) => notify(String(e)));
        }
      }, 250);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Could not restore the recording.");
    } finally {
      recovering = false;
      surface.enableInput(true);
    }
  });
  onBeforeUnmount(() => {
    off();
    clearInterval(clock);
    clearTimeout(pendingView);
    player.exit();
  });
  return {
    state,
    elapsed,
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
