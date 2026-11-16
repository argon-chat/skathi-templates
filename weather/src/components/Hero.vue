<script setup lang="ts">
import { computed, ref } from "vue";
import { labelOf } from "../conditions";
import { ago, degrees } from "../format";
import { weather } from "../scene";
import { app, choose } from "../state";
import Icon from "./Icon.vue";
import WeatherIcon from "./WeatherIcon.vue";

const menu = ref(false);
const f = computed(() => app.forecast);
const today = computed(() => f.value?.days[0]);
const label = computed(() => labelOf(weather.value.code, weather.value.isDay));
const status = computed(() => {
  if (app.loading && !f.value) return "Loading…";
  if (app.offline) return "Offline · sample forecast";
  return f.value ? ago(app.clock - f.value.fetched) : "";
});
const deg = (c: number) => `${degrees(c, app.units)}°`;

function search() {
  menu.value = false;
  app.searching = true;
}
</script>

<template>
  <section class="hero">
    <div class="where">
      <button class="place" @click="menu = !menu">
        <Icon name="pin" :size="22" />
        <span class="place-name">{{ app.place.name }}, {{ app.place.country }}</span>
        <Icon name="chevron" :size="20" />
      </button>
      <div class="status">
        <span>{{ status }}</span>
        <span v-if="app.preview" class="badge">Preview</span>
      </div>
      <div v-if="menu" class="menu">
        <button v-for="p in app.recent" :key="`${p.latitude},${p.longitude}`" class="menu-item" @click="choose(p)">
          <span>{{ p.name }}</span>
          <span class="menu-sub">{{ [p.region, p.country].filter(Boolean).join(", ") }}</span>
        </button>
        <button class="menu-item find" @click="search">
          <Icon name="search" :size="16" />
          <span>Find a city…</span>
        </button>
      </div>
    </div>
    <div v-if="f" class="reading">
      <div class="temp-row">
        <span class="temp">{{ deg(f.now.temperature) }}</span>
        <WeatherIcon class="big-icon" :code="weather.code" :night="!weather.isDay" :size="124" />
      </div>
      <div class="condition">{{ label }}</div>
      <div class="meta">
        Feels like {{ deg(f.now.feelsLike) }}
        <span class="dot">•</span>
        H {{ deg(today?.high ?? f.now.temperature) }}
        <span class="gap" />
        L {{ deg(today?.low ?? f.now.temperature) }}
      </div>
    </div>
  </section>
</template>

<style scoped>
.hero {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 0 0 0 20px;
  z-index: 3;
}
.where {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}
.place {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px 6px 6px;
  margin-left: -6px;
  border-radius: 14px;
  border: none;
  background: transparent;
  color: #ffffff;
  cursor: pointer;
  transition: background-color 150ms ease;
}
.place:hover {
  background: #ffffff14;
}
.place-name {
  font-size: 24px;
  font-weight: 400;
  letter-spacing: 0.2px;
}
.status {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-left: 32px;
  font-size: 14px;
  color: #ffffffb3;
}
.badge {
  padding: 2px 9px;
  border-radius: 999px;
  background: #ffffff26;
  font-size: 11px;
  color: #ffffff;
}
.menu {
  position: absolute;
  top: 48px;
  left: 18px;
  width: 280px;
  display: flex;
  flex-direction: column;
  padding: 6px;
  border-radius: 16px;
  border: 1px solid #ffffff2e;
  background: #2a1d55e6;
  box-shadow: 0 24px 48px -12px #0a0420cc;
  backdrop-filter: blur(20px);
  z-index: 10;
}
.menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: #ffffff;
  font-size: 14px;
  text-align: left;
  cursor: pointer;
}
.menu-item:hover {
  background: #ffffff1a;
}
.menu-sub {
  font-size: 12px;
  color: #ffffff8c;
}
.find {
  color: #ffffffcc;
  border-top: 1px solid #ffffff14;
  border-radius: 0 0 10px 10px;
}
.reading {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.temp-row {
  display: flex;
  align-items: center;
  gap: 4px;
}
.temp {
  font-size: 128px;
  line-height: 124px;
  font-weight: 200;
  letter-spacing: -4px;
  color: #ffffff;
}
.big-icon {
  margin-top: 4px;
}
.condition {
  font-size: 32px;
  font-weight: 400;
  color: #ffffff;
}
.meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 17px;
  color: #ffffffcc;
}
.dot {
  font-size: 10px;
  padding: 0 4px;
}
.gap {
  width: 6px;
}
</style>
