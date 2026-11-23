<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { branches, repo, switchTo, type BranchInfo } from "../git/repo";
import { history } from "../history";
import { lanes } from "../theme";
import { keys } from "../tip";
import { relativeTime, ui } from "../ui";
import Icon from "./Icon.vue";
import Popover from "./Popover.vue";

const query = ref("");
const active = ref(0);
const input = ref<HTMLInputElement | null>(null);

const VALID = /^(?!-)(?!.*\.\.)(?!.*[~^:?*[\\\s])(?!.*\/\/)(?!.*@\{)(?!.*\.lock$)(?!.*[./]$)[^\x00-\x1f\x7f]+$/;

const current = computed(() => repo.status?.branch.head ?? null);
const matches = computed(() => {
  const q = query.value.trim().toLowerCase();
  const list = branches.value.filter((b) => !q || b.name.toLowerCase().includes(q));
  return [...list].sort((a, b) => (a.name === current.value ? -1 : b.name === current.value ? 1 : 0));
});
const canCreate = computed(() => {
  const name = query.value.trim();
  return name !== "" && VALID.test(name) && !branches.value.some((b) => b.name === name);
});
const items = computed(() => matches.value.length + (canCreate.value ? 1 : 0));

/** Each branch in the colour of its lane on the timeline, when the history has drawn it. */
const colors = computed(() => {
  void history.count;
  const map = new Map<string, string>();
  const reader = history.reader;
  const palette = lanes.value;
  if (reader) {
    const end = Math.min(reader.commits.length, 2000);
    for (let i = 0; i < end; i++) {
      const commit = reader.commits[i]!;
      const row = reader.graph.rows[i];
      if (!row) break;
      for (const r of commit.refs)
        if (r.kind === "head" || r.kind === "branch") map.set(r.name, palette[row.color % palette.length]!);
    }
  }
  return map;
});

function color(b: BranchInfo, i: number): string {
  const palette = lanes.value;
  return colors.value.get(b.name) ?? palette[(i + 1) % palette.length]!;
}

watch(query, () => (active.value = 0));

onMounted(() => nextTick(() => input.value?.focus()));

function close() {
  ui.menu = null;
}

async function choose(index: number) {
  const branch = matches.value[index];
  if (branch) {
    if (branch.name === current.value) return close();
    close();
    await switchTo(branch.name);
  } else if (canCreate.value) {
    const name = query.value.trim();
    close();
    await switchTo(name, true);
  }
}

function onKey(e: KeyboardEvent) {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const n = items.value;
    if (n) active.value = (active.value + (e.key === "ArrowDown" ? 1 : n - 1)) % n;
  } else if (e.key === "Enter") {
    e.preventDefault();
    void choose(active.value);
  }
}

function track(b: BranchInfo) {
  return {
    ahead: /ahead (\d+)/.exec(b.track)?.[1] ?? "",
    behind: /behind (\d+)/.exec(b.track)?.[1] ?? "",
    gone: b.track.includes("gone"),
  };
}
</script>

<template>
  <Popover anchor="branch-button" :width="380" @close="close">
    <div id="branch-menu" class="menu" @keydown="onKey">
      <div class="search">
        <Icon name="search" :size="14" />
        <input
          ref="input"
          v-model="query"
          id="branch-filter"
          class="filter"
          placeholder="Switch to or create a branch"
          spellcheck="false"
        />
      </div>
      <div class="label">
        Branches <span class="count">{{ branches.length }}</span>
      </div>
      <div class="list" role="listbox">
        <div
          v-for="(b, i) in matches"
          :key="b.name"
          class="item"
          :class="{ active: i === active, current: b.name === current }"
          :style="{ '--branch': color(b, i) }"
          :data-branch="b.name"
          role="option"
          :aria-selected="b.name === current"
          @mousemove="active = i"
          @click="choose(i)"
        >
          <span class="tile"><Icon name="branch" :size="14" :stroke="2" /></span>
          <span class="text">
            <span class="top">
              <b class="bname">{{ b.name }}</b>
              <span v-if="b.name === current" class="here">current</span>
            </span>
            <span class="sub">
              <template v-if="b.subject">{{ b.subject }}</template>
              <template v-if="b.subject && b.time"> · </template>
              <template v-if="b.time">{{ relativeTime(b.time) }}</template>
            </span>
          </span>
          <span class="sync">
            <span v-if="track(b).ahead" class="chip ahead"
              ><Icon name="push" :size="11" :stroke="2.4" />{{ track(b).ahead }}</span
            >
            <span v-if="track(b).behind" class="chip behind"
              ><Icon name="pull" :size="11" :stroke="2.4" />{{ track(b).behind }}</span
            >
            <span v-if="track(b).gone" class="chip gone">gone</span>
            <span v-else-if="b.upstream && !track(b).ahead && !track(b).behind" class="chip synced"
              ><Icon name="cloud" :size="11" :stroke="2"
            /></span>
          </span>
          <Icon v-if="b.name === current" name="check" :size="15" :stroke="2.4" class="tick" />
        </div>
        <div
          v-if="canCreate"
          id="create-branch"
          class="item create"
          :class="{ active: active === matches.length }"
          @mousemove="active = matches.length"
          @click="choose(matches.length)"
        >
          <span class="tile"><Icon name="plus" :size="14" :stroke="2.2" /></span>
          <span class="text">
            <span class="top"
              ><b class="bname">{{ query.trim() }}</b></span
            >
            <span class="sub">New branch from {{ current ?? "HEAD" }}</span>
          </span>
        </div>
        <p v-if="!items" class="none">
          {{ query.trim() && !canCreate ? "Not a valid branch name" : "No branches" }}
        </p>
      </div>
      <footer class="foot">
        <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
        <span><kbd>Enter</kbd> switch</span>
        <span><kbd>Esc</kbd> close</span>
        <span class="spacer" />
        <span
          ><kbd>{{ keys("Ctrl+B") }}</kbd></span
        >
      </footer>
    </div>
  </Popover>
</template>

<style scoped>
.menu {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.search {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
  height: 36px;
  margin: 8px 8px 4px;
  padding: 0 10px;
  border: 1px solid var(--line);
  border-radius: 9px;
  background-color: var(--sunken);
  color: var(--faint);
  transition:
    border-color 120ms var(--ease),
    box-shadow 160ms var(--ease);
}
.search:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.filter {
  flex: 1;
  height: 100%;
  padding: 0;
  border: none;
  outline: none;
  background-color: transparent;
  color: var(--text);
  font: inherit;
}
.filter::placeholder {
  color: var(--faint);
}
.label {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px 4px;
  color: var(--faint);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.count {
  padding: 0 6px;
  border-radius: 8px;
  background-color: var(--hover);
  color: var(--muted);
  letter-spacing: 0;
  line-height: 16px;
}
.list {
  flex: 1;
  min-height: 0;
  padding: 2px 6px 6px;
  overflow-y: auto;
}
.item {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 5px 10px 5px 8px;
  border-radius: 8px;
  cursor: pointer;
  --branch: var(--accent);
}
.item.active {
  background-color: var(--selected);
}
.tile {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid color-mix(in srgb, var(--branch) 40%, transparent);
  border-radius: 8px;
  background-color: color-mix(in srgb, var(--branch) 16%, transparent);
  color: var(--branch);
}
.current .tile {
  border-color: transparent;
  background-color: var(--branch);
  color: #ffffff;
  box-shadow: 0 2px 10px color-mix(in srgb, var(--branch) 45%, transparent);
}
.create .tile {
  border-style: dashed;
  border-color: var(--line-strong);
  background-color: transparent;
  color: var(--accent);
}
.text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.top {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.bname {
  min-width: 0;
  overflow: hidden;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.current .bname {
  font-weight: 600;
}
.here {
  flex: none;
  padding: 0 6px;
  border-radius: 8px;
  background-color: color-mix(in srgb, var(--branch) 18%, transparent);
  color: var(--branch);
  font-size: 10.5px;
  font-weight: 600;
  line-height: 16px;
}
.sub {
  overflow: hidden;
  color: var(--faint);
  font-size: 11.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sync {
  display: flex;
  flex: none;
  gap: 4px;
}
.chip {
  display: flex;
  align-items: center;
  gap: 2px;
  height: 18px;
  padding: 0 6px 0 4px;
  border-radius: 9px;
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.chip.ahead {
  background-color: var(--accent-soft);
  color: var(--accent);
}
.chip.behind {
  background-color: color-mix(in srgb, var(--warn) 16%, transparent);
  color: var(--warn);
}
.chip.gone {
  padding: 0 6px;
  background-color: var(--danger-soft);
  color: var(--danger);
}
.chip.synced {
  padding: 0 4px;
  color: var(--faint);
}
.tick {
  flex: none;
  color: var(--branch);
}
.none {
  margin: 0;
  padding: 12px 10px;
  color: var(--faint);
  font-size: 12px;
}
.foot {
  display: flex;
  flex: none;
  align-items: center;
  gap: 12px;
  padding: 8px 14px;
  border-top: 1px solid var(--line);
  background-color: var(--sunken);
  color: var(--faint);
  font-size: 11px;
}
.foot span {
  display: flex;
  align-items: center;
  gap: 4px;
}
.foot .spacer {
  flex: 1;
}
.foot kbd {
  min-width: 18px;
  padding: 0 5px;
  border: 1px solid var(--line-strong);
  border-radius: 5px;
  background-color: var(--raised);
  color: var(--muted);
  line-height: 17px;
  text-align: center;
  box-shadow: 0 1px 0 var(--line-strong);
}
</style>
