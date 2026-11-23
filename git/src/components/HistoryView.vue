<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { avatar } from "../avatar";
import type { GraphRow } from "../git/graph";
import type { Commit, Ref } from "../git/log";
import { history } from "../history";
import { dark, lanes, reducedMotion } from "../theme";
import { vTip } from "../tip";
import { fullDate, relativeTime } from "../ui";
import CommitDetail from "./CommitDetail.vue";
import Icon from "./Icon.vue";

const ROW = 34;
const LANE = 16;
const PAD = 14;
/** Rows per graph canvas: each tile is drawn once and scrolls as it is. */
const TILE = 24;
const OVERSCAN = 4;
const MAX_PILLS = 1;

const scroller = ref<HTMLElement | null>(null);
const first = ref(0);
const height = ref(600);
const hoverColor = ref<number | null>(null);
const now = ref(Date.now());
const detailHeight = ref(0.48);
let clock: ReturnType<typeof setInterval> | undefined;

const widths = reactive({ refs: 190, graph: 0, author: 150, date: 118, sha: 78 });
type Column = keyof typeof widths;

const reader = () => (history.count, history.reader);
const done = computed(() => (history.count, history.reader?.done ?? true));
const error = computed(() => (history.count, history.reader?.error ?? null));
const total = computed(() => {
  const r = reader();
  if (!r) return 0;
  return Math.max(r.total ?? 0, r.commits.length + (r.done ? 0 : 1));
});

const graphWidth = computed(() => {
  if (widths.graph) return widths.graph;
  const lanesUsed = reader()?.graph.width ?? 1;
  return Math.min(260, Math.max(84, PAD * 2 + (lanesUsed - 1) * LANE + 8));
});

const columns = computed(() => ({
  "--w-refs": `${widths.refs}px`,
  "--w-graph": `${graphWidth.value}px`,
  "--w-author": `${widths.author}px`,
  "--w-date": `${widths.date}px`,
  "--w-sha": `${widths.sha}px`,
}));

const visible = computed(() => Math.ceil(height.value / ROW));

interface Shown {
  slot: number;
  index: number;
  commit: Commit | null;
  row: GraphRow | null;
  pills: Ref[];
  more: Ref[];
}

const ORDER: Record<Ref["kind"], number> = { head: 0, branch: 1, tag: 2, remote: 3 };
const NO_REFS: Ref[] = [];

/** Rows mounted at once: a row that scrolls out hands its element to the one scrolling in. */
const slots = computed(() => visible.value + OVERSCAN * 2);

const rows = computed(() => {
  const r = reader();
  const n = slots.value;
  const shown: Shown[] = [];
  if (!r) return shown;
  const from = Math.max(0, Math.min(first.value - OVERSCAN, total.value - n));
  const to = Math.min(total.value, from + n);
  for (let i = from; i < to; i++) {
    const commit = r.commits[i] ?? null;
    const row = r.graph.rows[i] ?? null;
    let pills = NO_REFS;
    let more = NO_REFS;
    if (commit?.refs.length) {
      const refs = [...commit.refs].sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);
      pills = refs.slice(0, MAX_PILLS);
      more = refs.slice(MAX_PILLS);
    }
    shown.push({ slot: i % n, index: i, commit: row ? commit : null, row, pills, more });
  }
  // In slot order, so a recycled element keeps its place among its siblings and nothing moves.
  return shown.sort((a, b) => a.slot - b.slot);
});

const tiles = computed(() => {
  const from = Math.max(0, Math.floor((first.value - OVERSCAN) / TILE));
  const to = Math.min(Math.ceil(total.value / TILE), Math.ceil((first.value + visible.value + OVERSCAN) / TILE));
  const list: number[] = [];
  for (let t = from; t < to; t++) list.push(t);
  return list;
});

function nodeX(lane: number) {
  return PAD + lane * LANE;
}

function laneColor(index: number) {
  return lanes.value[index % lanes.value.length]!;
}

const head = computed(() => {
  const r = reader();
  if (!r) return null;
  const at = r.commits.findIndex((c) => c.refs.some((x) => x.kind === "head"));
  const row = r.graph.rows[at];
  if (at < 0 || !row) return null;
  let end = at;
  for (let i = at + 1; i < r.graph.rows.length && i < at + 4000; i++) {
    const next = r.graph.rows[i]!;
    if (!next.up.some((s) => s.from === row.lane && s.to === row.lane && s.color === row.color)) break;
    end = i;
    if (next.lane === row.lane && next.color === row.color && !next.down.some((s) => s.from === row.lane)) break;
  }
  return { index: at, lane: row.lane, color: row.color, end };
});

const pulse = computed(() => {
  const h = head.value;
  if (!h || h.end <= h.index) return null;
  const top = Math.max(h.index * ROW + ROW / 2, (first.value - 2) * ROW);
  const bottom = Math.min(h.end * ROW + ROW / 2, (first.value + visible.value + 2) * ROW);
  if (bottom <= top) return null;
  return {
    left: `${widths.refs + nodeX(h.lane) - 12}px`,
    top: `${top}px`,
    height: `${bottom - top}px`,
    "--shading": `lanepulse(${laneColor(h.color)}, ${reducedMotion.value ? 0 : 1})`,
  };
});

const canvases = new Map<number, HTMLCanvasElement>();
/** What each tile shows, so it is drawn again only when that changes. */
const drawn = new WeakMap<HTMLCanvasElement, string>();

const tileRefs = new Map<number, (el: unknown) => void>();

/** One ref function per tile, so Vue does not detach and attach it on every render. */
function tileRef(tile: number) {
  let fn = tileRefs.get(tile);
  if (!fn) {
    fn = (el: unknown) => {
      if (el) canvases.set(tile, el as HTMLCanvasElement);
      else canvases.delete(tile);
    };
    tileRefs.set(tile, fn);
  }
  return fn;
}

/** Draws the tiles that are new or whose look changed; a tile drawn before its rows were read is drawn again. */
function drawTiles() {
  const r = reader();
  if (!r) return;
  const look = [graphWidth.value, hoverColor.value, dark.value, head.value?.color, devicePixelRatio].join();
  for (const t of tiles.value) {
    const el = canvases.get(t);
    if (!el) continue;
    const end = Math.min((t + 1) * TILE, total.value);
    const key = `${look}|${Math.min(r.graph.rows.length, end)}`;
    if (drawn.get(el) === key) continue;
    drawn.set(el, key);
    draw(el, t * TILE, end);
  }
}

function draw(el: HTMLCanvasElement, start: number, end: number) {
  const r = reader();
  if (!r) return;
  const dpr = devicePixelRatio || 1;
  const w = graphWidth.value;
  const h = TILE * ROW;
  const pw = Math.round(w * dpr);
  const ph = Math.round(h * dpr);
  if (el.width !== pw) el.width = pw;
  if (el.height !== ph) el.height = ph;
  const ctx = el.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.lineCap = "round";
  const hover = hoverColor.value;
  const headColor = head.value?.color ?? -1;
  const passes = [
    { width: 6, alpha: 0.16, only: true },
    { width: 2, alpha: 1, only: false },
  ];
  for (const pass of passes) {
    ctx.lineWidth = pass.width;
    for (let i = start; i < end; i++) {
      const row = r.graph.rows[i];
      if (!row) break;
      const top = (i - start) * ROW;
      const mid = top + ROW / 2;
      const segs: [GraphRow["up"][number], number, number][] = [
        ...row.up.map((s) => [s, top, mid] as [GraphRow["up"][number], number, number]),
        ...row.down.map((s) => [s, mid, top + ROW] as [GraphRow["up"][number], number, number]),
      ];
      for (const [s, y0, y1] of segs) {
        const glow = s.color === headColor || s.color === hover;
        if (pass.only && !glow) continue;
        const dim = hover !== null && s.color !== hover;
        ctx.globalAlpha = pass.alpha * (dim ? 0.28 : 1);
        ctx.strokeStyle = laneColor(s.color);
        const x0 = nodeX(s.from);
        const x1 = nodeX(s.to);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        if (x0 === x1) ctx.lineTo(x1, y1);
        else ctx.bezierCurveTo(x0, y0 + (y1 - y0) * 0.75, x1, y0 + (y1 - y0) * 0.25, x1, y1);
        ctx.stroke();
      }
    }
  }
  ctx.globalAlpha = 1;
}

watch(
  () => [tiles.value, graphWidth.value, hoverColor.value, dark.value, head.value?.color, history.count],
  drawTiles,
  { flush: "post" },
);

function want() {
  void history.reader?.ensure(first.value + visible.value + 300);
}

/** Rows passing under a still pointer while the list scrolls do not light up their lanes. */
let scrolling: ReturnType<typeof setTimeout> | undefined;

function onScroll() {
  const el = scroller.value;
  if (!el) return;
  first.value = Math.floor(el.scrollTop / ROW);
  hoverColor.value = null;
  clearTimeout(scrolling);
  scrolling = setTimeout(() => (scrolling = undefined), 150);
  want();
}

function onRowEnter(color: number) {
  if (scrolling === undefined) hoverColor.value = color;
}

watch(
  () => history.reader,
  () => {
    first.value = 0;
    if (scroller.value) scroller.value.scrollTop = 0;
  },
);

let observer: ResizeObserver | null = null;
onMounted(() => {
  const el = scroller.value;
  if (el) {
    observer = new ResizeObserver(() => {
      height.value = el.clientHeight || height.value;
      want();
    });
    observer.observe(el);
    const index = history.reader?.commits.findIndex((c) => c.sha === history.selected) ?? -1;
    if (index > 0) requestAnimationFrame(() => reveal(index));
  }
  drawTiles();
  clock = setInterval(() => (now.value = Date.now()), 60_000);
});
onBeforeUnmount(() => {
  observer?.disconnect();
  clearInterval(clock);
  clearTimeout(scrolling);
  stopDrag();
});

function reveal(index: number) {
  const el = scroller.value;
  if (!el) return;
  const top = index * ROW;
  if (top < el.scrollTop) el.scrollTop = top;
  else if (top + ROW > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW - el.clientHeight;
}

async function move(delta: number) {
  const r = history.reader;
  if (!r) return;
  const at = r.commits.findIndex((c) => c.sha === history.selected);
  const target = Math.max(0, at + delta);
  await r.ensure(target + 1);
  const index = Math.min(target, r.commits.length - 1);
  const commit = r.commits[index];
  if (!commit) return;
  history.selected = commit.sha;
  reveal(index);
}

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape" && history.selected) {
    e.preventDefault();
    history.selected = null;
    return;
  }
  const page = Math.max(1, visible.value - 1);
  const step: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, PageDown: page, PageUp: -page, Home: -1e9 };
  const delta = step[e.key];
  if (delta === undefined) return;
  e.preventDefault();
  void move(delta);
}

let drag: { column: Column | "detail"; start: number; from: number } | null = null;

function startResize(column: Column, e: PointerEvent) {
  e.preventDefault();
  const from = column === "graph" ? graphWidth.value : widths[column];
  drag = { column, start: e.clientX, from };
  addEventListener("pointermove", onDrag);
  addEventListener("pointerup", stopDrag);
}

function startDetailResize(e: PointerEvent) {
  e.preventDefault();
  drag = { column: "detail", start: e.clientY, from: detailHeight.value };
  addEventListener("pointermove", onDrag);
  addEventListener("pointerup", stopDrag);
}

function onDrag(e: PointerEvent) {
  if (!drag) return;
  if (drag.column === "detail") {
    const box = scroller.value?.parentElement?.getBoundingClientRect();
    if (!box) return;
    detailHeight.value = Math.min(0.8, Math.max(0.2, drag.from - (e.clientY - drag.start) / box.height));
    return;
  }
  const min: Record<Column, number> = { refs: 90, graph: 48, author: 80, date: 80, sha: 60 };
  widths[drag.column] = Math.min(420, Math.max(min[drag.column], drag.from + e.clientX - drag.start));
}

function stopDrag() {
  drag = null;
  removeEventListener("pointermove", onDrag);
  removeEventListener("pointerup", stopDrag);
}

function refIcon(kind: Ref["kind"]) {
  return kind === "tag" ? "tag" : kind === "remote" ? "cloud" : "branch";
}

function pillStyle(color: number, kind: Ref["kind"]) {
  const c = laneColor(color);
  if (kind === "head") return { "--pill": c, backgroundColor: c, borderColor: c };
  if (kind === "tag") return { "--pill": c };
  return { "--pill": c, backgroundColor: `${c}24`, borderColor: `${c}66` };
}

function rowStyle(index: number, commit: Commit, row: GraphRow) {
  const c = laneColor(row.color);
  return {
    top: `${index * ROW}px`,
    "--lane": c,
    "--band": `${c}30`,
    "--band-end": `${c}00`,
    "--node-x": `${nodeX(row.lane)}px`,
    animationDelay: history.fresh.has(commit.sha) ? `${Math.min(index, 8) * 45}ms` : undefined,
  };
}

const ripple = ref(0);
function select(sha: string) {
  if (history.selected !== sha) ripple.value++;
  history.selected = sha;
}

const COLUMNS: { key: Column | "message"; label: string; resizable: boolean }[] = [
  { key: "refs", label: "Branch / Tag", resizable: true },
  { key: "graph", label: "Graph", resizable: true },
  { key: "message", label: "Commit message", resizable: false },
  { key: "author", label: "Author", resizable: true },
  { key: "date", label: "Date", resizable: true },
  { key: "sha", label: "SHA", resizable: false },
];
</script>

<template>
  <section class="timeline" :style="columns">
    <header class="thead" role="row">
      <div v-for="c in COLUMNS" :key="c.key" class="th caps" :class="c.key" role="columnheader">
        <span>{{ c.label }}</span>
        <span
          v-if="c.resizable && c.key !== 'message'"
          class="grip"
          @pointerdown="startResize(c.key as Column, $event)"
          @dblclick="c.key === 'graph' && (widths.graph = 0)"
        />
      </div>
    </header>

    <div
      ref="scroller"
      id="history"
      class="scroller focusable"
      tabindex="0"
      role="grid"
      aria-label="History"
      @scroll="onScroll"
      @keydown="onKey"
      @mouseleave="hoverColor = null"
    >
      <div v-if="error" class="empty">
        <div class="glyph"><Icon name="alert" :size="24" /></div>
        <h3>Could not read the history</h3>
        <pre class="stderr">{{ error }}</pre>
      </div>
      <div v-else-if="done && total === 0" class="empty">
        <div class="field" />
        <div class="glyph"><Icon name="commit" :size="24" /></div>
        <h3>No commits yet</h3>
        <p>The first commit you make starts the timeline here.</p>
      </div>
      <div v-else class="spacer" :style="{ height: `${total * ROW}px` }">
        <canvas
          v-for="t in tiles"
          :key="t"
          :ref="tileRef(t)"
          class="graph-canvas"
          :style="{
            top: `${t * TILE * ROW}px`,
            left: `${widths.refs}px`,
            width: `${graphWidth}px`,
            height: `${TILE * ROW}px`,
          }"
        />
        <div v-if="pulse" class="pulse" :style="pulse" />
        <template v-for="s in rows" :key="s.slot">
          <div
            v-if="!s.commit || !s.row"
            class="commit pending"
            :style="{ top: `${s.index * ROW}px`, '--node-x': '14px' }"
          >
            <div class="cell refs" />
            <div class="cell graph"><span class="node bone" /></div>
            <div class="cell message"><span class="bone" :style="{ width: `${40 + ((s.index * 37) % 45)}%` }" /></div>
            <div class="cell author"><span class="bone" /></div>
            <div class="cell date"><span class="bone" /></div>
            <div class="cell sha"><span class="bone" /></div>
          </div>
          <div
            v-else
            class="commit"
            :class="{
              selected: s.commit.sha === history.selected,
              merge: s.row.merge,
              fresh: history.fresh.has(s.commit.sha),
              dim: hoverColor !== null && hoverColor !== s.row.color,
              'is-head': head?.index === s.index,
            }"
            :style="rowStyle(s.index, s.commit, s.row)"
            :data-sha="s.commit.sha"
            role="row"
            @mousedown="select(s.commit!.sha)"
            @mouseenter="onRowEnter(s.row!.color)"
          >
            <div class="band" />
            <div class="cell refs">
              <template v-if="s.pills.length">
                <span
                  v-for="r in s.pills"
                  :key="r.kind + r.name"
                  class="ref"
                  :class="r.kind"
                  :style="pillStyle(s.row.color, r.kind)"
                  ><Icon :name="refIcon(r.kind)" :size="11" :stroke="2.2" />{{ r.name }}</span
                >
                <span v-if="s.more.length" class="more">
                  +{{ s.more.length }}
                  <span class="more-list">
                    <span
                      v-for="r in s.more"
                      :key="r.kind + r.name"
                      class="ref"
                      :class="r.kind"
                      :style="pillStyle(s.row.color, r.kind)"
                      ><Icon :name="refIcon(r.kind)" :size="11" :stroke="2.2" />{{ r.name }}</span
                    >
                  </span>
                </span>
                <span class="connector" />
              </template>
            </div>
            <div class="cell graph">
              <span v-if="s.row.merge" class="node dot" />
              <span
                v-else
                class="node avatar"
                :style="{ background: avatar(s.commit.author, s.commit.email).background }"
              >
                {{ avatar(s.commit.author, s.commit.email).initials }}
              </span>
              <span v-if="s.commit.sha === history.selected" :key="ripple" class="ripple" />
            </div>
            <div class="cell message">
              <span class="subject">{{ s.commit.subject }}</span>
              <span v-if="s.commit.body" class="body">{{ s.commit.body }}</span>
            </div>
            <div class="cell author">{{ s.commit.author }}</div>
            <div v-tip="fullDate(s.commit.time)" class="cell date">{{ relativeTime(s.commit.time, now) }}</div>
            <div class="cell sha">{{ s.commit.sha.slice(0, 7) }}</div>
          </div>
        </template>
      </div>
    </div>

    <template v-if="history.selected">
      <div class="detail-grip" @pointerdown="startDetailResize" />
      <div class="detail-panel" :style="{ height: `${detailHeight * 100}%` }">
        <button
          v-tip="['Close', 'Esc']"
          class="icon-btn close-detail focusable"
          aria-label="Close the commit"
          @click="history.selected = null"
        >
          <Icon name="close" :size="14" />
        </button>
        <CommitDetail />
      </div>
    </template>
  </section>
</template>

<style scoped>
.timeline {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background-color: var(--pane);
}
.thead,
.commit {
  display: flex;
  align-items: center;
}
.thead {
  flex: none;
  height: 32px;
  border-bottom: 1px solid var(--line);
  background-color: var(--chrome);
}
.th {
  position: relative;
  display: flex;
  align-items: center;
  height: 100%;
  padding: 0 12px;
  white-space: nowrap;
}
.grip {
  position: absolute;
  top: 7px;
  right: -3px;
  bottom: 7px;
  z-index: 2;
  width: 7px;
  cursor: col-resize;
}
.grip::after {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: 3px;
  width: 1px;
  background-color: var(--line-strong);
  transition: background-color 120ms var(--ease);
}
.grip:hover::after {
  background-color: var(--accent);
}
.refs {
  flex: none;
  width: var(--w-refs);
}
.graph {
  flex: none;
  width: var(--w-graph);
}
.message {
  flex: 1;
  min-width: 0;
}
.author {
  flex: none;
  width: var(--w-author);
}
.date {
  flex: none;
  width: var(--w-date);
}
.sha {
  flex: none;
  width: var(--w-sha);
}

.scroller {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  outline-offset: -2px;
}
.spacer {
  position: relative;
}
.graph-canvas {
  position: absolute;
  pointer-events: none;
}
.pulse {
  position: absolute;
  width: 24px;
  pointer-events: none;
}

.commit {
  position: absolute;
  left: 0;
  right: 0;
  height: 34px;
  transition: opacity 160ms var(--ease);
}
.commit:hover {
  background-color: var(--hover);
}
.commit.selected {
  background-color: var(--selected);
}
.commit.selected::before {
  content: "";
  position: absolute;
  top: 5px;
  bottom: 5px;
  left: 0;
  width: 3px;
  border-radius: 0 3px 3px 0;
  background-color: var(--lane);
}
.commit.dim .cell.message,
.commit.dim .cell.refs {
  opacity: 0.55;
}
.commit.fresh {
  animation: drop 420ms var(--spring) both;
}
@keyframes drop {
  from {
    opacity: 0;
    transform: translateY(-14px);
  }
}
.band {
  position: absolute;
  top: 6px;
  bottom: 6px;
  left: calc(var(--w-refs) + var(--node-x));
  right: 30%;
  border-radius: 0 11px 11px 0;
  background: linear-gradient(90deg, var(--band), var(--band-end));
  opacity: 0.55;
  pointer-events: none;
  transition: opacity 160ms var(--ease);
}
.commit:hover .band,
.commit.selected .band {
  opacity: 1;
}
.commit.dim .band {
  opacity: 0.15;
}

.cell {
  position: relative;
  display: flex;
  align-items: center;
  height: 100%;
  padding: 0 12px;
  overflow: hidden;
  white-space: nowrap;
}
.cell.refs {
  justify-content: flex-end;
  gap: 4px;
  padding-right: 10px;
  overflow: visible;
}
.cell.graph {
  padding: 0;
  overflow: visible;
}
.ref {
  display: flex;
  flex: none;
  align-items: center;
  gap: 4px;
  max-width: 150px;
  height: 20px;
  padding: 0 8px 0 6px;
  overflow: hidden;
  border: 1px solid var(--line-strong);
  border-radius: 10px;
  color: var(--text);
  font-size: 11.5px;
  font-weight: 600;
  text-overflow: ellipsis;
  box-shadow: inset 0 1px 0 light-dark(#ffffff99, #ffffff1a);
}
.ref .icon {
  flex: none;
  color: var(--pill);
}
.ref.head {
  color: #ffffff;
  box-shadow:
    inset 0 1px 0 #ffffff40,
    0 2px 10px color-mix(in srgb, var(--pill) 40%, transparent);
}
.ref.head .icon {
  color: #ffffff;
}
.ref.remote {
  color: var(--muted);
  font-weight: 500;
}
.ref.tag {
  border-style: dashed;
  border-color: var(--pill);
  background-color: transparent;
}
.more {
  position: relative;
  flex: none;
  height: 20px;
  padding: 0 6px;
  border-radius: 10px;
  background-color: var(--hover);
  color: var(--muted);
  font-size: 11px;
  font-weight: 600;
  line-height: 20px;
}
.more-list {
  position: absolute;
  top: 24px;
  right: 0;
  z-index: 5;
  display: none;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  padding: 6px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background-color: var(--raised);
  box-shadow: var(--shadow);
}
.more:hover .more-list {
  display: flex;
}
.connector {
  position: absolute;
  top: 16px;
  right: calc(0px - var(--node-x));
  width: calc(var(--node-x) + 4px);
  height: 1.5px;
  background: linear-gradient(90deg, color-mix(in srgb, var(--lane) 30%, transparent), var(--lane));
  pointer-events: none;
}

.node {
  position: absolute;
  left: var(--node-x);
  top: 50%;
  transform: translate(-50%, -50%);
  transition:
    box-shadow 160ms var(--ease),
    transform 180ms var(--spring);
}
.node.avatar {
  width: 22px;
  height: 22px;
  border: 2px solid var(--lane);
  box-sizing: border-box;
  font-size: 8.5px;
  box-shadow: 0 0 0 2px var(--pane-solid);
}
.node.dot {
  width: 10px;
  height: 10px;
  border: 2px solid var(--lane);
  border-radius: 50%;
  box-sizing: border-box;
  background-color: var(--pane-solid);
}
.commit:hover .node {
  box-shadow:
    0 0 0 2px var(--pane-solid),
    0 0 0 5px color-mix(in srgb, var(--lane) 35%, transparent);
  transform: translate(-50%, -50%) scale(1.12);
}
.commit.is-head .node.avatar {
  box-shadow:
    0 0 0 2px var(--pane-solid),
    0 0 14px color-mix(in srgb, var(--lane) 70%, transparent);
}
.ripple {
  position: absolute;
  left: var(--node-x);
  top: 50%;
  width: 22px;
  height: 22px;
  border: 2px solid var(--lane);
  border-radius: 50%;
  box-sizing: border-box;
  pointer-events: none;
  transform: translate(-50%, -50%);
  animation: ripple 520ms var(--ease) forwards;
}
@keyframes ripple {
  from {
    opacity: 0.9;
    transform: translate(-50%, -50%) scale(1);
  }
  to {
    opacity: 0;
    transform: translate(-50%, -50%) scale(2.4);
  }
}

.cell.message {
  gap: 10px;
}
.subject {
  flex: none;
  max-width: 100%;
  overflow: hidden;
  color: var(--text);
  font-weight: 500;
  text-overflow: ellipsis;
}
.body {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--faint);
  text-overflow: ellipsis;
}
.cell.author,
.cell.date {
  color: var(--muted);
  font-size: 12.5px;
}
.cell.sha {
  color: var(--faint);
  font-family: var(--mono);
  font-size: 12px;
}

.pending .bone {
  width: 70%;
  height: 9px;
  border-radius: 5px;
  background-color: var(--hover);
}
.pending .node.bone {
  width: 12px;
  height: 12px;
  border-radius: 50%;
}

.empty .field {
  position: absolute;
  inset: 0;
  --shading: field(var(--accent), var(--accent-2), 0.5, 1);
  pointer-events: none;
}

.detail-grip {
  position: relative;
  z-index: 3;
  flex: none;
  height: 6px;
  margin: -3px 0;
  cursor: row-resize;
}
.detail-grip::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 50%;
  width: 36px;
  height: 3px;
  border-radius: 2px;
  background-color: var(--line-strong);
  transform: translateX(-50%);
}
.detail-panel {
  position: relative;
  display: flex;
  flex: none;
  flex-direction: column;
  min-height: 0;
  border-top: 1px solid var(--line-strong);
  background-color: var(--pane);
  box-shadow: 0 -12px 30px light-dark(#1b1d3a14, #00000059);
  transition:
    opacity 200ms var(--ease),
    transform 220ms var(--spring);
}
@starting-style {
  .detail-panel {
    opacity: 0;
    transform: translateY(24px);
  }
}
.close-detail {
  position: absolute;
  top: 10px;
  right: 12px;
  z-index: 4;
}

@media (prefers-reduced-motion: reduce) {
  .commit.fresh,
  .ripple {
    animation: none;
  }
  .ripple {
    display: none;
  }
  .detail-panel,
  .node {
    transition: none;
  }
}
</style>
