<script setup lang="ts">
import { SHAPE_INFO, SHAPES, TOOL_INFO, type Ink, type Shape } from "../model";
import Icon from "./Icon.vue";

defineProps<{ shape: Shape; ink: Ink }>();
const emit = defineEmits<{ shape: [Shape] }>();
</script>

<template>
  <div class="popover pill shapes" role="dialog" aria-label="Shapes">
    <div class="segmented" role="radiogroup" aria-label="Shape">
      <button
        v-for="s in SHAPES"
        :id="`shape-${s}`"
        :key="s"
        class="seg"
        :class="{ on: s === shape }"
        role="radio"
        :aria-checked="s === shape"
        :aria-label="SHAPE_INFO[s].name"
        @click="emit('shape', s)"
      >
        <Icon :name="s" />
        <span>{{ SHAPE_INFO[s].name }}</span>
      </button>
    </div>
    <p class="note">
      Drawn with the {{ TOOL_INFO[ink].name.toLowerCase() }}. Hold Shift for 45° lines, squares and circles.
    </p>
  </div>
</template>

<style scoped>
.shapes {
  width: 300px;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.seg {
  flex-direction: column;
  height: 56px;
  gap: 4px;
  font-size: 11px;
}
.note {
  margin: 0;
  padding: 0 6px 2px;
  font-size: 12px;
  line-height: 1.4;
  color: #f2f2f48c;
}
</style>
