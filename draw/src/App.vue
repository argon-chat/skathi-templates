<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from "vue";
import { appWindow } from "@skathi-native/runtime";
import { useRecordingSession } from "./recordingSession";
import type { DrawUi } from "./events";
import PlayerTransport from "./components/PlayerTransport.vue";
import BrushPopover from "./components/BrushPopover.vue";
import ColorPopover from "./components/ColorPopover.vue";
import ExportPopover, { type Format } from "./components/ExportPopover.vue";
import Icon from "./components/Icon.vue";
import LayersPopover from "./components/LayersPopover.vue";
import Navigator from "./components/Navigator.vue";
import ShapePopover from "./components/ShapePopover.vue";
import ShortcutsSheet from "./components/ShortcutsSheet.vue";
import SymmetryPopover from "./components/SymmetryPopover.vue";
import Toolbar from "./components/Toolbar.vue";
import ToolRail from "./components/ToolRail.vue";
import ViewControls from "./components/ViewControls.vue";
import WindowControls from "./components/WindowControls.vue";
import {
  clamp,
  defaultSettings,
  INK,
  isColor,
  isTool,
  isInk,
  PAINT_TOOLS,
  MODE_INFO,
  PAPER,
  PAPER_INFO,
  PAPERS,
  SHAPES,
  SWATCHES,
  TOOL_INFO,
  TOOLS,
  type Color,
  type Ink,
  type Mode,
  type Paper,
  type Shape,
  type Symmetry,
  type Tool,
  type ToolSettings,
} from "./model";
import { poppyStudy } from "./sample";
import { useSketchbook } from "./sketchbook";
import { useSurface } from "./surface";
import { toSvg } from "./svg";
import { hideTip, showTip, tip } from "./tooltip";

type Popover =
  "paint" | "recording" | "layers" | "menu" | "export" | "brush" | "palette" | "shape" | "symmetry" | "view";

const scheme = matchMedia("(prefers-color-scheme: dark)");
const dark = ref(scheme.matches);
const mode = ref<Mode>("pen");
const lastTool = ref<Tool>("pen");
const inkTool = ref<Ink>("pen");
const color = ref<Color>("ink");
const recents = ref<Color[]>([]);
const settings = reactive<Record<Tool, ToolSettings>>(defaultSettings());
const shape = ref<Shape>("rect");
const paper = ref<Paper>(legacyPaper());
const symmetry = ref<Symmetry | null>(null);
const lastSymmetry = ref<Symmetry>({ mirror: true, segments: 1, x: 0, y: 0 });
const exportFormat = ref<Format>("png");
const exportScale = ref(2);
const exportPattern = ref(false);
const navigatorOn = ref(false);
const canvas = ref<HTMLCanvasElement | null>(null);
const open = ref<Popover | null>(null);
const sheet = ref(false);
const notice = ref("");
const busy = ref(false);
const placement = shallowRef<Record<string, string>>({});
const tipParts = computed(() => tip.value?.text.split("  ") ?? []);
const book = useSketchbook();
const { layers, active, ready, canUndo, canRedo, strokeCount, documentBusy } = book;
const surface = useSurface({
  canvas,
  book,
  mode,
  color,
  settings,
  inkTool,
  shape,
  dark,
  paper,
  symmetry,
  onPick: picked,
  notify,
});
const { error, angle, drawing, effective, selected, cursor, ready: drawable } = surface;
const viewState = { zoom: surface.zoom, angle };
const ink = computed(() => INK[(session.shown.value?.ui.dark ?? dark.value) ? "dark" : "light"]);
const brushTool = computed<Tool>(() => {
  const m = effective.value;
  return isTool(m) ? m : mode.value === "shape" ? inkTool.value : lastTool.value;
});
const session = useRecordingSession({
  book,
  surface,
  notify,
  ui: computed<DrawUi>(() => ({
    mode: mode.value,
    shape: shape.value,
    color: color.value,
    size: settings[brushTool.value].size,
    active: active.value,
    paper: paper.value,
    dark: dark.value,
    symmetry: symmetry.value ? { ...symmetry.value } : null,
  })),
  dismiss() {
    open.value = null;
    sheet.value = false;
    hideTip();
  },
  restore(frame) {
    const s = frame.ui;
    if (s.mode) setMode(s.mode);
    if (s.shape) shape.value = s.shape;
    if (s.color) chooseColor(s.color);
    if (s.size && isTool(mode.value)) settings[mode.value].size = s.size;
    if (s.paper) paper.value = s.paper;
    if (s.dark !== undefined) appWindow.theme = s.dark ? "dark" : "light";
    symmetry.value = s.symmetry ?? null;
  },
});
const {
  player,
  shown: playFrame,
  cursor: playCursor,
  stamp,
  protect: protectRecording,
  title: recordTitle,
  author: recordAuthor,
  state: recordState,
} = session;
const { loaded: inPlayer, hideUi: cleanPlayer, editor: replayed } = player;
const showcase = computed(() => inPlayer.value && player.chrome.value === "editor");
const controls = computed(() => {
  const ui = replayed.value?.ui;
  const tool = replayed.value?.tool ?? brushTool.value;
  if (!showcase.value || !ui)
    return {
      mode: effective.value,
      shape: shape.value,
      color: color.value,
      tool: brushTool.value,
      size: settings[brushTool.value].size,
      opacity: settings[brushTool.value].opacity,
      symmetry: symmetry.value !== null,
    };
  return {
    mode: ui.mode ?? tool,
    shape: ui.shape ?? shape.value,
    color: isColor(ui.color) ? ui.color : "ink",
    tool,
    size: ui.size ?? settings[tool].size,
    opacity: 1,
    symmetry: !!ui.symmetry,
  };
});
const recordingControlsBusy = computed(() => documentBusy.value || drawing.value || session.busy.value);
const newRecording = ref(false);
const draftTitle = ref("");
const draftAuthor = ref("");
const recordingForm = computed(() => recordState.value === "idle" || newRecording.value);
function editNewRecording() {
  draftTitle.value = "";
  draftAuthor.value = recordAuthor.value;
  newRecording.value = true;
}
watch(open, (value) => {
  if (value !== "recording") newRecording.value = false;
});
Object.assign(window, { __draw: { open: session.open, play: player.play, seek: player.seek, pause: player.pause } });
const hint = computed(
  () => ready.value && !error.value && strokeCount.value === 0 && !drawing.value && !inPlayer.value,
);
const lastStroke = computed(() => layers.value.find((l) => l.id === active.value)?.strokes.at(-1)?.tool ?? "");
const caption = computed(
  () => navigator.platform !== "MacIntel" && appWindow.chrome.titleBarStyle === "hidden" && !appWindow.isFullscreen(),
);
const navigatorVersion = computed(() => [layers.value, dark.value, paper.value]);
const opacityStart = new Map<string, number>();
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
let prefsLoaded = false;

function legacyPaper(): Paper {
  try {
    return localStorage.getItem("draw.grid") === "0" ? "plain" : "dots";
  } catch {
    return "dots";
  }
}

function notify(message: string) {
  notice.value = message;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => (notice.value = ""), 2600);
}

function setMode(m: Mode) {
  if (m === "shape" && mode.value === "shape") {
    shape.value = SHAPES[(SHAPES.indexOf(shape.value) + 1) % SHAPES.length]!;
    return;
  }
  mode.value = m;
  if (isTool(m)) {
    lastTool.value = m;
    if (isInk(m)) inkTool.value = m;
  }
  if (open.value === "shape" || open.value === "brush") open.value = null;
}

function remember(c: Color) {
  if (c === "ink" || SWATCHES.includes(c)) return;
  recents.value = [c, ...recents.value.filter((r) => r.toUpperCase() !== c.toUpperCase())].slice(0, 12);
}

function chooseColor(c: Color) {
  color.value = c;
  remember(c);
  if (mode.value === "eraser" || mode.value === "eyedropper") setMode(inkTool.value);
}

function picked(c: Color) {
  chooseColor(c);
  notify(`Picked ${c}`);
}

function sampleColour() {
  open.value = null;
  setMode("eyedropper");
}

function place(event: Event | Element | null, side: "below" | "above" | "right", width: number) {
  const el = event instanceof Element ? event : (event?.currentTarget as HTMLElement | null);
  const box = el?.closest(".anchor")?.getBoundingClientRect() ?? el?.getBoundingClientRect();
  if (!box) return;
  if (side === "below")
    placement.value = { top: `${box.y + box.height + 8}px`, right: `${innerWidth - box.x - box.width}px` };
  else if (side === "right")
    placement.value = { left: `${box.x + box.width + 10}px`, top: `${clamp(box.y - 4, 48, innerHeight - 320)}px` };
  else {
    const left = clamp(box.x + box.width / 2 - width / 2, 8, innerWidth - width - 8);
    const top = el?.closest(".toolbar")?.getBoundingClientRect().y ?? box.y;
    placement.value = { left: `${left}px`, bottom: `${innerHeight - top + 10}px` };
  }
}

const SIDES: Record<Popover, ["below" | "above" | "right", number]> = {
  paint: ["above", 220],
  recording: ["below", 260],
  layers: ["below", 280],
  menu: ["below", 236],
  export: ["below", 272],
  brush: ["above", 272],
  palette: ["above", 236],
  shape: ["right", 300],
  symmetry: ["right", 264],
  view: ["above", 236],
};

function toggle(which: Popover, event: Event | Element | null) {
  hideTip();
  if (open.value === which) {
    open.value = null;
    return;
  }
  const [side, width] = SIDES[which];
  place(event, side, width);
  if (which === "view") {
    const box = (event instanceof Element ? event : (event?.currentTarget as HTMLElement | null))
      ?.closest(".anchor")
      ?.getBoundingClientRect();
    if (box)
      placement.value = { right: `${innerWidth - box.x - box.width}px`, bottom: `${innerHeight - box.y + 10}px` };
  }
  open.value = which;
}

const openFrom = (id: string, which: Popover) => toggle(which, document.getElementById(id));

function themeChange() {
  dark.value = scheme.matches;
}

function newDrawing() {
  open.value = null;
  book.replace([{ id: "layer-1", name: "Layer 1", visible: true, opacity: 1, strokes: [] }]);
  surface.home();
}

function loadSample() {
  open.value = null;
  book.replace(poppyStudy(book.nextSeq));
  surface.fitContent();
}

function clear() {
  open.value = null;
  book.clear();
}

function setSymmetry(next: Symmetry | null) {
  if (next && !symmetry.value) {
    const c = surface.centre();
    next = { ...next, x: c.x, y: c.y };
  }
  symmetry.value = next;
  if (next) lastSymmetry.value = next;
}

function centreSymmetry() {
  if (!symmetry.value) return;
  const c = surface.centre();
  setSymmetry({ ...symmetry.value, x: c.x, y: c.y });
}

function changeSettings(partial: Partial<ToolSettings>) {
  Object.assign(settings[brushTool.value], partial);
}

function resetSettings() {
  Object.assign(settings[brushTool.value], defaultSettings()[brushTool.value]);
}

function layerOpacity(id: string, value: number, final: boolean) {
  if (!opacityStart.has(id)) opacityStart.set(id, layers.value.find((l) => l.id === id)?.opacity ?? 1);
  if (!final) return book.previewOpacity(id, value);
  book.setOpacity(id, opacityStart.get(id)!, value);
  opacityStart.delete(id);
}

async function writeFile(handle: FileSystemFileHandle, blob: Blob) {
  const writer = await handle.createWritable();
  try {
    await writer.write(blob);
    await writer.close();
  } catch (e) {
    await writer.abort().catch(() => {});
    throw e;
  }
}

async function exportImage(action: "save" | "copy", format = exportFormat.value) {
  if (busy.value) return;
  if (!surface.hasContent()) {
    notify("Nothing to export yet");
    return;
  }
  if (action === "copy" && format === "svg") format = "png";
  busy.value = true;
  try {
    const svg = format === "svg";
    const target =
      action === "save"
        ? await showSaveFilePicker({
            id: "skathi-draw",
            suggestedName: svg ? "Drawing.svg" : "Drawing.png",
            types: [
              svg
                ? { description: "SVG image", accept: { "image/svg+xml": [".svg"] } }
                : { description: "PNG image", accept: { "image/png": [".png"] } },
            ],
          })
        : null;
    const background = format !== "transparent";
    const pattern = background && exportPattern.value && paper.value !== "plain";
    let blob: Blob | null;
    if (svg) {
      const b = surface.bounds();
      if (!b) return;
      const mode = dark.value ? "dark" : "light";
      const text = await toSvg(layers.value, {
        bounds: { minX: b.minX - 32, minY: b.minY - 32, maxX: b.maxX + 32, maxY: b.maxY + 32 },
        ink: INK[mode],
        paper: PAPER[mode],
        background,
        pattern: pattern ? paper.value : null,
        patternOpacity: dark.value ? 0.16 : 0.2,
      });
      blob = new Blob([text], { type: "image/svg+xml" });
    } else blob = await surface.exportPng(exportScale.value, background, pattern);
    if (!blob) return;
    if (target) {
      await writeFile(target, blob);
      notify(`Saved ${target.name}`);
    } else {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      notify("Copied to the clipboard");
    }
    open.value = null;
  } catch (e) {
    if ((e as { name?: unknown } | null)?.name !== "AbortError")
      notify(e instanceof Error ? e.message : "The image could not be made");
  } finally {
    busy.value = false;
  }
}

function selectionAction(action: "duplicate" | "copy" | "cut" | "delete" | "clear") {
  if (action === "duplicate") surface.duplicateSelection();
  else if (action === "copy" && surface.copySelection()) notify("Copied the selection");
  else if (action === "cut") surface.cutSelection();
  else if (action === "delete") surface.deleteSelection();
  else surface.clearSelection();
}

function outside(e: PointerEvent) {
  const t = e.target as HTMLElement | null;
  if (open.value && !t?.closest?.(".popover, .anchor")) open.value = null;
}

function keydown(e: KeyboardEvent) {
  if (showcase.value) {
    if (e.key === "Escape" && !player.playing.value) player.exit();
    e.preventDefault();
    return;
  }
  if (inPlayer.value) {
    if (e.key === "Escape") {
      if (cleanPlayer.value) cleanPlayer.value = false;
      else player.exit();
    } else if (e.key === "Tab" && cleanPlayer.value) cleanPlayer.value = false;
    else if (e.key === " " && (e.target as HTMLElement)?.tagName !== "BUTTON") {
      if (player.playing.value) player.pause();
      else void player.play().catch(() => {});
    } else return;
    e.preventDefault();
    return;
  }
  const tag = (e.target as HTMLElement | null)?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
  const key = e.key;
  const lower = key.toLowerCase();
  if (sheet.value) {
    if (key === "Escape" || key === "?") {
      sheet.value = false;
      e.preventDefault();
    }
    return;
  }
  if (e.ctrlKey || e.metaKey) {
    if (lower === "z" && e.shiftKey) book.redo();
    else if (lower === "z") book.undo();
    else if (lower === "y") book.redo();
    else if (lower === "0") surface.zoomTo(1);
    else if (key === "=" || key === "+") surface.zoomBy(1.25);
    else if (key === "-") surface.zoomBy(0.8);
    else if (lower === "a") {
      setMode("select");
      surface.selectAll();
    } else if (lower === "c" && e.shiftKey) void exportImage("copy", "png");
    else if (lower === "c") selectionAction("copy");
    else if (lower === "x") selectionAction("cut");
    else if (lower === "v" && surface.canPaste()) {
      setMode("select");
      surface.paste();
    } else if (lower === "d") selectionAction("duplicate");
    else if (lower === "n" && e.shiftKey) book.addLayer();
    else if (lower === "e" && e.shiftKey) openFrom("export", "export");
    else return;
    e.preventDefault();
    return;
  }
  if (key === "Alt") {
    if (!e.repeat) surface.setTemporary("eyedropper");
    e.preventDefault();
    return;
  }
  if (e.altKey) return;
  if (key === " ") {
    surface.setSpace(true);
    e.preventDefault();
    return;
  }
  if (key === "Escape") {
    if (open.value) open.value = null;
    else surface.clearSelection();
    return;
  }
  if ((key === "Delete" || key === "Backspace") && surface.deleteSelection()) {
    e.preventDefault();
    return;
  }
  if (key.startsWith("Arrow") && surface.selection()) {
    const by = e.shiftKey ? 10 : 1;
    const [dx, dy] = { ArrowLeft: [-by, 0], ArrowRight: [by, 0], ArrowUp: [0, -by], ArrowDown: [0, by] }[key] ?? [0, 0];
    surface.nudge(dx!, dy!);
    e.preventDefault();
    return;
  }
  if (key === "?") sheet.value = true;
  else if (e.shiftKey && (e.code === "Digit1" || key === "!")) surface.fitContent();
  else if (e.shiftKey && lower === "n") navigatorOn.value = !navigatorOn.value;
  else if (key === "[" || key === "]") {
    const t = brushTool.value;
    const s = settings[t];
    s.size = clamp(s.size * (key === "]" ? 1.15 : 1 / 1.15), TOOL_INFO[t].min, TOOL_INFO[t].max);
  } else if (key === "{" || key === "}") {
    const s = settings[brushTool.value];
    s.opacity = clamp(Math.round((s.opacity + (key === "}" ? 0.1 : -0.1)) * 10) / 10, 0.1, 1);
  } else if (key === "," || key === ".") surface.rotateBy(key === "," ? -15 : 15);
  else if (lower === "r" && !e.shiftKey) surface.resetRotation();
  else if (lower === "y" && !e.shiftKey) setSymmetry(symmetry.value ? null : lastSymmetry.value);
  else if (lower === "g" && !e.shiftKey) paper.value = PAPERS[(PAPERS.indexOf(paper.value) + 1) % PAPERS.length]!;
  else if (!e.shiftKey) {
    const tool = TOOLS.find((t, i) => key === String(i + 1) || lower === TOOL_INFO[t].key.toLowerCase());
    const other = (Object.keys(MODE_INFO) as (keyof typeof MODE_INFO)[]).find(
      (m) => lower === MODE_INFO[m].key.toLowerCase(),
    );
    if (tool) setMode(tool);
    else if (other) setMode(other);
    else return;
  } else return;
  e.preventDefault();
}

function keyup(e: KeyboardEvent) {
  if (e.key === " ") surface.setSpace(false);
  if (e.key === "Alt") surface.setTemporary(null);
}

function blur() {
  surface.setSpace(false);
  surface.setTemporary(null);
}

const prefs = computed(() => ({
  version: 1,
  settings: JSON.parse(JSON.stringify(settings)) as unknown,
  color: color.value,
  recents: recents.value,
  shape: shape.value,
  paper: paper.value,
  symmetry: symmetry.value,
  lastSymmetry: lastSymmetry.value,
  format: exportFormat.value,
  scale: exportScale.value,
  pattern: exportPattern.value,
  navigator: navigatorOn.value,
  mode: mode.value,
  inkTool: inkTool.value,
}));

const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object";
const number = (v: unknown, lo: number, hi: number): v is number => typeof v === "number" && v >= lo && v <= hi;

function symmetryOf(v: unknown): Symmetry | null {
  if (!record(v) || typeof v.mirror !== "boolean" || !number(v.segments, 1, 12)) return null;
  if (typeof v.x !== "number" || typeof v.y !== "number" || !Number.isFinite(v.x + v.y)) return null;
  return { mirror: v.mirror, segments: Math.round(v.segments), x: v.x, y: v.y };
}

function restore(p: unknown) {
  if (!record(p) || p.version !== 1) return;
  if (record(p.settings))
    for (const t of TOOLS) {
      const s = p.settings[t];
      if (!record(s)) continue;
      const info = TOOL_INFO[t];
      if (number(s.size, info.min, info.max)) settings[t].size = s.size;
      if (number(s.opacity, 0.05, 1)) settings[t].opacity = s.opacity;
      if (number(s.streamline, 0, 1)) settings[t].streamline = s.streamline;
      for (const k of ["hardness", "density", "scatter"] as const) if (number(s[k], 0, 1)) settings[t][k] = s[k];
      if (t === "bucket") {
        if (number(s.tolerance, 0, 255)) settings[t].tolerance = s.tolerance;
        if (number(s.gap, 0, 12)) settings[t].gap = s.gap;
        if (number(s.expand, 0, 2)) settings[t].expand = s.expand;
        if (typeof s.currentLayer === "boolean") settings[t].currentLayer = s.currentLayer;
      }
    }
  if (isColor(p.color)) color.value = p.color;
  if (Array.isArray(p.recents)) recents.value = p.recents.filter(isColor).slice(0, 12);
  if (SHAPES.includes(p.shape as Shape)) shape.value = p.shape as Shape;
  if (PAPERS.includes(p.paper as Paper)) paper.value = p.paper as Paper;
  symmetry.value = symmetryOf(p.symmetry);
  lastSymmetry.value = symmetryOf(p.lastSymmetry) ?? lastSymmetry.value;
  if (p.format === "png" || p.format === "transparent" || p.format === "svg") exportFormat.value = p.format;
  if (p.scale === 1 || p.scale === 2 || p.scale === 4) exportScale.value = p.scale;
  if (typeof p.pattern === "boolean") exportPattern.value = p.pattern;
  if (typeof p.navigator === "boolean") navigatorOn.value = p.navigator;
  if (isInk(p.inkTool)) inkTool.value = p.inkTool;
  if (isTool(p.mode)) setMode(p.mode);
}

watch(ready, (r) => {
  if (!r || prefsLoaded) return;
  prefsLoaded = true;
  restore(book.prefs());
});
watch(prefs, (p) => prefsLoaded && book.savePrefs(p));

onMounted(() => {
  scheme.addEventListener("change", themeChange);
  addEventListener("keydown", keydown);
  addEventListener("keyup", keyup);
  addEventListener("blur", blur);
  addEventListener("pointerdown", outside);
});

onBeforeUnmount(() => {
  scheme.removeEventListener("change", themeChange);
  removeEventListener("keydown", keydown);
  removeEventListener("keyup", keyup);
  removeEventListener("blur", blur);
  removeEventListener("pointerdown", outside);
  clearTimeout(noticeTimer);
});
</script>

<template>
  <main
    id="draw"
    :class="{ dark: playFrame?.ui.dark ?? dark, showcase }"
    :data-player="inPlayer"
    :data-recording="recordState"
    :aria-busy="documentBusy"
    @dragover.prevent
    @drop="session.drop"
    :data-ready="ready && drawable ? 'true' : 'false'"
    :data-strokes="playFrame ? playFrame.layers.reduce((n, l) => n + l.strokes.length, 0) : strokeCount"
    :data-tool="mode"
    :data-effective-tool="effective"
    :data-last-tool="lastStroke"
    :data-layers="layers.length"
    :data-active-layer="active"
    :data-selected="selected"
    :data-color="color"
    :data-paper="paper"
    :data-symmetry="symmetry ? (symmetry.segments > 1 ? `radial-${symmetry.segments}` : 'mirror') : 'off'"
  >
    <canvas
      ref="canvas"
      class="surface"
      :style="{ cursor }"
      @pointerdown="surface.handlers.down"
      @pointermove="surface.handlers.move"
      @pointerup="surface.handlers.up"
      @pointercancel="surface.handlers.up"
      @pointerleave="surface.handlers.leave"
      @wheel="surface.handlers.wheel"
      @contextmenu.prevent
    />

    <div v-if="error" class="unsupported" role="alert">
      <p class="unsupported-title">Drawing needs WebGPU</p>
      <p class="unsupported-body">
        {{ error }} Update the graphics driver, or run on a GPU with Direct3D 12, Metal or Vulkan.
      </p>
    </div>

    <input
      id="record-file"
      type="file"
      accept=".skev,application/x-skathi-draw-events"
      style="display: none"
      @change="session.fileInput"
    />
    <template v-if="!inPlayer || showcase">
      <header class="strip">
        <div class="cluster pill">
          <button
            id="undo"
            class="icon-button"
            aria-label="Undo"
            :disabled="!showcase && (!canUndo || documentBusy)"
            @click="book.undo"
            @pointerenter="showTip($event, 'Undo  Ctrl+Z', true)"
            @focus="showTip($event, 'Undo  Ctrl+Z', true)"
            @pointerleave="hideTip"
            @blur="hideTip"
          >
            <Icon name="undo" />
          </button>
          <button
            id="redo"
            class="icon-button"
            aria-label="Redo"
            :disabled="showcase || !canRedo || documentBusy"
            @click="book.redo"
            @pointerenter="showTip($event, 'Redo  Ctrl+Shift+Z', true)"
            @focus="showTip($event, 'Redo  Ctrl+Shift+Z', true)"
            @pointerleave="hideTip"
            @blur="hideTip"
          >
            <Icon name="redo" />
          </button>
        </div>

        <Transition name="fade">
          <div
            v-if="selected && effective === 'select'"
            class="cluster pill selection-bar"
            role="toolbar"
            aria-label="Selection"
          >
            <span class="count">{{ selected }} selected</span>
            <i class="bar-rule" />
            <button
              id="selection-duplicate"
              class="icon-button"
              aria-label="Duplicate"
              @click="selectionAction('duplicate')"
              @pointerenter="showTip($event, 'Duplicate  Ctrl+D', true)"
              @pointerleave="hideTip"
            >
              <Icon name="copy" />
            </button>
            <button
              id="selection-cut"
              class="icon-button"
              aria-label="Cut"
              @click="selectionAction('cut')"
              @pointerenter="showTip($event, 'Cut  Ctrl+X', true)"
              @pointerleave="hideTip"
            >
              <Icon name="cut" />
            </button>
            <button
              id="selection-delete"
              class="icon-button"
              aria-label="Delete"
              @click="selectionAction('delete')"
              @pointerenter="showTip($event, 'Delete  Del', true)"
              @pointerleave="hideTip"
            >
              <Icon name="trash" />
            </button>
            <button
              id="selection-clear"
              class="icon-button"
              aria-label="Deselect"
              @click="selectionAction('clear')"
              @pointerenter="showTip($event, 'Deselect  Esc', true)"
              @pointerleave="hideTip"
            >
              <Icon name="close" />
            </button>
          </div>
        </Transition>

        <div class="end">
          <div class="cluster pill anchor">
            <button
              id="recording"
              class="record-button"
              :class="{ active: session.active.value }"
              :aria-label="recordState === 'error' ? 'Recording interrupted' : 'Recording'"
              :disabled="!session.ready.value || !ready"
              @click="toggle('recording', $event)"
              @pointerenter="showTip($event, 'Recording', true)"
              @pointerleave="hideTip"
            >
              <span v-if="recordState === 'error'" role="status">Recording interrupted</span>
              <i v-else class="record-dot" :class="{ paused: recordState === 'paused' }" /><span
                v-if="session.active.value && recordState !== 'error'"
                >{{ stamp }}</span
              >
            </button>
          </div>
          <div class="cluster pill anchor">
            <button
              id="export"
              class="icon-button"
              :class="{ on: open === 'export' }"
              aria-label="Export"
              :aria-expanded="open === 'export'"
              @click="toggle('export', $event)"
              @pointerenter="showTip($event, 'Export  Ctrl+Shift+E', true)"
              @focus="showTip($event, 'Export  Ctrl+Shift+E', true)"
              @pointerleave="hideTip"
              @blur="hideTip"
            >
              <Icon name="export" />
            </button>
            <button
              id="layers"
              :disabled="documentBusy"
              class="icon-button"
              :class="{ on: open === 'layers' }"
              aria-label="Layers"
              :aria-expanded="open === 'layers'"
              @click="toggle('layers', $event)"
              @pointerenter="showTip($event, 'Layers', true)"
              @focus="showTip($event, 'Layers', true)"
              @pointerleave="hideTip"
              @blur="hideTip"
            >
              <Icon name="layers" />
            </button>
            <button
              id="menu"
              class="icon-button"
              :class="{ on: open === 'menu' }"
              aria-label="More"
              :aria-expanded="open === 'menu'"
              @click="toggle('menu', $event)"
              @pointerenter="showTip($event, 'More', true)"
              @focus="showTip($event, 'More', true)"
              @pointerleave="hideTip"
              @blur="hideTip"
            >
              <Icon name="more" />
            </button>
          </div>
          <WindowControls v-if="caption" />
        </div>
      </header>

      <ToolRail
        :mode="controls.mode"
        :shape="controls.shape"
        :symmetry="controls.symmetry"
        :open="open"
        @mode="setMode"
        @flyout="(which, e) => toggle(which, e)"
      />

      <Transition name="pop">
        <LayersPopover
          v-if="open === 'layers'"
          :style="placement"
          :layers="layers"
          :active="active"
          @select="book.selectLayer"
          @toggle="book.toggleLayer"
          @add="book.addLayer"
          @duplicate="book.duplicateLayer"
          @merge="surface.mergeDown"
          @remove="book.deleteLayer"
          @move="book.moveLayer"
          @rename="book.renameLayer"
          @properties="book.setProperties"
          @opacity="layerOpacity"
        />
      </Transition>
      <Transition name="pop">
        <ExportPopover
          v-if="open === 'export'"
          :style="placement"
          :format="exportFormat"
          :scale="exportScale"
          :pattern="exportPattern"
          :paper="paper !== 'plain'"
          :busy="busy"
          @format="(f) => (exportFormat = f)"
          @scale="(s) => (exportScale = s)"
          @pattern="(p) => (exportPattern = p)"
          @save="exportImage('save')"
          @copy="exportImage('copy')"
        />
      </Transition>
      <Transition name="pop">
        <div v-if="open === 'menu'" class="popover pill menu" :style="placement" role="menu" aria-label="More">
          <button id="new-drawing" :disabled="documentBusy" class="item" role="menuitem" @click="newDrawing">
            <Icon name="page" :size="16" />New drawing
          </button>
          <button id="load-sample" :disabled="documentBusy" class="item" role="menuitem" @click="loadSample">
            <Icon name="flower" :size="16" />Load sample
          </button>
          <i class="rule" />
          <button id="menu-recording" class="item" @click="openFrom('recording', 'recording')">
            <Icon name="record" :size="16" />Recording…
          </button>
          <button id="menu-open-recording" class="item" :disabled="session.active.value" @click="session.choose">
            Open recording…
          </button>
          <i class="rule" />
          <p class="heading">Paper</p>
          <div class="segmented papers" role="radiogroup" aria-label="Paper">
            <button
              v-for="p in PAPERS"
              :id="`paper-${p}`"
              :key="p"
              class="seg"
              :class="{ on: p === paper }"
              role="radio"
              :aria-checked="p === paper"
              :aria-label="PAPER_INFO[p].name"
              @click="paper = p"
              @pointerenter="showTip($event, `${PAPER_INFO[p].name}  G`)"
              @pointerleave="hideTip"
            >
              <Icon :name="p === 'dots' ? 'grid' : p" />
            </button>
          </div>
          <i class="rule" />
          <button id="show-shortcuts" class="item" role="menuitem" @click="((open = null), (sheet = true))">
            <Icon name="keyboard" :size="16" />Keyboard shortcuts<kbd class="shortcut">?</kbd>
          </button>
          <i class="rule" />
          <button id="clear" class="item danger" role="menuitem" :disabled="!strokeCount" @click="clear">
            <Icon name="erase" :size="16" />Clear
          </button>
        </div>
      </Transition>
      <Transition name="pop">
        <BrushPopover
          v-if="open === 'brush'"
          :style="placement"
          :tool="brushTool"
          :settings="settings[brushTool]"
          :paper="PAPER[dark ? 'dark' : 'light']"
          :color="color === 'ink' ? ink : color"
          :shape="mode === 'shape'"
          @change="changeSettings"
          @reset="resetSettings"
        />
      </Transition>
      <Transition name="pop">
        <ColorPopover
          v-if="open === 'palette'"
          :style="placement"
          :color="color"
          :ink="ink"
          :recents="recents"
          @color="chooseColor"
          @eyedropper="sampleColour"
        />
      </Transition>
      <Transition name="pop">
        <ShapePopover
          v-if="open === 'shape'"
          :style="placement"
          :shape="shape"
          :ink="inkTool"
          @shape="(s) => ((shape = s), (open = null))"
        />
      </Transition>
      <Transition name="pop">
        <SymmetryPopover
          v-if="open === 'symmetry'"
          :style="placement"
          :symmetry="symmetry"
          :last="lastSymmetry"
          @change="setSymmetry"
          @centre="centreSymmetry"
        />
      </Transition>
      <Transition name="pop">
        <div
          v-if="open === 'view'"
          class="popover pill menu view-menu"
          :style="placement"
          role="menu"
          aria-label="View"
        >
          <button id="zoom-actual" class="item" role="menuitem" @click="surface.zoomTo(1)">
            <Icon name="page" :size="16" />Actual size<kbd class="shortcut">Ctrl+0</kbd>
          </button>
          <button id="zoom-fit" class="item" role="menuitem" @click="surface.fitContent()">
            <Icon name="fit" :size="16" />Fit drawing<kbd class="shortcut">Shift+1</kbd>
          </button>
          <i class="rule" />
          <p class="heading">Rotation</p>
          <div class="rotation">
            <button
              id="rotate-left"
              class="icon-button"
              aria-label="Rotate left"
              @click="surface.rotateBy(-15)"
              @pointerenter="showTip($event, 'Rotate left  ,')"
              @pointerleave="hideTip"
            >
              <Icon name="rotate-left" />
            </button>
            <span class="degrees">{{ angle }}°</span>
            <button
              id="rotate-right"
              class="icon-button"
              aria-label="Rotate right"
              @click="surface.rotateBy(15)"
              @pointerenter="showTip($event, 'Rotate right  .')"
              @pointerleave="hideTip"
            >
              <Icon name="rotate-right" />
            </button>
            <button id="rotate-reset" class="text-button small" :disabled="!angle" @click="surface.resetRotation()">
              <Icon name="compass" :size="16" />Reset
            </button>
          </div>
        </div>
      </Transition>

      <p class="hint" :class="{ shown: hint }" aria-hidden="true">
        Draw anywhere. Pinch or Ctrl+scroll to zoom. Press ? for shortcuts.
      </p>

      <div
        v-if="open === 'recording'"
        class="popover pill menu recording-panel"
        :style="placement"
        role="dialog"
        aria-label="Recording"
      >
        <p class="heading">
          {{ recordingForm ? "New recording" : recordState === "stopped" ? "Recording stopped" : "Recording" }}
        </p>
        <template v-if="recordState === 'error'">
          <small role="alert">{{ session.error.value }}</small>
          <button id="record-retry" class="item" :disabled="session.busy.value" @click="session.retry">
            Retry recording
          </button>
        </template>
        <template v-else-if="recordingForm">
          <input
            v-model="draftTitle"
            aria-label="Recording title"
            placeholder="Title (optional)"
            class="record-field"
          />
          <input v-model="draftAuthor" aria-label="Artist name" placeholder="Artist (optional)" class="record-field" />
          <small v-if="newRecording"
            >Starting will replace the recording kept in Draw. Save a copy first if you want to keep it.</small
          >
          <button
            id="record-start"
            class="item"
            :disabled="recordingControlsBusy"
            @click="session.start({ title: draftTitle, author: draftAuthor })"
          >
            <Icon name="record" :size="16" />Start recording
          </button>
          <button
            v-if="newRecording"
            id="record-cancel-new"
            class="item"
            :disabled="recordingControlsBusy"
            @click="newRecording = false"
          >
            Cancel
          </button>
        </template>
        <template v-else-if="session.active.value">
          <button
            v-if="recordState === 'recording'"
            id="record-pause"
            class="item"
            :disabled="recordingControlsBusy"
            @click="session.pause"
          >
            Pause recording
          </button>
          <button v-else id="record-resume" class="item" :disabled="recordingControlsBusy" @click="session.resume">
            Resume recording
          </button>
          <button id="record-stop" class="item" :disabled="recordingControlsBusy" @click="session.stop">
            Stop recording
          </button>
        </template>
        <template v-else>
          <div class="record-summary">
            <strong>{{ recordTitle || "Untitled recording" }}</strong
            ><span>{{ stamp }}</span>
          </div>
        </template>
        <template v-if="!recordingForm && recordState !== 'error'">
          <button
            id="record-save"
            :class="recordState === 'stopped' ? 'primary' : 'item'"
            :disabled="recordingControlsBusy"
            @click="session.save"
          >
            <Icon name="export" :size="15" />{{
              session.saving.value
                ? "Preparing file…"
                : session.saveError.value
                  ? "Try saving again…"
                  : "Save recording…"
            }}
          </button>
          <small v-if="session.saveError.value" id="record-save-error" role="alert">{{
            session.saveError.value
          }}</small>
          <small v-else-if="session.saveStatus.value" role="status">{{ session.saveStatus.value }}</small>
          <button
            v-if="recordState === 'stopped'"
            id="record-preview"
            class="item"
            :disabled="recordingControlsBusy"
            @click="session.preview"
          >
            Play this recording
          </button>
        </template>
        <template v-if="recordState !== 'error' && !newRecording">
          <i class="rule" />
          <button
            id="record-protect"
            class="item"
            role="checkbox"
            :aria-checked="protectRecording"
            :disabled="recordingControlsBusy"
            @click="protectRecording = !protectRecording"
          >
            <Icon :name="protectRecording ? 'check' : 'rect'" :size="15" />Protect recording
          </button>
          <small>View-only flag. The file is unencrypted.</small>
          <template v-if="!session.active.value">
            <i class="rule" />
            <button
              v-if="recordState === 'stopped'"
              id="record-new"
              class="item"
              :disabled="recordingControlsBusy"
              @click="editNewRecording"
            >
              New recording…
            </button>
            <button id="record-open" class="item" :disabled="recordingControlsBusy" @click="session.choose">
              Open recording…
            </button>
          </template>
        </template>
      </div>
      <div v-if="open === 'paint'" class="popover pill menu" :style="placement" role="menu" aria-label="Painting tools">
        <button
          v-for="t in PAINT_TOOLS"
          :key="t"
          :id="'tool-' + t"
          class="item"
          @click="
            setMode(t);
            openFrom('brush-settings', 'brush');
          "
        >
          <Icon :name="t" />{{ TOOL_INFO[t].name }}<kbd class="shortcut">{{ TOOL_INFO[t].key }}</kbd>
        </button>
      </div>
      <Toolbar
        :tool="isTool(controls.mode) ? controls.mode : null"
        :color="controls.color"
        :ink="ink"
        :brush-tool="controls.tool"
        :size="controls.size"
        :opacity="controls.opacity"
        :open="open"
        @paint="(e) => toggle('paint', e)"
        @tool="setMode"
        @color="chooseColor"
        @brush="(e) => toggle('brush', e)"
        @palette="(e) => toggle('palette', e)"
      />

      <Navigator
        v-if="navigatorOn && drawable && !inPlayer"
        :version="navigatorVersion"
        :thumbnail="surface.thumbnail"
        :viewport="surface.viewport"
        :on-view="surface.onView"
        @centre="surface.centreOn"
      />
      <ViewControls
        :view="viewState"
        :navigator="navigatorOn"
        :open="open === 'view'"
        @zoom-in="surface.zoomBy(1.25)"
        @zoom-out="surface.zoomBy(0.8)"
        @menu="(e) => toggle('view', e)"
        @navigator="navigatorOn = !navigatorOn"
      />
    </template>
    <template v-if="inPlayer">
      <div
        v-if="playCursor"
        class="play-cursor"
        :style="{
          left: playCursor.x + 'px',
          top: playCursor.y + 'px',
          width: 2 * Math.max(playCursor.r, showcase ? 6 : 0) + 'px',
          height: 2 * Math.max(playCursor.r, showcase ? 6 : 0) + 'px',
          borderColor: playCursor.color,
        }"
      >
        <span v-if="!cleanPlayer && !showcase">{{ TOOL_INFO[playCursor.label as Tool]?.name }}</span>
      </div>
      <PlayerTransport v-if="!cleanPlayer && !showcase" :player="player" />
    </template>
    <p v-if="documentBusy || notice" class="notice pill" role="status">
      {{ documentBusy ? "Applying changes…" : notice }}
    </p>

    <ShortcutsSheet v-if="sheet" @close="sheet = false" />

    <div v-if="tip" class="tip" :class="tip.place" :style="{ left: `${tip.x}px`, top: `${tip.y}px` }">
      <span>{{ tipParts[0] }}</span
      ><kbd v-if="tipParts[1]">{{ tipParts[1] }}</kbd>
    </div>
  </main>
</template>
