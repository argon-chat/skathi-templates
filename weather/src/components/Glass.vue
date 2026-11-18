<script setup lang="ts">
import { shading } from "../scene";
</script>

<template>
  <div class="glass" :style="{ '--shading': shading.pane }">
    <slot />
  </div>
</template>

<style>
/* The panel's own background is a faint tint drawn over the `pane` effect, which paints beneath it. */
.glass {
  position: relative;
  border-radius: 30px;
  corner-shape: squircle;
  border: 1px solid #ffffff2e;
  background: #ffffff10;
  box-shadow: 0 24px 48px -24px #12082eb3;
  transition: --shading 2400ms ease;
}
</style>
