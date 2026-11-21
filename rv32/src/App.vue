<script setup lang="ts">
import { Runtime } from "skathi:runtime";
import { computed, onMounted, onUnmounted, ref } from "vue";
import Inspector from "./components/Inspector.vue";
import Screen from "./components/Screen.vue";
import TitleBar from "./components/TitleBar.vue";
import { KEYS, LEGEND } from "./keys";
import { bench, frame, key, load, machine, pause, reset, run, step, stepFrame } from "./workbench";

const CONSOLE_LINES = 16;
const engine = Runtime.isAot() ? "AOT" : "JIT";
const glass = ref(true);

const rate = computed(() =>
  bench.running ? `${bench.fps.toFixed(0)} fps · ${bench.mips.toFixed(0)} MIPS` : bench.loaded ? "paused" : "loading",
);

const output = computed(() => {
  void frame.value;
  const lines = (machine()?.log ?? []).filter((line) => line.trim() !== "");
  return lines.slice(-CONSOLE_LINES).join("\n");
});

function press(event: KeyboardEvent, down: boolean): void {
  const code = KEYS[event.code];
  if (code === undefined) return;
  // Space and Enter would otherwise press whichever button was clicked last.
  event.preventDefault();
  if (!event.repeat) key(code, down);
}
const keydown = (event: KeyboardEvent): void => press(event, true);
const keyup = (event: KeyboardEvent): void => press(event, false);

onMounted(() => {
  window.addEventListener("keydown", keydown);
  window.addEventListener("keyup", keyup);
  void load();
});
onUnmounted(() => {
  pause();
  window.removeEventListener("keydown", keydown);
  window.removeEventListener("keyup", keyup);
});
</script>

<template>
  <main class="app">
    <TitleBar />
    <header class="bar">
      <button class="control primary" :disabled="!bench.loaded" @click="bench.running ? pause() : run()">
        {{ bench.running ? "Pause" : "Run" }}
      </button>
      <button class="control" :disabled="!bench.loaded" @click="step">Step</button>
      <button class="control" :disabled="!bench.loaded" @click="stepFrame">Frame</button>
      <button class="control" :disabled="!bench.loaded" @click="reset">Reset</button>
      <button class="control" :class="{ on: glass }" @click="glass = !glass">Glass</button>
      <span class="readout"
        ><b>{{ engine }}</b> {{ rate }}</span
      >
    </header>

    <div class="body">
      <section class="left">
        <Screen :glass="glass" />
        <div class="legend">
          <span v-for="entry in LEGEND" :key="entry.does" class="binding"
            ><b>{{ entry.keys }}</b
            >{{ entry.does }}</span
          >
        </div>
        <div class="console">
          <div class="lines">
            <pre>{{ output }}</pre>
          </div>
        </div>
      </section>
      <Inspector />
    </div>
  </main>
</template>
