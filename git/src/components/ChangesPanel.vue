<script setup lang="ts">
import { computed } from "vue";
import { confirmDiscard } from "../actions";
import { refresh, repo, stage, unstage } from "../git/repo";
import type { FileChange } from "../git/status";
import { vTip } from "../tip";
import { transition, ui } from "../ui";
import CommitBox from "./CommitBox.vue";
import FileList from "./FileList.vue";
import Icon from "./Icon.vue";

const unstaged = computed(() => repo.status?.unstaged ?? []);
const staged = computed(() => repo.status?.staged ?? []);

function select(file: FileChange) {
  ui.selected = { path: file.path, staged: file.staged };
}

function neighbour(list: FileChange[], file: FileChange) {
  const at = list.findIndex((f) => f.path === file.path);
  return list[at + 1] ?? list[at - 1] ?? null;
}

async function toggle(file: FileChange) {
  const next = neighbour(file.staged ? staged.value : unstaged.value, file);
  const wasSelected = ui.selected?.path === file.path && ui.selected.staged === file.staged;
  ui.moving = { path: file.path, staged: file.staged };
  await transition(async () => {
    if (file.staged) await unstage([file]);
    else await stage([file]);
    await refresh();
    ui.moving = { path: file.path, staged: !file.staged };
  });
  ui.moving = null;
  if (!wasSelected) return;
  if (next) ui.selected = { path: next.path, staged: file.staged };
  else ui.selected = { path: file.path, staged: !file.staged };
}

async function discardOne(file: FileChange) {
  await confirmDiscard([file]);
}

const stagedBasis = computed(() => `${Math.min(Math.max(staged.value.length, 1), 7) * 28 + 52}px`);
</script>

<template>
  <div class="panel">
    <section class="group unstaged-group">
      <header class="group-head">
        <span class="group-title">Changes</span>
        <span :key="unstaged.length" class="group-count">{{ unstaged.length }}</span>
        <div class="group-actions">
          <button
            v-if="unstaged.length"
            id="discard-all"
            v-tip="'Discard all changes'"
            class="icon-btn"
            aria-label="Discard all changes"
            @click="confirmDiscard(unstaged)"
          >
            <Icon name="discard" :size="14" />
          </button>
          <button
            v-if="unstaged.length"
            id="stage-all"
            v-tip="['Stage all', 'Ctrl+Shift+A']"
            class="btn ghost small"
            @click="stage(unstaged)"
          >
            Stage all
          </button>
        </div>
      </header>
      <FileList
        v-if="unstaged.length"
        id="unstaged"
        label="Unstaged changes"
        :files="unstaged"
        :staged="false"
        :selected="ui.selected && !ui.selected.staged ? ui.selected.path : null"
        @select="select"
        @toggle="toggle"
        @discard="discardOne"
      />
      <p v-else class="none">{{ repo.status ? "No unstaged changes" : "Loading…" }}</p>
    </section>

    <section class="group staged-group" :style="{ flexBasis: stagedBasis }">
      <header class="group-head">
        <span class="group-title">Staged</span>
        <span :key="staged.length" class="group-count" :class="{ on: staged.length }">{{ staged.length }}</span>
        <div class="group-actions">
          <button
            v-if="staged.length"
            id="unstage-all"
            v-tip="'Unstage all'"
            class="btn ghost small"
            @click="unstage(staged)"
          >
            Unstage all
          </button>
        </div>
      </header>
      <FileList
        v-if="staged.length"
        id="staged"
        label="Staged changes"
        :files="staged"
        :staged="true"
        :selected="ui.selected && ui.selected.staged ? ui.selected.path : null"
        @select="select"
        @toggle="toggle"
        @discard="() => {}"
      />
      <p v-else class="none">Stage files or lines to commit them</p>
    </section>

    <CommitBox />
  </div>
</template>

<style scoped>
.panel {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}
.group {
  display: flex;
  flex-direction: column;
  min-height: 72px;
}
.unstaged-group {
  flex: 1 1 0;
}
.staged-group {
  flex-grow: 0;
  flex-shrink: 1;
  border-top: 1px solid var(--line);
}
.group-head {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 10px 0 14px;
}
.group-title {
  color: var(--muted);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.group-count {
  min-width: 18px;
  padding: 0 6px;
  border-radius: 9px;
  background-color: var(--hover);
  color: var(--muted);
  font-size: 11px;
  font-weight: 600;
  line-height: 18px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  animation: tick 280ms var(--spring);
}
.group-count.on {
  background-color: var(--accent-soft);
  color: var(--accent);
}
@keyframes tick {
  from {
    opacity: 0.3;
    transform: translateY(-5px) scale(0.85);
  }
}
.group-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
}
.none {
  margin: 0;
  padding: 4px 14px 12px;
  color: var(--faint);
  font-size: 12px;
}
@media (prefers-reduced-motion: reduce) {
  .group-count {
    animation: none;
  }
}
</style>
