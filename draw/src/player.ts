import { nextTick, ref, shallowRef } from "vue";
import { decodeRecording, type DrawRecording } from "./events";
import { clamp, type Layer } from "./model";
import { PlaybackTimeline, type PlayerFrame } from "./playbackTimeline";

export type { PlayerFrame } from "./playbackTimeline";

export interface PlayOptions {
  speed?: number;
  fitTo?: number;
  compressPausesTo?: number;
  camera?: "author" | "fit";
  hideUi?: boolean;
  showUndone?: boolean;
}

export interface DrawPlaybackApi {
  open(bytes: Uint8Array): Promise<{ duration: number; events: number }>;
  play(options?: PlayOptions): Promise<void>;
  seek(ms: number): Promise<void>;
  pause(): void;
}

interface Output {
  prepare?(file: DrawRecording, current: () => boolean): Promise<void>;
  settled?(): Promise<void>;
  enter?(): void;
  present(frame: PlayerFrame): void;
  close(continueDrawing: boolean, frame: PlayerFrame): void;
}

export function createPlayer(output: Output) {
  const loaded = ref(false);
  const playing = ref(false);
  const position = ref(0);
  const duration = ref(0);
  const count = ref(0);
  const eventCount = ref(0);
  const title = ref("");
  const viewOnly = ref(false);
  const speed = ref(1);
  const compressPausesTo = ref(1);
  const showCursor = ref(true);
  const showUndone = ref(true);
  const camera = ref<"author" | "fit">("author");
  const hideUi = ref(false);
  const density = shallowRef<number[]>([]);
  const finalLayers = shallowRef<readonly Layer[]>([]);
  let timeline: PlaybackTimeline | null = null;
  let current: PlayerFrame | null = null;
  let raf = 0;
  let opening = 0;
  let pending: { promise: Promise<void>; resolve: () => void; reject: (e: unknown) => void } | undefined;

  function stopClock() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    playing.value = false;
  }

  function pause() {
    stopClock();
    pending?.resolve();
    pending = undefined;
  }

  function display(ms: number, event?: number) {
    if (!timeline) return;
    const at = clamp(ms, 0, duration.value);
    position.value = at;
    count.value = event ?? timeline.count(at);
    current = timeline.frame(at, showUndone.value, count.value);
    output.present(!showCursor.value && current.cursor ? { ...current, cursor: null } : current);
  }

  function abandon() {
    stopClock();
    pending?.reject(new DOMException("Playback closed before the end.", "AbortError"));
    pending = undefined;
  }

  async function open(bytes: Uint8Array) {
    const id = ++opening;
    const isCurrent = () => id === opening;
    const file = await decodeRecording(bytes);
    if (!isCurrent()) throw new DOMException("Another recording was opened.", "AbortError");
    const next = new PlaybackTimeline(file);
    if (output.prepare) {
      await output.prepare(file, isCurrent);
      if (!isCurrent()) throw new DOMException("The recording was replaced or closed.", "AbortError");
    }
    abandon();
    if (!loaded.value) output.enter?.();
    timeline = next;
    loaded.value = true;
    eventCount.value = file.events.length;
    duration.value = file.duration;
    viewOnly.value = file.protected;
    title.value = file.meta.title || "Drawing replay";
    hideUi.value = false;
    finalLayers.value = next.final.layers;
    density.value = next.density;
    display(0);
    await nextTick();
    await output.settled?.();
    return { duration: file.duration, events: file.events.length };
  }

  function finish() {
    stopClock();
    const ended = pending;
    pending = undefined;
    void nextTick()
      .then(() => output.settled?.())
      .then(
        () => ended?.resolve(),
        (e) => ended?.reject(e),
      );
  }

  async function seek(ms: number) {
    if (!timeline) throw new Error("Open a drawing recording first.");
    if (!Number.isFinite(ms)) throw new Error("Seek time must be a finite number of milliseconds.");
    pause();
    display(ms);
    if (position.value === duration.value) finish();
    await nextTick();
    await output.settled?.();
  }

  function step() {
    if (!timeline) return;
    pause();
    const e = timeline.file.events[count.value];
    if (!e) {
      void seek(duration.value);
      return;
    }
    display(e.at, count.value + 1);
    if (count.value === eventCount.value && position.value === duration.value) finish();
  }

  function configure(options: PlayOptions) {
    if (options.speed !== undefined && !(options.speed > 0)) throw new Error("Playback speed must be positive.");
    if (options.compressPausesTo !== undefined && !(options.compressPausesTo >= 0))
      throw new Error("Maximum pause must be zero or more seconds.");
    if (options.fitTo !== undefined && (!Number.isFinite(options.fitTo) || options.fitTo <= 0))
      throw new Error("Playback length must be a positive number of seconds.");
    if (options.speed !== undefined) speed.value = options.speed;
    if (options.compressPausesTo !== undefined) compressPausesTo.value = options.compressPausesTo;
    if (options.camera !== undefined) camera.value = options.camera;
    if (options.showUndone !== undefined) showUndone.value = options.showUndone;
    if (options.hideUi !== undefined) hideUi.value = options.hideUi;
  }

  async function play(options: PlayOptions = {}) {
    if (!timeline) throw new Error("Open a drawing recording first.");
    configure(options);
    stopClock();
    if (position.value >= duration.value || options.fitTo !== undefined) display(0);
    else display(position.value);
    if (!pending) {
      let resolve!: () => void;
      let reject!: (error: unknown) => void;
      const promise = new Promise<void>((ok, fail) => {
        resolve = ok;
        reject = fail;
      });
      pending = { promise, resolve, reject };
    }
    const result = pending.promise;
    const clock = timeline.clock(
      compressPausesTo.value * 1000,
      options.fitTo === undefined ? undefined : options.fitTo * 1000,
    );
    const rate = options.fitTo === undefined ? speed.value : 1;
    if ((!duration.value && options.fitTo === undefined) || !Number.isFinite(rate) || !clock.duration) {
      display(duration.value);
      finish();
      return result;
    }
    const offset = clock.played(position.value);
    const start = performance.now();
    playing.value = true;
    const tick = () => {
      if (!playing.value) return;
      try {
        const time = offset + (performance.now() - start) * rate;
        if (time >= clock.duration) {
          display(duration.value);
          finish();
        } else {
          display(clock.raw(time));
          raf = requestAnimationFrame(tick);
        }
      } catch (e) {
        stopClock();
        pending?.reject(e);
        pending = undefined;
      }
    };
    raf = requestAnimationFrame(tick);
    return result;
  }

  function change(options: PlayOptions) {
    if (playing.value) void play(options).catch(() => {});
    else {
      configure(options);
      display(position.value, count.value);
    }
  }

  function toggleCursor() {
    showCursor.value = !showCursor.value;
    display(position.value, count.value);
  }

  function exit(continueDrawing = false) {
    if (continueDrawing && viewOnly.value) return;
    opening++;
    if (!current) return;
    abandon();
    loaded.value = false;
    hideUi.value = false;
    output.close(continueDrawing, current);
    current = null;
    timeline = null;
    finalLayers.value = [];
    density.value = [];
  }

  return {
    open,
    play,
    seek,
    pause,
    step,
    exit,
    continueDrawing: () => exit(true),
    change,
    toggleCursor,
    loaded,
    playing,
    position,
    duration,
    eventCount,
    count,
    speed,
    hideUi,
    camera,
    showCursor,
    showUndone,
    compressPausesTo,
    density,
    title,
    viewOnly,
    finalLayers,
  };
}

export type DrawPlayer = ReturnType<typeof createPlayer>;
