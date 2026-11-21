<script setup lang="ts">
// No click handlers: `--window-control` makes each button the OS caption button, so Windows
// performs the action (and shows snap layouts over maximize) and the other hosts act on mouse-up.
import { computed } from "vue";
import { appWindow } from "skathi:app";
import { hideTip, showTip } from "../tooltip";
import Icon from "./Icon.vue";

const maximized = computed(() => appWindow.isMaximized());
</script>

<template>
  <div class="cluster pill controls" role="group" aria-label="Window">
    <div
      id="window-minimize"
      class="control minimize"
      aria-label="Minimize"
      @pointerenter="showTip($event, 'Minimize', true)"
      @pointerleave="hideTip"
    >
      <Icon name="win-min" :size="16" />
    </div>
    <div
      id="window-maximize"
      class="control maximize"
      :aria-label="maximized ? 'Restore' : 'Maximize'"
      @pointerenter="showTip($event, maximized ? 'Restore' : 'Maximize', true)"
      @pointerleave="hideTip"
    >
      <Icon :name="maximized ? 'win-restore' : 'win-max'" :size="16" />
    </div>
    <div
      id="window-close"
      class="control close"
      aria-label="Close"
      @pointerenter="showTip($event, 'Close', true)"
      @pointerleave="hideTip"
    >
      <Icon name="win-close" :size="16" />
    </div>
  </div>
</template>

<style scoped>
.control {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 16px;
  color: #f2f2f4c0;
  transition:
    background-color 150ms ease,
    color 150ms ease;
}
.control:hover {
  background: #ffffff17;
  color: #f2f2f4;
}
.close:hover {
  background: #e5484d;
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
@media (prefers-reduced-motion: reduce) {
  .control {
    transition: none;
  }
}
</style>
