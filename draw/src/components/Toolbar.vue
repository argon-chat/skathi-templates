<script setup lang="ts">
import { computed } from "vue";
import { SWATCHES, TOOL_INFO, TOOLS, type Color, type Tool } from "../model";
import { hideTip, showTip } from "../tooltip";
import ToolGlyph from "./ToolGlyph.vue";

const props = defineProps<{
  tool: Tool | null;
  color: Color;
  ink: string;
  /** The tool whose size and opacity the brush button shows. */
  brushTool: Tool;
  size: number;
  opacity: number;
  open: string | null;
}>();
const emit = defineEmits<{ tool: [Tool]; color: [Color]; brush: [Event]; palette: [Event] }>();

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
const dot = computed(() => {
  const { min, max } = TOOL_INFO[props.brushTool];
  const u = Math.sqrt((props.size - min) / (max - min));
  return Math.round(4 + Math.min(1, Math.max(0, u)) * 22);
});
const sizeText = computed(() => (props.size < 10 ? props.size.toFixed(1) : String(Math.round(props.size))));
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
      <span class="anchor">
        <button
          id="swatch-custom"
          class="swatch custom"
          :class="{ selected: custom, open: open === 'palette' }"
          aria-label="More colours"
          :aria-expanded="open === 'palette'"
          @click="emit('palette', $event)"
          @pointerenter="showTip($event, 'More colours')"
          @focus="showTip($event, 'More colours')"
          @pointerleave="hideTip"
          @blur="hideTip"
        >
          <span v-if="custom" class="custom-fill" :style="{ backgroundColor: color }" />
        </button>
      </span>
    </div>
    <i class="divider" />
    <span class="anchor brush-anchor">
      <button
        id="brush-settings"
        class="brush"
        :class="{ open: open === 'brush' }"
        aria-label="Brush settings"
        :aria-expanded="open === 'brush'"
        @click="emit('brush', $event)"
        @pointerenter="showTip($event, 'Size and opacity  [ ]  { }')"
        @focus="showTip($event, 'Size and opacity  [ ]  { }')"
        @pointerleave="hideTip"
        @blur="hideTip"
      >
        <span class="well">
          <span
            class="dot"
            :class="{ eraser: brushTool === 'eraser' }"
            :style="{
              width: `${dot}px`,
              height: `${dot}px`,
              borderRadius: `${dot / 2}px`,
              backgroundColor: brushTool === 'eraser' ? 'transparent' : hex(color),
              opacity: brushTool === 'eraser' ? 1 : Math.max(0.15, opacity),
            }"
          />
        </span>
        <span class="caption"
          >{{ sizeText }}<template v-if="opacity < 1"> · {{ Math.round(opacity * 100) }}%</template></span
        >
      </button>
    </span>
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
  padding: 0 14px 0 18px;
  gap: 16px;
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
.anchor {
  display: flex;
  align-items: center;
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
.custom.open {
  transform: scale(1.08);
}
.custom-fill {
  width: 14px;
  height: 14px;
  border-radius: 7px;
  box-shadow: 0 0 0 2px var(--pill);
}
.brush-anchor {
  align-self: center;
}
.brush {
  width: 56px;
  height: 64px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 0;
  border: none;
  border-radius: 12px;
  background: transparent;
  cursor: pointer;
  transition: background-color 150ms ease;
}
.brush:hover,
.brush.open {
  background: #ffffff14;
}
.brush:focus-visible {
  outline: 2px solid #ffffffd0;
  outline-offset: 1px;
}
.well {
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.dot {
  box-shadow: 0 0 0 1px #ffffff2e;
}
.dot.eraser {
  box-shadow: inset 0 0 0 1.5px #f2f2f4b0;
}
.caption {
  font-size: 11px;
  color: #f2f2f4a6;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
@media (prefers-reduced-motion: reduce) {
  .tool,
  .swatch,
  .brush {
    transition: none;
  }
}
</style>
