<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { appWindow } from "@skathi-native/runtime";
import Icon from "./components/Icon.vue";
import LayersPopover from "./components/LayersPopover.vue";
import Toolbar from "./components/Toolbar.vue";
import { INK, TOOL_INFO, TOOLS, type Color, type Tool } from "./model";
import { poppyStudy } from "./sample";
import { useSketchbook } from "./sketchbook";
import { useSurface, widthOf } from "./surface";
import { hideTip, showTip, tip } from "./tooltip";

const scheme = matchMedia("(prefers-color-scheme: dark)");
const dark = ref(scheme.matches);
const grid = ref(readGrid());
const tool = ref<Tool>("pen");
const color = ref<Color>("ink");
const widths = reactive<Record<Tool, number>>({ pen: 1, brush: 1, marker: 1, pencil: 1, eraser: 1 });
const canvas = ref<HTMLCanvasElement | null>(null);
const open = ref<"layers" | "menu" | null>(null);
const notice = ref("");
const busy = ref(false);
const placement = ref({ top: "50px", right: "8px" });
const tipParts = computed(() => tip.value?.text.split("  ") ?? []);
const book = useSketchbook();
const { layers, active, ready, canUndo, canRedo, strokeCount } = book;
const surface = useSurface({
  canvas,
  book,
  tool,
  color,
  width: (t) => widthOf(t, widths[t]),
  dark,
  grid,
});
const { error, zoom, zooming, drawing, panning, space, effective, ready: drawable } = surface;
const ink = computed(() => INK[dark.value ? "dark" : "light"]);
const width = computed(() => widths[effective.value]);
const hint = computed(() => ready.value && !error.value && strokeCount.value === 0 && !drawing.value);
const cursor = computed(() => (panning.value ? "grabbing" : space.value ? "grab" : "crosshair"));
const lastTool = computed(() => layers.value.find((l) => l.id === active.value)?.strokes.at(-1)?.tool ?? "");
const caption = navigator.platform !== "MacIntel" && appWindow.chrome.titleBarStyle === "hidden";
let noticeTimer: ReturnType<typeof setTimeout> | undefined;

function readGrid(): boolean {
  try {
    return localStorage.getItem("draw.grid") !== "0";
  } catch {
    return true;
  }
}

function notify(message: string) {
  notice.value = message;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => (notice.value = ""), 2600);
}

function chooseTool(t: Tool) {
  tool.value = t;
}

function chooseColor(c: Color) {
  color.value = c;
  if (tool.value === "eraser") tool.value = "pen";
}

function toggle(which: "layers" | "menu", event: Event) {
  hideTip();
  const box = (event.currentTarget as HTMLElement).closest(".anchor")?.getBoundingClientRect();
  if (box) placement.value = { top: `${box.y + box.height + 8}px`, right: `${innerWidth - box.x - box.width}px` };
  open.value = open.value === which ? null : which;
}

function themeChange() {
  dark.value = scheme.matches;
}

function paintCaption() {
  if (caption) appWindow.setTitleBarOverlay({ symbolColor: dark.value ? "#F2F2F4" : "#1C1C1E" });
}

function setGrid(on: boolean) {
  grid.value = on;
  try {
    localStorage.setItem("draw.grid", on ? "1" : "0");
  } catch {}
}

function newDrawing() {
  open.value = null;
  book.replace([{ id: "layer-1", name: "Layer 1", visible: true, strokes: [] }]);
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

async function image(copy: boolean) {
  open.value = null;
  if (busy.value) return;
  if (!surface.hasContent()) {
    notify("Nothing to export yet");
    return;
  }
  busy.value = true;
  try {
    const target = copy
      ? null
      : await showSaveFilePicker({
          id: "skathi-draw",
          suggestedName: "Drawing.png",
          types: [{ description: "PNG image", accept: { "image/png": [".png"] } }],
        });
    const blob = await surface.exportPng();
    if (!blob) return;
    if (target) {
      const writer = await target.createWritable();
      try {
        await writer.write(blob);
        await writer.close();
      } catch (e) {
        await writer.abort().catch(() => {});
        throw e;
      }
      notify(`Saved ${target.name}`);
    } else {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      notify("Copied");
    }
  } catch (e) {
    if ((e as { name?: unknown } | null)?.name !== "AbortError")
      notify(e instanceof Error ? e.message : "The image could not be made");
  } finally {
    busy.value = false;
  }
}

function outside(e: PointerEvent) {
  const t = e.target as HTMLElement | null;
  if (open.value && !t?.closest?.(".popover, .anchor")) open.value = null;
}

function keydown(e: KeyboardEvent) {
  if ((e.target as HTMLElement | null)?.tagName === "INPUT") return;
  const key = e.key.toLowerCase();
  if (e.ctrlKey || e.metaKey) {
    if (key === "z" && e.shiftKey) book.redo();
    else if (key === "z") book.undo();
    else if (key === "y") book.redo();
    else if (key === "0") surface.resetZoom();
    else if (key === "=" || key === "+") surface.zoomBy(1.25);
    else if (key === "-") surface.zoomBy(0.8);
    else return;
    e.preventDefault();
    return;
  }
  if (e.altKey) return;
  if (key === " ") {
    if (!e.repeat) surface.setSpace(true);
    e.preventDefault();
    return;
  }
  if (key === "escape") {
    open.value = null;
    return;
  }
  const picked = TOOLS.find((t, i) => key === String(i + 1) || key === TOOL_INFO[t].key.toLowerCase());
  if (picked) tool.value = picked;
  else if (key === "[" || key === "]") {
    const t = tool.value;
    widths[t] = Math.max(0, Math.min(2, widths[t] + (key === "]" ? 1 : -1)));
  } else return;
  e.preventDefault();
}

function keyup(e: KeyboardEvent) {
  if (e.key === " ") surface.setSpace(false);
}

function blur() {
  surface.setSpace(false);
}

watch(dark, paintCaption);

onMounted(() => {
  paintCaption();
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
    :class="{ dark }"
    :data-ready="ready && drawable ? 'true' : 'false'"
    :data-strokes="strokeCount"
    :data-tool="tool"
    :data-effective-tool="effective"
    :data-last-tool="lastTool"
    :data-layers="layers.length"
    :data-zoom="zoom"
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

    <header class="strip">
      <div class="cluster pill">
        <button
          id="undo"
          class="icon-button"
          aria-label="Undo"
          :disabled="!canUndo"
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
          :disabled="!canRedo"
          @click="book.redo"
          @pointerenter="showTip($event, 'Redo  Ctrl+Shift+Z', true)"
          @focus="showTip($event, 'Redo  Ctrl+Shift+Z', true)"
          @pointerleave="hideTip"
          @blur="hideTip"
        >
          <Icon name="redo" />
        </button>
      </div>
      <div class="cluster pill anchor">
        <button
          id="layers"
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
    </header>

    <Transition name="pop">
      <LayersPopover
        v-if="open === 'layers'"
        :style="placement"
        :layers="layers"
        :active="active"
        @select="book.selectLayer"
        @toggle="book.toggleLayer"
        @add="book.addLayer"
        @remove="book.deleteLayer"
        @move="book.moveLayer"
        @rename="book.renameLayer"
      />
    </Transition>
    <Transition name="pop">
      <div v-if="open === 'menu'" class="popover pill menu" :style="placement" role="menu" aria-label="More">
        <button id="new-drawing" class="item" role="menuitem" @click="newDrawing">
          <Icon name="page" :size="16" />New drawing
        </button>
        <button id="load-sample" class="item" role="menuitem" @click="loadSample">
          <Icon name="flower" :size="16" />Load sample
        </button>
        <i class="rule" />
        <button id="export-png" class="item" role="menuitem" :disabled="busy" @click="image(false)">
          <Icon name="export" :size="16" />Export PNG…
        </button>
        <button id="copy-image" class="item" role="menuitem" :disabled="busy" @click="image(true)">
          <Icon name="copy" :size="16" />Copy image
        </button>
        <i class="rule" />
        <button id="toggle-grid" class="item" role="menuitemcheckbox" :aria-checked="grid" @click="setGrid(!grid)">
          <Icon name="grid" :size="16" />Show grid<Icon v-if="grid" class="check" name="check" :size="16" />
        </button>
        <i class="rule" />
        <button id="clear" class="item danger" role="menuitem" :disabled="!strokeCount" @click="clear">
          <Icon name="erase" :size="16" />Clear
        </button>
      </div>
    </Transition>

    <p class="hint" :class="{ shown: hint }" aria-hidden="true">Draw anywhere. Pinch or Ctrl+scroll to zoom.</p>

    <Toolbar
      :tool="effective"
      :color="color"
      :ink="ink"
      :width="width"
      @tool="chooseTool"
      @color="chooseColor"
      @width="(i) => (widths[tool] = i)"
    />

    <button
      class="zoom pill"
      :class="{ shown: zooming }"
      :aria-label="`Zoom ${Math.round(zoom * 100)}%, reset to 100%`"
      @click="surface.resetZoom"
    >
      {{ Math.round(zoom * 100) }}%
    </button>

    <p v-if="notice" class="notice pill" role="status">{{ notice }}</p>

    <div v-if="tip" class="tip" :class="{ below: tip.below }" :style="{ left: `${tip.x}px`, top: `${tip.y}px` }">
      <span>{{ tipParts[0] }}</span
      ><kbd v-if="tipParts[1]">{{ tipParts[1] }}</kbd>
    </div>
  </main>
</template>
