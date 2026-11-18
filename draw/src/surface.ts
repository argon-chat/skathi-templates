import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from "vue";
import {
  about,
  type Affine,
  apply,
  type Bounds,
  distanceToStroke,
  IDENTITY,
  insidePolygon,
  isIdentity,
  type Point,
  rotate,
  scale,
  shapePath,
  symmetryTransforms,
  transformStroke,
  translate,
  union,
} from "./geometry";
import { LiveShape, LiveStroke, Stabilizer } from "./ink";
import {
  hex,
  INK,
  isTool,
  PAPER,
  rgb,
  STRIDE,
  type Color,
  type Ink,
  type Layer,
  type Mode,
  type Paper,
  type Shape,
  type Stroke,
  type Symmetry,
  type Tool,
  type ToolSettings,
} from "./model";
import { canonicalPoint, coordinate16, fraction16 } from "./precision";
import { rasterMerge } from "./merge";
import { Marks, type Rgba } from "./overlay";
import { meshOf, Renderer, type View } from "./renderer";
import type { DrawAtomic, DrawRecording, DrawMutation } from "./events";
import type { useSketchbook } from "./sketchbook";

const BARREL = 2;
const ERASER = 32;
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 16;
const PALM_MS = 600;
const SHAPE_PRESSURE = 0.76;
const HANDLE_HIT = 11;

const ACCENT: Rgba = [59, 130, 246, 255];
const HALO: Rgba = [255, 255, 255, 220];
const WHITE: Rgba = [255, 255, 255, 255];
const CLEAR: Rgba = [0, 0, 0, 0];
const GUIDE: Rgba = [59, 130, 246, 150];

interface Options {
  canvas: Ref<HTMLCanvasElement | null>;
  book: ReturnType<typeof useSketchbook>;
  mode: Ref<Mode>;
  color: Ref<Color>;
  settings: Record<Tool, ToolSettings>;
  inkTool: Ref<Ink>;
  shape: Ref<Shape>;
  dark: Ref<boolean>;
  paper: Ref<Paper>;
  symmetry: Ref<Symmetry | null>;
  notify: (message: string) => void;
  onPick: (color: Color) => void;
}

type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "rotate" | "move";

type Gesture =
  | {
      kind: "draw";
      id: number;
      lives: LiveStroke[];
      transforms: Affine[];
      stab: Stabilizer;
      started: number;
      sx: number;
      sy: number;
    }
  | { kind: "shape"; id: number; start: Point; lives: LiveShape[]; transforms: Affine[] }
  | { kind: "pan"; id: number; x: number; y: number }
  | { kind: "pinch"; distance: number; angle: number; zoom: number; viewAngle: number; docX: number; docY: number }
  | { kind: "lasso"; id: number; points: number[] }
  | { kind: "transform"; id: number; handle: Handle; start: Point; m: Affine; moved: boolean }
  | { kind: "bucket"; id: number; point: Point }
  | { kind: "pick"; id: number };

interface Selection {
  layer: string;
  strokes: readonly Stroke[];
  box: Bounds;
}

const rgbUnit = (h: string) => rgb(h).map((c) => c / 255) as [number, number, number];
const CORNERS: Record<Exclude<Handle, "rotate" | "move">, [number, number]> = {
  nw: [0, 0],
  n: [0.5, 0],
  ne: [1, 0],
  e: [1, 0.5],
  se: [1, 1],
  s: [0.5, 1],
  sw: [0, 1],
  w: [0, 0.5],
};
const CURSORS: Record<Handle, string> = {
  nw: "nwse-resize",
  se: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
  rotate: "grab",
  move: "move",
};

let clipboard: readonly Stroke[] = [];
let pasted = 0;

function penSeenBefore(): boolean {
  try {
    return localStorage.getItem("draw.pen") === "1";
  } catch {
    return false;
  }
}

/** The drawing canvas: the WebGPU renderer, the view, and pen, mouse, touch and wheel input. */
export function useSurface(o: Options) {
  const { canvas, book, mode, color, settings } = o;
  const error = ref("");
  const ready = ref(false);
  const zoom = ref(1);
  const angle = ref(0);
  const temporary = ref<Mode | null>(null);
  const drawing = ref(false);
  const panning = ref(false);
  const space = ref(false);
  const selected = ref(0);
  const hover = ref<Handle | null>(null);
  const effective = computed<Mode>(() => (space.value ? "hand" : (temporary.value ?? mode.value)));
  const cursor = computed(() => {
    if (panning.value) return "grabbing";
    const m = effective.value;
    if (m === "hand") return "grab";
    if (m === "select" && hover.value) return CURSORS[hover.value];
    return m === "eyedropper" ? "crosshair" : m === "select" ? "default" : "crosshair";
  });
  let renderer: Renderer | null = null;
  let view: View = { zoom: 1, angle: 0, x: 0, y: 0 };
  let size = { w: 0, h: 0 };
  let gesture: Gesture | null = null;
  let playback = false;
  const processing = book.documentBusy;
  let onCancelDraft: (() => void) | undefined;
  let inputsEnabled = true;
  let holdTimer: ReturnType<typeof setInterval> | undefined;
  let previewPaper = "";
  let selection: Selection | null = null;
  let penSeen = penSeenBefore();
  let penInRange = false;
  let lastPen = -Infinity;
  let loupe: { x: number; y: number; color: Rgba | null } | null = null;
  let picked: [number, number, number] | null = null;
  let pickWant: Point | null = null;
  let pickBusy = false;
  let pickCommit = false;
  const touches = new Map<number, { x: number; y: number }>();
  const marks = new Marks();
  const viewListeners = new Set<() => void>();

  function toDoc(x: number, y: number): Point {
    const c = Math.cos(view.angle);
    const s = Math.sin(view.angle);
    const dx = x - view.x;
    const dy = y - view.y;
    return { x: (c * dx + s * dy) / view.zoom, y: (c * dy - s * dx) / view.zoom };
  }

  function toScreen(x: number, y: number): Point {
    const c = Math.cos(view.angle) * view.zoom;
    const s = Math.sin(view.angle) * view.zoom;
    return { x: c * x - s * y + view.x, y: s * x + c * y + view.y };
  }

  /** The view that shows document point `doc` at screen point `at`. */
  function placed(doc: Point, at: Point, z: number, a: number): View {
    const c = Math.cos(a) * z;
    const s = Math.sin(a) * z;
    return { zoom: z, angle: a, x: at.x - (c * doc.x - s * doc.y), y: at.y - (s * doc.x + c * doc.y) };
  }

  function setView(next: View) {
    if (view.x === next.x && view.y === next.y && view.zoom === next.zoom && view.angle === next.angle) return;
    view = next;
    renderer?.setView(view);
    if (next.zoom !== zoom.value) zoom.value = next.zoom;
    const deg = Math.round(((((next.angle * 180) / Math.PI + 180) % 360) + 360) % 360) - 180;
    if (deg !== angle.value) angle.value = deg;
    for (const fn of viewListeners) fn();
  }

  function zoomAt(x: number, y: number, factor: number) {
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom * factor));
    setView(placed(toDoc(x, y), { x, y }, z, view.angle));
  }

  function rotateAt(x: number, y: number, a: number) {
    setView(placed(toDoc(x, y), { x, y }, view.zoom, a));
  }

  const centre = () => ({ x: size.w / 2, y: size.h / 2 });
  const zoomBy = (factor: number) => zoomAt(size.w / 2, size.h / 2, factor);
  const zoomTo = (z: number) => zoomAt(size.w / 2, size.h / 2, z / view.zoom);
  const rotateBy = (deg: number) => rotateAt(size.w / 2, size.h / 2, view.angle + (deg * Math.PI) / 180);
  const resetRotation = () => rotateAt(size.w / 2, size.h / 2, 0);
  const home = () => setView({ zoom: 1, angle: 0, x: size.w / 2, y: size.h / 2 });

  /** Fits the drawing between the title strip and the toolbar, at 100% at most, keeping the rotation. */
  function fitContent(layers: readonly Layer[] = book.layers.value, rotation = view.angle) {
    const b = contentBounds(layers);
    if (!b) return home();
    const top = 56;
    const bottom = 112;
    const c = Math.cos(rotation);
    const s = Math.sin(rotation);
    const xs: number[] = [];
    const ys: number[] = [];
    for (const [x, y] of [
      [b.minX, b.minY],
      [b.maxX, b.minY],
      [b.minX, b.maxY],
      [b.maxX, b.maxY],
    ] as const) {
      xs.push(c * x - s * y);
      ys.push(s * x + c * y);
    }
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    const z = Math.max(MIN_ZOOM, Math.min(1, (size.w - 96) / w, (size.h - top - bottom) / h));
    const mid = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
    setView(placed(mid, { x: size.w / 2, y: top + (size.h - top - bottom) / 2 }, z, rotation));
  }

  function centreOn(x: number, y: number) {
    setView(placed({ x, y }, centre(), view.zoom, view.angle));
  }

  function fit() {
    const w = innerWidth;
    const h = innerHeight;
    if (size.w) setView({ ...view, x: view.x + (w - size.w) / 2, y: view.y + (h - size.h) / 2 });
    else setView({ zoom: 1, angle: 0, x: w / 2, y: h / 2 });
    size = { w, h };
    renderer?.resize(w, h, devicePixelRatio || 1);
  }

  function theme() {
    if (playback) return;
    const m = o.dark.value ? "dark" : "light";
    renderer?.setTheme(rgbUnit(PAPER[m]), rgbUnit(INK[m]), o.paper.value, o.dark.value ? 0.16 : 0.2);
  }

  function ring(e: PointerEvent, on = true) {
    const t = effective.value;
    const show = on && isTool(t) && e.pointerType !== "touch" && !panning.value;
    const r = isTool(t) ? Math.max(2, (settings[t].size / 2) * view.zoom) : 0;
    renderer?.setCursor(e.clientX, e.clientY, r, show);
  }

  function activeLayer() {
    const layer = book.layers.value.find((l) => l.id === book.active.value);
    return layer?.visible ? layer : null;
  }

  function newStroke(tool: Tool, layer: Layer): Stroke {
    const s = settings[tool];
    const seq = book.nextSeq();
    return {
      seq,
      tool,
      color: tool === "eraser" ? "ink" : color.value,
      width: s.size,
      points: [],
      ...(s.opacity < 1 && { opacity: fraction16(s.opacity) }),
      ...(layer.alphaLocked && { alphaLocked: true }),
      ...((tool === "spray" || tool === "pencil" || tool === "airbrush") && { seed: Math.imul(seq, 2654435761) >>> 0 }),
      ...(s.scatter !== undefined && { scatter: fraction16(s.scatter) }),
      ...(s.density !== undefined && { density: fraction16(s.density) }),
      ...(s.hardness !== undefined && { hardness: fraction16(s.hardness) }),
    };
  }
  function addPoint(live: LiveStroke, x: number, y: number, p: number, tx: number, ty: number, tw: number, t: number) {
    const pts = live.stroke.points;
    live.add(...canonicalPoint(x, y, p, tx, ty, tw, Math.max(pts.at(-1) ?? 0, t)));
  }
  function startDeposition() {
    const start = performance.now();
    const g = gesture;
    if (g?.kind !== "draw") return;
    const origin = g.lives[0]!.stroke.points.at(-1) ?? 0;
    holdTimer = setInterval(() => {
      if (gesture !== g) return;
      for (const live of g.lives) {
        const a = live.stroke.points,
          i = a.length - STRIDE;
        const t = origin + performance.now() - start;
        if (t - a[i + 6]! < 30) continue;
        addPoint(live, a[i]!, a[i + 1]!, a[i + 2]!, a[i + 3]!, a[i + 4]!, a[i + 5]!, t);
        live.build([]);
      }
      renderer?.updateLive();
    }, 40);
  }

  function startDraw(e: PointerEvent, t: Tool) {
    const layer = activeLayer();
    if (!layer || !renderer) return;
    const s = settings[t];
    const transforms = symmetryTransforms(o.symmetry.value);
    const lives = transforms.map(() => new LiveStroke(newStroke(t, layer)));
    gesture = {
      kind: "draw",
      id: e.pointerId,
      lives,
      transforms,
      stab: new Stabilizer(s.streamline),
      started: e.timeStamp,
      sx: e.clientX,
      sy: e.clientY,
    };
    drawing.value = true;
    sample(e, true);
    for (const live of lives) live.build([]);
    renderer.beginLive(layer.id, lives);
    if (t === "spray" || t === "airbrush") startDeposition();
  }

  function sample(e: PointerEvent, force = false) {
    if (gesture?.kind !== "draw") return;
    const g = gesture;
    const t = e.timeStamp;
    const p = e.pointerType === "pen" ? g.stab.pressure(e.pressure, t) : 0.5;
    const at = g.stab.position(e.clientX, e.clientY, t);
    if (!at || (!force && Math.hypot(at.x - g.sx, at.y - g.sy) < 0.6)) return;
    g.sx = at.x;
    g.sy = at.y;
    const d = toDoc(at.x, at.y);
    for (const [i, live] of g.lives.entries()) {
      const q = apply(g.transforms[i]!, d.x, d.y);
      addPoint(live, q.x, q.y, p, e.tiltX, e.tiltY, e.twist, t - g.started);
    }
  }

  function finishDraw(e: PointerEvent | null) {
    if (gesture?.kind !== "draw") return;
    clearInterval(holdTimer);
    if (!e) onCancelDraft?.();
    const { lives, transforms, stab, started } = gesture;
    gesture = null;
    drawing.value = false;
    if (temporary.value === "eraser") temporary.value = null;
    if (e) {
      const d = toDoc(e.clientX, e.clientY);
      for (const [i, live] of lives.entries()) {
        const pts = live.stroke.points;
        const n = pts.length;
        const q = apply(transforms[i]!, d.x, d.y);
        if (!stab.trailing && Math.hypot(q.x - pts[n - 7]!, q.y - pts[n - 6]!) * view.zoom > 0.3)
          addPoint(live, q.x, q.y, pts[n - 5]!, e.tiltX, e.tiltY, e.twist, e.timeStamp - started);
      }
      const strokes = lives
        .map((l) => l.stroke)
        .filter((s) => s.points.length && (s.tool !== "lasso-fill" || s.points.length >= 3 * STRIDE));
      const layer = activeLayer();
      const gpu = renderer;
      if (layer && gpu && strokes[0]?.tool === "smudge") {
        void resolvePaint(layer, () => Promise.all(strokes.map((s) => gpu.smudge(s, layer.id))));
      } else book.addStrokes(strokes);
      renderer?.setLayers(book.layers.value);
    }
    renderer?.endLive();
  }

  async function resolvePaint(layer: Layer, run: () => Promise<Stroke[]>) {
    processing.value = true;
    try {
      const result = await run();
      processing.value = false;
      if (result.length) book.addStrokes(result, layer.id);
    } catch (e) {
      o.notify(e instanceof Error ? e.message : "Could not sample this layer");
    } finally {
      processing.value = false;
    }
  }

  async function mergeDown(id: string) {
    if (processing.value || playback || drawing.value) return;
    const i = book.layers.value.findIndex((l) => l.id === id);
    const upper = book.layers.value[i],
      lower = book.layers.value[i - 1];
    if (!upper || !lower || !renderer) return;
    if (!rasterMerge(lower, upper)) {
      book.mergeDown(id);
      return;
    }
    processing.value = true;
    try {
      const merged = await renderer.mergeLayers(lower, upper, book.nextSeq());
      processing.value = false;
      book.mergeDown(id, merged);
    } catch (e) {
      o.notify(e instanceof Error ? e.message : "Could not merge these layers.");
    } finally {
      processing.value = false;
    }
  }

  function fillAt(point: Point) {
    const layer = activeLayer(),
      gpu = renderer;
    if (!layer || !gpu) return;
    const s = settings.bucket,
      stroke = newStroke("bucket", layer);
    void resolvePaint(layer, async () => {
      const contours = await gpu.bucket(point.x, point.y, {
        ...(s.currentLayer && { layer: layer.id }),
        tolerance: s.tolerance ?? 24,
        gap: s.gap ?? 0,
        expand: s.expand ?? 1,
      });
      if (!contours?.length) {
        o.notify("This area is open. Close its outline to fill it.");
        return [];
      }
      stroke.points = canonicalPoint(point.x, point.y, 1, 0, 0, 0, 0);
      stroke.contours = contours.map((ring) => ring.map(coordinate16));
      return [stroke];
    });
  }

  function startShape(e: PointerEvent) {
    const layer = activeLayer();
    if (!layer || !renderer) return;
    const t = o.inkTool.value;
    const transforms = symmetryTransforms(o.symmetry.value);
    const lives = transforms.map(
      () =>
        new LiveShape({
          ...newStroke(t, layer),
          shape: true,
        }),
    );
    gesture = { kind: "shape", id: e.pointerId, start: { x: e.clientX, y: e.clientY }, lives, transforms };
    drawing.value = true;
    renderer.beginLive(layer.id, lives);
  }

  function moveShape(e: PointerEvent) {
    if (gesture?.kind !== "shape") return;
    const g = gesture;
    const width = g.lives[0]!.stroke.width * view.zoom;
    const path = shapePath(o.shape.value, g.start, { x: e.clientX, y: e.clientY }, e.shiftKey, 14 + width * 2.5);
    const doc = path.map((p) => toDoc(p.x, p.y));
    for (const [i, live] of g.lives.entries()) {
      const points: number[] = [];
      for (const [k, p] of doc.entries()) {
        const q = apply(g.transforms[i]!, p.x, p.y);
        points.push(...canonicalPoint(q.x, q.y, SHAPE_PRESSURE, 0, 0, 0, k));
      }
      live.set(points);
    }
    renderer?.updateLive();
  }

  function finishShape(e: PointerEvent | null) {
    if (gesture?.kind !== "shape") return;
    const g = gesture;
    if (e) moveShape(e);
    else onCancelDraft?.();
    gesture = null;
    drawing.value = false;
    const far = e && Math.hypot(e.clientX - g.start.x, e.clientY - g.start.y) > 3;
    if (far) {
      book.addStrokes(g.lives.map((l) => l.stroke).filter((s) => s.points.length >= 2 * STRIDE));
      renderer?.setLayers(book.layers.value);
    }
    renderer?.endLive();
  }

  function pinchState() {
    const [a, b] = [...touches.values()] as [{ x: number; y: number }, { x: number; y: number }];
    return {
      cx: (a.x + b.x) / 2,
      cy: (a.y + b.y) / 2,
      distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      angle: Math.atan2(b.y - a.y, b.x - a.x),
    };
  }

  function cancelGesture() {
    clearInterval(holdTimer);
    if (gesture?.kind === "draw" || gesture?.kind === "shape") {
      onCancelDraft?.();
      renderer?.endLive();
      drawing.value = false;
    }
    if (gesture?.kind === "transform") {
      renderer?.dropFloat();
      renderer?.setLayers(book.layers.value);
    }
    gesture = null;
    renderer?.invalidateOverlay();
  }

  function touchDown(e: PointerEvent) {
    if (penInRange || performance.now() - lastPen < PALM_MS) return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.value?.setPointerCapture(e.pointerId);
    if (touches.size === 1) {
      if (!penSeen) press(e);
      else gesture = { kind: "pan", id: e.pointerId, x: e.clientX, y: e.clientY };
    } else if (touches.size === 2) {
      cancelGesture();
      const { cx, cy, distance, angle: a } = pinchState();
      const doc = toDoc(cx, cy);
      gesture = { kind: "pinch", distance, angle: a, zoom: view.zoom, viewAngle: view.angle, docX: doc.x, docY: doc.y };
    }
  }

  /** A primary press on the canvas, with whatever tool is in effect. */
  function press(e: PointerEvent) {
    const m = effective.value;
    if (m === "hand") {
      gesture = { kind: "pan", id: e.pointerId, x: e.clientX, y: e.clientY };
      panning.value = true;
      renderer?.setCursor(0, 0, 0, false);
    } else if (m === "bucket") gesture = { kind: "bucket", id: e.pointerId, point: toDoc(e.clientX, e.clientY) };
    else if (m === "select") pressSelect(e);
    else if (m === "shape") startShape(e);
    else if (m === "eyedropper") {
      gesture = { kind: "pick", id: e.pointerId };
      requestPick(e.clientX, e.clientY);
    } else startDraw(e, m);
  }

  function down(e: PointerEvent) {
    if (!inputsEnabled || playback || processing.value || !book.ready.value) return;
    if (e.pointerType === "pen") {
      lastPen = performance.now();
      penInRange = true;
      if (!penSeen) {
        penSeen = true;
        try {
          localStorage.setItem("draw.pen", "1");
        } catch {}
      }
    }
    if (e.pointerType === "touch") return touchDown(e);
    if (gesture) return;
    e.preventDefault();
    canvas.value?.setPointerCapture(e.pointerId);
    if (e.button === 1) {
      gesture = { kind: "pan", id: e.pointerId, x: e.clientX, y: e.clientY };
      panning.value = true;
      renderer?.setCursor(0, 0, 0, false);
      return;
    }
    const pen = e.pointerType === "pen";
    if (pen ? ![0, 2, 5].includes(e.button) : e.button !== 0) return;
    const erasing = pen && (e.button === 5 || e.button === 2 || (e.buttons & (ERASER | BARREL)) !== 0);
    if (erasing && effective.value !== "hand") {
      temporary.value = "eraser";
      startDraw(e, "eraser");
      if (gesture === null) temporary.value = null;
    } else press(e);
    ring(e);
  }

  function move(e: PointerEvent) {
    if (playback) return;
    if (e.pointerType === "pen") {
      lastPen = performance.now();
      penInRange = true;
    }
    if (e.pointerType === "touch") {
      if (!touches.has(e.pointerId)) return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    const g = gesture;
    if (g?.kind === "pinch") {
      const { cx, cy, distance, angle: a } = pinchState();
      const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (g.zoom * distance) / g.distance));
      let turn = g.viewAngle + a - g.angle;
      const snapped = Math.round(turn / (Math.PI / 2)) * (Math.PI / 2);
      if (Math.abs(turn - snapped) < 0.06) turn = snapped;
      setView(placed({ x: g.docX, y: g.docY }, { x: cx, y: cy }, z, turn));
      return;
    }
    if (g && "id" in g && g.id !== e.pointerId) return;
    switch (g?.kind) {
      case "pan":
        setView({ ...view, x: view.x + e.clientX - g.x, y: view.y + e.clientY - g.y });
        g.x = e.clientX;
        g.y = e.clientY;
        return;
      case "draw": {
        const events = e.getCoalescedEvents();
        for (const c of events.length ? events : [e]) sample(c);
        const predicted = g.stab.trailing ? [] : e.getPredictedEvents().map((p) => toDoc(p.clientX, p.clientY));
        for (const [i, live] of g.lives.entries())
          live.build(
            predicted.map((p) => {
              const q = apply(g.transforms[i]!, p.x, p.y);
              return [q.x, q.y] as const;
            }),
          );
        renderer?.updateLive();
        break;
      }
      case "shape":
        moveShape(e);
        break;
      case "lasso": {
        const n = g.points.length;
        if (Math.hypot(e.clientX - g.points[n - 2]!, e.clientY - g.points[n - 1]!) >= 3) {
          g.points.push(e.clientX, e.clientY);
          renderer?.invalidateOverlay();
        }
        return;
      }
      case "transform":
        moveTransform(e, g);
        return;
      case "pick":
        requestPick(e.clientX, e.clientY);
        return;
      default:
        hovered(e);
    }
    ring(e);
  }

  function hovered(e: PointerEvent) {
    const m = effective.value;
    hover.value = m === "select" ? handleAt(e.clientX, e.clientY) : null;
    if (m === "eyedropper" && e.pointerType !== "touch") requestPick(e.clientX, e.clientY);
    else if (loupe) {
      loupe = null;
      renderer?.invalidateOverlay();
    }
  }

  function up(e: PointerEvent) {
    if (e.pointerType === "pen") lastPen = performance.now();
    if (e.pointerType === "touch") {
      touches.delete(e.pointerId);
      if (gesture?.kind === "pinch") {
        const rest = [...touches.entries()][0];
        gesture = rest ? { kind: "pan", id: rest[0], x: rest[1].x, y: rest[1].y } : null;
        return;
      }
    }
    const g = gesture;
    if (!g || g.kind === "pinch" || g.id !== e.pointerId) return;
    const cancelled = e.type === "pointercancel";
    switch (g.kind) {
      case "bucket":
        gesture = null;
        if (!cancelled) fillAt(g.point);
        return;
      case "draw":
        return finishDraw(cancelled ? null : e);
      case "shape":
        return finishShape(cancelled ? null : e);
      case "pan":
        gesture = null;
        panning.value = false;
        return;
      case "lasso":
        gesture = null;
        if (!cancelled) finishLasso(g.points);
        renderer?.invalidateOverlay();
        return;
      case "transform":
        gesture = null;
        if (cancelled) cancelGesture();
        else commitTransform(g.m, g.moved);
        return;
      case "pick":
        gesture = null;
        if (!cancelled) {
          pickCommit = true;
          requestPick(e.clientX, e.clientY);
        }
        return;
    }
  }

  function leave(e: PointerEvent) {
    if (playback) return;
    if (e.pointerType === "pen") penInRange = false;
    if (!gesture) {
      ring(e, false);
      if (loupe) {
        loupe = null;
        renderer?.invalidateOverlay();
      }
    }
  }

  function wheel(e: WheelEvent) {
    e.preventDefault();
    if (playback) return;
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? size.h : 1;
    const dx = e.deltaX * unit;
    const dy = e.deltaY * unit;
    if (e.ctrlKey || e.metaKey) zoomAt(e.clientX, e.clientY, Math.exp(-dy * 0.0025));
    else if (e.shiftKey && !dx) setView({ ...view, x: view.x - dy });
    else setView({ ...view, x: view.x - dx, y: view.y - dy });
  }

  function requestPick(x: number, y: number) {
    pickWant = { x, y };
    loupe = { x, y, color: loupe?.color ?? null };
    renderer?.invalidateOverlay();
    if (!pickBusy) void runPick();
  }

  async function runPick() {
    pickBusy = true;
    try {
      while (pickWant && renderer) {
        const at = pickWant;
        pickWant = null;
        const d = toDoc(at.x, at.y);
        picked = await renderer.pick(d.x, d.y);
        if (loupe) {
          loupe = { ...loupe, color: [...picked, 255] };
          renderer?.invalidateOverlay();
        }
      }
    } catch {
      picked = null;
    } finally {
      pickBusy = false;
    }
    if (pickCommit && picked) o.onPick(hex(...picked));
    pickCommit = false;
  }

  function strokesBounds(strokes: readonly Stroke[]): Bounds {
    let b: Bounds | null = null;
    for (const s of strokes) b = union(b, meshOf(s).bounds);
    return b ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }

  function select(layer: string, strokes: readonly Stroke[]) {
    selection = strokes.length ? { layer, strokes, box: strokesBounds(strokes) } : null;
    selected.value = strokes.length;
    renderer?.invalidateOverlay();
  }

  function clearSelection() {
    if (gesture?.kind === "transform" || gesture?.kind === "lasso") cancelGesture();
    select("", []);
  }

  function finishLasso(points: number[]) {
    const layer = activeLayer();
    if (!layer) return select("", []);
    let length = 0;
    for (let i = 2; i < points.length; i += 2)
      length += Math.hypot(points[i]! - points[i - 2]!, points[i + 1]! - points[i - 1]!);
    if (length < 8) {
      const d = toDoc(points[0]!, points[1]!);
      const hit = [...layer.strokes]
        .reverse()
        .find((s) => s.tool !== "eraser" && distanceToStroke(s, d.x, d.y) <= (s.width / 2 + 6 / view.zoom) ** 2);
      return select(layer.id, hit ? [hit] : []);
    }
    const poly: number[] = [];
    for (let i = 0; i < points.length; i += 2) {
      const d = toDoc(points[i]!, points[i + 1]!);
      poly.push(d.x, d.y);
    }
    const inside = layer.strokes.filter((s) => {
      let n = 0;
      for (let i = 0; i < s.points.length; i += STRIDE) if (insidePolygon(s.points[i]!, s.points[i + 1]!, poly)) n++;
      return n * 2 * STRIDE >= s.points.length;
    });
    select(layer.id, inside);
  }

  /** The selection's frame and handles on screen, through the transform being dragged. */
  function frame(m: Affine) {
    const s = selection!;
    const pad = 6 / view.zoom;
    const b = { minX: s.box.minX - pad, minY: s.box.minY - pad, maxX: s.box.maxX + pad, maxY: s.box.maxY + pad };
    const at = (u: number, v: number) => {
      const p = apply(m, b.minX + (b.maxX - b.minX) * u, b.minY + (b.maxY - b.minY) * v);
      return toScreen(p.x, p.y);
    };
    const corners = [at(0, 0), at(1, 0), at(1, 1), at(0, 1)];
    const [nw, ne, , sw] = corners as [Point, Point, Point, Point];
    // Side handles on a short side would sit on top of the strokes, where a press should move them.
    const sides = Math.min(Math.hypot(ne.x - nw.x, ne.y - nw.y), Math.hypot(sw.x - nw.x, sw.y - nw.y)) >= 56;
    const handles = Object.entries(CORNERS)
      .filter(([h]) => sides || h.length === 2)
      .map(([h, [u, v]]) => ({ h: h as Handle, ...at(u, v) }));
    const top = at(0.5, 0);
    const mid = at(0.5, 0.5);
    const len = Math.hypot(top.x - mid.x, top.y - mid.y) || 1;
    const knob = { x: top.x + ((top.x - mid.x) / len) * 26, y: top.y + ((top.y - mid.y) / len) * 26 };
    return { b, corners, handles, top, knob };
  }

  function handleAt(x: number, y: number): Handle | null {
    if (!selection || selection.layer !== book.active.value) return null;
    const f = frame(IDENTITY);
    if (Math.hypot(f.knob.x - x, f.knob.y - y) <= HANDLE_HIT) return "rotate";
    for (const h of f.handles) if (Math.hypot(h.x - x, h.y - y) <= HANDLE_HIT) return h.h;
    return insidePolygon(
      x,
      y,
      f.corners.flatMap((p) => [p.x, p.y]),
    )
      ? "move"
      : null;
  }

  function pressSelect(e: PointerEvent) {
    const handle = handleAt(e.clientX, e.clientY);
    if (handle) {
      gesture = {
        kind: "transform",
        id: e.pointerId,
        handle,
        start: toDoc(e.clientX, e.clientY),
        m: IDENTITY,
        moved: false,
      };
      return;
    }
    gesture = { kind: "lasso", id: e.pointerId, points: [e.clientX, e.clientY] };
    renderer?.invalidateOverlay();
  }

  function moveTransform(e: PointerEvent, g: Extract<Gesture, { kind: "transform" }>) {
    const s = selection;
    if (!s || !renderer) return;
    const p = toDoc(e.clientX, e.clientY);
    const { b } = frame(IDENTITY);
    const mid = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
    let m: Affine = IDENTITY;
    if (g.handle === "move") {
      let dx = p.x - g.start.x;
      let dy = p.y - g.start.y;
      if (e.shiftKey && Math.abs(dx) > Math.abs(dy)) dy = 0;
      else if (e.shiftKey) dx = 0;
      m = translate(dx, dy);
    } else if (g.handle === "rotate") {
      let a = Math.atan2(p.y - mid.y, p.x - mid.x) - Math.atan2(g.start.y - mid.y, g.start.x - mid.x);
      if (e.shiftKey) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
      m = about(mid.x, mid.y, rotate(a));
    } else {
      const [u, v] = CORNERS[g.handle];
      const a = { x: b.minX + (b.maxX - b.minX) * (1 - u), y: b.minY + (b.maxY - b.minY) * (1 - v) };
      const c = { x: b.minX + (b.maxX - b.minX) * u, y: b.minY + (b.maxY - b.minY) * v };
      const ratio = (q: number, from: number, to: number) =>
        Math.abs(to - from) > 1e-3 ? (q - from) / (to - from) : 1;
      let sx = u === 0.5 ? 1 : ratio(p.x, a.x, c.x);
      let sy = v === 0.5 ? 1 : ratio(p.y, a.y, c.y);
      if (u !== 0.5 && v !== 0.5 && !e.shiftKey) {
        const dx = c.x - a.x;
        const dy = c.y - a.y;
        sx = sy = ((p.x - a.x) * dx + (p.y - a.y) * dy) / Math.max(dx * dx + dy * dy, 1e-6);
      }
      m = about(a.x, a.y, scale(Math.max(0.02, sx), Math.max(0.02, sy)));
    }
    if (!g.moved && Math.hypot(p.x - g.start.x, p.y - g.start.y) * view.zoom < 2) return;
    g.moved = true;
    g.m = m;
    renderer.setFloat(s.layer, s.strokes, m);
    renderer.invalidateOverlay();
  }

  function commitTransform(m: Affine, moved: boolean) {
    const s = selection;
    renderer?.dropFloat();
    if (!s || !moved || isIdentity(m)) {
      renderer?.setLayers(book.layers.value);
      renderer?.invalidateOverlay();
      return;
    }
    const next = s.strokes.map((stroke) => transformStroke(stroke, m));
    book.edit(s.layer, s.strokes, next);
    renderer?.setLayers(book.layers.value);
    select(s.layer, next);
  }

  function nudge(dx: number, dy: number) {
    if (!selection) return false;
    const c = Math.cos(-view.angle);
    const s = Math.sin(-view.angle);
    commitTransform(translate((c * dx - s * dy) / view.zoom, (s * dx + c * dy) / view.zoom), true);
    return true;
  }

  function selectAll() {
    const layer = activeLayer();
    if (layer) select(layer.id, layer.strokes);
  }

  function deleteSelection() {
    const s = selection;
    if (!s) return false;
    book.edit(s.layer, s.strokes, []);
    select("", []);
    return true;
  }

  function copySelection() {
    if (!selection) return false;
    clipboard = selection.strokes;
    pasted = 0;
    return true;
  }

  function cutSelection() {
    return copySelection() && deleteSelection();
  }

  function place(strokes: readonly Stroke[], offset: number) {
    const layer = activeLayer();
    if (!layer || !strokes.length) return false;
    const d = offset / view.zoom;
    const copies = [...strokes]
      .sort((a, b) => a.seq - b.seq)
      .map((s) => transformStroke(s, translate(d, d), book.nextSeq()));
    book.edit(layer.id, [], copies);
    select(layer.id, copies);
    return true;
  }

  const paste = () => place(clipboard, 16 * ++pasted);
  const duplicateSelection = () => (selection ? place(selection.strokes, 16) : false);

  function buildOverlay(): Uint8Array {
    marks.reset();
    if (playback) return marks.view();
    const sym = o.symmetry.value;
    if (sym) {
      const c = toScreen(sym.x, sym.y);
      const n = Math.max(1, Math.round(sym.segments));
      const reach = Math.hypot(size.w, size.h) * 2;
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + view.angle + (sym.mirror ? (i * Math.PI) / n : (i * 2 * Math.PI) / n);
        const ex = c.x + Math.cos(a) * reach;
        const ey = c.y + Math.sin(a) * reach;
        const sx = sym.mirror ? c.x - Math.cos(a) * reach : c.x;
        const sy = sym.mirror ? c.y - Math.sin(a) * reach : c.y;
        marks.line(sx, sy, ex, ey, 1.25, GUIDE, 10);
      }
      marks.disc(c.x, c.y, 5, 1.5, ACCENT, WHITE);
    }
    if (gesture?.kind === "lasso" && gesture.points.length >= 4) {
      marks.path(gesture.points, 3, HALO, 0, true);
      marks.path(gesture.points, 1.5, ACCENT, 7, true);
    }
    if (selection && selection.layer === book.active.value) {
      const m = gesture?.kind === "transform" ? gesture.m : IDENTITY;
      const f = frame(m);
      const ring = f.corners.flatMap((p) => [p.x, p.y]);
      marks.path(ring, 3, HALO, 0, true);
      marks.path(ring, 1.25, ACCENT, 0, true);
      marks.line(f.top.x, f.top.y, f.knob.x, f.knob.y, 1.25, ACCENT);
      for (const h of f.handles) marks.square(h.x, h.y, h.h.length === 2 ? 5 : 4, 1.5, ACCENT, WHITE);
      marks.disc(f.knob.x, f.knob.y, 5.5, 1.5, ACCENT, WHITE);
    }
    if (loupe?.color) {
      const outline: Rgba = o.dark.value ? [242, 242, 244, 200] : [28, 28, 30, 170];
      marks.disc(loupe.x, loupe.y, 26, 10, loupe.color, CLEAR);
      marks.disc(loupe.x, loupe.y, 27, 1.25, outline, CLEAR);
      marks.disc(loupe.x, loupe.y, 16, 1.25, outline, CLEAR);
      marks.disc(loupe.x, loupe.y, 1.5, 1.5, outline, CLEAR);
    }
    return marks.view();
  }

  /** The drawn area of the visible layers, in document units. */
  function contentBounds(layers: readonly Layer[] = book.layers.value): Bounds | null {
    let b: Bounds | null = null;
    for (const layer of layers) {
      if (!layer.visible) continue;
      for (const stroke of layer.strokes) if (stroke.tool !== "eraser") b = union(b, meshOf(stroke).bounds);
    }
    return b;
  }

  async function exportPng(scaleBy: number, background: boolean, pattern: boolean): Promise<Blob | null> {
    const b = contentBounds();
    if (!b || !renderer) return null;
    const pad = 32;
    const bounds = { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad };
    return renderer.exportPng(bounds, scaleBy, { background, pattern });
  }

  /** The document corners of the window, clockwise from the top left. */
  const viewport = () => [toDoc(0, 0), toDoc(size.w, 0), toDoc(size.w, size.h), toDoc(0, size.h)];

  /** A small picture of the drawing for the navigator, with the document area it covers. */
  async function thumbnail(maxW: number, maxH: number) {
    if (!renderer) return null;
    let b = contentBounds();
    if (!b) for (const p of viewport()) b = union(b, { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y });
    if (!b) return null;
    const pad = Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.08 + 16;
    let bounds = { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad };
    const s = Math.min(maxW / (bounds.maxX - bounds.minX), maxH / (bounds.maxY - bounds.minY));
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    bounds = { minX: cx - maxW / s / 2, maxX: cx + maxW / s / 2, minY: cy - maxH / s / 2, maxY: cy + maxH / s / 2 };
    const image = await renderer.render(bounds, s, { background: true, pattern: false });
    return { ...image, bounds, scale: s };
  }

  function setSpace(held: boolean) {
    if (space.value === held) return;
    space.value = held;
    hover.value = null;
    if (held) renderer?.setCursor(0, 0, 0, false);
  }

  function setTemporary(m: Mode | null) {
    if (gesture?.kind === "draw" || gesture?.kind === "shape") return;
    temporary.value = m;
    if (m !== "eyedropper" && loupe) {
      loupe = null;
      renderer?.invalidateOverlay();
    }
  }

  watch(book.layers, (layers) => {
    if (playback) return;
    renderer?.setLayers(layers);
    const s = selection;
    if (!s) return;
    const layer = layers.find((l) => l.id === s.layer);
    const present = new Set(layer?.strokes);
    if (!layer || s.strokes.some((x) => !present.has(x))) select("", []);
  });
  watch(book.active, () => {
    if (selection) clearSelection();
  });
  watch(mode, (m) => {
    if (m !== "select" && selection) clearSelection();
    hover.value = null;
  });
  watch([o.dark, o.paper], theme);
  watch(o.symmetry, () => renderer?.invalidateOverlay(), { deep: true });

  onMounted(async () => {
    const el = canvas.value;
    if (!el) return;
    // Recovery may restore the camera while the GPU adapter is still opening.
    fit();
    addEventListener("resize", fit);
    try {
      renderer = await Renderer.create(el);
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      return;
    }
    renderer.overlay = buildOverlay;
    fit();
    renderer.setView(view);
    theme();
    renderer.setLayers(book.layers.value);
    ready.value = true;
  });

  onBeforeUnmount(() => {
    clearInterval(holdTimer);
    removeEventListener("resize", fit);
    renderer?.destroy();
    renderer = null;
  });

  return {
    ready,
    error,
    zoom,
    angle,
    drawing,
    panning,
    space,
    effective,
    temporary,
    selected,
    cursor,
    handlers: { down, move, up, leave, wheel },
    getView: () => ({ ...view }),
    setView,
    toScreen,
    beginPlayback() {
      cancelGesture();
      clearSelection();
      loupe = null;
      playback = true;
      previewPaper = "";
      renderer?.setCursor(0, 0, 0, false);
    },
    present(layers: readonly Layer[], dark: boolean, paper: Paper) {
      const key = paper + dark;
      if (key !== previewPaper) {
        const m = dark ? "dark" : "light";
        renderer?.setTheme(rgbUnit(PAPER[m]), rgbUnit(INK[m]), paper, dark ? 0.16 : 0.2);
        previewPaper = key;
      }
      renderer?.setLayers(layers);
    },
    endPlayback() {
      playback = false;
      renderer?.setLayers(book.layers.value);
      theme();
    },
    mergeDown,
    painting: () => drawing.value || processing.value,
    enableInput(value: boolean) {
      inputsEnabled = value;
    },
    onCancelDraft(fn: () => void) {
      onCancelDraft = fn;
    },
    async checkpoint(): Promise<Extract<DrawMutation, { kind: "stroke" }> | null> {
      const g = gesture,
        layer = activeLayer(),
        gpu = renderer;
      if (!g || (g.kind !== "draw" && g.kind !== "shape") || !layer || !gpu) return null;
      let strokes = g.lives.map((l) => l.stroke).filter((s) => s.points.length);
      if (strokes.some((s) => s.tool === "smudge"))
        strokes = await Promise.all(strokes.map((s) => gpu.smudge(s, layer.id, true)));
      return g === gesture && strokes.length ? { kind: "stroke", layer: layer.id, strokes } : null;
    },
    async rastersReady() {
      await renderer?.rastersReady();
    },
    async preparePlayback(file: DrawRecording, isCurrent: () => boolean) {
      function* members(m: DrawAtomic) {
        if (m.kind === "stroke") yield* m.strokes;
        else if (m.kind === "edit") yield* m.added;
        else if (m.kind === "add-layer") yield* m.layer.strokes;
        else if (m.kind === "replace") for (const l of m.layers) yield* l.strokes;
      }
      function* geometry() {
        for (const l of file.initial?.layers ?? []) yield* l.strokes;
        for (const e of file.events) {
          const m = e.kind === "undo" || e.kind === "redo" ? e.fallback : e;
          if (m?.kind === "group") for (const change of m.changes) yield* members(change);
          else if (m && m.kind !== "ui" && m.kind !== "view") yield* members(m);
        }
      }
      let since = performance.now();
      // Warm small recordings for scrubbing. Larger recordings build meshes on demand.
      let remaining = 168 * 1024 * 1024;
      const visited = new WeakSet<Stroke>();
      for (const stroke of geometry()) {
        if (visited.has(stroke) || stroke.patch) continue;
        visited.add(stroke);
        if (remaining <= 0 || stroke.points.length > STRIDE * 4096) break;
        remaining -= meshOf(stroke).bytes.byteLength;
        if (performance.now() - since > 8) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          if (!isCurrent()) return;
          since = performance.now();
        }
      }
    },
    zoomBy,
    zoomTo,
    rotateBy,
    resetRotation,
    home,
    fitContent,
    centreOn,
    setSpace,
    setTemporary,
    exportPng,
    thumbnail,
    viewport,
    onView(fn: () => void) {
      viewListeners.add(fn);
      return () => viewListeners.delete(fn);
    },
    centre: () => toDoc(size.w / 2, size.h / 2),
    hasContent: () => contentBounds() !== null,
    bounds: contentBounds,
    selection: () => selection,
    clearSelection,
    selectAll,
    deleteSelection,
    copySelection,
    cutSelection,
    paste,
    duplicateSelection,
    nudge,
    canPaste: () => clipboard.length > 0,
  };
}
