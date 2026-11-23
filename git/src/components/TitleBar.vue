<script setup lang="ts">
import { computed, ref } from "vue";
import { appWindow } from "skathi:app";
import { activity, headColor } from "../activity";
import { cancelNetwork, network, refresh, repo, repoName } from "../git/repo";
import { lanes, reducedMotion } from "../theme";
import { vTip } from "../tip";
import { relativeTime, setTab, ui } from "../ui";
import Icon from "./Icon.vue";

const ownKeys = navigator.platform !== "MacIntel";
const maximized = computed(() => appWindow.isMaximized());
const branch = computed(() => repo.status?.branch ?? null);
const branchLabel = computed(() => {
  const b = branch.value;
  if (!b) return "…";
  return b.head ?? (b.oid ? `${b.oid.slice(0, 7)} (detached)` : "no branch");
});
const laneColor = computed(() => lanes.value[headColor.value % lanes.value.length]!);
const changeCount = computed(() => (repo.status ? repo.status.unstaged.length + repo.status.staged.length : 0));

const spark = computed(() => {
  const weeks = activity.value;
  if (weeks.length < 2) return null;
  const W = 76;
  const H = 22;
  const max = Math.max(1, ...weeks);
  const pts = weeks.map((n, i) => [(i / (weeks.length - 1)) * W, H - 3 - (n / max) * (H - 6)] as const);
  let line = `M${pts[0]![0]} ${pts[0]![1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1]!;
    const [x1, y1] = pts[i]!;
    const mx = (x0 + x1) / 2;
    line += ` C${mx} ${y0} ${mx} ${y1} ${x1} ${y1}`;
  }
  const total = weeks.reduce((a, b) => a + b, 0);
  const last = pts[pts.length - 1]!;
  return { line, area: `${line} L${W} ${H} L0 ${H} Z`, total, x: last[0], y: last[1], W, H };
});

const now = ref(Date.now());
const fetchTip = computed((): [string, string] => {
  void now.value;
  return [repo.fetchedAt ? `Fetch · last ${relativeTime(repo.fetchedAt)}` : "Fetch", "Ctrl+Shift+F"];
});

function toggle(menu: "branch" | "repo") {
  ui.menu = ui.menu === menu ? null : menu;
}
</script>

<template>
  <header class="titlebar">
    <div class="mark" aria-hidden="true"><Icon name="commit" :size="15" :stroke="2.4" /></div>
    <template v-if="repo.path">
      <button
        id="repo-button"
        v-tip="['Repositories', 'Ctrl+O']"
        class="crumb focusable"
        :class="{ open: ui.menu === 'repo' }"
        @click="toggle('repo')"
      >
        <span class="crumb-label">{{ repoName(repo.path) }}</span>
        <Icon name="down" :size="12" />
      </button>
      <button
        id="branch-button"
        v-tip="['Switch branch', 'Ctrl+B']"
        class="branch-pill focusable"
        :class="{ open: ui.menu === 'branch' }"
        :style="{ '--pill': laneColor }"
        @click="toggle('branch')"
      >
        <span class="pill-dot" />
        <span class="crumb-label">{{ branchLabel }}</span>
        <span v-if="branch?.ahead" v-tip="`${branch.ahead} to push`" class="sync up">↑{{ branch.ahead }}</span>
        <span v-if="branch?.behind" v-tip="`${branch.behind} to pull`" class="sync down">↓{{ branch.behind }}</span>
        <Icon name="down" :size="12" />
      </button>
    </template>
    <span v-else class="title-text">Git</span>

    <div class="spacer" />

    <nav v-if="repo.path" class="segmented" role="tablist" :class="ui.tab">
      <span class="thumb" />
      <button
        id="tab-changes"
        v-tip="['Changes', 'Ctrl+1']"
        class="seg focusable"
        role="tab"
        :aria-selected="ui.tab === 'changes'"
        @click="setTab('changes')"
      >
        <Icon name="changes" :size="14" />Changes
        <span v-if="changeCount" :key="changeCount" class="seg-count">{{ changeCount }}</span>
      </button>
      <button
        id="tab-history"
        v-tip="['History', 'Ctrl+2']"
        class="seg focusable"
        role="tab"
        :aria-selected="ui.tab === 'history'"
        @click="setTab('history')"
      >
        <Icon name="history" :size="14" />History
      </button>
    </nav>

    <div class="spacer" />

    <div v-if="repo.path" class="actions">
      <div
        v-if="spark"
        v-tip="`${spark.total} commit${spark.total === 1 ? '' : 's'} on this branch in 12 weeks`"
        class="spark"
        :style="{ '--pill': laneColor }"
      >
        <svg :width="spark.W" :height="spark.H" :viewBox="`0 0 ${spark.W} ${spark.H}`" aria-hidden="true">
          <path class="area" :d="spark.area" />
          <path class="line" :d="spark.line" fill="none" stroke-width="1.6" stroke-linecap="round" />
          <circle class="tip-dot" :cx="spark.x" :cy="spark.y" r="2.4" />
        </svg>
      </div>
      <button
        v-if="repo.network"
        v-tip="'Cancel'"
        class="icon-btn net cancel focusable"
        aria-label="Cancel"
        @click="cancelNetwork()"
      >
        <Icon name="stop" :size="15" />
      </button>
      <button
        id="fetch-button"
        v-tip="fetchTip"
        class="net focusable"
        :class="{ running: repo.network === 'fetch' }"
        :disabled="repo.network !== null"
        @mouseenter="now = Date.now()"
        @click="network('fetch')"
      >
        <Icon name="fetch" :size="15" />
        <span>Fetch</span>
      </button>
      <button
        id="pull-button"
        v-tip="['Pull', 'Ctrl+Shift+L']"
        class="net focusable"
        :class="{ running: repo.network === 'pull' }"
        :disabled="repo.network !== null"
        @click="network('pull')"
      >
        <Icon name="pull" :size="15" />
        <span>Pull</span>
        <span v-if="branch?.behind" class="count">{{ branch.behind }}</span>
      </button>
      <button
        id="push-button"
        v-tip="['Push', 'Ctrl+Shift+P']"
        class="net focusable"
        :class="{ running: repo.network === 'push' }"
        :disabled="repo.network !== null"
        @click="network('push')"
      >
        <Icon name="push" :size="15" />
        <span>Push</span>
        <span v-if="branch?.ahead" class="count">{{ branch.ahead }}</span>
      </button>
      <button
        id="refresh-button"
        v-tip="['Refresh', 'F5']"
        class="icon-btn focusable"
        aria-label="Refresh"
        @click="refresh()"
      >
        <Icon name="refresh" :size="15" />
      </button>
    </div>

    <div v-if="ownKeys" class="caption">
      <div class="minimize" aria-label="Minimize"><Icon name="win-min" :size="14" :stroke="1.3" /></div>
      <div class="maximize" :aria-label="maximized ? 'Restore' : 'Maximize'">
        <Icon :name="maximized ? 'win-restore' : 'win-max'" :size="14" :stroke="1.3" />
      </div>
      <div class="close" aria-label="Close"><Icon name="close" :size="14" :stroke="1.3" /></div>
    </div>

    <div
      v-if="repo.network"
      class="progress"
      role="progressbar"
      :aria-label="`${repo.network} running`"
      :style="{ '--shading': `progress(${lanes[0]}, ${lanes[1]}, ${reducedMotion ? 0 : 1})` }"
    />
  </header>
</template>

<style scoped>
.titlebar {
  position: relative;
  display: flex;
  flex: none;
  align-items: center;
  gap: 6px;
  height: env(titlebar-area-height, 44px);
  padding-left: calc(env(titlebar-area-x, 0px) + 12px);
  border-bottom: 1px solid var(--line);
  background-color: var(--chrome);
  app-region: drag;
}
.mark {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  margin-right: 4px;
  border-radius: 7px;
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
  color: #ffffff;
  box-shadow: 0 2px 10px light-dark(#5a4de040, #9488ff40);
}
.title-text {
  font-family: var(--display);
  font-size: 14px;
  font-weight: 600;
}
.crumb {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  max-width: 220px;
  padding: 0 8px;
  border: none;
  border-radius: 7px;
  background-color: transparent;
  color: var(--text);
  font-family: var(--display);
  font-size: 14px;
  font-weight: 600;
  app-region: no-drag;
  transition: background-color 120ms var(--ease);
}
.crumb .icon {
  color: var(--faint);
}
.crumb:hover,
.crumb.open {
  background-color: var(--hover);
}
.crumb-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.branch-pill {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 26px;
  max-width: 280px;
  padding: 0 8px 0 10px;
  border: 1px solid color-mix(in srgb, var(--pill) 45%, transparent);
  border-radius: 13px;
  background-color: color-mix(in srgb, var(--pill) 14%, transparent);
  color: var(--text);
  font-size: 12.5px;
  font-weight: 600;
  app-region: no-drag;
  transition:
    background-color 140ms var(--ease),
    transform 140ms var(--spring);
}
.branch-pill:hover,
.branch-pill.open {
  background-color: color-mix(in srgb, var(--pill) 24%, transparent);
}
.branch-pill:active {
  transform: scale(0.97);
}
.branch-pill .icon {
  color: var(--muted);
}
.pill-dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: var(--pill);
  box-shadow: 0 0 8px var(--pill);
}
.sync {
  padding: 0 5px;
  border-radius: 7px;
  font-size: 11px;
  font-weight: 700;
  line-height: 15px;
  font-variant-numeric: tabular-nums;
}
.sync.up {
  background-color: color-mix(in srgb, var(--ok) 22%, transparent);
  color: var(--ok);
}
.sync.down {
  background-color: color-mix(in srgb, var(--warn) 22%, transparent);
  color: var(--warn);
}
.spacer {
  flex: 1;
  align-self: stretch;
}

.segmented {
  position: relative;
  display: flex;
  padding: 3px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background-color: var(--sunken);
  app-region: no-drag;
}
.thumb {
  position: absolute;
  top: 3px;
  bottom: 3px;
  left: 3px;
  width: 116px;
  border-radius: 7px;
  background-color: var(--raised);
  box-shadow:
    0 1px 3px light-dark(#1b1d3a24, #00000066),
    inset 0 1px 0 light-dark(#ffffff, #ffffff14);
  transition: transform 220ms var(--spring);
}
.segmented.history .thumb {
  transform: translateX(116px);
}
.seg {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 116px;
  height: 26px;
  border: none;
  border-radius: 7px;
  background-color: transparent;
  color: var(--muted);
  font-size: 12.5px;
  font-weight: 600;
  transition: color 140ms var(--ease);
}
.seg:hover,
.seg[aria-selected="true"] {
  color: var(--text);
}
.seg-count {
  min-width: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background-color: var(--accent);
  color: var(--accent-ink);
  font-size: 10.5px;
  font-weight: 700;
  line-height: 16px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  animation: tick 260ms var(--spring);
}
@keyframes tick {
  from {
    transform: translateY(-5px) scale(0.85);
    opacity: 0.3;
  }
}

.actions {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-right: 6px;
  app-region: no-drag;
}
.spark {
  display: flex;
  align-items: center;
  height: 30px;
  margin-right: 8px;
  padding: 0 6px;
}
.spark .area {
  fill: color-mix(in srgb, var(--pill) 18%, transparent);
}
.spark .line {
  stroke: var(--pill);
}
.spark .tip-dot {
  fill: var(--pill);
}
.net {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 10px;
  border: none;
  border-radius: 7px;
  background-color: transparent;
  color: var(--text);
  font-size: 12.5px;
  font-weight: 500;
  transition:
    background-color 120ms var(--ease),
    transform 120ms var(--spring);
}
.net .icon {
  color: var(--muted);
}
.net:hover {
  background-color: var(--hover);
}
.net:active {
  transform: scale(0.96);
}
.net:disabled {
  opacity: 0.45;
}
.net.running {
  opacity: 1;
  color: var(--accent);
}
.net.running .icon {
  color: var(--accent);
  animation: bob 900ms var(--ease) infinite alternate;
}
@keyframes bob {
  to {
    transform: translateY(2px);
  }
}
.net.cancel {
  width: 30px;
  padding: 0;
  justify-content: center;
}
.count {
  min-width: 16px;
  padding: 0 5px;
  border-radius: 8px;
  background-color: var(--accent);
  color: var(--accent-ink);
  font-size: 11px;
  font-weight: 700;
  line-height: 16px;
  text-align: center;
}
.progress {
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 2px;
  pointer-events: none;
}
.caption {
  display: flex;
  align-self: stretch;
}
.caption div {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  color: var(--muted);
  transition: background-color 100ms;
}
.caption div:hover {
  background-color: var(--hover);
  color: var(--text);
}
.caption .close:hover {
  background-color: #e5484d;
  color: #ffffff;
}
.minimize {
  --window-control: minimize;
}
.maximize {
  --window-control: maximize;
}
.close {
  --window-control: close;
}
@media (display-mode: fullscreen) {
  .caption {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .thumb,
  .seg-count,
  .net.running .icon {
    transition: none;
    animation: none;
  }
}
</style>
