<script setup lang="ts">
import { ref } from "vue";
import type { Color } from "../model";
import { hideTip, showTip } from "../tooltip";
import Icon from "./Icon.vue";

const props = defineProps<{ color: Color; ink: string; recents: readonly Color[] }>();
const emit = defineEmits<{ color: [Color]; eyedropper: [] }>();

const picker = ref<HTMLInputElement | null>(null);
const hex = (c: Color) => (c === "ink" ? props.ink : c);

function custom() {
  const input = picker.value;
  if (!input) return;
  input.value = hex(props.color).toLowerCase();
  input.showPicker();
}
</script>

<template>
  <div class="popover pill palette" role="dialog" aria-label="Colours">
    <p class="heading">Recent</p>
    <div v-if="recents.length" class="recents" role="radiogroup" aria-label="Recent colours">
      <button
        v-for="(c, i) in recents"
        :id="`recent-${i}`"
        :key="c"
        class="chip"
        :class="{ selected: c.toUpperCase() === hex(color).toUpperCase() }"
        role="radio"
        :aria-checked="c.toUpperCase() === hex(color).toUpperCase()"
        :aria-label="c"
        :style="{ backgroundColor: c }"
        @click="emit('color', c)"
        @pointerenter="showTip($event, c)"
        @pointerleave="hideTip"
      />
    </div>
    <p v-else class="empty">Colours you pick or sample show up here.</p>
    <div class="actions">
      <button
        id="pick-from-canvas"
        class="text-button"
        @click="emit('eyedropper')"
        @pointerenter="showTip($event, 'Sample from the canvas  I or hold Alt')"
        @pointerleave="hideTip"
      >
        <Icon name="eyedropper" :size="16" />Sample
      </button>
      <button id="custom-colour" class="text-button" @click="custom"><span class="wheel" />Custom…</button>
    </div>
    <input
      ref="picker"
      class="picker"
      type="color"
      tabindex="-1"
      aria-hidden="true"
      @input="emit('color', ($event.target as HTMLInputElement).value.toUpperCase())"
    />
  </div>
</template>

<style scoped>
.palette {
  width: 236px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.recents {
  display: grid;
  grid-template-columns: repeat(6, 24px);
  gap: 10px;
  padding: 2px 4px;
}
.chip {
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 12px;
  box-shadow: inset 0 0 0 1px #ffffff2e;
  cursor: pointer;
  transition: transform 150ms ease;
}
.chip:hover {
  transform: scale(1.1);
}
.chip.selected {
  box-shadow:
    inset 0 0 0 1px #ffffff2e,
    0 0 0 2px var(--pill),
    0 0 0 3.5px #ffffff;
}
.empty {
  margin: 0;
  padding: 0 4px;
  font-size: 12px;
  color: #f2f2f48c;
  line-height: 1.4;
}
.actions {
  display: flex;
  justify-content: space-between;
  border-top: 1px solid #ffffff14;
  padding-top: 6px;
}
.wheel {
  width: 16px;
  height: 16px;
  border-radius: 8px;
  background: conic-gradient(#ff5a52, #ffb020, #34c38f, #3b82f6, #a06bff, #ff5a52);
}
.picker {
  position: absolute;
  right: 12px;
  bottom: 10px;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}
</style>
