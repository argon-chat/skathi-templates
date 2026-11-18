<script setup lang="ts">
import { computed, ref } from "vue";
import type { Layer } from "../model";
import { hideTip, showTip } from "../tooltip";
import Icon from "./Icon.vue";

const props = defineProps<{ layers: readonly Layer[]; active: string }>();
const emit = defineEmits<{
  select: [string];
  toggle: [string];
  add: [];
  remove: [string];
  move: [string, number];
  rename: [string, string];
}>();

const rows = computed(() => props.layers.map((layer, index) => ({ layer, index })).reverse());
const editing = ref<string | null>(null);
const draft = ref("");
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
</script>

<template>
  <div class="popover pill layers" role="dialog" aria-label="Layers">
    <ul class="list" role="listbox" aria-label="Layers">
      <li
        v-for="{ layer, index } in rows"
        :key="layer.id"
        class="row"
        :class="{ active: layer.id === active, hidden: !layer.visible }"
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
        <span class="count">{{ layer.strokes.length || "" }}</span>
        <span class="order">
          <button
            class="icon-button tiny"
            :disabled="index === layers.length - 1"
            :aria-label="`Move ${layer.name} up`"
            @click.stop="emit('move', layer.id, index + 1)"
          >
            <Icon name="up" :size="14" />
          </button>
          <button
            class="icon-button tiny"
            :disabled="index === 0"
            :aria-label="`Move ${layer.name} down`"
            @click.stop="emit('move', layer.id, index - 1)"
          >
            <Icon name="down" :size="14" />
          </button>
        </span>
      </li>
    </ul>
    <div class="footer">
      <button id="add-layer" class="text-button" @click="emit('add')"><Icon name="plus" :size="16" />New layer</button>
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
    </div>
  </div>
</template>

<style scoped>
.layers {
  width: 272px;
  padding: 6px;
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 320px;
  overflow-y: auto;
}
.row {
  height: 36px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 4px;
  border-radius: 10px;
  cursor: default;
  transition: background-color 150ms ease;
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
.count {
  font-size: 11px;
  color: #ffffff66;
  font-variant-numeric: tabular-nums;
}
.order {
  display: flex;
  opacity: 0;
  transition: opacity 150ms ease;
}
.row:hover .order,
.row.active .order,
.order:focus-within {
  opacity: 1;
}
.footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid #ffffff14;
}
</style>
