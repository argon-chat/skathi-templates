<script setup lang="ts">
import { computed, ref } from "vue";
import { SWATCHES, TOOL_INFO, TOOLS, type Color, type Tool } from "../model";
import { hideTip, showTip } from "../tooltip";
import ToolGlyph from "./ToolGlyph.vue";

const props = defineProps<{ tool: Tool; color: Color; ink: string; width: number }>();
const emit = defineEmits<{ tool: [Tool]; color: [Color]; width: [number] }>();

const picker = ref<HTMLInputElement | null>(null);
const hex = (c: Color) => (c === "ink" ? props.ink : c);
const custom = computed(() => !SWATCHES.includes(props.color));
const swatchNames: Record<string, string> = {
  ink: "Ink",
  "#3B82F6": "Blue",
  "#FF5A52": "Red",
  "#34C38F": "Green",
  "#FFB020": "Amber",
  "#A06BFF": "Violet",
};
const widthNames = ["Fine", "Medium", "Bold"];

function pick() {
  hideTip();
  const input = picker.value;
  if (!input) return;
  input.value = hex(props.color).toLowerCase();
  input.showPicker();
}
</script>

<template>
  <div class="toolbar pill" role="toolbar" aria-label="Drawing tools">
    <div class="tools" role="radiogroup" aria-label="Tool">
      <button
        v-for="(t, i) in TOOLS"
        :key="t"
        :id="`tool-${t}`"
        class="tool"
        :class="{ selected: t === tool }"
        role="radio"
        :aria-checked="t === tool"
        :aria-label="TOOL_INFO[t].name"
        @click="emit('tool', t)"
        @pointerenter="showTip($event, `${TOOL_INFO[t].name}  ${i + 1} or ${TOOL_INFO[t].key}`)"
        @focus="showTip($event, `${TOOL_INFO[t].name}  ${i + 1} or ${TOOL_INFO[t].key}`)"
        @pointerleave="hideTip"
        @blur="hideTip"
      >
        <ToolGlyph :tool="t" :tip="t === 'eraser' ? '#D8B9BF' : hex(color)" :band="t === tool ? hex(color) : null" />
      </button>
    </div>
    <i class="divider" />
    <div class="colors">
      <div class="swatches" role="radiogroup" aria-label="Colour">
        <button
          v-for="(c, i) in SWATCHES"
          :key="c"
          :id="`swatch-${i}`"
          class="swatch"
          :class="{ selected: c === color }"
          role="radio"
          :aria-checked="c === color"
          :aria-label="swatchNames[c]"
          :style="{ backgroundColor: hex(c) }"
          @click="emit('color', c)"
          @pointerenter="showTip($event, swatchNames[c] ?? c)"
          @focus="showTip($event, swatchNames[c] ?? c)"
          @pointerleave="hideTip"
          @blur="hideTip"
        />
      </div>
      <button
        id="swatch-custom"
        class="swatch custom"
        :class="{ selected: custom }"
        aria-label="Custom colour"
        @click="pick"
        @pointerenter="showTip($event, 'Custom colour')"
        @focus="showTip($event, 'Custom colour')"
        @pointerleave="hideTip"
        @blur="hideTip"
      >
        <span v-if="custom" class="custom-fill" :style="{ backgroundColor: color }" />
      </button>
      <input
        ref="picker"
        class="picker"
        type="color"
        tabindex="-1"
        aria-hidden="true"
        @input="emit('color', ($event.target as HTMLInputElement).value)"
      />
    </div>
    <i class="divider" />
    <div class="widths" role="radiogroup" aria-label="Width">
      <button
        v-for="(name, i) in widthNames"
        :key="name"
        :id="`width-${i}`"
        class="width"
        :class="{ selected: i === width }"
        role="radio"
        :aria-checked="i === width"
        :aria-label="`${name} width`"
        @click="emit('width', i)"
        @pointerenter="showTip($event, `${name}  [ or ]`)"
        @focus="showTip($event, `${name}  [ or ]`)"
        @pointerleave="hideTip"
        @blur="hideTip"
      >
        <span class="bar" :style="{ height: `${[2, 4.5, 8][i]}px` }" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.toolbar {
  position: absolute;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  height: 80px;
  display: flex;
  align-items: stretch;
  padding: 0 18px;
  gap: 18px;
  border-radius: 22px;
  overflow: hidden;
}
.tools {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 0 2px;
}
.tool {
  width: 28px;
  height: 72px;
  padding: 0;
  border: none;
  background: none;
  border-radius: 7px 7px 0 0;
  transform: translateY(25px);
  transition: transform 180ms cubic-bezier(0.34, 1.4, 0.64, 1);
  cursor: pointer;
}
.tool:hover {
  transform: translateY(21px);
}
.tool.selected {
  transform: translateY(11px);
}
.tool:focus-visible {
  outline: 2px solid #ffffffd0;
  outline-offset: 2px;
}
.divider {
  width: 1px;
  margin: 20px 0;
  background: #ffffff1c;
}
.colors {
  display: flex;
  align-items: center;
  gap: 10px;
}
.swatches {
  display: grid;
  grid-template-columns: repeat(3, 28px);
  grid-auto-rows: 28px;
  gap: 8px;
}
.swatch {
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 14px;
  box-shadow: inset 0 0 0 1px #ffffff2e;
  cursor: pointer;
  transition: transform 150ms ease;
}
.swatch:hover {
  transform: scale(1.08);
}
.swatch.selected {
  box-shadow:
    inset 0 0 0 1px #ffffff2e,
    0 0 0 2px var(--pill),
    0 0 0 4px #ffffff;
}
.swatch:focus-visible {
  outline: 2px solid #ffffffd0;
  outline-offset: 5px;
}
.custom {
  display: flex;
  align-items: center;
  justify-content: center;
  background: conic-gradient(#ff5a52, #ffb020, #34c38f, #3b82f6, #a06bff, #ff5a52);
}
.custom-fill {
  width: 14px;
  height: 14px;
  border-radius: 7px;
  box-shadow: 0 0 0 2px var(--pill);
}
.picker {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}
.widths {
  width: 48px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
}
.width {
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  border-radius: 7px;
  background: transparent;
  cursor: pointer;
  transition: background-color 150ms ease;
}
.width:hover {
  background: #ffffff0f;
}
.width.selected {
  background: #ffffff21;
}
.width:focus-visible {
  outline: 2px solid #ffffffd0;
  outline-offset: 1px;
}
.bar {
  width: 30px;
  border-radius: 4px;
  background: #e8e8ea;
}
@media (prefers-reduced-motion: reduce) {
  .tool,
  .swatch,
  .width {
    transition: none;
  }
}
</style>
