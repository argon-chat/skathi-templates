<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import type { DiffLine, HunkView } from "../git/diff";
import { tokenize, type Lang, type Token } from "../git/syntax";

const props = defineProps<{
  hunk: HunkView;
  digits: number;
  picked: ReadonlySet<string>;
  version: number;
  selectable: boolean;
  lang: Lang | null;
}>();
const emit = defineEmits<{
  down: [hunk: number, line: DiffLine, event: PointerEvent];
  over: [hunk: number, line: DiffLine];
}>();

const MARGIN = 40;
/** Lines decorated before the editor has reported what it shows. */
const FIRST_PAINT = 120;

const editor = ref<SkEditorElement | null>(null);
let shown: HunkView | null = null;
let gutters: (string | undefined)[] = [];
let starts: number[] = [];
let tokens: (Token[] | undefined)[] = [];
let hover = -1;

const key = (line: DiffLine) => `${props.hunk.index}:${line.index}`;
const isPicked = (line: DiffLine) => line.kind !== "ctx" && props.picked.has(key(line));
const SIGN = { ctx: " ", add: "+", del: "−" } as const;

function gutterText(line: DiffLine): string {
  const pad = (n: number | null) => (n === null ? "" : String(n)).padStart(props.digits);
  return `${pad(line.old)} ${pad(line.new)} ${SIGN[line.kind]}`;
}

/** The lines on screen and a margin: a long hunk is decorated only where it is seen. */
function range(): [number, number] {
  const ed = editor.value;
  const count = props.hunk.lines.length;
  const { fromLine, toLine } = ed?.viewport ?? { fromLine: 0, toLine: 0 };
  const to = toLine > fromLine ? toLine + MARGIN : FIRST_PAINT;
  return [Math.max(0, fromLine - MARGIN), Math.min(count, to)];
}

function paintLines() {
  const ed = editor.value;
  if (!ed) return;
  const [from, to] = range();
  const lines = props.hunk.lines;
  const marks: { line: number; name: string; gutter: string }[] = [];
  for (let i = from; i < to; i++) {
    const line = lines[i]!;
    const name = line.kind === "ctx" ? "ctx" : isPicked(line) ? `${line.kind}-sel` : line.kind;
    marks.push({ line: i, name, gutter: (gutters[i] ??= gutterText(line)) });
  }
  ed.setLineDecorations("diff", marks);
}

function paintSyntax() {
  const ed = editor.value;
  const lang = props.lang;
  if (!ed || !lang) return;
  const [from, to] = range();
  const lines = props.hunk.lines;
  const ranges: { from: number; to: number; name: string }[] = [];
  for (let i = from; i < to; i++) {
    const list = (tokens[i] ??= tokenize(lines[i]!.text, lang));
    const at = starts[i]!;
    for (const t of list) ranges.push({ from: at + t.from, to: at + t.to, name: t.name });
  }
  ed.setDecorations("syntax", ranges);
}

function paintView() {
  paintLines();
  paintSyntax();
}

function render() {
  const ed = editor.value;
  if (!ed) return;
  if (shown === props.hunk) {
    paintLines();
    return;
  }
  shown = props.hunk;
  const lines = props.hunk.lines;
  gutters = [];
  tokens = [];
  starts = [];
  let at = 0;
  const words: { from: number; to: number; name: string }[] = [];
  for (const line of lines) {
    starts.push(at);
    for (const [a, b] of line.words) words.push({ from: at + a, to: at + b, name: `${line.kind}-word` });
    at += line.text.length + 1;
  }
  const text = lines.map((l) => l.text).join("\n");
  ed.value = { text, marks: [], atoms: [] };
  // Every line a `code` block, so `::line(code)` sets the text off from the gutter.
  // A new value puts the caret at its end, and the editor would scroll a long last line sideways to it.
  ed.dispatch({ selections: [{ anchor: 0 }], setLines: [{ from: 0, to: text.length, type: "code" }], history: false });
  ed.setDecorations("words", words);
  paintView();
  hover = -1;
  ed.setLineDecorations("hover", []);
}

function lineAt(e: PointerEvent): DiffLine | null {
  const ed = editor.value;
  if (!ed) return null;
  const box = ed.getBoundingClientRect();
  const at = ed.positionAt(box.right - 1, e.clientY);
  return props.hunk.lines[ed.lineAt(at)] ?? null;
}

function setHover(line: DiffLine | null) {
  const index = line && line.kind !== "ctx" ? line.index : -1;
  if (index === hover) return;
  hover = index;
  editor.value?.setLineDecorations("hover", index < 0 ? [] : [{ line: index, name: "pick-hover" }]);
}

function onDown(e: PointerEvent) {
  const line = lineAt(e);
  if (line) emit("down", props.hunk.index, line, e);
}

function onMove(e: PointerEvent) {
  const line = lineAt(e);
  setHover(line);
  if (line) emit("over", props.hunk.index, line);
}

onMounted(render);
watch(() => props.hunk, render);
watch(
  () => props.digits,
  () => {
    gutters = [];
    paintLines();
  },
);
watch(() => props.version, paintLines);
</script>

<template>
  <div class="chunk">
    <sk-editor ref="editor" class="code" readonly @viewportchange="paintView" />
    <div
      v-if="selectable"
      class="picker"
      :data-hunk="hunk.index"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerleave="setHover(null)"
    />
  </div>
</template>

<style scoped>
.chunk {
  position: relative;
}
.code {
  display: block;
  color: var(--text);
  font-family: var(--mono);
  font-size: 13px;
  line-height: var(--row);
  tab-size: 4;
  white-space: pre;
  user-select: text;
}
.wrap .code {
  white-space: pre-wrap;
}
.picker {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: var(--gutter-w);
  cursor: pointer;
}
.code::line(code) {
  padding: 0 16px 0 12px;
}
.code::selection {
  background-color: var(--selected);
}
.code::gutter {
  width: var(--gutter-w);
  padding: 0 10px 0 12px;
  border-right: 1px solid var(--line);
  background-color: var(--card);
  color: var(--faint);
  font-family: var(--mono);
  font-size: 11.5px;
}
.code::gutter(add) {
  background-color: var(--add-gutter);
  color: var(--add);
}
.code::gutter(del) {
  background-color: var(--del-gutter);
  color: var(--del);
}
.code::gutter(add-sel),
.code::gutter(del-sel) {
  background-color: var(--accent);
  color: var(--accent-ink);
  font-weight: 700;
}
.code::gutter(pick-hover) {
  background-color: var(--line-strong);
}
.code::decoration(add) {
  background-color: var(--add-bg);
}
.code::decoration(del) {
  background-color: var(--del-bg);
}
.code::decoration(add-sel) {
  background-color: var(--add-sel);
}
.code::decoration(del-sel) {
  background-color: var(--del-sel);
}
.code::decoration(kw) {
  color: var(--syn-kw);
}
.code::decoration(str) {
  color: var(--syn-str);
}
.code::decoration(num) {
  color: var(--syn-num);
}
.code::decoration(com) {
  color: var(--syn-com);
}
.code::decoration(add-word) {
  background-color: var(--add-word);
  border-radius: 4px;
}
.code::decoration(del-word) {
  background-color: var(--del-word);
  border-radius: 4px;
}
</style>
