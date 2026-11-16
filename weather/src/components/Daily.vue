<script setup lang="ts">
import { computed } from "vue";
import { labelOf } from "../conditions";
import { degrees, weekday } from "../format";
import { app } from "../state";
import Glass from "./Glass.vue";
import WeatherIcon from "./WeatherIcon.vue";

const days = computed(() => {
  const f = app.forecast;
  if (!f) return [];
  return f.days.slice(0, 5).map((d, i) => ({
    key: d.time,
    name: i === 0 ? "Today" : weekday(d.time, f.offset),
    code: d.code,
    label: labelOf(d.code),
    high: `${degrees(d.high, app.units)}°`,
    low: `${degrees(d.low, app.units)}°`,
  }));
});
</script>

<template>
  <Glass class="daily">
    <div v-for="d in days" :key="d.key" class="day">
      <span class="name">{{ d.name }}</span>
      <WeatherIcon :code="d.code" :size="34" />
      <span class="label">{{ d.label }}</span>
      <span class="high">{{ d.high }}</span>
      <span class="low">{{ d.low }}</span>
    </div>
  </Glass>
</template>

<style scoped>
.daily {
  display: flex;
  flex-direction: column;
  padding: 8px 26px;
}
.day {
  height: 46px;
  display: flex;
  align-items: center;
  gap: 18px;
  border-top: 1px solid #ffffff1a;
}
.day:first-child {
  border-top-width: 0;
}
.name {
  width: 130px;
  font-size: 17px;
  color: #ffffff;
}
.label {
  flex: 1;
  padding-left: 8px;
  font-size: 14px;
  color: #ffffffcc;
}
.high {
  width: 50px;
  text-align: right;
  font-size: 17px;
  color: #ffffff;
}
.low {
  width: 44px;
  text-align: right;
  font-size: 17px;
  color: #ffffff99;
}
@media (max-height: 880px) {
  .day {
    height: 40px;
  }
}
</style>
