<script setup lang="ts">
import { computed } from "vue";
import Glass from "../components/Glass.vue";
import WeatherIcon from "../components/WeatherIcon.vue";
import { labelOf } from "../conditions";
import { dateOf, degrees, weekday } from "../format";
import { app } from "../state";

const days = computed(() => {
  const f = app.forecast;
  if (!f) return [];
  const lowest = Math.min(...f.days.map((d) => d.low));
  const highest = Math.max(...f.days.map((d) => d.high));
  const span = Math.max(highest - lowest, 1);
  return f.days.map((d, i) => ({
    key: d.time,
    name: i === 0 ? "Today" : weekday(d.time, f.offset),
    date: dateOf(d.time, f.offset),
    code: d.code,
    label: labelOf(d.code),
    chance: d.precipitationChance,
    low: `${degrees(d.low, app.units)}°`,
    high: `${degrees(d.high, app.units)}°`,
    from: ((d.low - lowest) / span) * 100,
    to: ((d.high - lowest) / span) * 100,
  }));
});
</script>

<template>
  <div class="view calendar">
    <h1 class="title">10-day forecast</h1>
    <Glass class="list">
      <div v-for="d in days" :key="d.key" class="day">
        <div class="when">
          <span class="name">{{ d.name }}</span>
          <span class="date">{{ d.date }}</span>
        </div>
        <WeatherIcon :code="d.code" :size="40" />
        <span class="label">{{ d.label }}</span>
        <span class="chance">{{ d.chance >= 20 ? `${d.chance}%` : "" }}</span>
        <span class="low">{{ d.low }}</span>
        <div class="range">
          <div class="fill" :style="{ left: `${d.from}%`, width: `${Math.max(d.to - d.from, 4)}%` }" />
        </div>
        <span class="high">{{ d.high }}</span>
      </div>
    </Glass>
  </div>
</template>

<style scoped>
.calendar {
  flex: 1;
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
.list {
  display: flex;
  flex-direction: column;
  padding: 6px 28px;
}
.day {
  height: 62px;
  display: flex;
  align-items: center;
  gap: 18px;
  border-top: 1px solid #ffffff1a;
}
.day:first-child {
  border-top-width: 0;
}
.when {
  width: 110px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.name {
  font-size: 17px;
  color: #ffffff;
}
.date {
  font-size: 12px;
  color: #ffffff99;
}
.label {
  flex: 1;
  font-size: 14px;
  color: #ffffffcc;
}
.chance {
  width: 44px;
  font-size: 13px;
  color: #a9c8ff;
}
.low,
.high {
  width: 40px;
  font-size: 17px;
  text-align: right;
}
.low {
  color: #ffffff99;
}
.range {
  position: relative;
  width: 180px;
  height: 6px;
  border-radius: 3px;
  background: #ffffff1f;
}
.fill {
  position: absolute;
  top: 0;
  height: 6px;
  border-radius: 3px;
  background: linear-gradient(90deg, #8fb1ff, #ffd27a);
}
</style>
