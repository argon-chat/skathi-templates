<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef } from "vue";
import Glass from "../components/Glass.vue";
import { degrees, hourOf } from "../format";
import { app } from "../state";

const box = shallowRef<HTMLElement | null>(null);
const width = ref(800);
let observer: ResizeObserver | null = null;
onMounted(() => {
  observer = new ResizeObserver(() => {
    const w = box.value?.getBoundingClientRect().width;
    if (w) width.value = Math.round(w);
  });
  if (box.value) observer.observe(box.value);
});
onUnmounted(() => observer?.disconnect());

const HEIGHT = 200;
const PAD = 28;

const hours = computed(() => app.forecast?.hours.slice(0, 25) ?? []);
const temps = computed(() => hours.value.map((h) => degrees(h.temperature, app.units)));
const points = computed(() => {
  const t = temps.value;
  if (t.length < 2) return [];
  const lo = Math.min(...t) - 1;
  const hi = Math.max(...t) + 1;
  const step = (width.value - PAD * 2) / (t.length - 1);
  return t.map((v, i) => ({ x: PAD + i * step, y: PAD + (1 - (v - lo) / (hi - lo)) * (HEIGHT - PAD * 2), v }));
});

const line = computed(() => {
  const p = points.value;
  if (!p.length) return "";
  let d = `M${p[0]!.x.toFixed(1)} ${p[0]!.y.toFixed(1)}`;
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 2] ?? p[i - 1]!;
    const b = p[i - 1]!;
    const c = p[i]!;
    const e = p[i + 1] ?? c;
    const c1 = { x: b.x + (c.x - a.x) / 6, y: b.y + (c.y - a.y) / 6 };
    const c2 = { x: c.x - (e.x - b.x) / 6, y: c.y - (e.y - b.y) / 6 };
    d += ` C${c1.x.toFixed(1)} ${c1.y.toFixed(1)} ${c2.x.toFixed(1)} ${c2.y.toFixed(1)} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`;
  }
  return d;
});
const area = computed(() => {
  const p = points.value;
  if (!p.length) return "";
  return `${line.value} L${p[p.length - 1]!.x.toFixed(1)} ${HEIGHT} L${p[0]!.x.toFixed(1)} ${HEIGHT} Z`;
});
const labels = computed(() =>
  points.value.flatMap((p, i) =>
    i % 3 === 0 ? [{ ...p, hour: hourOf(hours.value[i]?.time ?? 0, app.forecast?.offset ?? 0) }] : [],
  ),
);
const chances = computed(() => hours.value.map((h) => h.precipitationChance));
</script>

<template>
  <div class="view charts">
    <h1 class="title">Next 24 hours</h1>
    <Glass class="panel">
      <h2 class="heading">Temperature</h2>
      <div ref="box" class="plot">
        <svg
          :width="width"
          :height="HEIGHT + 24"
          :viewBox="`0 0 ${width} ${HEIGHT + 24}`"
          :style="{ width: `${width}px`, height: `${HEIGHT + 24}px` }"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <linearGradient id="under" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="#ffd27a" stop-opacity="0.45" />
              <stop offset="1" stop-color="#8fb1ff" stop-opacity="0" />
            </linearGradient>
            <linearGradient id="stroke" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stop-color="#9fb8ff" />
              <stop offset="0.5" stop-color="#ffd27a" />
              <stop offset="1" stop-color="#ff9ad5" />
            </linearGradient>
          </defs>
          <path :d="area" fill="url(#under)" />
          <path :d="line" fill="none" stroke="url(#stroke)" stroke-width="3" stroke-linecap="round" />
          <g v-for="l in labels" :key="l.x">
            <circle :cx="l.x" :cy="l.y" r="4" fill="#ffffff" />
            <text
              :x="l.x"
              :y="l.y - 12"
              fill="#ffffff"
              font-size="13"
              font-family="Segoe UI, system-ui, sans-serif"
              text-anchor="middle"
            >
              {{ l.v }}°
            </text>
            <text
              :x="l.x"
              :y="HEIGHT + 18"
              fill="#ffffffa0"
              font-size="12"
              font-family="Segoe UI, system-ui, sans-serif"
              text-anchor="middle"
            >
              {{ l.hour }}
            </text>
          </g>
        </svg>
      </div>
    </Glass>
    <Glass class="panel">
      <h2 class="heading">Chance of rain</h2>
      <div class="bars">
        <div v-for="(c, i) in chances" :key="i" class="bar">
          <div class="fill" :style="{ height: `${Math.max(c, 2)}%` }" />
        </div>
      </div>
    </Glass>
  </div>
</template>

<style scoped>
.charts {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding-left: 20px;
}
.title {
  margin: 0;
  font-size: 34px;
  font-weight: 300;
}
.panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 18px 24px;
}
.heading {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: #ffffffe6;
}
.plot {
  width: 100%;
  height: 224px;
}
.bars {
  height: 120px;
  display: flex;
  align-items: flex-end;
  gap: 6px;
}
.bar {
  flex: 1;
  height: 100%;
  display: flex;
  align-items: flex-end;
}
.fill {
  width: 100%;
  border-radius: 4px 4px 2px 2px;
  background: linear-gradient(180deg, #a9c8ff, #6f7dff);
}
</style>
