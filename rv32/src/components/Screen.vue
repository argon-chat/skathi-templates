<script setup lang="ts">
// The guest's 320 × 200 framebuffer, shown at 4:3 as the monitors it was drawn for showed it. With
// `glass` the tube around the canvas is painted by shaders/crt.slang, which reads the canvas as its
// content and bends, lines and shades it.
import { onMounted, onUnmounted, ref } from "vue";
import { HEIGHT, WIDTH } from "../rv32/machine";
import { attach } from "../workbench";

defineProps<{ glass: boolean }>();

const canvas = ref<HTMLCanvasElement>();
onMounted(() => attach(canvas.value?.getContext("2d") ?? null));
onUnmounted(() => attach(null));
</script>

<template>
  <div class="bezel">
    <div class="tube" :class="{ glass }">
      <canvas ref="canvas" class="screen" :width="WIDTH" :height="HEIGHT" />
    </div>
  </div>
</template>

<style>
.bezel {
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background-color: #050506;
}
.tube {
  border-radius: 8px;
  overflow: hidden;
  background-color: #000;
}
.tube.glass {
  --shading: crt(200, 0.6);
}
.screen {
  display: block;
  width: 100%;
  aspect-ratio: 4 / 3;
  image-rendering: pixelated;
}

/* On battery saver or a hot CPU the instructions matter more than the glass. */
@media (currently-power-scheme: saving), (currently-compute-pressure: critical) {
  .tube.glass {
    --shading: none;
  }
}
</style>
