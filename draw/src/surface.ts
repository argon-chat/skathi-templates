import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from "vue";
import { LiveStroke, OneEuro, type Bounds } from "./ink";
import { INK, PAPER, rgb, TOOL_INFO, type Color, type Stroke, type Tool } from "./model";
import { meshOf, Renderer, type View } from "./renderer";
import type { useSketchbook } from "./sketchbook";

const BARREL = 2;
const ERASER = 32;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;
const PALM_MS = 600;

interface Options {
  canvas: Ref<HTMLCanvasElement | null>;
  book: ReturnType<typeof useSketchbook>;
  tool: Ref<Tool>;
  color: Ref<Color>;
  width: (tool: Tool) => number;
  dark: Ref<boolean>;
  grid: Ref<boolean>;
}

type Gesture =
  | { kind: "draw"; id: number; live: LiveStroke; fx: OneEuro; fy: OneEuro; fp: OneEuro; sx: number; sy: number }
  | { kind: "pan"; id: number; x: number; y: number }
  | { kind: "pinch"; distance: number; zoom: number; docX: number; docY: number };

const rgbUnit = (hex: string) => rgb(hex).map((c) => c / 255) as [number, number, number];

function penSeenBefore(): boolean {
  try {
    return localStorage.getItem("draw.pen") === "1";
  } catch {
    return false;
  }
}

/** The drawing canvas: the WebGPU renderer, the view, and pen, mouse, touch and wheel input. */
export function useSurface({ canvas, book, tool, color, width, dark, grid }: Options) {
  const error = ref("");
  const ready = ref(false);
  const zoom = ref(1);
  const zooming = ref(false);
  const temporary = ref<Tool | null>(null);
  const drawing = ref(false);
  const panning = ref(false);
  const space = ref(false);
  const effective = computed(() => temporary.value ?? tool.value);
  let renderer: Renderer | null = null;
  let view: View = { zoom: 1, x: 0, y: 0 };
  let size = { w: 0, h: 0 };
  let gesture: Gesture | null = null;
  let zoomTimer: ReturnType<typeof setTimeout> | undefined;
  let penSeen = penSeenBefore();
  let penInRange = false;
  let lastPen = -Infinity;
  const touches = new Map<number, { x: number; y: number }>();

  const toDoc = (x: number, y: number) => ({ x: (x - view.x) / view.zoom, y: (y - view.y) / view.zoom });

  function setView(next: View) {
    view = next;
    renderer?.setView(view);
    if (next.zoom !== zoom.value) {
      zoom.value = next.zoom;
      zooming.value = true;
      clearTimeout(zoomTimer);
      zoomTimer = setTimeout(() => (zooming.value = false), 1200);
    }
  }

  function zoomAt(x: number, y: number, factor: number) {
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom * factor));
    const doc = toDoc(x, y);
    setView({ zoom: z, x: x - doc.x * z, y: y - doc.y * z });
  }

  const zoomBy = (factor: number) => zoomAt(size.w / 2, size.h / 2, factor);
  const resetZoom = () => zoomAt(size.w / 2, size.h / 2, 1 / view.zoom);
  const home = () => setView({ zoom: 1, x: size.w / 2, y: size.h / 2 });

  /** Fits the drawing between the title strip and the toolbar, at 100% at most. */
  function fitContent() {
    const b = contentBounds();
    if (!b) return home();
    const top = 56;
    const bottom = 108;
    const z = Math.max(
      MIN_ZOOM,
      Math.min(1, (size.w - 64) / (b.maxX - b.minX), (size.h - top - bottom) / (b.maxY - b.minY)),
    );
    const cy = top + (size.h - top - bottom) / 2;
    setView({ zoom: z, x: size.w / 2 - ((b.minX + b.maxX) / 2) * z, y: cy - ((b.minY + b.maxY) / 2) * z });
  }

  function fit() {
    const w = innerWidth;
    const h = innerHeight;
    if (size.w) setView({ ...view, x: view.x + (w - size.w) / 2, y: view.y + (h - size.h) / 2 });
    else setView({ zoom: 1, x: w / 2, y: h / 2 });
    size = { w, h };
    renderer?.resize(w, h, devicePixelRatio || 1);
  }

  function theme() {
    const mode = dark.value ? "dark" : "light";
    renderer?.setTheme(rgbUnit(PAPER[mode]), rgbUnit(INK[mode]), grid.value ? (dark.value ? 0.16 : 0.2) : 0);
  }

  function ring(e: PointerEvent, on = true) {
    const t = effective.value;
    const r = Math.max(2, (width(t) / 2) * view.zoom);
    renderer?.setCursor(e.clientX, e.clientY, r, on && e.pointerType !== "touch" && !panning.value && !space.value);
  }

  function startDraw(e: PointerEvent, t: Tool) {
    const layer = book.layers.value.find((l) => l.id === book.active.value);
    if (!layer?.visible || !renderer) return;
    const stroke: Stroke = {
      seq: book.nextSeq(),
      tool: t,
      color: t === "eraser" ? "ink" : color.value,
      width: width(t),
      points: [],
    };
    const live = new LiveStroke(stroke);
    gesture = {
      kind: "draw",
      id: e.pointerId,
      live,
      fx: new OneEuro(6, 0.04),
      fy: new OneEuro(6, 0.04),
      fp: new OneEuro(4, 0.02),
      sx: e.clientX,
      sy: e.clientY,
    };
    drawing.value = true;
    sample(e, true);
    live.build([]);
    renderer.beginLive(layer.id, live);
  }

  function sample(e: PointerEvent, force = false) {
    if (gesture?.kind !== "draw") return;
    const g = gesture;
    const t = e.timeStamp;
    const x = g.fx.filter(e.clientX, t);
    const y = g.fy.filter(e.clientY, t);
    const p = e.pointerType === "pen" ? g.fp.filter(e.pressure, t) : 0.5;
    if (!force && Math.hypot(x - g.sx, y - g.sy) < 0.6) return;
    g.sx = x;
    g.sy = y;
    const d = toDoc(x, y);
    g.live.add(d.x, d.y, p, e.tiltX, e.tiltY, e.twist, t);
  }

  function finishDraw(e: PointerEvent | null) {
    if (gesture?.kind !== "draw") return;
    const { live } = gesture;
    gesture = null;
    drawing.value = false;
    temporary.value = null;
    if (e) {
      const d = toDoc(e.clientX, e.clientY);
      const pts = live.stroke.points;
      const n = pts.length;
      if (Math.hypot(d.x - pts[n - 7]!, d.y - pts[n - 6]!) * view.zoom > 0.3)
        live.add(d.x, d.y, pts[n - 5]!, e.tiltX, e.tiltY, e.twist, e.timeStamp);
      book.addStroke(live.stroke);
      renderer?.setLayers(book.layers.value);
    }
    renderer?.endLive();
  }

  function pinchState() {
    const [a, b] = [...touches.values()] as [{ x: number; y: number }, { x: number; y: number }];
    return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) };
  }

  function touchDown(e: PointerEvent) {
    if (penInRange || performance.now() - lastPen < PALM_MS) return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.value?.setPointerCapture(e.pointerId);
    if (touches.size === 1) {
      if (!penSeen) startDraw(e, tool.value);
      else gesture = { kind: "pan", id: e.pointerId, x: e.clientX, y: e.clientY };
    } else if (touches.size === 2) {
      if (gesture?.kind === "draw") {
        gesture = null;
        drawing.value = false;
        renderer?.endLive();
      }
      const { cx, cy, distance } = pinchState();
      const doc = toDoc(cx, cy);
      gesture = { kind: "pinch", distance, zoom: view.zoom, docX: doc.x, docY: doc.y };
    }
  }

  function down(e: PointerEvent) {
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
    if (e.button === 1 || (space.value && e.button === 0)) {
      gesture = { kind: "pan", id: e.pointerId, x: e.clientX, y: e.clientY };
      panning.value = true;
      canvas.value?.setPointerCapture(e.pointerId);
      renderer?.setCursor(0, 0, 0, false);
      return;
    }
    const pen = e.pointerType === "pen";
    if (pen ? ![0, 2, 5].includes(e.button) : e.button !== 0) return;
    const erasing = pen && (e.button === 5 || e.button === 2 || (e.buttons & (ERASER | BARREL)) !== 0);
    if (erasing) temporary.value = "eraser";
    canvas.value?.setPointerCapture(e.pointerId);
    startDraw(e, erasing ? "eraser" : tool.value);
    if (gesture === null) temporary.value = null;
    ring(e);
  }

  function move(e: PointerEvent) {
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
      const { cx, cy, distance } = pinchState();
      const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (g.zoom * distance) / g.distance));
      setView({ zoom: z, x: cx - g.docX * z, y: cy - g.docY * z });
      return;
    }
    if (g?.kind === "pan" && g.id === e.pointerId) {
      setView({ ...view, x: view.x + e.clientX - g.x, y: view.y + e.clientY - g.y });
      g.x = e.clientX;
      g.y = e.clientY;
      return;
    }
    if (g?.kind === "draw" && g.id === e.pointerId) {
      const events = e.getCoalescedEvents();
      for (const c of events.length ? events : [e]) sample(c);
      g.live.build(
        e.getPredictedEvents().map((p) => {
          const d = toDoc(p.clientX, p.clientY);
          return [d.x, d.y] as const;
        }),
      );
      renderer?.updateLive();
    }
    ring(e);
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
    if (gesture?.kind === "draw" && gesture.id === e.pointerId) finishDraw(e.type === "pointercancel" ? null : e);
    else if (gesture?.kind === "pan" && gesture.id === e.pointerId) {
      gesture = null;
      panning.value = false;
    }
  }

  function leave(e: PointerEvent) {
    if (e.pointerType === "pen") penInRange = false;
    if (!gesture) ring(e, false);
  }

  function wheel(e: WheelEvent) {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? size.h : 1;
    const dx = e.deltaX * unit;
    const dy = e.deltaY * unit;
    if (e.ctrlKey || e.metaKey) zoomAt(e.clientX, e.clientY, Math.exp(-dy * 0.0025));
    else if (e.shiftKey && !dx) setView({ ...view, x: view.x - dy });
    else setView({ ...view, x: view.x - dx, y: view.y - dy });
  }

  /** The drawn area of the visible layers, in document units. */
  function contentBounds(): Bounds | null {
    const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const layer of book.layers.value) {
      if (!layer.visible) continue;
      for (const stroke of layer.strokes) {
        if (stroke.tool === "eraser") continue;
        const m = meshOf(stroke).bounds;
        b.minX = Math.min(b.minX, m.minX);
        b.minY = Math.min(b.minY, m.minY);
        b.maxX = Math.max(b.maxX, m.maxX);
        b.maxY = Math.max(b.maxY, m.maxY);
      }
    }
    return Number.isFinite(b.minX) ? b : null;
  }

  async function exportPng(): Promise<Blob | null> {
    const b = contentBounds();
    if (!b || !renderer) return null;
    const pad = 32;
    return renderer.exportPng({ minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad }, 2);
  }

  function setSpace(held: boolean) {
    space.value = held;
    if (held) renderer?.setCursor(0, 0, 0, false);
  }

  watch(book.layers, (layers) => renderer?.setLayers(layers));
  watch([dark, grid], theme);

  onMounted(async () => {
    const el = canvas.value;
    if (!el) return;
    try {
      renderer = await Renderer.create(el);
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      return;
    }
    size = { w: 0, h: 0 };
    fit();
    theme();
    renderer.setLayers(book.layers.value);
    addEventListener("resize", fit);
    ready.value = true;
  });

  onBeforeUnmount(() => {
    removeEventListener("resize", fit);
    clearTimeout(zoomTimer);
    renderer?.destroy();
    renderer = null;
  });

  return {
    ready,
    error,
    zoom,
    zooming,
    drawing,
    panning,
    space,
    effective,
    temporary,
    handlers: { down, move, up, leave, wheel },
    zoomBy,
    resetZoom,
    home,
    fitContent,
    setSpace,
    exportPng,
    hasContent: () => contentBounds() !== null,
  };
}

export const widthOf = (t: Tool, index: number) => TOOL_INFO[t].widths[index] ?? TOOL_INFO[t].widths[1];
