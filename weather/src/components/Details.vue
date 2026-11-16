<script setup lang="ts">
import { computed } from "vue";
import type { IconName } from "../icons";
import { clock, compass, distance, duration, pressure, speed, uvLevel } from "../format";
import { app } from "../state";
import Glass from "./Glass.vue";
import Icon from "./Icon.vue";

const W = 260;
const RX = 112;
const RY = 62;
const BASE = 72;

const f = computed(() => app.forecast);
const today = computed(() => f.value?.days[0]);
const progress = computed(() => {
  const d = today.value;
  if (!d) return 0.5;
  return Math.min(1, Math.max(0, (app.clock / 1000 - d.sunrise) / Math.max(d.sunset - d.sunrise, 1)));
});
const point = (p: number) => ({
  x: W / 2 - RX * Math.cos(Math.PI * p),
  y: BASE - RY * Math.sin(Math.PI * p),
});
const sun = computed(() => point(progress.value));
const arc = `M${W / 2 - RX} ${BASE} A${RX} ${RY} 0 0 1 ${W / 2 + RX} ${BASE}`;
const passed = computed(() => {
  const s = sun.value;
  return `M${W / 2 - RX} ${BASE} A${RX} ${RY} 0 0 1 ${s.x.toFixed(1)} ${s.y.toFixed(1)}`;
});

const rows = computed<{ icon: IconName; label: string; value: string; uv?: ReturnType<typeof uvLevel> }[]>(() => {
  const n = f.value?.now;
  if (!n) return [];
  return [
    { icon: "wind", label: "Wind", value: `${speed(n.windSpeed, app.units)} ${compass(n.windDirection)}` },
    { icon: "drop", label: "Humidity", value: `${Math.round(n.humidity)}%` },
    { icon: "gauge", label: "Pressure", value: pressure(n.pressure, app.units) },
    { icon: "eye", label: "Visibility", value: distance(n.visibility, app.units) },
    { icon: "sun", label: "UV Index", value: String(Math.round(n.uv)), uv: uvLevel(n.uv) },
  ];
});
</script>

<template>
  <Glass class="details">
    <div v-if="f && today" class="sun">
      <svg class="arc" :width="W" height="84" :viewBox="`0 0 ${W} 84`" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="orb" cx="0.4" cy="0.38" r="0.7">
            <stop offset="0" stop-color="#fff8d6" />
            <stop offset="0.5" stop-color="#ffd65e" />
            <stop offset="1" stop-color="#ff9a3c" />
          </radialGradient>
          <radialGradient id="orb-glow" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0.3" stop-color="#ffd27a" stop-opacity="0.7" />
            <stop offset="1" stop-color="#ffd27a" stop-opacity="0" />
          </radialGradient>
        </defs>
        <path
          :d="arc"
          fill="none"
          stroke="#ffffff59"
          stroke-width="1.5"
          stroke-dasharray="2 5"
          stroke-linecap="round"
        />
        <path :d="passed" fill="none" stroke="#ffffffd9" stroke-width="2" stroke-linecap="round" />
        <circle :cx="sun.x" :cy="sun.y" r="16" fill="url(#orb-glow)" />
        <circle :cx="sun.x" :cy="sun.y" r="8" fill="url(#orb)" />
      </svg>
      <div class="sun-times">
        <div class="sun-time">
          <span class="k">Sunrise</span>
          <span class="v">{{ clock(today.sunrise, f.offset) }}</span>
        </div>
        <div class="sun-time mid">
          <span class="k">Daylight</span>
          <span class="v">{{ duration(today.sunset - today.sunrise) }}</span>
        </div>
        <div class="sun-time end">
          <span class="k">Sunset</span>
          <span class="v">{{ clock(today.sunset, f.offset) }}</span>
        </div>
      </div>
    </div>
    <div class="rows">
      <div v-for="row in rows" :key="row.label" class="row">
        <Icon :name="row.icon" :size="20" class="row-icon" />
        <span class="row-label">{{ row.label }}</span>
        <span class="row-value">{{ row.value }}</span>
        <span v-if="row.uv" class="uv" :class="row.uv.tone">{{ row.uv.label }}</span>
      </div>
    </div>
  </Glass>
</template>

<style scoped>
.details {
  display: flex;
  flex-direction: column;
  padding: 18px 22px 10px;
}
.sun {
  display: flex;
  flex-direction: column;
  align-items: center;
}
.arc {
  width: 260px;
  height: 84px;
}
.sun-times {
  width: 100%;
  display: flex;
  justify-content: space-between;
  margin-top: -18px;
}
.sun-time {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.sun-time.mid {
  align-items: center;
  margin-top: 6px;
}
.sun-time.end {
  align-items: flex-end;
}
.k {
  font-size: 13px;
  color: #ffffffb3;
}
.v {
  font-size: 17px;
  color: #ffffff;
}
.rows {
  display: flex;
  flex-direction: column;
  margin-top: 14px;
}
.row {
  height: 46px;
  display: flex;
  align-items: center;
  gap: 14px;
  border-top: 1px solid #ffffff1a;
}
.row-icon {
  color: #ffffffcc;
}
.row-label {
  flex: 1;
  font-size: 15px;
  color: #ffffffd9;
}
.row-value {
  font-size: 15px;
  color: #ffffff;
}
.uv {
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 12px;
}
.uv.low {
  background: #5fd39a33;
  color: #9ff0c4;
}
.uv.moderate {
  background: #ffd25e33;
  color: #ffe08f;
}
.uv.high {
  background: #ff7a6b33;
  color: #ffb1a6;
}
</style>
