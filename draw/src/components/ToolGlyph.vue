<script setup lang="ts">
import type { Tool } from "../model";

const props = defineProps<{ tool: Tool; tip: string; band: string | null }>();
const bands: Record<Tool, [number, number]> = {
  pen: [2.5, 23],
  brush: [6, 16],
  marker: [2, 24],
  pencil: [3, 22],
  eraser: [3, 22],
};
const bandBox = () => bands[props.tool];
</script>

<template>
  <svg class="glyph" width="28" height="72" viewBox="0 0 28 72" aria-hidden="true">
    <defs>
      <linearGradient :id="`body-${tool}`" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#F6F6F8" />
        <stop offset="0.5" stop-color="#E4E4E7" />
        <stop offset="1" stop-color="#BDBDC2" />
      </linearGradient>
      <linearGradient :id="`metal-${tool}`" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#DADADF" />
        <stop offset="0.45" stop-color="#C4C4CA" />
        <stop offset="1" stop-color="#9A9AA1" />
      </linearGradient>
    </defs>
    <template v-if="tool === 'pen'">
      <path d="M14 1 L19 17 H9 Z" :fill="tip" />
      <path d="M14 7 V14" stroke="#00000040" stroke-width="0.8" />
      <circle cx="14" cy="14.2" r="1" fill="#00000040" />
      <path d="M9 17 H19 L25.5 30 H2.5 Z" :fill="`url(#metal-${tool})`" />
      <rect x="2.5" y="30" width="23" height="42" rx="2" :fill="`url(#body-${tool})`" />
      <rect x="2.5" y="30" width="23" height="1.6" fill="#00000017" />
    </template>
    <template v-else-if="tool === 'brush'">
      <path d="M14 0.5 C18.6 6.5 20.2 13 19.6 21 H8.4 C7.8 13 9.4 6.5 14 0.5 Z" :fill="tip" />
      <path d="M14 3 C12.6 8 12.2 14 12.6 21" stroke="#ffffff38" stroke-width="0.9" fill="none" />
      <rect x="8" y="21" width="12" height="11" rx="1" :fill="`url(#metal-${tool})`" />
      <path d="M8 24.5 H20 M8 27.5 H20" stroke="#00000026" stroke-width="0.8" />
      <path d="M7.4 32 H20.6 L25.5 72 H2.5 Z" :fill="`url(#body-${tool})`" />
    </template>
    <template v-else-if="tool === 'marker'">
      <path d="M9 5.5 L19 1.5 V14 H9 Z" :fill="tip" />
      <path d="M6.5 14 H21.5 L25.5 24 H2.5 Z" :fill="`url(#metal-${tool})`" />
      <rect x="2" y="24" width="24" height="48" rx="3" :fill="`url(#body-${tool})`" />
      <rect x="2" y="24" width="24" height="4" :fill="tip" />
    </template>
    <template v-else-if="tool === 'pencil'">
      <path d="M10.6 10 H17.4 L25 27 H3 Z" fill="#EAD7B4" />
      <path d="M10.6 10 H17.4 L20.3 16.5 H7.7 Z" fill="#DCC49B" opacity="0.5" />
      <path d="M14 0.8 L17.4 10 H10.6 Z" :fill="tip" />
      <path d="M3 27 Q6.7 24.4 10.3 27 Q14 24.4 17.7 27 Q21.3 24.4 25 27 V72 H3 Z" :fill="`url(#body-${tool})`" />
      <path d="M10.3 27 V72 M17.7 27 V72" stroke="#00000012" stroke-width="0.9" />
    </template>
    <template v-else>
      <path d="M3 19 Q3 6 14 6 Q25 6 25 19 V24 H3 Z" fill="#DDB8BF" />
      <path d="M7 12 Q9 9 13 8.6" stroke="#ffffff55" stroke-width="1.2" fill="none" stroke-linecap="round" />
      <rect x="3" y="24" width="22" height="8" :fill="`url(#metal-${tool})`" />
      <path d="M3 27 H25 M3 29.5 H25" stroke="#00000022" stroke-width="0.8" />
      <rect x="3" y="32" width="22" height="40" :fill="`url(#body-${tool})`" />
    </template>
    <rect
      v-if="band"
      :x="bandBox()[0]"
      y="40"
      :width="bandBox()[1]"
      height="6"
      :fill="band"
      stroke="#00000033"
      stroke-width="0.6"
    />
  </svg>
</template>

<style scoped>
.glyph {
  display: block;
}
</style>
