<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { Bounds, Point } from "../geometry";

const W = 216;
const H = 144;

type Thumbnail = { pixels: Uint8ClampedArray; w: number; h: number; bounds: Bounds; scale: number } | null;

const props = defineProps<{
  /** Changes whenever the picture should be redrawn. */
  version: unknown;
  thumbnail: (w: number, h: number) => Promise<Thumbnail>;
  viewport: () => Point[];
  onView: (fn: () => void) => () => void;
}>();
const emit = defineEmits<{ centre: [number, number] }>();

const canvas = ref<HTMLCanvasElement | null>(null);
const frame = ref<HTMLElement | null>(null);
let shown: Thumbnail = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let off: (() => void) | undefined;
let dragging = -1;

async function paint() {
  const dpr = devicePixelRatio || 1;
  const image = await props.thumbnail(Math.round(W * dpr), Math.round(H * dpr));
  const el = canvas.value;
  const ctx = el?.getContext("2d");
  if (!image || !el || !ctx) return;
  el.width = image.w;
  el.height = image.h;
  const data = ctx.createImageData(image.w, image.h);
  data.data.set(image.pixels);
  ctx.putImageData(data, 0, 0);
  shown = { ...image, scale: image.scale / dpr };
  place();
}

/** Moves the viewport frame by writing its style directly, so panning re-renders nothing. */
function place() {
  const el = frame.value;
  if (!el || !shown) return;
  const [a, b, , d] = props.viewport() as [Point, Point, Point, Point];
  const map = (p: Point) => ({
    x: (p.x - shown!.bounds.minX) * shown!.scale,
    y: (p.y - shown!.bounds.minY) * shown!.scale,
  });
  const pa = map(a);
  const pb = map(b);
  const pd = map(d);
  const w = Math.hypot(pb.x - pa.x, pb.y - pa.y);
  const h = Math.hypot(pd.x - pa.x, pd.y - pa.y);
  const turn = Math.atan2(pb.y - pa.y, pb.x - pa.x);
  el.style.width = `${w}px`;
  el.style.height = `${h}px`;
  el.style.transform = `translate(${pa.x}px, ${pa.y}px) rotate(${turn}rad)`;
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => void paint(), 250);
}

function point(e: PointerEvent) {
  if (!shown || !canvas.value) return;
  const box = canvas.value.getBoundingClientRect();
  emit(
    "centre",
    shown.bounds.minX + (e.clientX - box.x) / shown.scale,
    shown.bounds.minY + (e.clientY - box.y) / shown.scale,
  );
}

function down(e: PointerEvent) {
  if (e.button !== 0) return;
  dragging = e.pointerId;
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  point(e);
}

function move(e: PointerEvent) {
  if (dragging === e.pointerId) point(e);
}

function up(e: PointerEvent) {
  if (dragging !== e.pointerId) return;
  dragging = -1;
  schedule();
}

watch(() => props.version, schedule);

onMounted(() => {
  void paint();
  off = props.onView(place);
});

onBeforeUnmount(() => {
  clearTimeout(timer);
  off?.();
});
</script>

<template>
  <div class="navigator" aria-label="Navigator">
    <div
      class="map"
      :style="{ width: `${W}px`, height: `${H}px` }"
      @pointerdown="down"
      @pointermove="move"
      @pointerup="up"
      @pointercancel="up"
    >
      <canvas ref="canvas" class="thumb" :style="{ width: `${W}px`, height: `${H}px` }" />
      <i ref="frame" class="frame" />
    </div>
  </div>
</template>

<style scoped>
.navigator {
  position: absolute;
  right: 16px;
  bottom: 60px;
  border-radius: 14px;
  border: 1px solid var(--frame);
  box-shadow:
    0 12px 32px #0000002e,
    0 2px 8px #0000001f;
  overflow: hidden;
}
.map {
  position: relative;
  z-index: 1;
  overflow: hidden;
  cursor: pointer;
  touch-action: none;
}
.thumb {
  display: block;
}
.frame {
  position: absolute;
  left: 0;
  top: 0;
  box-sizing: border-box;
  border: 1.5px solid #3b82f6;
  border-radius: 3px;
  transform-origin: 0 0;
  pointer-events: none;
}
@media (max-width: 900px) {
  .navigator {
    bottom: 152px;
  }
}
</style>
