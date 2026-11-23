<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, watchEffect } from "vue";
import { appLaunch, appShell, appWindow } from "skathi:app";
import { network, open, refresh, repo, repoName, stage } from "./git/repo";
import { history } from "./history";
import { chooseFolder, openDropped } from "./open";
import { accent, accent2, reducedMotion } from "./theme";
import { tip } from "./tip";
import { setTab, ui } from "./ui";
import BranchMenu from "./components/BranchMenu.vue";
import ChangesPanel from "./components/ChangesPanel.vue";
import ConfirmDialog from "./components/ConfirmDialog.vue";
import DiffView from "./components/DiffView.vue";
import HistoryView from "./components/HistoryView.vue";
import Icon from "./components/Icon.vue";
import Notices from "./components/Notices.vue";
import RepoMenu from "./components/RepoMenu.vue";
import TitleBar from "./components/TitleBar.vue";
import Welcome from "./components/Welcome.vue";

const dragging = ref(0);
const backdrop = ref(appWindow.effectiveBackdrop);
const solid = computed(() => backdrop.value === "none");
const onBackdrop = () => (backdrop.value = appWindow.effectiveBackdrop);
const fieldShading = computed(
  () => `field(${accent.value}, ${accent2.value}, ${solid.value ? 0.35 : 0.5}, ${reducedMotion.value ? 0 : 1})`,
);
const status = computed(() => repo.status);
const changeCount = computed(() => (status.value ? status.value.unstaged.length + status.value.staged.length : 0));

const selectedFile = computed(() => {
  const s = ui.selected;
  const st = status.value;
  if (!s || !st) return null;
  return (s.staged ? st.staged : st.unstaged).find((f) => f.path === s.path) ?? null;
});

const target = computed(() => {
  const f = selectedFile.value;
  if (!f) return null;
  return { mode: f.staged ? ("staged" as const) : ("unstaged" as const), path: f.path, from: f.from, kind: f.kind };
});

watch(status, (st) => {
  if (!st) return;
  if (selectedFile.value) return;
  const first = st.unstaged[0] ?? st.staged[0];
  ui.selected = first ? { path: first.path, staged: first.staged } : null;
});

watch(
  () => repo.path,
  () => {
    ui.selected = null;
    ui.draft = "";
    ui.amend = false;
    ui.commitError = null;
    history.selected = null;
  },
);

watchEffect(() => {
  const branch = repo.status?.branch.head;
  appWindow.title = repo.path ? `${repoName(repo.path)}${branch ? ` · ${branch}` : ""} — Git` : "Git";
});

function onKey(e: KeyboardEvent) {
  if (e.defaultPrevented) return;
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  let handled = true;
  if (mod && !e.shiftKey && key === "o") void chooseFolder();
  else if (!repo.path || ui.confirm) handled = false;
  else if (key === "F5" || (mod && !e.shiftKey && key === "r")) void refresh();
  else if (mod && !e.shiftKey && key === "b") ui.menu = ui.menu === "branch" ? null : "branch";
  else if (mod && key === "1") setTab("changes");
  else if (mod && key === "2") setTab("history");
  else if (mod && e.shiftKey && key === "f") void network("fetch");
  else if (mod && e.shiftKey && key === "l") void network("pull");
  else if (mod && e.shiftKey && key === "p") void network("push");
  else if (mod && e.shiftKey && key === "a") void stage(repo.status?.unstaged ?? []);
  else handled = false;
  if (handled) e.preventDefault();
}

function onFocus() {
  void refresh();
}

function over(e: DragEvent) {
  if (!e.dataTransfer?.types.includes("Files")) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "link";
}

async function drop(e: DragEvent) {
  dragging.value = 0;
  e.preventDefault();
  await openDropped(e);
}

async function reveal() {
  if (repo.path) await appShell.openPath(repo.path).catch(() => {});
}

onMounted(() => {
  addEventListener("keydown", onKey);
  addEventListener("focus", onFocus);
  appWindow.addEventListener("backdropchange", onBackdrop);
  const start = appLaunch.paths[0];
  if (start) void open(start);
});
onBeforeUnmount(() => {
  removeEventListener("keydown", onKey);
  removeEventListener("focus", onFocus);
  appWindow.removeEventListener("backdropchange", onBackdrop);
});
</script>

<template>
  <main
    class="app"
    :class="{ dragging: dragging > 0, solid }"
    @dragenter="dragging++"
    @dragleave="dragging--"
    @dragover="over"
    @drop="drop"
  >
    <TitleBar />
    <Welcome v-if="!repo.path" />
    <div v-else-if="ui.tab === 'changes'" class="workspace changes-view">
      <aside class="sidebar">
        <ChangesPanel />
      </aside>
      <section class="main">
        <div v-if="repo.statusError" class="empty">
          <div class="glyph danger"><Icon name="alert" :size="24" /></div>
          <h3>Could not read the status</h3>
          <pre class="stderr">{{ repo.statusError }}</pre>
          <div class="actions"><button class="btn primary" @click="refresh()">Try again</button></div>
        </div>
        <DiffView v-else-if="target" :target="target" :revision="status" />
        <div v-else-if="status && changeCount === 0" id="clean" class="empty clean">
          <div class="field" :style="{ '--shading': fieldShading }" />
          <div class="glyph big"><Icon name="check" :size="30" :stroke="2.4" /></div>
          <h3>Everything is committed</h3>
          <span class="branch-name"
            ><Icon name="branch" :size="12" :stroke="2.2" />{{ status.branch.head ?? "detached HEAD" }}</span
          >
          <p>
            Nothing left to commit{{
              status.branch.ahead
                ? `, and ${status.branch.ahead} commit${status.branch.ahead === 1 ? "" : "s"} waiting to be pushed`
                : ""
            }}. Changes you make in your editor show up here.
          </p>
          <div class="actions">
            <button v-if="status.branch.ahead" class="btn primary" @click="network('push')">
              <Icon name="push" :size="14" />Push {{ status.branch.ahead }} commit{{
                status.branch.ahead === 1 ? "" : "s"
              }}
            </button>
            <button class="btn" @click="setTab('history')"><Icon name="history" :size="14" />Show history</button>
            <button class="btn ghost" @click="reveal"><Icon name="external" :size="14" />Open folder</button>
          </div>
        </div>
        <div v-else-if="status" class="empty">
          <div class="glyph"><Icon name="file" :size="24" /></div>
          <h3>Select a file</h3>
          <p>Pick a changed file on the left to see its diff.</p>
        </div>
        <div v-else class="empty"><span class="spinner" /></div>
      </section>
    </div>
    <div v-else class="workspace history-view">
      <HistoryView />
    </div>

    <BranchMenu v-if="ui.menu === 'branch' && repo.path" />
    <RepoMenu v-if="ui.menu === 'repo' && repo.path" />
    <Notices />
    <ConfirmDialog />
    <div v-if="dragging > 0" class="drop-hint"><Icon name="folder" :size="18" />Drop a folder to open it</div>
    <div v-if="tip" class="tip" :class="{ above: tip.above }" :style="{ left: `${tip.x}px`, top: `${tip.y}px` }">
      <span>{{ tip.text }}</span
      ><kbd v-if="tip.keys">{{ tip.keys }}</kbd>
    </div>
  </main>
</template>

<style scoped>
.workspace {
  display: flex;
  flex: 1;
  min-height: 0;
  view-transition-name: workspace;
}
.sidebar {
  display: flex;
  flex: none;
  flex-direction: column;
  width: 330px;
  border-right: 1px solid var(--line);
  background-color: var(--chrome);
}
.main {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background-color: var(--pane);
}
.empty .glyph.danger {
  color: var(--danger);
}
.clean .field {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.clean .glyph.big {
  width: 72px;
  height: 72px;
  border: none;
  border-radius: 24px;
  background: linear-gradient(135deg, var(--ok), var(--accent-2));
  color: #ffffff;
  box-shadow: 0 10px 30px color-mix(in srgb, var(--ok) 35%, transparent);
  animation: pop 520ms var(--spring) both;
}
.clean h3 {
  font-size: 20px;
}
.branch-name {
  display: flex;
  align-items: center;
  gap: 5px;
  margin: 2px 0 4px;
  padding: 2px 10px 2px 8px;
  border-radius: 11px;
  background-color: var(--accent-soft);
  color: var(--accent);
  font-size: 12px;
  font-weight: 600;
}
@keyframes pop {
  from {
    opacity: 0;
    transform: scale(0.6) rotate(-8deg);
  }
}
.drop-hint {
  position: absolute;
  inset: 12px;
  z-index: 70;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  border: 2px dashed var(--accent);
  border-radius: 16px;
  background-color: var(--accent-soft);
  color: var(--accent);
  font-size: 15px;
  font-weight: 600;
  pointer-events: none;
}
@media (prefers-reduced-motion: reduce) {
  .clean .glyph.big {
    animation: none;
  }
}
</style>
