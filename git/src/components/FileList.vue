<script setup lang="ts">
import { computed, ref } from "vue";
import type { FileChange, Kind } from "../git/status";
import { vTip } from "../tip";
import { splitPath, ui } from "../ui";
import Icon from "./Icon.vue";

const props = defineProps<{
  files: FileChange[];
  staged: boolean;
  selected: string | null;
  label: string;
}>();
const emit = defineEmits<{
  select: [file: FileChange];
  toggle: [file: FileChange];
  discard: [file: FileChange];
}>();

const ROW = 30;
const first = ref(0);
const height = ref(400);
const viewport = ref<HTMLElement | null>(null);

const visible = computed(() => {
  const count = Math.ceil(height.value / ROW) + 8;
  const from = Math.max(0, first.value - 4);
  return props.files.slice(from, from + count).map((file, i) => ({ file, index: from + i }));
});

const LETTER: Record<Kind, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  copied: "C",
  untracked: "U",
  conflicted: "!",
  typechange: "T",
};

function onScroll(e: Event) {
  const el = e.currentTarget as HTMLElement;
  first.value = Math.floor(el.scrollTop / ROW);
  height.value = el.clientHeight;
}

function reveal(index: number) {
  const el = viewport.value;
  if (!el) return;
  const top = index * ROW;
  if (top < el.scrollTop) el.scrollTop = top;
  else if (top + ROW > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW - el.clientHeight;
}

function move(delta: number) {
  const at = props.files.findIndex((f) => f.path === props.selected);
  const next = props.files[Math.min(props.files.length - 1, Math.max(0, at < 0 ? 0 : at + delta))];
  if (!next) return;
  emit("select", next);
  reveal(props.files.indexOf(next));
}

function current() {
  return props.files.find((f) => f.path === props.selected);
}

function onKey(e: KeyboardEvent) {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    move(e.key === "ArrowDown" ? 1 : -1);
  } else if (e.key === "Home" || e.key === "End") {
    e.preventDefault();
    move(e.key === "Home" ? -Infinity : Infinity);
  } else if (e.key === " " || e.key === "Enter") {
    const file = current();
    if (file) {
      e.preventDefault();
      emit("toggle", file);
    }
  } else if ((e.key === "Delete" || e.key === "Backspace") && !props.staged) {
    const file = current();
    if (file) {
      e.preventDefault();
      emit("discard", file);
    }
  }
}

function measure(el: unknown) {
  if (el instanceof HTMLElement) {
    viewport.value = el;
    requestAnimationFrame(() => (height.value = el.clientHeight || height.value));
  }
}

defineExpose({ focus: () => viewport.value?.focus() });
</script>

<template>
  <div
    :ref="measure"
    class="files focusable"
    tabindex="0"
    role="listbox"
    :aria-label="label"
    @scroll="onScroll"
    @keydown="onKey"
  >
    <div class="spacer" :style="{ height: `${files.length * ROW}px` }">
      <div
        v-for="{ file, index } in visible"
        :key="file.path"
        class="file"
        :class="{ selected: file.path === selected }"
        :style="{
          top: `${index * ROW}px`,
          viewTransitionName: ui.moving?.path === file.path && ui.moving.staged === staged ? 'moving-file' : undefined,
        }"
        role="option"
        :data-path="file.path"
        @mousedown="emit('select', file)"
        @dblclick="emit('toggle', file)"
      >
        <span class="badge" :class="file.kind" :aria-label="file.kind">{{ LETTER[file.kind] }}</span>
        <span class="name">
          <span v-if="file.from" class="dir">{{ splitPath(file.from).name }} → </span>
          <span class="base">{{ splitPath(file.path).name }}</span>
          <span class="dir">{{ splitPath(file.path).dir }}</span>
        </span>
        <span class="row-actions">
          <button
            v-if="!staged"
            v-tip="['Discard changes', 'Delete']"
            class="icon-btn discard"
            aria-label="Discard changes"
            @mousedown.stop
            @click.stop="emit('discard', file)"
          >
            <Icon name="discard" :size="14" />
          </button>
          <button
            v-tip="[staged ? 'Unstage' : 'Stage', 'Space']"
            class="icon-btn toggle"
            :aria-label="staged ? 'Unstage' : 'Stage'"
            @mousedown.stop
            @click.stop="emit('toggle', file)"
          >
            <Icon :name="staged ? 'minus' : 'plus'" :size="14" />
          </button>
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.files {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  outline-offset: -2px;
}
.spacer {
  position: relative;
}
.file {
  position: absolute;
  left: 8px;
  right: 8px;
  display: flex;
  align-items: center;
  gap: 9px;
  height: 28px;
  margin-top: 1px;
  padding: 0 4px 0 7px;
  border-radius: 8px;
  cursor: default;
  transition:
    background-color 100ms var(--ease),
    opacity 200ms var(--ease),
    transform 240ms var(--spring);
}
@starting-style {
  .file {
    opacity: 0;
    transform: translateX(-8px);
  }
}
.file:hover {
  background-color: var(--hover);
}
.file.selected {
  background-color: var(--selected-muted);
}
.files:focus .file.selected {
  background-color: var(--selected);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 35%, transparent);
}
.badge {
  flex: none;
  width: 18px;
  height: 18px;
  border-radius: 5px;
  font-size: 10.5px;
  font-weight: 700;
  line-height: 18px;
  text-align: center;
  color: var(--b);
  background-color: color-mix(in srgb, var(--b) 16%, transparent);
}
.badge.modified,
.badge.typechange {
  --b: var(--badge-modified);
}
.badge.added {
  --b: var(--badge-added);
}
.badge.deleted {
  --b: var(--badge-deleted);
}
.badge.renamed,
.badge.copied {
  --b: var(--badge-renamed);
}
.badge.untracked {
  --b: var(--badge-untracked);
}
.badge.conflicted {
  --b: var(--badge-conflicted);
}
.name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.base {
  margin-right: 6px;
  font-weight: 500;
}
.dir {
  color: var(--faint);
  font-size: 12px;
}
.row-actions {
  display: none;
  flex: none;
  gap: 1px;
}
.file:hover .row-actions,
.file.selected .row-actions {
  display: flex;
}
.icon-btn {
  width: 22px;
  height: 22px;
}
.toggle:hover {
  background-color: var(--accent-soft);
  color: var(--accent);
}
.discard:hover {
  background-color: var(--danger-soft);
  color: var(--danger);
}
@media (prefers-reduced-motion: reduce) {
  .file {
    transition: none;
  }
}
</style>
