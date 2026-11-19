import type { DrawAction, DrawAtomic, DrawEvent, DrawRecording, DrawSnapshot, DrawUi } from "./events";
import { LIMITS } from "./eventBinary";
import { clamp, isTool, STRIDE, type Layer, type Stroke, type Tool } from "./model";
import type { View } from "./renderer";

export interface PlayerFrame extends DrawSnapshot {
  ui: DrawUi;
  view: View;
  cursor: { x: number; y: number; width: number; tool: Stroke["tool"]; color: string } | null;
}

/** The editor controls a replay shows: the recorded tool state and the last drawing tool. */
export interface EditorState {
  at: number;
  ui: DrawUi;
  tool: Tool;
}

const EDITOR_FIELDS = ["mode", "shape", "color", "size", "active"] as const;
type EditorField = (typeof EDITOR_FIELDS)[number];

type Atomic = DrawAtomic | { kind: "restore-properties"; layer: Layer };
type Mutation = Atomic | { kind: "group"; changes: readonly Atomic[]; active?: string };
type Change = Mutation | Extract<DrawAction, { kind: "ui" | "view" }>;
type Step = { change: Change; command?: number; forward?: boolean };
const layerLimit = () =>
  new Error(
    `A recording can contain up to ${LIMITS.layers} simultaneous layers. Start a new recording with fewer layers.`,
  );

class Drawing {
  layers: Layer[];
  active: string;
  ui: DrawUi;
  view: View;
  private writable = new Map<readonly Stroke[], Stroke[]>();
  private published: readonly Layer[] | null;

  constructor(frame: PlayerFrame) {
    if (frame.layers.length > LIMITS.layers) throw layerLimit();
    this.layers = [...frame.layers];
    this.published = frame.layers;
    this.active = frame.active;
    this.ui = frame.ui;
    this.view = frame.view;
  }

  frame(): PlayerFrame {
    this.writable.clear();
    this.published ??= [...this.layers];
    return { layers: this.published, active: this.active, ui: this.ui, view: this.view, cursor: null };
  }

  apply(change: Change, inverse = false): Mutation | undefined {
    if (change.kind !== "ui" && change.kind !== "view") this.published = null;
    switch (change.kind) {
      case "group": {
        const active = this.active;
        const reverse: Atomic[] = [];
        for (const member of change.changes) {
          const back = this.apply(member, inverse);
          if (back && back.kind !== "group") reverse.push(back);
        }
        const target = change.active ?? active;
        if (this.layers.some((l) => l.id === target)) this.active = target;
        if (inverse) return { kind: "group", changes: reverse.reverse(), active };
        break;
      }
      case "ui":
        this.ui = { ...this.ui, ...change.state };
        if (change.state.active && this.layers.some((l) => l.id === change.state.active))
          this.active = change.state.active;
        break;
      case "view":
        this.view = change.view;
        break;
      case "stroke":
      case "edit": {
        const i = this.layers.findIndex((layer) => layer.id === change.layer);
        const layer = this.layers[i];
        if (!layer) break;
        let added = change.kind === "stroke" ? change.strokes : change.added;
        if (change.kind === "edit" && change.copies?.length) {
          const sources = new Map<string, Map<number, Stroke>>();
          const copies = change.copies.map((copy) => {
            let strokes = sources.get(copy.layer);
            if (!strokes) {
              strokes = new Map(this.layers.find((l) => l.id === copy.layer)?.strokes.map((s) => [s.seq, s]));
              sources.set(copy.layer, strokes);
            }
            const original = strokes.get(copy.seq);
            if (!original) throw new Error("Invalid recording: copied stroke is missing.");
            return {
              ...original,
              seed: original.seed ?? original.seq,
              seq: copy.as,
              ...(copy.opacity !== undefined && { opacity: copy.opacity }),
              ...(copy.scope && { scope: copy.scope }),
            };
          });
          added = [...added, ...copies];
        }
        const removed = change.kind === "edit" && change.removed.length ? new Set(change.removed) : null;
        let strokes = this.writable.get(layer.strokes);
        const old: Stroke[] = [];
        if (removed) {
          this.writable.delete(layer.strokes);
          strokes = layer.strokes.filter((s) => {
            if (!removed.has(s.seq)) return true;
            if (inverse) old.push(s);
            return false;
          });
        }
        if (!strokes) strokes = [...layer.strokes];
        if (strokes !== layer.strokes) {
          this.layers[i] = { ...layer, strokes };
          this.writable.set(strokes, strokes);
        }
        let top = strokes.at(-1)?.seq ?? -Infinity;
        let sort = false;
        for (const s of added) {
          if (s.seq < top) sort = true;
          strokes.push(s);
          top = s.seq;
        }
        if (sort) strokes.sort((a, b) => a.seq - b.seq);
        if (inverse) return { kind: "edit", layer: change.layer, removed: added.map((s) => s.seq), added: old };
        break;
      }
      case "add-layer":
        if (this.layers.length >= LIMITS.layers) throw layerLimit();
        if (this.layers.some((l) => l.id === change.layer.id)) throw new Error("Invalid recording: duplicate layer.");
        this.layers.splice(change.index, 0, change.layer);
        this.active = change.layer.id;
        if (inverse) return { kind: "delete-layer", id: change.layer.id };
        break;
      case "delete-layer": {
        const i = this.layers.findIndex((l) => l.id === change.id);
        if (i < 0) break;
        const layer = this.layers.splice(i, 1)[0]!;
        this.writable.delete(layer.strokes);
        if (this.active === change.id) this.active = this.layers[Math.max(0, i - 1)]?.id ?? "";
        if (inverse) return { kind: "add-layer", layer, index: i };
        break;
      }
      case "move-layer": {
        if (this.layers[change.from]) this.layers.splice(change.to, 0, ...this.layers.splice(change.from, 1));
        if (inverse) return { kind: "move-layer", from: change.to, to: change.from };
        break;
      }
      case "layer":
      case "restore-properties": {
        const id = change.kind === "layer" ? change.id : change.layer.id;
        const i = this.layers.findIndex((l) => l.id === id);
        const layer = this.layers[i];
        if (!layer) break;
        this.layers[i] =
          change.kind === "layer" ? { ...layer, ...change.changes } : { ...change.layer, strokes: layer.strokes };
        if (inverse) return { kind: "restore-properties", layer: { ...layer, strokes: [] } };
        break;
      }
      case "replace":
      case "clear": {
        if (change.kind === "replace" && change.layers.length > LIMITS.layers) throw layerLimit();
        const before = this.layers;
        this.layers = change.kind === "replace" ? [...change.layers] : before.map((l) => ({ ...l, strokes: [] }));
        this.writable.clear();
        if (!this.layers.some((l) => l.id === this.active)) this.active = this.layers.at(-1)?.id ?? "";
        if (inverse) return { kind: "replace", layers: before };
        break;
      }
    }
    return undefined;
  }
}

function initialFrame(file: DrawRecording): PlayerFrame {
  const first = file.initial ?? {
    layers: [{ id: "layer-1", name: "Layer 1", visible: true, opacity: 1, strokes: [] }],
    active: "layer-1",
  };
  return { ...first, ui: { paper: file.meta.paper, dark: file.meta.dark }, view: file.meta.view, cursor: null };
}

function indexActions(events: readonly DrawEvent[], initial: PlayerFrame, period: number) {
  const steps: (Step | undefined)[] = [];
  const checkpoints = [initial];
  const drawing = new Drawing(initial);
  const lastActivation = new Map<number, number>();
  const done: { id: number; forward: Mutation; reverse: Mutation; external?: boolean }[] = [];
  const undone: typeof done = [];
  for (const [i, e] of events.entries()) {
    let step: Step | undefined;
    if (e.kind === "undo" || e.kind === "redo") {
      const undo = e.kind === "undo";
      const stack = undo ? done : undone;
      // A fallback identifies an editor command outside the recorded history, including edits made on pause.
      const command = !e.fallback || stack.at(-1)?.external ? stack.pop() : undefined;
      if (command) {
        const change = e.fallback ?? (undo ? command.reverse : command.forward);
        drawing.apply(change);
        (undo ? undone : done).push(command);
        step = command.external ? { change } : { change, command: command.id, forward: !undo };
        if (!command.external) lastActivation.set(command.id, undo ? -1 : i);
      } else if (e.fallback) {
        const reverse = drawing.apply(e.fallback, true);
        if (reverse) {
          const command = {
            id: i,
            forward: undo ? reverse : e.fallback,
            reverse: undo ? e.fallback : reverse,
            external: true,
          };
          (undo ? undone : done).push(command);
        }
        // A pre-recording command already contributed pixels to the opening snapshot.
        step = { change: e.fallback };
      }
    } else if (e.kind === "ui" || e.kind === "view") {
      drawing.apply(e);
      step = { change: e };
    } else {
      const reverse = drawing.apply(e, true);
      if (reverse) {
        done.push({ id: i, forward: e, reverse });
        undone.length = 0;
      }
      step = { change: e, command: i, forward: true };
    }
    steps.push(step);
    if ((i + 1) % period === 0) checkpoints.push(drawing.frame());
  }
  return { steps, lastActivation, checkpoints, final: drawing.frame() };
}

function upperBound<T>(items: readonly T[], target: number, value: (v: T) => number) {
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (value(items[mid]!) <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function editorAt(track: readonly EditorState[], at: number): EditorState | null {
  return track[upperBound(track, at, (s) => s.at) - 1] ?? null;
}

function span(s: Stroke) {
  return Math.max(0, (s.points.at(-1) ?? 0) - (s.points[STRIDE - 1] ?? 0));
}

function prefix(s: Stroke, elapsed: number): Stroke | null {
  const p = s.points;
  if (!p.length || elapsed < 0) return null;
  const time = p[STRIDE - 1]! + elapsed;
  if (time >= p.at(-1)!) return s;
  let lo = 0;
  let hi = p.length / STRIDE;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (p[mid * STRIDE + STRIDE - 1]! <= time) lo = mid + 1;
    else hi = mid;
  }
  const n = lo * STRIDE;
  const points = p.slice(0, n);
  const u = (time - p[n - 1]!) / (p[n + STRIDE - 1]! - p[n - 1]!);
  if (u > 0) {
    for (let i = 0; i < STRIDE; i++) points.push(p[n - STRIDE + i]! + (p[n + i]! - p[n - STRIDE + i]!) * u);
  }
  return { ...s, points };
}

export class PlaybackTimeline {
  readonly final: PlayerFrame;
  readonly density: number[];
  private readonly index;
  private readonly period: number;
  private readonly strokes;
  private hiddenCheckpoints: PlayerFrame[] | null = null;
  private cache: { count: number; showUndone: boolean; frame: PlayerFrame } | null = null;

  constructor(readonly file: DrawRecording) {
    const initial = initialFrame(file);
    // With both histories cached, at most 48 distinct keyframe stroke lists per layer per history.
    this.period = Math.max(128, Math.ceil(file.events.length / 48));
    this.index = indexActions(file.events, initial, this.period);
    this.final = this.index.final;
    this.density = new Array<number>(64).fill(0);
    let last = 0;
    this.strokes = file.events.flatMap((e, index) => {
      const bin = Math.min(
        this.density.length - 1,
        Math.floor((e.at / Math.max(1, file.duration)) * this.density.length),
      );
      this.density[bin] = this.density[bin]! + 1;
      if (e.kind !== "stroke") return [];
      const duration = e.strokes.reduce((max, s) => Math.max(span(s), max), 0);
      const start = Math.max(last, e.at - duration, 0);
      last = e.at;
      return [{ index, start, end: e.at, duration, event: e }];
    });
  }

  private included(i: number, showUndone: boolean) {
    const step = this.index.steps[i];
    if (!step) return undefined;
    if (!showUndone && step.command !== undefined) {
      const final = this.index.lastActivation.get(step.command);
      if (final !== undefined && (final !== i || !step.forward)) return undefined;
    }
    return step.change;
  }

  private keyframes(showUndone: boolean) {
    if (showUndone || !this.index.lastActivation.size) return this.index.checkpoints;
    if (this.hiddenCheckpoints) return this.hiddenCheckpoints;
    const checkpoints = [this.index.checkpoints[0]!];
    const drawing = new Drawing(checkpoints[0]!);
    for (let i = 0; i < this.index.steps.length; i++) {
      const change = this.included(i, false);
      if (change) drawing.apply(change);
      if ((i + 1) % this.period === 0) checkpoints.push(drawing.frame());
    }
    this.hiddenCheckpoints = checkpoints;
    return checkpoints;
  }

  count(at: number) {
    return upperBound(this.file.events, at, (e) => e.at);
  }

  /**
   * The editor state over the replay, per field: a value whose strokes were all undone is dropped
   * unless `showUndone`, and so is one held for less than `hold` ms of `played` time.
   */
  editorTrack(showUndone: boolean, played: (raw: number) => number, hold: number): EditorState[] {
    type Run = { at: number; value: DrawUi[EditorField]; drawn: boolean; visible: boolean };
    const runs = new Map<EditorField, Run[]>(EDITOR_FIELDS.map((field) => [field, []]));
    for (const [i, e] of this.file.events.entries()) {
      if (e.kind === "ui") {
        for (const [field, list] of runs) {
          const value = e.state[field];
          if (value !== undefined) list.push({ at: e.at, value, drawn: false, visible: false });
        }
      } else if (e.kind === "stroke") {
        const visible = this.included(i, showUndone) !== undefined;
        for (const list of runs.values()) {
          const run = list.at(-1);
          if (!run) continue;
          run.drawn = true;
          run.visible ||= visible;
        }
      }
    }
    const initial: DrawUi = {};
    const changes: { at: number; field: EditorField; value: Run["value"] }[] = [];
    for (const [field, list] of runs) {
      const used = list.filter((run) => run.visible || !run.drawn);
      let last: Run["value"];
      for (const [i, run] of used.entries()) {
        const end = used[i + 1]?.at ?? this.file.duration;
        if (played(end) - played(run.at) < hold || run.value === last) continue;
        if (last === undefined) Object.assign(initial, { [field]: run.value });
        else changes.push({ at: run.at, field, value: run.value });
        last = run.value;
      }
    }
    changes.sort((a, b) => a.at - b.at);
    let tool: Tool = isTool(initial.mode) ? initial.mode : "pen";
    const track: EditorState[] = [{ at: -Infinity, ui: initial, tool }];
    for (const change of changes) {
      const previous = track.at(-1)!;
      const ui: DrawUi = Object.assign({ ...previous.ui }, { [change.field]: change.value });
      if (isTool(ui.mode)) tool = ui.mode;
      const next = { at: change.at, ui, tool };
      if (previous.at === change.at) track[track.length - 1] = next;
      else track.push(next);
    }
    return track;
  }

  frame(at: number, showUndone: boolean, count = this.count(at)): PlayerFrame {
    const checkpoints = this.keyframes(showUndone);
    const k = Math.floor(count / this.period);
    let start = k * this.period;
    let base = checkpoints[k]!;
    if (this.cache?.showUndone === showUndone && this.cache.count >= start && this.cache.count <= count) {
      start = this.cache.count;
      base = this.cache.frame;
    }
    if (start < count) {
      const drawing = new Drawing(base);
      for (let i = start; i < count; i++) {
        const change = this.included(i, showUndone);
        if (change) drawing.apply(change);
      }
      base = drawing.frame();
    }
    this.cache = { count, showUndone, frame: base };
    const stroke = this.strokes[upperBound(this.strokes, at, (s) => s.end)];
    if (!stroke || at < stroke.start || !this.included(stroke.index, showUndone)) return base;
    const elapsed = ((at - stroke.start) / (stroke.end - stroke.start)) * stroke.duration;
    const strokes = stroke.event.strokes.flatMap((s) => {
      const visible = prefix(s, elapsed);
      return visible ? [visible] : [];
    });
    const head = strokes[0];
    if (!head) return base;
    const drawing = new Drawing(base);
    drawing.apply({ kind: "stroke", layer: stroke.event.layer, strokes });
    const frame = drawing.frame();
    const p = head.points;
    frame.cursor = {
      x: p[p.length - STRIDE]!,
      y: p[p.length - STRIDE + 1]!,
      width: head.width,
      tool: head.tool,
      color: head.color,
    };
    return frame;
  }

  clock(pauseLimit: number, fitTo?: number) {
    const ends: { raw: number; active: boolean }[] = [];
    let last = 0;
    const add = (raw: number, active: boolean) => {
      if (raw > last) ends.push({ raw, active });
      last = raw;
    };
    // Non-drawing actions split idle intervals too; a sequence of edits plays at its recorded tempo.
    let action = 0;
    for (const s of this.strokes) {
      while (action < s.index) {
        const t = this.file.events[action++]!.at;
        if (t <= s.start) add(t, false);
      }
      add(s.start, false);
      add(s.end, true);
      action = s.index + 1;
    }
    for (; action < this.file.events.length; action++) add(this.file.events[action]!.at, false);
    add(this.file.duration, false);
    let ink = 0;
    let idle = 0;
    last = 0;
    for (const e of ends) {
      if (e.active) ink += e.raw - last;
      else idle += Math.min(e.raw - last, pauseLimit);
      last = e.raw;
    }
    const target = fitTo ?? ink + idle;
    const idleTime = fitTo === undefined || ink === 0 ? idle : Math.min(idle, Math.max(target - ink, target * 0.08));
    const weight = ink + idleTime;
    let played = 0;
    last = 0;
    const knots = [{ raw: 0, played: 0 }];
    for (const e of ends) {
      const dt = e.raw - last;
      played += e.active ? dt : idle === 0 ? 0 : (Math.min(dt, pauseLimit) * idleTime) / idle;
      knots.push({ raw: e.raw, played: weight ? (played / weight) * target : (e.raw / this.file.duration) * target });
      last = e.raw;
    }
    const convert = (v: number, from: "played" | "raw", to: "played" | "raw") => {
      const hi = upperBound(knots, v, (k) => k[from]);
      if (hi === knots.length) return knots.at(-1)![to];
      const a = knots[Math.max(0, hi - 1)]!;
      const b = knots[hi]!;
      const t = clamp((v - a[from]) / (b[from] - a[from]) || 0, 0, 1);
      return a[to] + t * (b[to] - a[to]);
    };
    return {
      duration: target,
      raw: (v: number) => convert(v, "played", "raw"),
      played: (v: number) => convert(v, "raw", "played"),
    };
  }
}
