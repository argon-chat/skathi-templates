<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { appHaptics } from "skathi:app";
import { headColor } from "../activity";
import { commit, errorText, lastMessage, notify, repo } from "../git/repo";
import { history, revealHead } from "../history";
import { lanes, reducedMotion } from "../theme";
import { keys, vTip } from "../tip";
import { ui } from "../ui";
import Icon from "./Icon.vue";
import Popover from "./Popover.vue";

const SUBJECT = 50;
const BODY = 72;

const editor = ref<SkEditorElement | null>(null);
const value = ref<SkEditorValue>({ text: ui.draft, marks: [], atoms: [] });
const landed = ref(-1000);
const coauthors = ref(false);
let amendSource = "";

const subject = computed(() => ui.draft.split("\n", 1)[0] ?? "");
const stagedCount = computed(() => repo.status?.staged.length ?? 0);
const committing = computed(() => repo.busy === "commit");
const branch = computed(() => repo.status?.branch.head ?? "HEAD");
const blocked = computed(() => {
  if (!subject.value.trim()) return "Write a summary first";
  if (!ui.amend && stagedCount.value === 0) return "Stage changes to commit them";
  return null;
});
const ready = computed(() => blocked.value === null && !committing.value);
const left = computed(() => SUBJECT - subject.value.length);
const charge = computed(() => {
  const tint = lanes.value[headColor.value % lanes.value.length]!;
  const level = ready.value ? 1 : 0;
  const speed = ready.value && !reducedMotion.value ? 1 : 0;
  return `charge(${level}, ${landed.value}, ${tint}, ${lanes.value[1]}, 12px, ${speed})`;
});

const people = computed(() => {
  void history.count;
  const seen = new Map<string, string>();
  for (const c of history.reader?.commits.slice(0, 400) ?? []) {
    if (!seen.has(c.email)) seen.set(c.email, c.author);
    if (seen.size >= 8) break;
  }
  return [...seen].map(([email, name]) => ({ name, email }));
});

function decorate() {
  const ed = editor.value;
  if (!ed) return;
  const lines = ui.draft.split("\n");
  const ranges: { from: number; to: number; name: string }[] = [];
  const lineMarks: { line: number; name: string }[] = [];
  let at = 0;
  lines.forEach((line, i) => {
    if (i === 0) {
      if (line.length > SUBJECT)
        ranges.push({ from: at + SUBJECT, to: at + Math.min(line.length, BODY), name: "long" });
      if (line.length > BODY) ranges.push({ from: at + BODY, to: at + line.length, name: "over" });
    } else if (i === 1 && line.trim()) {
      lineMarks.push({ line: 1, name: "gap" });
    } else if (line.length > BODY) {
      ranges.push({ from: at + BODY, to: at + line.length, name: "over" });
    }
    if (/^Co-authored-by: /.test(line)) ranges.push({ from: at, to: at + line.length, name: "trailer" });
    at += line.length + 1;
  });
  ed.setDecorations("guide", ranges);
  ed.setLineDecorations("guide", lineMarks);
}

function onInput() {
  const ed = editor.value;
  if (!ed) return;
  value.value = ed.value;
  ui.draft = ed.value.text;
  ui.commitError = null;
}

watch(() => ui.draft, decorate);
onMounted(decorate);

function setText(text: string) {
  ui.draft = text;
  value.value = { text, marks: [], atoms: [] };
  requestAnimationFrame(decorate);
}

watch(
  () => repo.headVersion,
  () => (ui.commitError = null),
);

async function toggleAmend() {
  ui.amend = !ui.amend;
  ui.commitError = null;
  if (ui.amend && !ui.draft.trim()) {
    amendSource = await lastMessage();
    setText(amendSource);
  } else if (!ui.amend && ui.draft === amendSource) {
    setText("");
  }
}

function addCoauthor(name: string, email: string) {
  coauthors.value = false;
  const trailer = `Co-authored-by: ${name} <${email}>`;
  if (ui.draft.includes(trailer)) return;
  const text = ui.draft.replace(/\s+$/, "");
  const hasTrailers = /\nCo-authored-by: [^\n]*$/.test(text);
  setText(`${text || "Summary"}${hasTrailers ? "\n" : "\n\n"}${trailer}\n`);
  editor.value?.focus();
}

async function submit() {
  if (blocked.value || committing.value) return;
  ui.commitError = null;
  const amend = ui.amend;
  const done = await commit(ui.draft, amend, (e) => {
    ui.commitError = errorText(e);
    appHaptics.perform("error");
  });
  if (done) {
    const short = /\[[^\]]*?([0-9a-f]{7,})\]/.exec(done.stdout)?.[1] ?? "";
    landed.value = performance.now() / 1000;
    revealHead();
    appHaptics.perform("success");
    notify("ok", `${amend ? "Amended" : "Committed"} ${short}`.trim(), subject.value);
    setText("");
    ui.amend = false;
    amendSource = "";
  }
}

function onKey(e: KeyboardEvent) {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    void submit();
  }
}

defineExpose({ submit, focus: () => editor.value?.focus() });
</script>

<template>
  <section class="commit" @keydown="onKey">
    <div class="field">
      <div class="field-head">
        <span class="caps">Message</span>
        <span
          v-tip="'Keep the summary under 50 characters, body lines under 72'"
          class="counter"
          :class="{ warn: left < 0, bad: subject.length > BODY }"
        >
          {{ left }}
        </span>
      </div>
      <sk-editor
        id="message"
        ref="editor"
        class="message"
        placeholder="Summarize the change"
        :value="value"
        @input="onInput"
      />
      <div class="field-foot">
        <button
          id="amend"
          v-tip="'Rewrite the last commit with the staged changes and this message'"
          class="chip focusable"
          role="switch"
          :aria-checked="ui.amend"
          :class="{ on: ui.amend }"
          @click="toggleAmend"
        >
          <span class="track"><span class="knob" /></span>
          Amend
        </button>
        <button
          id="coauthor"
          v-tip="'Credit someone else on this commit'"
          class="chip focusable"
          :class="{ on: coauthors }"
          :disabled="!people.length"
          @click="coauthors = !coauthors"
        >
          <Icon name="plus" :size="12" :stroke="2.2" />Co-author
        </button>
        <Popover v-if="coauthors" anchor="coauthor" :width="260" @close="coauthors = false">
          <button v-for="p in people" :key="p.email" class="person focusable" @click="addCoauthor(p.name, p.email)">
            <b>{{ p.name }}</b
            ><span>{{ p.email }}</span>
          </button>
        </Popover>
      </div>
    </div>

    <div v-if="ui.commitError" id="commit-error" class="commit-error" role="alert">
      <div class="commit-error-head">
        <Icon name="alert" :size="14" />
        <b>{{ ui.amend ? "Could not amend" : "Could not commit" }}</b>
        <button class="icon-btn" aria-label="Dismiss" @click="ui.commitError = null">
          <Icon name="close" :size="12" />
        </button>
      </div>
      <pre>{{ ui.commitError }}</pre>
      <span class="suggest">A hook or git itself refused it. Fix what it reports, then try again.</span>
    </div>

    <button
      id="commit-button"
      v-tip="blocked ? blocked : [ui.amend ? 'Amend the last commit' : 'Commit the staged changes', 'Ctrl+Enter']"
      class="commit-btn focusable"
      :class="{ ready }"
      :style="{ '--shading': charge }"
      :disabled="blocked !== null || committing"
      @click="submit"
    >
      <span v-if="committing" class="spinner" />
      <template v-if="committing">{{ ui.amend ? "Amending…" : "Committing…" }}</template>
      <template v-else-if="ui.amend">Amend last commit</template>
      <span v-else class="commit-label">
        Commit
        <template v-if="stagedCount">
          <span :key="stagedCount" class="staged">{{ stagedCount }}</span>
          file{{ stagedCount === 1 ? "" : "s" }}
        </template>
        to <b>{{ branch }}</b>
      </span>
      <kbd v-if="!committing">{{ keys("Ctrl+Enter") }}</kbd>
    </button>
  </section>
</template>

<style scoped>
.commit {
  display: flex;
  flex: none;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border-top: 1px solid var(--line);
}
.field {
  position: relative;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--line-strong);
  border-radius: 10px;
  background-color: var(--pane);
  transition:
    border-color 140ms var(--ease),
    box-shadow 160ms var(--ease);
}
.field:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.field-head {
  display: flex;
  align-items: center;
  padding: 8px 12px 0;
}
.counter {
  margin-left: auto;
  color: var(--faint);
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  transition: color 160ms var(--ease);
}
.counter.warn {
  color: var(--warn);
}
.counter.bad {
  color: var(--danger);
}
.message {
  min-height: 64px;
  max-height: 180px;
  padding: 4px 12px 8px;
  color: var(--text);
  font-family: var(--ui);
  font-size: 13px;
  line-height: 1.5;
}
.message::placeholder {
  color: var(--faint);
}
.message::selection {
  background-color: var(--selected);
}
.message::decoration(long) {
  color: var(--warn);
  background-color: light-dark(#ad6a0012, #f5bd4f14);
}
.message::decoration(over) {
  color: var(--danger);
  background-color: var(--danger-soft);
}
.message::decoration(trailer) {
  color: var(--muted);
}
.message::decoration(gap) {
  background-color: light-dark(#ad6a0012, #f5bd4f14);
}
.field-foot {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px 8px;
  border-top: 1px solid var(--line);
}
.chip {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 9px 0 6px;
  border: none;
  border-radius: 12px;
  background-color: transparent;
  color: var(--muted);
  font-size: 12px;
  font-weight: 500;
  transition:
    background-color 120ms var(--ease),
    color 120ms var(--ease);
}
.chip:hover {
  background-color: var(--hover);
  color: var(--text);
}
.chip.on {
  color: var(--text);
}
.chip:disabled {
  opacity: 0.4;
}
.track {
  display: flex;
  align-items: center;
  width: 24px;
  height: 14px;
  padding: 2px;
  border-radius: 7px;
  background-color: var(--line-strong);
  box-sizing: border-box;
  transition: background-color 160ms var(--ease);
}
.knob {
  width: 10px;
  height: 10px;
  border-radius: 5px;
  background-color: #ffffff;
  box-shadow: 0 1px 2px #00000040;
  transition: transform 200ms var(--spring);
}
.chip.on .track {
  background-color: var(--accent);
}
.chip.on .knob {
  transform: translateX(10px);
}
.person {
  margin: 2px 4px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  padding: 6px 10px;
  border: none;
  border-radius: 7px;
  background-color: transparent;
  text-align: left;
}
.person:hover {
  background-color: var(--hover);
}
.person b {
  font-weight: 600;
}
.person span {
  color: var(--muted);
  font-size: 11.5px;
}
.commit-error {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--danger) 30%, transparent);
  border-radius: 10px;
  background-color: var(--danger-soft);
  color: var(--danger);
  transition:
    opacity 180ms var(--ease),
    transform 220ms var(--spring);
}
@starting-style {
  .commit-error {
    opacity: 0;
    transform: translateY(6px);
  }
}
.commit-error-head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.suggest {
  color: var(--muted);
  font-size: 11.5px;
}
.commit-error-head .icon-btn {
  width: 20px;
  height: 20px;
  margin-left: auto;
  color: var(--danger);
}
.commit-error pre {
  max-height: 120px;
  margin: 0;
  padding: 8px 10px;
  overflow: auto;
  border-radius: 7px;
  background-color: var(--sunken);
  color: var(--text);
  font-family: var(--mono);
  font-size: 11.5px;
  white-space: pre-wrap;
  user-select: text;
}
.commit-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 36px;
  padding: 0 14px;
  border: none;
  border-radius: 10px;
  background-color: transparent;
  color: #ffffff;
  font-size: 13px;
  font-weight: 600;
  transition: transform 140ms var(--spring);
}
.commit-btn:not(.ready) {
  color: light-dark(#ffffffd9, #ffffffb3);
}
.commit-btn:active:not(:disabled) {
  transform: scale(0.98);
}
.commit-btn:disabled {
  cursor: default;
}
.commit-label {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
}
.commit-label b {
  overflow: hidden;
  font-weight: 700;
  text-overflow: ellipsis;
}
.staged {
  min-width: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background-color: #ffffff33;
  font-size: 11.5px;
  line-height: 18px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  animation: tick 280ms var(--spring);
}
@keyframes tick {
  from {
    opacity: 0.2;
    transform: translateY(-6px) scale(0.8);
  }
}
.commit-btn kbd {
  margin-left: auto;
  padding: 0 5px;
  border-radius: 4px;
  background-color: #ffffff26;
  color: #ffffffcc;
  line-height: 17px;
}
@media (prefers-reduced-motion: reduce) {
  .staged,
  .knob,
  .commit-error {
    animation: none;
    transition: none;
  }
}
</style>
