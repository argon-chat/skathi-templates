<script setup lang="ts">
// The 64 × 32 display, drawn as squares on a canvas ten times that size. A pixel that goes dark
// fades instead of vanishing, as on the phosphor these programs were written for: they erase a
// sprite and draw it again every frame, and without the fade that flickers.
import { onMounted, ref, watch } from "vue";
import { HEIGHT, WIDTH } from "../chip8/cpu";
import { cpu, frame } from "../machine";

const CELL = 10;
const FADE = 0.55;
const BACK = "#0a1610";
const LIT = "#9dffb0";

const canvas = ref<HTMLCanvasElement>();
const glow = new Float32Array(WIDTH * HEIGHT);
let context: CanvasRenderingContext2D | null = null;

function paint() {
  if (!context) return;
  context.globalAlpha = 1;
  context.fillStyle = BACK;
  context.fillRect(0, 0, WIDTH * CELL, HEIGHT * CELL);
  context.fillStyle = LIT;
  for (let at = 0; at < glow.length; at++) {
    const level = cpu.display[at] ? 1 : (glow[at] ?? 0) * FADE;
    glow[at] = level < 0.02 ? 0 : level;
    if (level < 0.02) continue;
    context.globalAlpha = level;
    context.fillRect((at % WIDTH) * CELL, Math.floor(at / WIDTH) * CELL, CELL, CELL);
  }
}

onMounted(() => {
  context = canvas.value?.getContext("2d") ?? null;
  paint();
});
watch(frame, paint, { flush: "sync" });
</script>

<template>
  <canvas ref="canvas" class="screen" :width="WIDTH * CELL" :height="HEIGHT * CELL" />
</template>

<style>
.screen {
  display: block;
  width: 100%;
  aspect-ratio: 2 / 1;
  border-radius: 6px;
}
</style>
