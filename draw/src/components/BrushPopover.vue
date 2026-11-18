<script setup lang="ts">
import { computed } from "vue";
import { TOOL_INFO, type Tool, type ToolSettings } from "../model";
import { dabStream, type Dab } from "../pigments";
import { STRIDE } from "../model";
import Slider from "./Slider.vue";

const props = defineProps<{ tool: Tool; settings: ToolSettings; color: string; paper: string; shape: boolean }>();
const emit = defineEmits<{ change: [Partial<ToolSettings>]; reset: [] }>();

const info = computed(() => TOOL_INFO[props.tool]);
const preview = computed(() => Math.max(1, Math.min(30, props.settings.size)));
const alpha = computed(
  () => (props.tool === "marker" ? 0.4 : props.tool === "pencil" ? 0.92 : 1) * props.settings.opacity,
);
const particles = computed(() => {
  if (props.tool !== "airbrush" && props.tool !== "spray") return [];
  const points: number[] = [];
  for (let i = 0; i <= 32; i++) points.push(22 + i * 6.4, 32 + Math.sin(i / 4) * 7, 0.45 + i / 80, 10, 0, 0, i * 21);
  const s = props.settings;
  const add = dabStream({
    seq: 1,
    seed: 473,
    points,
    tool: props.tool,
    color: props.color,
    width: Math.min(28, s.size),
    ...(s.density !== undefined && { density: s.density }),
    ...(s.scatter !== undefined && { scatter: s.scatter }),
  });
  const dots: Dab[] = [];
  for (let i = 0; i < points.length; i += STRIDE) add(i, (d) => dots.push(d));
  return dots;
});
const sizeText = (v: number) => (v < 10 ? v.toFixed(1) : String(Math.round(v)));
const percent = (v: number) => `${Math.round(v * 100)}%`;
</script>

<template>
  <div class="popover pill brush-panel" role="dialog" aria-label="Brush settings">
    <div class="head">
      <span class="title">{{ info.name }}<span v-if="shape" class="sub"> · shapes</span></span>
      <button id="brush-reset" class="text-button small" @click="emit('reset')">Reset</button>
    </div>
    <svg class="preview" viewBox="0 0 248 64" :style="{ backgroundColor: paper }" aria-hidden="true">
      <defs>
        <radialGradient id="tip-soft">
          <stop :offset="settings.hardness ?? 0.25" :stop-color="color" />
          <stop offset="1" :stop-color="color" stop-opacity="0" />
        </radialGradient>
      </defs>
      <g v-if="tool === 'spray' || tool === 'airbrush'" :fill="tool === 'spray' ? color : 'url(#tip-soft)'">
        <circle
          v-for="(d, i) in particles"
          :key="i"
          :cx="d.x"
          :cy="d.y"
          :r="d.radius"
          :opacity="d.opacity * settings.opacity"
        />
      </g>
      <path
        v-else-if="tool === 'bucket' || tool === 'lasso-fill'"
        d="M34 38Q38 15 84 21T155 23Q218 9 211 31T144 40Q51 59 34 38Z"
        :fill="color"
        :fill-opacity="alpha"
        :stroke="tool === 'bucket' ? color : 'none'"
      />
      <path
        v-else
        d="M18 40C52 8 84 60 122 34S196 14 230 30"
        fill="none"
        stroke-linecap="round"
        stroke-linejoin="round"
        :stroke="color"
        :stroke-opacity="tool === 'eraser' ? 0.35 : alpha"
        :stroke-width="preview"
        :stroke-dasharray="tool === 'eraser' ? '2 6' : undefined"
      />
    </svg>
    <div class="sliders">
      <Slider
        v-if="info.max > info.min"
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
        v-if="!shape && tool !== 'bucket'"
        id="brush-streamline"
        label="Stabilizer"
        :value="settings.streamline"
        :min="0"
        :max="1"
        :text="settings.streamline < 0.01 ? 'Off' : percent(settings.streamline)"
        @input="(v) => emit('change', { streamline: v })"
      />
      <template v-if="tool === 'spray'">
        <Slider
          id="spray-density"
          label="Density"
          :min="0.05"
          :max="1"
          :value="settings.density ?? 0.55"
          :text="percent(settings.density ?? 0.55)"
          @input="(v) => emit('change', { density: v })"
        />
        <Slider
          id="spray-scatter"
          label="Particle size variation"
          :min="0"
          :max="1"
          :value="settings.scatter ?? 0.65"
          :text="percent(settings.scatter ?? 0.65)"
          @input="(v) => emit('change', { scatter: v })"
        />
      </template>
      <Slider
        v-if="tool === 'airbrush'"
        id="airbrush-hardness"
        label="Hardness"
        :min="0"
        :max="1"
        :value="settings.hardness ?? 0.25"
        :text="percent(settings.hardness ?? 0.25)"
        @input="(v) => emit('change', { hardness: v })"
      />
      <template v-if="tool === 'bucket'">
        <Slider
          id="fill-tolerance"
          label="Colour tolerance"
          :min="0"
          :max="255"
          :value="settings.tolerance ?? 24"
          :text="String(settings.tolerance ?? 24)"
          @input="(v) => emit('change', { tolerance: Math.round(v) })"
        />
        <Slider
          id="fill-gap"
          label="Close gaps"
          :min="0"
          :max="12"
          :value="settings.gap ?? 0"
          :text="(settings.gap ?? 0) + ' px'"
          @input="(v) => emit('change', { gap: Math.round(v) })"
        />
        <Slider
          id="fill-expand"
          label="Expand"
          :min="0"
          :max="2"
          :value="settings.expand ?? 1"
          :text="(settings.expand ?? 1) + ' px'"
          @input="(v) => emit('change', { expand: Math.round(v) })"
        />
        <div class="segmented">
          <button
            v-for="current in [false, true]"
            :key="String(current)"
            class="seg"
            :class="{ on: !!settings.currentLayer === current }"
            @click="emit('change', { currentLayer: current })"
          >
            {{ current ? "Current layer" : "Visible layers" }}
          </button>
        </div>
      </template>
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
