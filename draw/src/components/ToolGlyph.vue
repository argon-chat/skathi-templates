<script setup lang="ts">
import type { Tool } from "../model";

const props = defineProps<{ tool: Tool; tip: string; band: string | null }>();
const bands: Record<Tool, [number, number]> = {
  pen: [2.5, 23],
  brush: [6, 16],
  marker: [2, 24],
  pencil: [3, 22],
  eraser: [3, 22],
  spray: [4, 20],
  airbrush: [8, 12],
  bucket: [3, 22],
  "lasso-fill": [10, 8],
  smudge: [5, 18],
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
    <template v-else-if="tool === 'spray'">
      <rect x="11" y="1" width="6" height="5" rx="1" fill="#E9E9EC" />
      <circle cx="11.6" cy="3.4" r="0.9" fill="#00000059" />
      <path d="M6 20 Q6 7 14 6.5 Q22 7 22 20 Z" :fill="tip" />
      <path d="M9.5 16 Q9.8 10.5 13.5 9.2" stroke="#ffffff59" stroke-width="1.1" fill="none" stroke-linecap="round" />
      <path d="M5 20 H23 L24 26 H4 Z" :fill="`url(#metal-${tool})`" />
      <rect x="4" y="26" width="20" height="46" rx="2" :fill="`url(#body-${tool})`" />
      <rect x="4" y="26" width="20" height="1.4" fill="#00000017" />
    </template>
    <template v-else-if="tool === 'airbrush'">
      <path d="M14 0.5 L15.4 9 H12.6 Z" fill="#9A9AA1" />
      <path d="M12.6 9 H15.4 L19 19 H9 Z" :fill="`url(#metal-${tool})`" />
      <path d="M17 13 Q17 10.4 21.5 10.4 Q26 10.4 26 13 L25 20 Q24.6 22 21.5 22 Q18.4 22 18 20 Z" :fill="`url(#metal-${tool})`" />
      <ellipse cx="21.5" cy="12" rx="3.6" ry="1.4" :fill="tip" />
      <rect x="8" y="19" width="12" height="53" rx="2" :fill="`url(#body-${tool})`" />
      <rect x="11.5" y="23" width="5" height="3.5" rx="1.2" fill="#8E8E95" />
    </template>
    <template v-else-if="tool === 'bucket'">
      <path d="M4 25 Q4 3 14 3 Q24 3 24 25" stroke="#8E8E95" stroke-width="1.4" fill="none" />
      <ellipse cx="14" cy="25" rx="12" ry="3.4" :fill="`url(#metal-${tool})`" />
      <ellipse cx="14" cy="25" rx="10.4" ry="2.4" :fill="tip" />
      <rect x="2" y="25" width="24" height="47" rx="1.5" :fill="`url(#body-${tool})`" />
      <path d="M5 26.5 V33 Q5 35 6.5 35 Q8 35 8 33 V27.4 Z" :fill="tip" />
      <path d="M2 25 Q14 30.2 26 25" stroke="#00000022" stroke-width="0.8" fill="none" />
    </template>
    <template v-else-if="tool === 'lasso-fill'">
      <rect x="2.5" y="3" width="23" height="13" rx="4" :fill="tip" />
      <path d="M6 6.5 H22" stroke="#ffffff40" stroke-width="1.2" stroke-linecap="round" />
      <path d="M25.5 9.5 H27 V20 H14 V27" stroke="#9A9AA1" stroke-width="1.6" fill="none" stroke-linejoin="round" />
      <rect x="10" y="27" width="8" height="45" rx="2.5" :fill="`url(#body-${tool})`" />
    </template>
    <template v-else-if="tool === 'smudge'">
      <path d="M14 1 L24 26 H4 Z" fill="#E7E1D6" />
      <path d="M14 1 L18.2 11.5 H9.8 Z" fill="#8C8A90" />
      <path d="M9.8 11.5 H18.2 L19.6 15 H8.4 Z" fill="#8C8A90" opacity="0.45" />
      <path d="M7.5 18.5 L20.5 15.5 M5.6 23.4 L22.8 19.4" stroke="#00000018" stroke-width="0.8" />
      <rect x="4" y="26" width="20" height="46" fill="#EDE8DE" />
      <path d="M4 34 L24 30 M4 46 L24 42 M4 58 L24 54" stroke="#00000014" stroke-width="0.8" />
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
