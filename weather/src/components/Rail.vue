<script setup lang="ts">
import type { IconName } from "../icons";
import { app, type View } from "../state";
import Icon from "./Icon.vue";

const items: { view: View; icon: IconName; title: string }[] = [
  { view: "now", icon: "cloud", title: "Now" },
  { view: "calendar", icon: "calendar", title: "10 days" },
  { view: "map", icon: "map", title: "Rain map" },
  { view: "charts", icon: "chart", title: "Charts" },
  { view: "settings", icon: "settings", title: "Settings" },
];
</script>

<template>
  <nav class="rail">
    <div class="drag" />
    <button
      v-for="item in items"
      :key="item.view"
      class="rail-item"
      :class="[item.view, { on: app.view === item.view }]"
      :title="item.title"
      @click="app.view = item.view"
    >
      <Icon :name="item.icon" :size="22" />
    </button>
  </nav>
</template>

<style scoped>
.rail {
  width: 76px;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding-bottom: 20px;
  background: linear-gradient(90deg, #1a0f3a40, #1a0f3a00);
}
.drag {
  width: 100%;
  height: 72px;
  window-drag: move;
}
.rail-item {
  width: 50px;
  height: 50px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 18px;
  corner-shape: squircle;
  border: 1px solid transparent;
  background: transparent;
  color: #ffffffb3;
  cursor: pointer;
  transition:
    background-color 150ms ease,
    color 150ms ease;
}
.rail-item:hover {
  background: #ffffff14;
  color: #ffffff;
}
.rail-item.on {
  border-color: #ffffff26;
  background: #ffffff26;
  color: #ffffff;
  box-shadow: 0 8px 20px -10px #0d0626;
}
</style>
