<script setup lang="ts">
import { computed, ref } from "vue";
import type { Layer } from "../model";
import { hideTip, showTip } from "../tooltip";
import Icon from "./Icon.vue";
import Slider from "./Slider.vue";

const ROW = 38;

const props = defineProps<{ layers: readonly Layer[]; active: string }>();
const emit = defineEmits<{
  select: [string];
  toggle: [string];
  add: [];
  duplicate: [string];
  merge: [string];
  remove: [string];
  move: [string, number];
  rename: [string, string];
  opacity: [string, number, boolean];
}>();

const rows = computed(() => props.layers.map((layer, index) => ({ layer, index })).reverse());
const current = computed(() => props.layers.find((l) => l.id === props.active));
const activeIndex = computed(() => props.layers.findIndex((l) => l.id === props.active));
const editing = ref<string | null>(null);
const draft = ref("");
const drag = ref<{ id: string; from: number; dy: number; pointer: number; start: number } | null>(null);
const vFocus = {
  mounted: (el: HTMLInputElement) => {
    el.focus();
    el.select();
  },
};

function edit(layer: Layer) {
  editing.value = layer.id;
  draft.value = layer.name;
}

function commit() {
  if (editing.value) emit("rename", editing.value, draft.value);
  editing.value = null;
}

/** The row slot the dragged row would land in, top first. */
const slot = computed(() => {
  const d = drag.value;
  if (!d) return -1;
  return Math.max(0, Math.min(rows.value.length - 1, d.from + Math.round(d.dy / ROW)));
});

function offset(visual: number, id: string): number {
  const d = drag.value;
  if (!d) return 0;
  if (id === d.id) return d.dy;
  const to = slot.value;
  if (d.from < visual && visual <= to) return -ROW;
  if (to <= visual && visual < d.from) return ROW;
  return 0;
}

function grab(e: PointerEvent, id: string, visual: number) {
  if (e.button !== 0) return;
  e.stopPropagation();
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  drag.value = { id, from: visual, dy: 0, pointer: e.pointerId, start: e.clientY };
}

function pull(e: PointerEvent) {
  const d = drag.value;
  if (!d || d.pointer !== e.pointerId) return;
  const max = (rows.value.length - 1 - d.from) * ROW;
  d.dy = Math.max(-d.from * ROW, Math.min(max, e.clientY - d.start));
}

function drop(e: PointerEvent) {
  const d = drag.value;
  if (!d || d.pointer !== e.pointerId) return;
  const to = slot.value;
  drag.value = null;
  if (to !== d.from) emit("move", d.id, props.layers.length - 1 - to);
}

function nudge(e: KeyboardEvent, layer: Layer, index: number) {
  if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
  e.preventDefault();
  e.stopPropagation();
  emit("move", layer.id, index + (e.key === "ArrowUp" ? 1 : -1));
}
</script>

<template>
  <div class="popover pill layers" role="dialog" aria-label="Layers">
    <ul class="list" role="listbox" aria-label="Layers" :style="{ height: `${rows.length * ROW - 2}px` }">
      <li
        v-for="({ layer, index }, visual) in rows"
        :key="layer.id"
        class="row"
        :class="{
          active: layer.id === active,
          hidden: !layer.visible,
          dragging: drag?.id === layer.id,
          settling: drag !== null && drag.id !== layer.id,
        }"
        :style="{ top: `${visual * ROW}px`, transform: `translateY(${offset(visual, layer.id)}px)` }"
        role="option"
        :aria-selected="layer.id === active"
        @click="emit('select', layer.id)"
      >
        <button
          class="icon-button small"
          :aria-label="layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`"
          @click.stop="emit('toggle', layer.id)"
        >
          <Icon :name="layer.visible ? 'eye' : 'hidden'" :size="16" />
        </button>
        <input
          v-if="editing === layer.id"
          v-focus
          v-model="draft"
          class="rename"
          aria-label="Layer name"
          @keydown.enter="commit"
          @keydown.esc="editing = null"
          @blur="commit"
          @click.stop
        />
        <span v-else class="name" @dblclick.stop="edit(layer)">{{ layer.name }}</span>
        <span v-if="layer.opacity < 1" class="meta">{{ Math.round(layer.opacity * 100) }}%</span>
        <span class="meta count">{{ layer.strokes.length || "" }}</span>
        <button
          class="grip"
          :aria-label="`Reorder ${layer.name}`"
          @pointerdown="grab($event, layer.id, visual)"
          @pointermove="pull"
          @pointerup="drop"
          @pointercancel="drop"
          @click.stop
          @keydown="nudge($event, layer, index)"
        >
          <Icon name="grip" :size="16" />
        </button>
      </li>
    </ul>
    <div v-if="current" class="opacity">
      <Slider
        id="layer-opacity"
        label="Opacity"
        :value="current.opacity"
        :min="0"
        :max="1"
        :text="`${Math.round(current.opacity * 100)}%`"
        @input="(v) => emit('opacity', current!.id, v, false)"
        @change="(v) => emit('opacity', current!.id, v, true)"
      />
    </div>
    <div class="footer">
      <button id="add-layer" class="text-button" @click="emit('add')"><Icon name="plus" :size="16" />New layer</button>
      <span class="tools">
        <button
          id="duplicate-layer"
          class="icon-button small"
          aria-label="Duplicate layer"
          @click="emit('duplicate', active)"
          @pointerenter="showTip($event, 'Duplicate layer', true)"
          @pointerleave="hideTip"
        >
          <Icon name="copy" :size="16" />
        </button>
        <button
          id="merge-layer"
          class="icon-button small"
          aria-label="Merge down"
          :disabled="activeIndex < 1"
          @click="emit('merge', active)"
          @pointerenter="showTip($event, 'Merge down', true)"
          @pointerleave="hideTip"
        >
          <Icon name="merge" :size="16" />
        </button>
        <button
          id="delete-layer"
          class="icon-button small"
          aria-label="Delete layer"
          :disabled="layers.length < 2"
          @click="emit('remove', active)"
          @pointerenter="showTip($event, 'Delete layer', true)"
          @pointerleave="hideTip"
        >
          <Icon name="trash" :size="16" />
        </button>
      </span>
    </div>
  </div>
</template>

<style scoped>
.layers {
  width: 280px;
  padding: 6px;
}
.list {
  position: relative;
  z-index: 1;
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 340px;
  overflow-y: auto;
}
.row {
  position: absolute;
  left: 0;
  right: 0;
  height: 36px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 4px;
  border-radius: 10px;
  cursor: default;
  transition: background-color 150ms ease;
}
.row.settling {
  transition:
    background-color 150ms ease,
    transform 160ms ease;
}
.row.dragging {
  z-index: 1;
  background: #3a3a3e;
  box-shadow: 0 6px 18px #00000059;
}
.row:hover {
  background: #ffffff0d;
}
.row.active {
  background: #ffffff1f;
}
.row.hidden .name {
  color: #ffffff70;
}
.name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 13px;
}
.rename {
  flex: 1;
  min-width: 0;
  height: 26px;
  padding: 0 6px;
  border: 1px solid #ffffff3a;
  border-radius: 6px;
  background: #ffffff12;
  color: #f2f2f4;
  font: inherit;
  font-size: 13px;
}
.meta {
  font-size: 11px;
  color: #ffffff66;
  font-variant-numeric: tabular-nums;
}
.count {
  min-width: 14px;
  text-align: right;
}
.grip {
  width: 24px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: #f2f2f48c;
  cursor: grab;
  opacity: 0;
  touch-action: none;
  transition: opacity 150ms ease;
}
.row:hover .grip,
.row.active .grip,
.row.dragging .grip,
.grip:focus-visible {
  opacity: 1;
}
.row.dragging .grip {
  cursor: grabbing;
}
.grip:focus-visible {
  outline: 2px solid #ffffffd0;
}
.opacity {
  margin-top: 6px;
}
.footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid #ffffff14;
}
.tools {
  display: flex;
  gap: 2px;
}
@media (prefers-reduced-motion: reduce) {
  .row,
  .row.settling,
  .grip {
    transition: none;
  }
}
</style>
