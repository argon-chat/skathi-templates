<script setup lang="ts">
import { computed, ref, shallowRef, watch } from "vue";
import { errorText, notify, read } from "../git/repo";
import { isAbort } from "../git/run";
import type { Kind } from "../git/status";
import { avatar } from "../avatar";
import { history } from "../history";
import { vTip } from "../tip";
import { fullDate, relativeTime, splitPath } from "../ui";
import DiffView from "./DiffView.vue";
import Icon from "./Icon.vue";

interface Info {
  sha: string;
  author: string;
  email: string;
  time: number;
  committer: string;
  parents: string[];
  subject: string;
  body: string;
}
interface Changed {
  path: string;
  from?: string;
  kind: Kind;
}

const info = shallowRef<Info | null>(null);
const files = shallowRef<Changed[]>([]);
const chosen = ref<string | null>(null);
const error = ref<string | null>(null);
const loading = ref(false);
let abort: AbortController | null = null;

const KINDS: Record<string, Kind> = {
  M: "modified",
  A: "added",
  D: "deleted",
  R: "renamed",
  C: "copied",
  T: "typechange",
};

function parseNameStatus(out: string): Changed[] {
  const parts = out.split("\0");
  const result: Changed[] = [];
  for (let i = 0; i < parts.length;) {
    const code = parts[i++];
    if (!code) continue;
    const kind = KINDS[code[0]!] ?? "modified";
    if (kind === "renamed" || kind === "copied") {
      const from = parts[i++] ?? "";
      result.push({ path: parts[i++] ?? "", from, kind });
    } else {
      result.push({ path: parts[i++] ?? "", kind });
    }
  }
  return result;
}

async function load(sha: string | null) {
  abort?.abort();
  if (!sha) {
    info.value = null;
    files.value = [];
    return;
  }
  const controller = new AbortController();
  abort = controller;
  loading.value = true;
  error.value = null;
  try {
    const [meta, names] = await Promise.all([
      read(["show", "-s", "--no-show-signature", "--format=%H%x00%an%x00%ae%x00%at%x00%cn%x00%P%x00%B", sha], {
        signal: controller.signal,
      }),
      read(["show", "--format=", "--name-status", "-z", "--find-renames", "--diff-merges=first-parent", sha], {
        signal: controller.signal,
      }),
    ]);
    const [h = "", an = "", ae = "", at = "0", cn = "", p = "", ...msg] = meta.stdout.split("\0");
    const message = msg.join("\0").replace(/\s+$/, "");
    const nl = message.indexOf("\n");
    info.value = {
      sha: h,
      author: an,
      email: ae,
      time: Number(at) * 1000,
      committer: cn,
      parents: p ? p.split(" ") : [],
      subject: nl < 0 ? message : message.slice(0, nl),
      body: nl < 0 ? "" : message.slice(nl + 1).trim(),
    };
    files.value = parseNameStatus(names.stdout);
    if (!files.value.some((f) => f.path === chosen.value)) chosen.value = files.value[0]?.path ?? null;
  } catch (e) {
    if (!isAbort(e)) error.value = errorText(e);
  } finally {
    if (abort === controller) loading.value = false;
  }
}

watch(() => history.selected, load, { immediate: true });

const target = computed(() => {
  const f = files.value.find((x) => x.path === chosen.value);
  if (!f || !info.value) return null;
  return { mode: "commit" as const, path: f.path, from: f.from, kind: f.kind, sha: info.value.sha };
});

async function copySha() {
  if (!info.value) return;
  await navigator.clipboard.writeText(info.value.sha);
  notify("ok", "Copied the commit hash", info.value.sha);
}

function onFilesKey(e: KeyboardEvent) {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  e.preventDefault();
  const at = files.value.findIndex((f) => f.path === chosen.value);
  const next = files.value[Math.max(0, Math.min(files.value.length - 1, at + (e.key === "ArrowDown" ? 1 : -1)))];
  if (next) chosen.value = next.path;
}

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
</script>

<template>
  <section class="detail">
    <div v-if="error" class="empty">
      <div class="glyph"><Icon name="alert" :size="24" /></div>
      <h3>Could not read the commit</h3>
      <p>{{ error }}</p>
    </div>
    <div v-else-if="!history.selected" class="empty">
      <div class="glyph"><Icon name="history" :size="24" /></div>
      <h3>No commit selected</h3>
      <p>Pick a commit in the list to see what it changed.</p>
    </div>
    <template v-else-if="info">
      <header id="commit-header" class="meta">
        <h2 class="subject">{{ info.subject }}</h2>
        <pre v-if="info.body" class="body">{{ info.body }}</pre>
        <div class="byline">
          <span class="avatar" :style="{ background: avatar(info.author, info.email).background }">{{
            avatar(info.author, info.email).initials
          }}</span>
          <span class="who">
            <b>{{ info.author }}</b>
            <span class="email">{{ info.email }}</span>
          </span>
          <span class="when" v-tip="fullDate(info.time)">{{ relativeTime(info.time) }}</span>
          <span class="grow" />
          <span v-if="info.parents.length > 1" class="merge">Merge</span>
          <button v-tip="'Copy the full hash'" class="sha focusable" @click="copySha">
            <Icon name="copy" :size="12" />{{ info.sha.slice(0, 10) }}
          </button>
        </div>
      </header>
      <div class="split">
        <div class="files focusable" tabindex="0" @keydown="onFilesKey">
          <div class="files-head">{{ files.length }} changed file{{ files.length === 1 ? "" : "s" }}</div>
          <div
            v-for="f in files"
            :key="f.path"
            class="file"
            :class="{ selected: f.path === chosen }"
            :data-path="f.path"
            @mousedown="chosen = f.path"
          >
            <span class="badge" :class="f.kind">{{ LETTER[f.kind] }}</span>
            <span class="name">
              <span class="base">{{ splitPath(f.path).name }}</span>
              <span class="dir">{{ splitPath(f.path).dir }}</span>
            </span>
          </div>
          <p v-if="!files.length" class="none">This commit changes no files.</p>
        </div>
        <DiffView v-if="target" :target="target" :revision="info.sha" />
        <div v-else class="empty"><p>No file selected</p></div>
      </div>
    </template>
    <div v-else-if="loading" class="empty"><span class="spinner" /></div>
  </section>
</template>

<style scoped>
.detail {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background-color: var(--pane);
}
.meta {
  display: flex;
  flex: none;
  flex-direction: column;
  gap: 8px;
  padding: 14px 52px 12px 18px;
  border-bottom: 1px solid var(--line);
  user-select: text;
}
.subject {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  line-height: 1.35;
}
.body {
  max-height: 120px;
  margin: 0;
  overflow: auto;
  color: var(--muted);
  font-family: var(--ui);
  font-size: 12.5px;
  line-height: 1.5;
  white-space: pre-wrap;
}
.byline {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 2px;
}
.avatar {
  flex: none;
  width: 26px;
  height: 26px;
  border-radius: 13px;
  color: #ffffff;
  font-size: 11px;
  font-weight: 700;
  line-height: 26px;
  text-align: center;
}
.who {
  display: flex;
  gap: 6px;
  align-items: baseline;
  min-width: 0;
}
.who b {
  font-weight: 600;
  white-space: nowrap;
}
.email,
.when {
  color: var(--muted);
  font-size: 12px;
  white-space: nowrap;
}
.email {
  overflow: hidden;
  text-overflow: ellipsis;
}
.grow {
  flex: 1;
}
.merge {
  padding: 0 6px;
  border-radius: 4px;
  background-color: var(--hover);
  color: var(--muted);
  font-size: 11px;
  line-height: 18px;
}
.sha {
  display: flex;
  flex: none;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 8px;
  border: 1px solid var(--line-strong);
  border-radius: 5px;
  background-color: var(--raised);
  color: var(--muted);
  font-family: var(--mono);
  font-size: 11.5px;
}
.sha:hover {
  color: var(--text);
}
.split {
  display: flex;
  flex: 1;
  min-height: 0;
}
.files {
  flex: none;
  width: 240px;
  padding: 4px 6px;
  overflow-y: auto;
  border-right: 1px solid var(--line);
  background-color: var(--chrome);
  outline-offset: -2px;
}
.files-head {
  padding: 8px 8px 6px;
  color: var(--muted);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.file {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 28px;
  padding: 0 8px;
  border-radius: 6px;
}
.file:hover {
  background-color: var(--hover);
}
.file.selected {
  background-color: var(--selected-muted);
}
.files:focus .file.selected {
  background-color: var(--selected);
}
.badge {
  flex: none;
  width: 16px;
  height: 16px;
  border-radius: 4px;
  background-color: var(--badge-modified);
  color: #ffffff;
  font-family: var(--mono);
  font-size: 10.5px;
  font-weight: 700;
  line-height: 16px;
  text-align: center;
}
.badge.added {
  background-color: var(--badge-added);
}
.badge.deleted {
  background-color: var(--badge-deleted);
}
.badge.renamed,
.badge.copied {
  background-color: var(--badge-renamed);
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
}
.dir {
  color: var(--faint);
  font-size: 12px;
}
.none {
  padding: 8px;
  color: var(--faint);
  font-size: 12px;
}
</style>
