<script setup lang="ts">
import type { Ref } from "vue";
import { hideTip, showTip } from "../tooltip";
import Icon from "./Icon.vue";

// The refs themselves, not their values: zooming re-renders this pill and not the app around it.
defineProps<{ view: { zoom: Ref<number>; angle: Ref<number> }; navigator: boolean; open: boolean }>();
const emit = defineEmits<{ zoomIn: []; zoomOut: []; menu: [Event]; navigator: [] }>();
</script>

<template>
  <div
    id="view-controls"
    class="view pill cluster anchor"
    role="group"
    aria-label="View"
    :data-zoom="view.zoom.value"
    :data-angle="view.angle.value"
  >
    <button
      id="zoom-out"
      class="icon-button"
      aria-label="Zoom out"
      @click="emit('zoomOut')"
      @pointerenter="showTip($event, 'Zoom out  Ctrl+−')"
      @pointerleave="hideTip"
    >
      <Icon name="minus" :size="16" />
    </button>
    <button
      id="zoom-menu"
      class="readout"
      :class="{ on: open }"
      :aria-label="`Zoom ${Math.round(view.zoom.value * 100)}%, view options`"
      :aria-expanded="open"
      @click="emit('menu', $event)"
    >
      <span>{{ Math.round(view.zoom.value * 100) }}%</span>
      <span v-if="view.angle.value" class="angle">{{ view.angle.value }}°</span>
    </button>
    <button
      id="zoom-in"
      class="icon-button"
      aria-label="Zoom in"
      @click="emit('zoomIn')"
      @pointerenter="showTip($event, 'Zoom in  Ctrl+=')"
      @pointerleave="hideTip"
    >
      <Icon name="plus" :size="16" />
    </button>
    <i class="divider" />
    <button
      id="navigator-toggle"
      class="icon-button"
      :class="{ on: navigator }"
      aria-label="Navigator"
      :aria-pressed="navigator"
      @click="emit('navigator')"
      @pointerenter="showTip($event, 'Navigator  Shift+N')"
      @pointerleave="hideTip"
    >
      <Icon name="map" :size="16" />
    </button>
  </div>
</template>

<style scoped>
.view {
  position: absolute;
  right: 16px;
  bottom: 16px;
}
.readout {
  height: 32px;
  min-width: 52px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 8px;
  border: none;
  border-radius: 16px;
  background: transparent;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  transition: background-color 150ms ease;
}
.readout:hover,
.readout.on {
  background: #ffffff17;
}
.readout:focus-visible {
  outline: 2px solid #ffffffd0;
  outline-offset: 1px;
}
.angle {
  color: #f2f2f48c;
}
.divider {
  width: 1px;
  height: 18px;
  margin: 0 2px;
  background: #ffffff1c;
}
@media (max-width: 900px) {
  .view {
    bottom: 108px;
  }
}
</style>
