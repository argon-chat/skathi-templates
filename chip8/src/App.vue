<script setup lang="ts">
import { Runtime } from "skathi:runtime";
import { onMounted, ref } from "vue";
import { PROGRAMS } from "./chip8/roms";
import Debugger from "./components/Debugger.vue";
import Keypad from "./components/Keypad.vue";
import Screen from "./components/Screen.vue";
import { load, machine, open, pause, reset, run, step } from "./machine";

// The same loop runs from a native image after `sk publish --aot`; Turbo shows what that changes.
const engine = Runtime.isAot() ? "AOT" : "JIT";
const dragging = ref(0);
const chosen = ref(0);

function choose(index: number) {
  chosen.value = index;
  pause();
  open(index);
  run();
}

function over(event: DragEvent) {
  if (!event.dataTransfer?.types.includes("Files")) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
}

async function drop(event: DragEvent) {
  dragging.value = 0;
  const file = event.dataTransfer?.files[0];
  if (!file) return;
  event.preventDefault();
  pause();
  chosen.value = -1;
  load(file.name, new Uint8Array(await file.arrayBuffer()));
  if (!machine.error) run();
}

const rate = (perSecond: number) =>
  perSecond >= 1_000_000 ? `${(perSecond / 1_000_000).toFixed(1)} M/s` : `${perSecond.toLocaleString("en-US")} /s`;

onMounted(() => {
  open(0);
  run();
});
</script>

<template>
  <main
    class="app"
    :class="{ dragging: dragging > 0 }"
    @dragenter="dragging++"
    @dragleave="dragging--"
    @dragover="over"
    @drop="drop"
  >
    <header class="bar">
      <div class="programs">
        <button
          v-for="(program, index) in PROGRAMS"
          :key="program.name"
          class="control program"
          :class="{ on: chosen === index }"
          :title="program.about"
          @click="choose(index)"
        >
          {{ program.name }}
        </button>
      </div>
      <button class="control primary" @click="machine.running ? pause() : run()">
        {{ machine.running ? "Pause" : "Run" }}
      </button>
      <button class="control" @click="step">Step</button>
      <button class="control" @click="reset">Reset</button>
      <label class="speed" :class="{ off: machine.turbo }">
        Speed
        <input v-model.number="machine.speed" type="range" min="1" max="60" :disabled="machine.turbo" />
        <span>{{ machine.speed * 60 }} /s</span>
      </label>
      <button class="control" :class="{ on: machine.turbo }" @click="machine.turbo = !machine.turbo">Turbo</button>
      <button class="control" :class="{ on: machine.muted }" @click="machine.muted = !machine.muted">Mute</button>
      <span class="readout"
        ><b>{{ engine }}</b> {{ machine.running ? rate(machine.perSecond) : "paused" }}</span
      >
    </header>

    <div class="body">
      <section class="left">
        <div class="bezel"><Screen /></div>
        <p v-if="machine.error" class="note error">{{ machine.error }}</p>
        <p v-else class="note">
          {{ machine.program }} · {{ machine.size }} bytes · CRC-32 {{ machine.id }}
          <span>Drop a .ch8 file on the window to run it</span>
        </p>
        <Keypad />
        <p class="note"><span>Keys 1 2 3 4, Q W E R, A S D F, Z X C V; the arrows are 2, 4, 6 and 8</span></p>
      </section>
      <Debugger />
    </div>
  </main>
</template>
