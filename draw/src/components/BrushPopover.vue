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
// Three pigment bands dragged across the original straight edge of a painted swatch.
const smear = computed(() => {
  const reach = props.settings.opacity * 78;
  const radius = 3 + Math.min(20, props.settings.size * 0.22);
  return [0.4, 0.75, 1].map((weight, i) => {
    const y = 27 + i * 4,
      r = radius * weight,
      x = 97 + reach * weight;
    return `M49 10H97V${y - r}C97 ${y - r / 3} ${x - 9} ${y - 7} ${x} ${y - 3}C${x - 10} ${y + 2} 97 ${y + 2} 97 ${y + r}V54H49Z`;
  });
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
      <g v-else-if="tool === 'smudge'">
        <path d="M49 10H199V54H49Z" fill="#e6b777" />
        <path v-for="(path, i) in smear" :key="i" :d="path" fill="#496c82" :opacity="[0.85, 0.48, 0.36][i]" />
      </g>
      <g v-else-if="tool === 'bucket'" stroke="#82868b" stroke-width="2" stroke-linejoin="round">
        <path d="M48 46Q36 22 66 15Q87 8 109 18L136 12Q166 6 190 26Q204 44 178 50L142 48Q112 58 91 48Z" fill="none" />
        <path
          d="M48 46Q36 22 66 15Q87 8 109 18Q95 33 110 50Q101 52 91 48Z M66 28a6 6 0 1 0 12 0a6 6 0 1 0 -12 0Z"
          fill-rule="evenodd"
          :fill="color"
          :fill-opacity="alpha"
        />
      </g>
      <path
        v-else-if="tool === 'lasso-fill'"
        d="M34 38Q38 15 84 21T155 23Q218 9 211 31T144 40Q51 59 34 38Z"
        :fill="color"
        :fill-opacity="alpha"
        stroke="none"
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
        :label="tool === 'smudge' ? 'Strength' : 'Opacity'"
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
  max-height: calc(100vh - 124px);
  overflow-y: auto;
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
