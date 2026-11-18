<script setup lang="ts">
import { MODE_INFO, SHAPE_INFO, type Mode, type Shape } from "../model";
import { hideTip, showTip } from "../tooltip";
import Icon, { type IconName } from "./Icon.vue";

const props = defineProps<{ mode: Mode; shape: Shape; symmetry: boolean; open: string | null }>();
const emit = defineEmits<{ mode: [Mode]; flyout: ["shape" | "symmetry", Event] }>();

const tools: { mode: Exclude<Mode, "pen" | "brush" | "marker" | "pencil" | "eraser">; icon: () => IconName }[] = [
  { mode: "select", icon: () => "lasso" },
  { mode: "shape", icon: () => props.shape },
  { mode: "eyedropper", icon: () => "eyedropper" },
  { mode: "hand", icon: () => "hand" },
];

function tipFor(m: (typeof tools)[number]["mode"]) {
  const info = MODE_INFO[m];
  const name = m === "shape" ? `${SHAPE_INFO[props.shape].name}` : info.name;
  return m === "eyedropper"
    ? `${name}  ${info.key} or hold Alt`
    : m === "hand"
      ? `${name}  ${info.key} or hold Space`
      : `${name}  ${info.key}`;
}

function press(m: (typeof tools)[number]["mode"], e: Event) {
  if (m === "shape" && props.mode === "shape") emit("flyout", "shape", e);
  else emit("mode", m);
}
</script>

<template>
  <nav class="rail pill anchor" aria-label="Canvas tools">
    <button
      v-for="t in tools"
      :id="`mode-${t.mode}`"
      :key="t.mode"
      class="icon-button"
      :class="{ on: mode === t.mode, flyout: t.mode === 'shape' }"
      :aria-label="MODE_INFO[t.mode].name"
      :aria-pressed="mode === t.mode"
      @click="press(t.mode, $event)"
      @pointerenter="showTip($event, tipFor(t.mode), false, 'right')"
      @focus="showTip($event, tipFor(t.mode), false, 'right')"
      @pointerleave="hideTip"
      @blur="hideTip"
    >
      <Icon :name="t.icon()" />
      <i v-if="t.mode === 'shape'" class="corner" />
    </button>
    <i class="rule" />
    <button
      id="symmetry"
      class="icon-button"
      :class="{ on: open === 'symmetry', live: symmetry }"
      aria-label="Symmetry"
      :aria-pressed="symmetry"
      @click="emit('flyout', 'symmetry', $event)"
      @pointerenter="showTip($event, 'Symmetry  Y', false, 'right')"
      @focus="showTip($event, 'Symmetry  Y', false, 'right')"
      @pointerleave="hideTip"
      @blur="hideTip"
    >
      <Icon name="mirror" />
      <i v-if="symmetry" class="dot" />
    </button>
  </nav>
</template>

<style scoped>
.rail {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  width: 40px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 4px 0;
  border-radius: 20px;
}
.icon-button {
  position: relative;
  z-index: 1;
}
.icon-button.on {
  background: #ffffff2b;
  color: #ffffff;
}
.corner {
  position: absolute;
  right: 5px;
  bottom: 5px;
  width: 0;
  height: 0;
  border-left: 4px solid transparent;
  border-bottom: 4px solid #f2f2f480;
}
.dot {
  position: absolute;
  right: 6px;
  top: 6px;
  width: 6px;
  height: 6px;
  border-radius: 3px;
  background: #3b82f6;
  box-shadow: 0 0 0 1.5px var(--pill);
}
.rule {
  width: 20px;
  height: 1px;
  margin: 2px 0;
  background: #ffffff1c;
}
</style>
