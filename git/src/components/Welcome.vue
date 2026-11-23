<script setup lang="ts">
import { computed, ref, shallowRef, watch } from "vue";
import { forget, open, repo, repoName } from "../git/repo";
import { git } from "../git/run";
import { chooseFolder } from "../open";
import { accent, accent2, reducedMotion } from "../theme";
import { keys, vTip } from "../tip";
import { relativeTime } from "../ui";
import Icon from "./Icon.vue";

interface Peek {
  branch: string;
  subject: string;
  time: number;
  missing: boolean;
}

const peeks = shallowRef(new Map<string, Peek>());
const opening = ref<string | null>(null);
let abort: AbortController | null = null;

watch(
  () => repo.recent.slice(),
  async (paths) => {
    abort?.abort();
    const controller = new AbortController();
    abort = controller;
    await Promise.all(
      paths.map(async (path) => {
        let peek: Peek;
        try {
          const [head, last] = await Promise.all([
            git(path, ["symbolic-ref", "--short", "-q", "HEAD"], { signal: controller.signal, ok: [1] }),
            git(path, ["log", "-1", "--format=%at%x00%s", "--"], { signal: controller.signal, ok: [128] }),
          ]);
          const [at = "0", subject = ""] = last.stdout.trim().split("\0");
          peek = { branch: head.stdout.trim() || "detached", subject, time: Number(at) * 1000, missing: false };
        } catch {
          if (controller.signal.aborted) return;
          peek = { branch: "", subject: "", time: 0, missing: true };
        }
        if (abort !== controller) return;
        const next = new Map(peeks.value);
        next.set(path, peek);
        peeks.value = next;
      }),
    );
  },
  { immediate: true },
);

const shading = computed(() => `field(${accent.value}, ${accent2.value}, 0.6, ${reducedMotion.value ? 0 : 1})`);

async function reopen(path: string) {
  opening.value = path;
  await open(path);
  opening.value = null;
}
</script>

<template>
  <section class="welcome">
    <div class="field" :style="{ '--shading': shading }" />
    <div class="card">
      <div class="hero">
        <div class="logo"><Icon name="commit" :size="30" :stroke="2.4" /></div>
        <h1>Open a repository</h1>
        <p>Stage hunks and single lines, write the commit, and follow every branch on one timeline.</p>
      </div>

      <div v-if="repo.openError" id="open-error" class="error" role="alert">
        <Icon name="alert" :size="16" />
        <div>
          <b>{{ repo.openError.message }}</b>
          <span class="path">{{ repo.openError.path }}</span>
          <span class="suggest"
            >Pick the folder that contains <code>.git</code>, or run <code>git init</code> in it first.</span
          >
        </div>
      </div>

      <button id="open-button" class="btn primary big" :disabled="repo.opening" @click="chooseFolder()">
        <span v-if="repo.opening && !opening" class="spinner" />
        <Icon v-else name="folder" :size="16" />
        <span>{{ repo.opening && !opening ? "Opening…" : "Choose a folder…" }}</span>
        <kbd>{{ keys("Ctrl+O") }}</kbd>
      </button>

      <div v-if="repo.recent.length" class="recent">
        <h2 class="caps">Recent</h2>
        <ul>
          <li v-for="path in repo.recent" :key="path" class="recent-row" :class="{ missing: peeks.get(path)?.missing }">
            <button class="recent-open focusable" :disabled="repo.opening" @click="reopen(path)">
              <span class="repo-glyph">{{ repoName(path).slice(0, 1).toUpperCase() }}</span>
              <span class="recent-text">
                <span class="title">
                  <b>{{ repoName(path) }}</b>
                  <span v-if="peeks.get(path)?.branch" class="branch">
                    <Icon name="branch" :size="11" :stroke="2.2" />{{ peeks.get(path)!.branch }}
                  </span>
                </span>
                <span v-if="peeks.get(path)?.missing" class="last">Not found or not a repository any more</span>
                <span v-else-if="peeks.get(path)?.subject" class="last">
                  {{ peeks.get(path)!.subject }} · {{ relativeTime(peeks.get(path)!.time) }}
                </span>
                <span v-else-if="peeks.get(path)" class="last">No commits yet</span>
                <span v-else class="last bone" />
                <span class="where">{{ path }}</span>
              </span>
              <span v-if="opening === path" class="spinner" />
              <Icon v-else name="right" :size="14" class="go" />
            </button>
            <button
              v-tip="'Remove from the list'"
              class="icon-btn forget"
              aria-label="Remove from the list"
              @click="forget(path)"
            >
              <Icon name="close" :size="13" />
            </button>
          </li>
        </ul>
      </div>
      <p class="hint"><Icon name="folder" :size="13" />Or drop a folder anywhere on this window</p>
    </div>
  </section>
</template>

<style scoped>
.welcome {
  position: relative;
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  min-height: 0;
  padding: 24px;
  overflow: auto;
}
.field {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 18px;
  width: 480px;
}
.hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  text-align: center;
}
.logo {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 68px;
  height: 68px;
  margin-bottom: 10px;
  border-radius: 22px;
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
  color: #ffffff;
  box-shadow:
    0 14px 40px light-dark(#5a4de047, #9488ff40),
    inset 0 1px 0 #ffffff4d;
  animation: rise 600ms var(--spring) both;
}
@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(10px) scale(0.85);
  }
}
h1 {
  margin: 0;
  font-family: var(--display);
  font-size: 26px;
  font-weight: 650;
  letter-spacing: -0.01em;
}
.hero p {
  margin: 0;
  max-width: 380px;
  color: var(--muted);
  font-size: 13.5px;
  line-height: 1.55;
}
.big {
  height: 40px;
  border-radius: 10px;
  font-size: 13.5px;
}
.big kbd {
  margin-left: 6px;
  padding: 0 5px;
  border-radius: 4px;
  background-color: #ffffff26;
  line-height: 17px;
}
.error {
  display: flex;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid color-mix(in srgb, var(--danger) 30%, transparent);
  border-radius: 12px;
  background-color: var(--danger-soft);
  color: var(--danger);
  transition:
    opacity 180ms var(--ease),
    transform 240ms var(--spring);
}
@starting-style {
  .error {
    opacity: 0;
    transform: translateY(-6px);
  }
}
.error > div {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.error b {
  font-weight: 600;
}
.error .path {
  overflow: hidden;
  color: var(--muted);
  font-family: var(--mono);
  font-size: 11.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.suggest {
  color: var(--text);
  font-size: 12px;
}
code {
  font-family: var(--mono);
  font-size: 11.5px;
}
.recent h2 {
  margin: 0 0 8px 4px;
}
.recent ul {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.recent-row {
  position: relative;
  display: flex;
  align-items: center;
  border: 1px solid var(--line);
  border-radius: 12px;
  background-color: var(--pane);
  box-shadow: var(--shadow-soft);
  transition:
    border-color 140ms var(--ease),
    transform 200ms var(--spring);
  animation: card-in 380ms var(--spring) both;
  animation-delay: calc(sibling-index() * 45ms);
}
@keyframes card-in {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
}
.recent-row:hover {
  border-color: color-mix(in srgb, var(--accent) 45%, transparent);
  transform: translateY(-1px);
}
.recent-row.missing {
  opacity: 0.6;
}
.recent-open {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 10px 40px 10px 12px;
  border: none;
  border-radius: 12px;
  background-color: transparent;
  text-align: left;
}
.recent-open:active {
  transform: scale(0.99);
}
.repo-glyph {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: linear-gradient(135deg, var(--accent-soft), light-dark(#0f9e8e1f, #4fe0c626));
  color: var(--accent);
  font-family: var(--display);
  font-size: 16px;
  font-weight: 700;
}
.recent-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.title {
  display: flex;
  align-items: center;
  gap: 8px;
}
.title b {
  font-size: 13.5px;
  font-weight: 600;
}
.branch {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 0 7px 0 5px;
  border-radius: 9px;
  background-color: var(--accent-soft);
  color: var(--accent);
  font-size: 11px;
  font-weight: 600;
  line-height: 18px;
}
.last,
.where {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.last {
  color: var(--muted);
  font-size: 12px;
}
.last.bone {
  width: 60%;
  height: 10px;
  margin: 3px 0;
  border-radius: 5px;
  background-color: var(--hover);
}
.where {
  color: var(--faint);
  font-size: 11px;
}
.go {
  color: var(--faint);
  transition:
    transform 200ms var(--spring),
    color 140ms var(--ease);
}
.recent-row:hover .go {
  color: var(--accent);
  transform: translateX(3px);
}
.forget {
  position: absolute;
  top: 8px;
  right: 8px;
  opacity: 0;
}
.recent-row:hover .forget {
  opacity: 1;
}
.recent-row:hover .go {
  opacity: 0;
}
.hint {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin: 0;
  color: var(--faint);
  font-size: 12px;
}
@media (prefers-reduced-motion: reduce) {
  .logo,
  .recent-row {
    animation: none;
  }
  .recent-row,
  .error,
  .go {
    transition: none;
  }
}
</style>
