<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import Daily from "./components/Daily.vue";
import Details from "./components/Details.vue";
import Hero from "./components/Hero.vue";
import Hourly from "./components/Hourly.vue";
import RainMap from "./components/RainMap.vue";
import Rail from "./components/Rail.vue";
import Search from "./components/Search.vue";
import TopBar from "./components/TopBar.vue";
import { shading, weather } from "./scene";
import { app, start } from "./state";
import CalendarView from "./views/CalendarView.vue";
import ChartsView from "./views/ChartsView.vue";
import SettingsView from "./views/SettingsView.vue";

let stop = () => {};
onMounted(() => (stop = start()));
onUnmounted(() => stop());
</script>

<template>
  <div class="app" :data-condition="weather.condition">
    <div class="sky" :style="{ '--shading': shading.sky }" />
    <div class="land" :style="{ '--shading': shading.land }" />
    <div class="precip" :style="{ '--shading': shading.precip }" />
    <div class="frame">
      <Rail />
      <main class="main">
        <template v-if="app.view === 'now'">
          <div class="left">
            <Hero class="grow" />
            <Hourly />
            <Daily />
          </div>
          <div class="right">
            <Details />
            <RainMap class="grow" />
          </div>
        </template>
        <CalendarView v-else-if="app.view === 'calendar'" />
        <div v-else-if="app.view === 'map'" class="map-view">
          <h1 class="title">Rain map</h1>
          <RainMap class="grow" large />
        </div>
        <ChartsView v-else-if="app.view === 'charts'" />
        <SettingsView v-else />
      </main>
    </div>
    <TopBar />
    <Search v-if="app.searching" />
  </div>
</template>

<style>
.app {
  position: relative;
  height: 100%;
  overflow: hidden;
  background: #1b1240;
  color: #ffffff;
  font-family: var(--font);
}
.sky,
.land,
.precip {
  position: absolute;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
  transition: --shading 2400ms ease;
}
.frame {
  position: relative;
  z-index: 1;
  height: 100%;
  display: flex;
}
.main {
  flex: 1;
  min-width: 0;
  display: flex;
  gap: 22px;
  padding: 72px 24px 24px 22px;
}
.left {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.right {
  width: 336px;
  display: flex;
  flex-direction: column;
  gap: 22px;
}
.grow {
  flex: 1;
  min-height: 0;
}
.map-view {
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
</style>
