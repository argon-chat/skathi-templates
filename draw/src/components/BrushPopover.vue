<script setup lang="ts">
import { computed } from "vue";
import { TOOL_INFO, type Tool, type ToolSettings } from "../model";
import Slider from "./Slider.vue";

const props = defineProps<{ tool: Tool; settings: ToolSettings; color: string; shape: boolean }>();
const emit = defineEmits<{ change: [Partial<ToolSettings>]; reset: [] }>();

const info = computed(() => TOOL_INFO[props.tool]);
const preview = computed(() => Math.max(1, Math.min(30, props.settings.size)));
const alpha = computed(
  () => (props.tool === "marker" ? 0.4 : props.tool === "pencil" ? 0.92 : 1) * props.settings.opacity,
);
const sizeText = (v: number) => (v < 10 ? v.toFixed(1) : String(Math.round(v)));
const percent = (v: number) => `${Math.round(v * 100)}%`;
</script>

<template>
  <div class="popover pill brush-panel" role="dialog" aria-label="Brush settings">
    <div class="head">
      <span class="title">{{ info.name }}<span v-if="shape" class="sub"> · shapes</span></span>
      <button id="brush-reset" class="text-button small" @click="emit('reset')">Reset</button>
    </div>
    <svg class="preview" viewBox="0 0 248 64" aria-hidden="true">
      <path
        d="M18 40C52 8 84 60 122 34S196 14 230 30"
        fill="none"
        stroke-linecap="round"
        stroke-linejoin="round"
        :stroke="tool === 'eraser' ? '#f2f2f4' : color"
        :stroke-opacity="tool === 'eraser' ? 0.35 : alpha"
        :stroke-width="preview"
        :stroke-dasharray="tool === 'eraser' ? '2 6' : undefined"
      />
    </svg>
    <div class="sliders">
      <Slider
        id="brush-size"
        label="Size"
        :value="settings.size"
        :min="info.min"
        :max="info.max"
        :curve="2"
        :text="sizeText(settings.size)"
        @input="(v) => emit('change', { size: v })"
      />
      <Slider
        id="brush-opacity"
        label="Opacity"
        :value="settings.opacity"
        :min="0.05"
        :max="1"
        :text="percent(settings.opacity)"
        @input="(v) => emit('change', { opacity: v })"
      />
      <Slider
        v-if="!shape"
        id="brush-streamline"
        label="Stabilizer"
        :value="settings.streamline"
        :min="0"
        :max="1"
        :text="settings.streamline < 0.01 ? 'Off' : percent(settings.streamline)"
        @input="(v) => emit('change', { streamline: v })"
      />
    </div>
  </div>
</template>

<style scoped>
.brush-panel {
  width: 272px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-left: 4px;
}
.title {
  font-size: 13px;
  font-weight: 600;
}
.sub {
  font-weight: 400;
  color: #f2f2f48c;
}
.preview {
  width: 100%;
  height: 64px;
  border-radius: 10px;
  background: #ffffff08;
}
.sliders {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
</style>
