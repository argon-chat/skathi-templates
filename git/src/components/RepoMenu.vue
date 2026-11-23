<script setup lang="ts">
import { appShell } from "skathi:app";
import { close as closeRepo, notify, open, repo, repoName } from "../git/repo";
import { chooseFolder } from "../open";
import { keys } from "../tip";
import { ui } from "../ui";
import Icon from "./Icon.vue";
import Popover from "./Popover.vue";

function done() {
  ui.menu = null;
}

async function pick(path: string) {
  done();
  if (path !== repo.path) await open(path);
}

async function reveal() {
  done();
  if (!repo.path) return;
  try {
    await appShell.openPath(repo.path);
  } catch (e) {
    notify("error", "Could not open the folder", e instanceof Error ? e.message : String(e));
  }
}
</script>

<template>
  <Popover anchor="repo-button" :width="320" @close="done">
    <div id="repo-menu" class="menu">
      <div class="label">Recent repositories</div>
      <button
        v-for="path in repo.recent"
        :key="path"
        class="item"
        :class="{ current: path === repo.path }"
        @click="pick(path)"
      >
        <Icon name="repo" :size="15" />
        <span class="text">
          <b>{{ repoName(path) }}</b>
          <span>{{ path }}</span>
        </span>
        <Icon v-if="path === repo.path" name="check" :size="14" :stroke="2.2" class="tick" />
      </button>
      <div class="rule" />
      <button class="item" @click="(done(), chooseFolder())">
        <Icon name="folder" :size="15" />
        <span class="text"><b>Open another repository…</b></span>
        <kbd>{{ keys("Ctrl+O") }}</kbd>
      </button>
      <button class="item" @click="reveal">
        <Icon name="external" :size="15" />
        <span class="text"><b>Show in file manager</b></span>
      </button>
      <button id="close-repo" class="item" @click="(done(), closeRepo())">
        <Icon name="close" :size="15" />
        <span class="text"><b>Close repository</b></span>
      </button>
    </div>
  </Popover>
</template>

<style scoped>
.menu {
  display: flex;
  flex-direction: column;
  padding: 4px;
  overflow-y: auto;
}
.label {
  padding: 8px 10px 4px;
  color: var(--faint);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.item {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 32px;
  padding: 5px 10px;
  border: none;
  border-radius: 6px;
  background-color: transparent;
  text-align: left;
}
.item:hover,
.item:focus-visible {
  background-color: var(--selected);
  outline: none;
}
.item .icon {
  color: var(--muted);
}
.text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}
.text b {
  font-weight: 500;
}
.current .text b {
  font-weight: 600;
}
.text span {
  overflow: hidden;
  color: var(--faint);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.item .tick {
  color: var(--accent);
}
kbd {
  color: var(--faint);
}
.rule {
  height: 1px;
  margin: 4px 6px;
  background-color: var(--line);
}
</style>
