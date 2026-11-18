<script setup lang="ts">
import Icon, { type IconName } from "./Icon.vue";

export type Format = "png" | "transparent" | "svg";

defineProps<{ format: Format; scale: number; pattern: boolean; paper: boolean; busy: boolean }>();
const emit = defineEmits<{
  format: [Format];
  scale: [number];
  pattern: [boolean];
  save: [];
  copy: [];
}>();

const formats: { id: Format; name: string; detail: string; icon: IconName }[] = [
  { id: "png", name: "PNG", detail: "On the paper colour", icon: "image" },
  { id: "transparent", name: "Transparent PNG", detail: "Strokes only", icon: "checker" },
  { id: "svg", name: "SVG", detail: "Vector paths from the strokes", icon: "vector" },
];
</script>

<template>
  <div class="popover pill export" role="dialog" aria-label="Export">
    <div class="formats" role="radiogroup" aria-label="Format">
      <button
        v-for="f in formats"
        :id="`format-${f.id}`"
        :key="f.id"
        class="format"
        :class="{ on: f.id === format }"
        role="radio"
        :aria-checked="f.id === format"
        @click="emit('format', f.id)"
      >
        <span class="glyph"><Icon :name="f.icon" :size="18" /></span>
        <span class="text">
          <span class="name">{{ f.name }}</span>
          <span class="detail">{{ f.detail }}</span>
        </span>
        <Icon v-if="f.id === format" class="tick" name="check" :size="16" />
      </button>
    </div>
    <i class="rule" />
    <div v-if="format !== 'svg'" class="option">
      <span class="label">Scale</span>
      <div class="segmented compact" role="radiogroup" aria-label="Scale">
        <button
          v-for="s in [1, 2, 4]"
          :id="`scale-${s}`"
          :key="s"
          class="seg"
          :class="{ on: s === scale }"
          role="radio"
          :aria-checked="s === scale"
          @click="emit('scale', s)"
        >
          {{ s }}×
        </button>
      </div>
    </div>
    <button
      id="export-pattern"
      class="item"
      role="menuitemcheckbox"
      :aria-checked="pattern"
      :disabled="!paper || format === 'transparent'"
      @click="emit('pattern', !pattern)"
    >
      <Icon name="grid" :size="16" />Include paper pattern<Icon
        v-if="pattern && paper && format !== 'transparent'"
        class="check"
        name="check"
        :size="16"
      />
    </button>
    <div class="buttons">
      <button id="export-copy" class="text-button wide" :disabled="busy || format === 'svg'" @click="emit('copy')">
        <Icon name="copy" :size="16" />Copy
      </button>
      <button id="export-save" class="primary" :disabled="busy" @click="emit('save')">
        <Icon name="export" :size="16" />Save…
      </button>
    </div>
  </div>
</template>

<style scoped>
.export {
  width: 272px;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.formats {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.format {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 10px 7px 7px;
  border: none;
  border-radius: 11px;
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: background-color 150ms ease;
}
.format:hover {
  background: #ffffff0f;
}
.format.on {
  background: #ffffff1c;
}
.glyph {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 9px;
  background: #ffffff12;
  color: #f2f2f4d0;
}
.text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.name {
  font-size: 13px;
}
.detail {
  font-size: 11px;
  color: #f2f2f48c;
}
.tick {
  color: #f2f2f4;
}
.option {
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 4px 0 10px;
}
.label {
  font-size: 13px;
}
.compact {
  width: 132px;
}
.buttons {
  display: flex;
  gap: 6px;
  margin-top: 4px;
  padding: 6px 2px 2px;
  border-top: 1px solid #ffffff14;
}
.wide {
  flex: 1;
  justify-content: center;
}
.text-button:disabled {
  opacity: 0.35;
  cursor: default;
}
</style>
