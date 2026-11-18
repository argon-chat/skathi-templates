<script setup lang="ts">
import { computed, ref } from "vue";

const props = withDefaults(
  defineProps<{
    value: number;
    min: number;
    max: number;
    label: string;
    text: string;
    /** Above 1, the low end gets more of the track: for sizes, where small steps matter most. */
    curve?: number;
    step?: number;
  }>(),
  { curve: 1, step: 0.01 },
);
const emit = defineEmits<{ input: [number]; change: [number] }>();

const track = ref<HTMLElement | null>(null);
const dragging = ref(false);
const fraction = computed(() => {
  const u = (props.value - props.min) / (props.max - props.min);
  return Math.min(1, Math.max(0, u)) ** (1 / props.curve);
});

function valueAt(clientX: number): number {
  const box = track.value?.getBoundingClientRect();
  if (!box) return props.value;
  const u = Math.min(1, Math.max(0, (clientX - box.x) / box.width));
  return props.min + (props.max - props.min) * u ** props.curve;
}

function down(e: PointerEvent) {
  if (e.button !== 0) return;
  dragging.value = true;
  track.value?.setPointerCapture(e.pointerId);
  emit("input", valueAt(e.clientX));
}

function move(e: PointerEvent) {
  if (dragging.value) emit("input", valueAt(e.clientX));
}

function up(e: PointerEvent) {
  if (!dragging.value) return;
  dragging.value = false;
  emit("change", valueAt(e.clientX));
}

function key(e: KeyboardEvent) {
  const range = props.max - props.min;
  const by = e.shiftKey ? range / 10 : Math.max(props.step, range / 100);
  const next =
    e.key === "ArrowRight" || e.key === "ArrowUp"
      ? props.value + by
      : e.key === "ArrowLeft" || e.key === "ArrowDown"
        ? props.value - by
        : e.key === "Home"
          ? props.min
          : e.key === "End"
            ? props.max
            : null;
  if (next === null) return;
  e.preventDefault();
  e.stopPropagation();
  const v = Math.min(props.max, Math.max(props.min, next));
  emit("input", v);
  emit("change", v);
}
</script>

<template>
  <div
    ref="track"
    class="slider"
    :class="{ dragging }"
    role="slider"
    tabindex="0"
    :aria-label="label"
    :aria-valuemin="min"
    :aria-valuemax="max"
    :aria-valuenow="value"
    :aria-valuetext="text"
    @pointerdown="down"
    @pointermove="move"
    @pointerup="up"
    @pointercancel="up"
    @keydown="key"
  >
    <span class="fill" :style="{ width: `${fraction * 100}%` }" />
    <span class="label">{{ label }}</span>
    <span class="value">{{ text }}</span>
  </div>
</template>

<style scoped>
.slider {
  position: relative;
  z-index: 1;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  border-radius: 10px;
  background: #ffffff10;
  overflow: hidden;
  cursor: ew-resize;
  touch-action: none;
}
.slider:focus-visible {
  outline: 2px solid #ffffffd0;
  outline-offset: 1px;
}
.fill {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  background: #ffffff26;
  transition: background-color 150ms ease;
}
.slider:hover .fill,
.slider.dragging .fill {
  background: #ffffff33;
}
.label,
.value {
  position: relative;
  z-index: 1;
  font-size: 12px;
  pointer-events: none;
}
.label {
  color: #f2f2f4e0;
}
.value {
  color: #f2f2f499;
  font-variant-numeric: tabular-nums;
}
</style>
