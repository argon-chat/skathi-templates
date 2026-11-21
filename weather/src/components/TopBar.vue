<script setup lang="ts">
// sk.config.json hides the OS title bar: this strip drags the window (`window-drag: move`), and when the
// host draws no caption buttons of its own, `--window-control` gives these their OS behaviour.
import { appWindow } from "skathi:app";
import { onMounted, onUnmounted, ref } from "vue";
import { app } from "../state";
import Glass from "./Glass.vue";
import Icon from "./Icon.vue";
import PreviewPicker from "./PreviewPicker.vue";

const hostControls = ref(appWindow.chrome.hostControls);
const maximized = ref(appWindow.isMaximized());
const read = () => {
  hostControls.value = appWindow.chrome.hostControls;
  maximized.value = appWindow.isMaximized();
};

onMounted(() => {
  navigator.windowControlsOverlay.addEventListener("geometrychange", read);
  appWindow.addEventListener("maximize", read);
  appWindow.addEventListener("unmaximize", read);
});
onUnmounted(() => {
  navigator.windowControlsOverlay.removeEventListener("geometrychange", read);
  appWindow.removeEventListener("maximize", read);
  appWindow.removeEventListener("unmaximize", read);
});
</script>

<template>
  <header class="topbar">
    <div class="tools">
      <button class="round search" title="Search for a city" @click="app.searching = true">
        <Icon name="search" />
      </button>
      <button
        class="round picker"
        :class="{ on: app.picking }"
        title="Preview weather"
        @click="app.picking = !app.picking"
      >
        <Icon name="sliders" />
      </button>
      <Glass v-if="app.picking" class="popover">
        <PreviewPicker />
      </Glass>
    </div>
    <div v-if="!hostControls" class="controls">
      <div class="control minimize" title="Minimize">
        <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 5h10" stroke="currentColor" /></svg>
      </div>
      <div class="control maximize" :title="maximized ? 'Restore' : 'Maximize'">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path v-if="maximized" d="M2.5 2.5V.5h7v7h-2 M.5 2.5h7v7h-7z" stroke="currentColor" />
          <path v-else d="M.5 .5h9v9h-9z" stroke="currentColor" />
        </svg>
      </div>
      <div class="control close" title="Close">
        <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 0l10 10M10 0 0 10" stroke="currentColor" /></svg>
      </div>
    </div>
  </header>
</template>

<style scoped>
.topbar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 72px;
  display: flex;
  align-items: flex-start;
  justify-content: flex-end;
  window-drag: move;
  user-select: none;
  z-index: 5;
}
.tools {
  position: relative;
  display: flex;
  gap: 12px;
  padding: 18px 24px 0 0;
  window-drag: none;
}
.popover {
  position: absolute;
  top: 70px;
  right: 24px;
  width: 340px;
  padding: 18px;
  background: #2a1b5c66;
}
.round {
  width: 42px;
  height: 42px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 21px;
  border: 1px solid #ffffff2e;
  background: #ffffff1a;
  color: #ffffffe6;
  cursor: pointer;
  transition:
    background-color 150ms ease,
    transform 150ms ease;
}
.round:hover {
  background: #ffffff2e;
}
.round:active {
  transform: scale(0.95);
}
.round.on {
  background: #ffffff38;
}
.controls {
  height: 36px;
  display: flex;
  window-drag: none;
}
.control {
  width: 46px;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffffb3;
  transition:
    background-color 120ms ease,
    color 120ms ease;
}
.control:hover {
  background: #ffffff1f;
  color: #ffffff;
}
.minimize {
  --window-control: minimize;
}
.maximize {
  --window-control: maximize;
}
.close {
  --window-control: close;
}
.close:hover {
  background: #c42b1c;
}
</style>
