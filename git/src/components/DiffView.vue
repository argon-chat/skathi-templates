<script setup lang="ts">
import { computed, markRaw, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { appHaptics } from "skathi:app";
import { fileDiff, selection, type DiffLine, type FileDiff, type HunkView } from "../git/diff";
import { languageFor } from "../git/syntax";
import { apply, errorText, read, stage, unstage } from "../git/repo";
import { isAbort } from "../git/run";
import type { FileChange, Kind } from "../git/status";
import { confirmDiscard } from "../actions";
import { dark, reducedMotion } from "../theme";
import { vTip } from "../tip";
import { ask, splitPath, ui } from "../ui";
import DiffChunk from "./DiffChunk.vue";
import Icon from "./Icon.vue";

export interface DiffTarget {
  mode: "unstaged" | "staged" | "commit";
  path: string;
  from?: string | undefined;
  kind: Kind;
  sha?: string | undefined;
}

const props = defineProps<{ target: DiffTarget; revision: unknown }>();

const ROW = 20;
const HEAD = 38;
const GAP = 14;
/** The gap that says how many unchanged lines lie between two hunks. */
const SKIP = 34;
const PAD = 14;
const CAP = 2 * 1024 * 1024;
const INSET = 14;
/** Advance of a digit in the gutter's 11.5px monospace face, rounded up. */
const GLYPH = 6.5;

const diff = shallowRef<FileDiff | null>(null);
const error = ref<string | null>(null);
const loading = ref(false);
const slow = ref(false);
const unlimited = ref(false);
const picked = shallowRef(new Set<string>());
const version = ref(0);
const scroller = ref<HTMLElement | null>(null);
const minimap = ref<HTMLCanvasElement | null>(null);
const band = ref(0);
const scrollTop = ref(0);
const viewHeight = ref(600);
const measured = shallowRef(new Map<number, number>());
const collapsing = ref<number | null>(null);
let lastText: string | null = null;
let abort: AbortController | null = null;

const editable = computed(() => props.target.mode !== "commit" && props.target.kind !== "conflicted");
const canDiscard = computed(() => props.target.mode === "unstaged");
const lang = computed(() => languageFor(props.target.path));
const file = computed<FileChange>(() => ({
  path: props.target.path,
  kind: props.target.kind,
  staged: props.target.mode === "staged",
  ...(props.target.from ? { from: props.target.from } : {}),
}));

function args(): { argv: string[]; ok?: number[] } {
  const t = props.target;
  const base = ["--no-color", "--no-ext-diff", "--find-renames"];
  const paths = t.from ? [t.from, t.path] : [t.path];
  if (t.mode === "commit") {
    return { argv: ["show", ...base, "--format=", "--diff-merges=first-parent", t.sha ?? "HEAD", "--", ...paths] };
  }
  if (t.mode === "staged") return { argv: ["diff", "--cached", ...base, "--", ...paths] };
  if (t.kind === "untracked") return { argv: ["diff", ...base, "--no-index", "--", "/dev/null", t.path], ok: [1] };
  return { argv: ["diff", ...base, "--", t.path] };
}

async function load(reset: boolean) {
  abort?.abort();
  const controller = new AbortController();
  abort = controller;
  if (reset) {
    diff.value = null;
    lastText = null;
    error.value = null;
    picked.value = new Set();
    unlimited.value = false;
    if (scroller.value) scroller.value.scrollTop = 0;
    scrollTop.value = 0;
  }
  if (props.target.kind === "conflicted") {
    diff.value = null;
    loading.value = false;
    return;
  }
  loading.value = true;
  const timer = setTimeout(() => (slow.value = true), 150);
  try {
    const { argv, ok } = args();
    const result = await read(argv, {
      signal: controller.signal,
      cap: unlimited.value ? 256 * 1024 * 1024 : CAP,
      ...(ok ? { ok } : {}),
    });
    const text = result.truncated ? `\0truncated:${result.stdout.length}` : result.stdout;
    if (text !== lastText) {
      lastText = text;
      diff.value = markRaw(fileDiff(result.stdout, result.truncated));
      measured.value = new Map();
      if (!reset) picked.value = new Set();
      version.value++;
    }
    collapsing.value = null;
    error.value = null;
  } catch (e) {
    if (!isAbort(e)) error.value = errorText(e);
  } finally {
    clearTimeout(timer);
    if (abort === controller) {
      loading.value = false;
      slow.value = false;
    }
  }
}

watch(
  () => [props.target.mode, props.target.path, props.target.from, props.target.sha, props.target.kind].join("\0"),
  () => void load(true),
  { immediate: true },
);
watch(
  () => props.revision,
  () => void load(false),
);

interface Block {
  hunk: HunkView;
  top: number;
  height: number;
}

/** Hunks are cards in a list of their own; only those near the view are mounted, each one editor. */
const layout = computed(() => {
  const blocks: Block[] = [];
  const d = diff.value;
  if (!d) return { blocks, height: 0 };
  const sizes = measured.value;
  let top = PAD;
  for (const hunk of d.hunks) {
    if (hunk.before) top += SKIP;
    else if (hunk.index > 0) top += GAP;
    const height = sizes.get(hunk.index) ?? HEAD + hunk.lines.length * ROW + 2;
    blocks.push({ hunk, top, height });
    top += height;
  }
  return { blocks, height: top + PAD + 40 };
});

function skipped(n: number) {
  return `${n.toLocaleString()} unchanged line${n === 1 ? "" : "s"}`;
}

/** The first block that ends below `y`. */
function blockAt(y: number): number {
  const list = layout.value.blocks;
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const b = list[mid]!;
    if (b.top + b.height < y) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const BAND = 240;
const visible = computed(() => {
  const from = band.value * BAND - viewHeight.value;
  const to = band.value * BAND + viewHeight.value * 2 + BAND;
  const list = layout.value.blocks;
  const out: Block[] = [];
  for (let i = blockAt(from); i < list.length && list[i]!.top <= to; i++) out.push(list[i]!);
  return out;
});

/** The hunk whose header sticks to the top while its lines scroll under it. */
const stuck = computed(() => {
  const y = scrollTop.value;
  const b = layout.value.blocks[blockAt(y)];
  return b && y > b.top && y < b.top + b.height - HEAD ? b.hunk.index : null;
});

const gutterWidth = computed(() => Math.ceil(((diff.value?.digits ?? 1) * 2 + 3) * GLYPH) + 24);

function onScroll() {
  const el = scroller.value;
  if (!el) return;
  band.value = Math.floor(el.scrollTop / BAND);
  scrollTop.value = el.scrollTop;
  placeThumb();
}

/** Wrapped lines make a card's height known only once it is laid out. */
const cards = new ResizeObserver((entries) => {
  if (!ui.wrap) return;
  const el = scroller.value;
  const next = new Map(measured.value);
  let shift = 0;
  for (const entry of entries) {
    const index = Number((entry.target as HTMLElement).dataset.hunk);
    const block = layout.value.blocks.find((b) => b.hunk.index === index);
    const height = Math.round(entry.contentRect.height) + 2;
    if (!block || Math.abs(block.height - height) < 1) continue;
    if (el && block.top + block.height <= el.scrollTop) shift += height - block.height;
    next.set(index, height);
  }
  if (next.size === measured.value.size && [...next].every(([k, v]) => measured.value.get(k) === v)) return;
  measured.value = next;
  if (el && shift) el.scrollTop += shift;
});

const observed = new Map<number, HTMLElement>();
/** One ref function per card, so Vue does not detach and attach it on every render. */
const cardRefs = new Map<number, (el: unknown) => void>();

function cardRef(index: number) {
  let fn = cardRefs.get(index);
  if (!fn) {
    fn = (el: unknown) => {
      const old = observed.get(index);
      if (old === el) return;
      if (old) cards.unobserve(old);
      if (el) {
        observed.set(index, el as HTMLElement);
        cards.observe(el as HTMLElement);
      } else observed.delete(index);
    };
    cardRefs.set(index, fn);
  }
  return fn;
}

watch(
  () => ui.wrap,
  () => (measured.value = new Map()),
);

let observer: ResizeObserver | null = null;
onMounted(() => {
  const el = scroller.value;
  if (!el) return;
  observer = new ResizeObserver(() => {
    viewHeight.value = el.clientHeight || viewHeight.value;
    paintMinimap();
  });
  observer.observe(el);
  addEventListener("pointerup", endDrag);
});
onBeforeUnmount(() => {
  observer?.disconnect();
  cards.disconnect();
  abort?.abort();
  removeEventListener("pointerup", endDrag);
});

const MAP_W = 10;

function paintMinimap() {
  const el = minimap.value;
  const d = diff.value;
  if (!el || !d) return;
  const h = viewHeight.value;
  const total = Math.max(1, layout.value.height);
  const dpr = devicePixelRatio || 1;
  el.width = Math.round(MAP_W * dpr);
  el.height = Math.round(h * dpr);
  const ctx = el.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, MAP_W, h);
  const colours = dark.value ? { add: "#44d692", del: "#ff6b78" } : { add: "#138a55", del: "#d23b48" };
  const scale = h / total;
  for (const { hunk, top } of layout.value.blocks) {
    let y = top + HEAD;
    let run: "add" | "del" | null = null;
    let from = 0;
    const flush = (to: number) => {
      if (!run) return;
      ctx.fillStyle = colours[run];
      const y0 = from * scale;
      ctx.fillRect(run === "add" ? 5 : 1, y0, 4, Math.max(2, (to - from) * scale));
    };
    for (const line of hunk.lines) {
      const kind = line.kind === "ctx" ? null : line.kind;
      if (kind !== run) {
        flush(y);
        run = kind;
        from = y;
      }
      y += ROW;
    }
    flush(y);
  }
}

watch([diff, dark], () => requestAnimationFrame(paintMinimap));

const thumbEl = ref<HTMLElement | null>(null);
const thumb = computed(() => {
  const total = Math.max(1, layout.value.height);
  if (total <= viewHeight.value) return null;
  const h = viewHeight.value;
  return { height: `${Math.max(16, (h / total) * h)}px` };
});

/** Written straight to the style, so scrolling does not re-render the diff. */
function placeThumb() {
  const el = thumbEl.value;
  if (el) el.style.top = `${(scrollTop.value / Math.max(1, layout.value.height)) * viewHeight.value}px`;
}
watch(thumbEl, placeThumb);

function jump(e: PointerEvent) {
  const el = scroller.value;
  const map = minimap.value;
  if (!el || !map) return;
  const box = map.getBoundingClientRect();
  const ratio = (e.clientY - box.top) / box.height;
  el.scrollTo({
    top: ratio * layout.value.height - el.clientHeight / 2,
    behavior: reducedMotion.value ? "auto" : "smooth",
  });
}

const order = computed(() => {
  const keys: string[] = [];
  for (const h of diff.value?.hunks ?? [])
    for (const l of h.lines) if (l.kind !== "ctx") keys.push(`${h.index}:${l.index}`);
  return { keys, at: new Map(keys.map((k, i) => [k, i])) };
});

let drag: { base: Set<string>; anchor: number; on: boolean } | null = null;
let anchor = -1;

function setPicked(next: Set<string>) {
  picked.value = next;
  version.value++;
}

function range(base: Set<string>, a: number, b: number, on: boolean) {
  const next = new Set(base);
  const [lo, hi] = a < b ? [a, b] : [b, a];
  for (let i = lo; i <= hi; i++) {
    const k = order.value.keys[i]!;
    if (on) next.add(k);
    else next.delete(k);
  }
  return next;
}

function onDown(hunk: number, line: DiffLine, event: PointerEvent) {
  if (!editable.value || line.kind === "ctx" || event.button !== 0) return;
  event.preventDefault();
  const at = order.value.at.get(`${hunk}:${line.index}`);
  if (at === undefined) return;
  if (event.shiftKey && anchor >= 0) {
    setPicked(range(picked.value, anchor, at, true));
    return;
  }
  const on = !picked.value.has(`${hunk}:${line.index}`);
  drag = { base: new Set(picked.value), anchor: at, on };
  anchor = at;
  setPicked(range(drag.base, at, at, on));
  appHaptics.perform("click", { pointerId: event.pointerId });
}

function onOver(hunk: number, line: DiffLine) {
  if (!drag || line.kind === "ctx") return;
  const at = order.value.at.get(`${hunk}:${line.index}`);
  if (at !== undefined) setPicked(range(drag.base, drag.anchor, at, drag.on));
}

function endDrag() {
  drag = null;
}

function clearPicks() {
  if (picked.value.size) setPicked(new Set());
}

function pickedLines(): [number, number][] {
  return [...picked.value].map((k) => k.split(":").map(Number) as [number, number]);
}

async function applyLines(mode: "stage" | "unstage" | "discard", hunks: number[], lines: [number, number][]) {
  const d = diff.value;
  if (!d) return;
  const patch = selection(d, hunks, lines, mode !== "stage");
  if (!patch) return;
  if (mode === "discard") {
    const what = hunks.length ? "this hunk" : `${lines.length} selected line${lines.length === 1 ? "" : "s"}`;
    if (
      !(await ask(
        `Discard ${what}?`,
        "The change will be removed from the working tree. This cannot be undone.",
        "Discard",
      ))
    )
      return;
  }
  if (hunks.length === 1 && !reducedMotion.value) {
    collapsing.value = hunks[0]!;
    await new Promise<void>((r) => setTimeout(r, 180));
  }
  await apply(patch, mode);
  clearPicks();
}

const primary = computed(() => (props.target.mode === "staged" ? "unstage" : "stage"));

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape" && picked.value.size) {
    e.preventDefault();
    clearPicks();
  }
}

function stageFile() {
  if (props.target.mode === "staged") void unstage([file.value]);
  else void stage([file.value]);
}

const name = computed(() => splitPath(props.target.path));
const sizeText = computed(() => {
  const bytes = lastText?.startsWith("\0truncated:") ? Number(lastText.slice(11)) : CAP;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
});

/** Five blocks split between additions and deletions, as a glance at the size of the change. */
const bar = computed(() => {
  const d = diff.value;
  if (!d || !(d.added + d.removed)) return [];
  const total = d.added + d.removed;
  const filled = Math.min(5, Math.max(1, Math.ceil(Math.log10(total + 1) * 2)));
  const add = Math.round((d.added / total) * filled);
  return Array.from({ length: 5 }, (_, i) => (i < add ? "add" : i < filled ? "del" : "none"));
});

function loadAnyway() {
  unlimited.value = true;
  lastText = null;
  void load(false);
}

defineExpose({ clearPicks });
</script>

<template>
  <section class="diff" tabindex="-1" @keydown="onKey">
    <header class="diff-head">
      <span class="kind" :class="target.kind">{{ target.kind }}</span>
      <div class="path">
        <span v-if="target.from" class="dir">{{ target.from }} → </span>
        <span class="dir">{{ name.dir }}</span
        ><b>{{ name.name }}</b>
      </div>
      <span v-if="diff && (diff.added || diff.removed)" class="stats">
        <span class="plus">+{{ diff.added }}</span>
        <span class="minus">−{{ diff.removed }}</span>
        <span class="bar" aria-hidden="true"><i v-for="(b, i) in bar" :key="i" :class="b" /></span>
      </span>
      <span v-if="loading && slow" class="spinner muted" />
      <div class="head-actions">
        <button
          id="wrap-lines"
          v-tip="ui.wrap ? 'Scroll long lines sideways' : 'Wrap long lines'"
          class="icon-btn focusable"
          :class="{ on: ui.wrap }"
          role="switch"
          :aria-checked="ui.wrap"
          @click="ui.wrap = !ui.wrap"
        >
          <Icon name="wrap" :size="15" />
        </button>
        <template v-if="target.mode !== 'commit'">
          <span class="sep" />
          <button
            v-if="canDiscard"
            id="discard-file"
            v-tip="'Discard every change in this file'"
            class="btn ghost small"
            @click="confirmDiscard([file])"
          >
            <Icon name="discard" :size="13" />Discard
          </button>
          <button id="stage-file" class="btn small" :class="{ primary: target.mode === 'unstaged' }" @click="stageFile">
            <Icon :name="target.mode === 'staged' ? 'minus' : 'plus'" :size="13" />
            {{
              target.mode === "staged" ? "Unstage file" : target.kind === "conflicted" ? "Mark resolved" : "Stage file"
            }}
          </button>
        </template>
      </div>
    </header>

    <div v-if="diff?.modeChange" class="note">File mode changed {{ diff.modeChange }}</div>

    <div class="body">
      <div ref="scroller" class="scroller" @scroll="onScroll">
        <div v-if="error" class="empty">
          <div class="glyph"><Icon name="alert" :size="24" /></div>
          <h3>Could not read the diff</h3>
          <pre class="stderr">{{ error }}</pre>
          <div class="actions"><button class="btn primary" @click="load(true)">Try again</button></div>
        </div>
        <div v-else-if="target.kind === 'conflicted'" class="empty">
          <div class="glyph warn"><Icon name="alert" :size="24" /></div>
          <h3>This file has conflicts</h3>
          <p>Resolve the conflict markers in your editor, then mark the file as resolved to stage it.</p>
        </div>
        <div v-else-if="diff?.truncated" id="diff-large" class="empty">
          <div class="glyph"><Icon name="file" :size="24" /></div>
          <h3>This diff is large</h3>
          <p>Its output passes {{ sizeText }}, so it is not shown by default to keep the app responsive.</p>
          <div class="actions"><button id="load-anyway" class="btn" @click="loadAnyway">Load anyway</button></div>
        </div>
        <div v-else-if="diff?.binary" class="empty">
          <div class="glyph"><Icon name="binary" :size="24" /></div>
          <h3>Binary file</h3>
          <p>Its contents changed, but a binary file has no lines to show.</p>
        </div>
        <div v-else-if="diff && !diff.hunks.length" class="empty">
          <div class="glyph"><Icon name="file" :size="24" /></div>
          <h3>{{ diff.modeChange ? "Only the file mode changed" : "No content changes" }}</h3>
          <p v-if="target.kind === 'untracked' || target.kind === 'added'">The file is empty.</p>
        </div>
        <div v-else-if="!diff && slow" class="skeleton">
          <div class="bone head" />
          <div v-for="i in 12" :key="i" class="bone" :style="{ width: `${30 + ((i * 37) % 55)}%` }" />
        </div>

        <div
          v-else-if="diff"
          id="diff-canvas"
          class="canvas"
          :class="{ wrap: ui.wrap }"
          :style="{ height: `${layout.height}px`, '--gutter-w': `${gutterWidth}px`, '--inset': `${INSET}px` }"
        >
          <div
            v-for="block in visible.filter((b) => b.hunk.before)"
            :key="`s${block.hunk.index}`"
            class="skip"
            :class="{ first: block.hunk.index === 0 }"
            :style="{ top: `${block.top - SKIP}px` }"
          >
            <span class="skip-line" /><span class="skip-text">{{ skipped(block.hunk.before) }}</span
            ><span class="skip-line" />
          </div>
          <section
            v-for="block in visible"
            :key="block.hunk.index"
            :ref="cardRef(block.hunk.index)"
            class="card"
            :class="{ collapsing: collapsing === block.hunk.index }"
            :data-hunk="block.hunk.index"
            :style="{ top: `${block.top}px`, height: ui.wrap ? undefined : `${block.height}px` }"
          >
            <header class="hunk" :class="{ stuck: stuck === block.hunk.index }" :data-hunk="block.hunk.index">
              <span class="hunk-range">{{ block.hunk.header }}</span>
              <span class="hunk-section">{{ block.hunk.section }}</span>
              <span class="hunk-stat"
                ><span class="plus">+{{ block.hunk.added }}</span>
                <span class="minus">−{{ block.hunk.removed }}</span></span
              >
              <span v-if="editable" class="hunk-actions">
                <button
                  v-if="canDiscard"
                  class="btn ghost small hunk-discard"
                  @click="applyLines('discard', [block.hunk.index], [])"
                >
                  Discard
                </button>
                <button class="btn small hunk-apply" @click="applyLines(primary, [block.hunk.index], [])">
                  <Icon :name="primary === 'stage' ? 'plus' : 'minus'" :size="12" />
                  {{ primary === "stage" ? "Stage hunk" : "Unstage hunk" }}
                </button>
              </span>
            </header>
            <DiffChunk
              :hunk="block.hunk"
              :digits="diff.digits"
              :picked="picked"
              :version="version"
              :selectable="editable"
              :lang="lang"
              @down="onDown"
              @over="onOver"
            />
          </section>
        </div>
      </div>

      <div v-if="diff && diff.hunks.length" class="minimap" @pointerdown="jump">
        <canvas ref="minimap" :style="{ width: `${MAP_W}px`, height: `${viewHeight}px` }" />
        <div v-if="thumb" ref="thumbEl" class="thumb" :style="thumb" />
      </div>

      <div v-if="editable && picked.size" class="actionbar" role="toolbar" aria-label="Selected lines">
        <span class="picked-count"
          ><b>{{ picked.size }}</b> line{{ picked.size === 1 ? "" : "s" }}</span
        >
        <button v-tip="['Clear the selection', 'Esc']" class="btn ghost small" @click="clearPicks">Clear</button>
        <button
          v-if="canDiscard"
          id="discard-lines"
          class="btn small danger-ghost"
          @click="applyLines('discard', [], pickedLines())"
        >
          Discard
        </button>
        <button id="apply-lines" class="btn primary small" @click="applyLines(primary, [], pickedLines())">
          {{ primary === "stage" ? "Stage lines" : "Unstage lines" }}
        </button>
      </div>
      <div v-else-if="editable && diff && diff.hunks.length" class="hint-pill">
        Click or drag the line numbers to pick lines · Shift+click extends
      </div>
    </div>
  </section>
</template>

<style scoped>
.diff {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background-color: var(--pane);
}
.diff-head {
  display: flex;
  flex: none;
  align-items: center;
  gap: 10px;
  height: 48px;
  padding: 0 14px 0 16px;
  border-bottom: 1px solid var(--line);
}
.kind {
  flex: none;
  padding: 0 7px;
  border-radius: 9px;
  color: var(--k);
  background-color: color-mix(in srgb, var(--k) 15%, transparent);
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.04em;
  line-height: 18px;
  text-transform: uppercase;
  --k: var(--badge-modified);
}
.kind.added {
  --k: var(--badge-added);
}
.kind.deleted {
  --k: var(--badge-deleted);
}
.kind.renamed,
.kind.copied {
  --k: var(--badge-renamed);
}
.kind.untracked {
  --k: var(--badge-untracked);
}
.kind.conflicted {
  --k: var(--badge-conflicted);
}
.path {
  min-width: 0;
  overflow: hidden;
  font-size: 13.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.path b {
  font-weight: 600;
}
.dir {
  color: var(--muted);
}
.stats {
  display: flex;
  flex: none;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.plus {
  color: var(--add);
}
.minus {
  color: var(--del);
}
.bar {
  display: flex;
  gap: 2px;
  margin-left: 2px;
}
.bar i {
  width: 7px;
  height: 7px;
  border-radius: 2px;
  background-color: var(--line-strong);
}
.bar i.add {
  background-color: var(--add);
}
.bar i.del {
  background-color: var(--del);
}
.muted {
  color: var(--faint);
}
.head-actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}
.note {
  flex: none;
  padding: 6px 16px;
  border-bottom: 1px solid var(--line);
  color: var(--muted);
  font-size: 12px;
}
.body {
  position: relative;
  display: flex;
  flex: 1;
  min-height: 0;
}
.scroller {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
}
.canvas {
  position: relative;
  flex: none;
}
.card {
  position: absolute;
  left: var(--inset);
  right: var(--inset);
  overflow: clip;
  border: 1px solid var(--line);
  border-radius: 12px;
  background-color: var(--card);
  box-shadow: 0 1px 2px light-dark(#1b1d3a0f, #00000040);
  transition:
    opacity 180ms var(--ease),
    transform 180ms var(--ease);
}
.card.collapsing {
  opacity: 0;
  transform: scaleY(0.6);
}
.hunk {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 10px;
  height: 38px;
  padding: 0 8px 0 14px;
  box-sizing: border-box;
  border-bottom: 1px solid var(--line);
  background-color: var(--hunk-bg);
  color: var(--hunk-text);
  font-size: 12px;
  box-shadow: 0 0 0 transparent;
  transition: box-shadow 220ms var(--ease);
}
.hunk.stuck {
  box-shadow: 0 8px 18px -8px light-dark(#1b1d3a40, #000000b3);
}
.skip {
  position: absolute;
  left: calc(var(--inset) + 12px);
  right: calc(var(--inset) + 12px);
  display: flex;
  align-items: center;
  gap: 10px;
  height: 34px;
  color: var(--faint);
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
}
.skip-line {
  flex: 1;
  height: 1px;
  background-color: var(--line-strong);
}
.skip-text {
  flex: none;
}
.sep {
  width: 1px;
  height: 18px;
  margin: 0 4px;
  background-color: var(--line-strong);
}
.icon-btn.on {
  background-color: var(--accent-soft);
  color: var(--accent);
}
.hunk-range {
  flex: none;
  font-family: var(--mono);
  font-size: 11.5px;
}
.hunk-section {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--muted);
  font-family: var(--mono);
  font-size: 11.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hunk-stat {
  display: flex;
  flex: none;
  gap: 6px;
  font-size: 11.5px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.hunk-actions {
  display: flex;
  flex: none;
  gap: 4px;
}
.hunk-actions .btn {
  height: 24px;
}
.minimap {
  position: relative;
  flex: none;
  width: 14px;
  padding: 0 2px;
  border-left: 1px solid var(--line);
  cursor: pointer;
}
.minimap canvas {
  display: block;
}
.thumb {
  position: absolute;
  left: 1px;
  right: 1px;
  border-radius: 4px;
  background-color: light-dark(#1b1d3a14, #ffffff17);
  box-shadow: inset 0 0 0 1px var(--line-strong);
  pointer-events: none;
}
.actionbar {
  position: absolute;
  bottom: 18px;
  left: 50%;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 6px 6px 14px;
  border: 1px solid var(--line-strong);
  border-radius: 14px;
  background-color: var(--raised);
  box-shadow: var(--shadow);
  transform: translateX(-50%);
  transition:
    opacity 160ms var(--ease),
    transform 240ms var(--spring);
}
@starting-style {
  .actionbar {
    opacity: 0;
    transform: translate(-50%, 14px) scale(0.96);
  }
}
.picked-count {
  margin-right: 6px;
  color: var(--muted);
  font-size: 12.5px;
}
.picked-count b {
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.danger-ghost:hover {
  border-color: var(--danger);
  color: var(--danger);
}
.hint-pill {
  position: absolute;
  bottom: 14px;
  left: 50%;
  padding: 4px 12px;
  border-radius: 12px;
  background-color: var(--sunken);
  color: var(--faint);
  font-size: 11.5px;
  white-space: nowrap;
  pointer-events: none;
  transform: translateX(-50%);
}
.skeleton {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 18px var(--inset, 14px);
}
.bone {
  height: 10px;
  border-radius: 5px;
  background-color: var(--hover);
  animation: pulse 1.2s ease-in-out infinite;
}
.bone.head {
  height: 30px;
  border-radius: 10px;
}
@keyframes pulse {
  50% {
    opacity: 0.5;
  }
}
.empty .glyph.warn {
  color: var(--warn);
}
@media (prefers-reduced-motion: reduce) {
  .card,
  .hunk,
  .actionbar {
    transition: none;
  }
  .bone {
    animation: none;
  }
}
</style>
