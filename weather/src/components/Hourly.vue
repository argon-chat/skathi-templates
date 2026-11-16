<script setup lang="ts">
import { computed } from "vue";
import { PREVIEW_CODES } from "../conditions";
import { degrees, hourOf } from "../format";
import { weather } from "../scene";
import { app } from "../state";
import Glass from "./Glass.vue";
import WeatherIcon from "./WeatherIcon.vue";

const hours = computed(() => {
  const f = app.forecast;
  if (!f) return [];
  const now = app.clock / 1000;
  const from = Math.max(
    0,
    f.hours.findIndex((h) => h.time + 3600 > now),
  );
  return f.hours.slice(from, from + 8).map((h, i) => ({
    key: h.time,
    label: i === 0 ? "Now" : hourOf(h.time, f.offset),
    code: i === 0 && app.preview ? PREVIEW_CODES[app.preview] : h.code,
    day: i === 0 ? weather.value.isDay : h.isDay,
    temp: `${degrees(i === 0 ? f.now.temperature : h.temperature, app.units)}°`,
  }));
});
</script>

<template>
  <Glass class="hourly">
    <div v-for="(h, i) in hours" :key="h.key" class="hour" :class="{ now: i === 0 }">
      <span class="label">{{ h.label }}</span>
      <WeatherIcon :code="h.code" :night="!h.day" :size="38" />
      <span class="temp">{{ h.temp }}</span>
    </div>
  </Glass>
</template>

<style scoped>
.hourly {
  display: flex;
  justify-content: space-between;
  padding: 12px 14px;
}
.hour {
  width: 62px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 10px 0 12px;
  border-radius: 16px;
}
.hour.now {
  border: 1px solid #ffffff26;
  background: #ffffff21;
}
.label {
  font-size: 13px;
  color: #ffffffcc;
}
.now .label {
  color: #ffffff;
  font-weight: 600;
}
.temp {
  font-size: 19px;
  color: #ffffff;
}
</style>
