<script setup lang="ts">
import type { Symmetry } from "../model";
import Icon from "./Icon.vue";
import Slider from "./Slider.vue";

const props = defineProps<{ symmetry: Symmetry | null; last: Symmetry }>();
const emit = defineEmits<{ change: [Symmetry | null]; centre: [] }>();

const kind = () => (!props.symmetry ? "off" : props.symmetry.segments > 1 ? "radial" : "mirror");

function choose(k: "off" | "mirror" | "radial") {
  if (k === "off") return emit("change", null);
  const base = props.symmetry ?? props.last;
  if (k === "mirror") emit("change", { ...base, mirror: true, segments: 1 });
  else
    emit("change", {
      ...base,
      mirror: base.segments > 1 && base.mirror,
      segments: Math.max(2, base.segments > 1 ? base.segments : 6),
    });
}
</script>

<template>
  <div class="popover pill symmetry-panel" role="dialog" aria-label="Symmetry">
    <div class="segmented" role="radiogroup" aria-label="Symmetry">
      <button
        id="symmetry-off"
        class="seg"
        :class="{ on: kind() === 'off' }"
        role="radio"
        :aria-checked="kind() === 'off'"
        @click="choose('off')"
      >
        Off
      </button>
      <button
        id="symmetry-mirror"
        class="seg"
        :class="{ on: kind() === 'mirror' }"
        role="radio"
        :aria-checked="kind() === 'mirror'"
        @click="choose('mirror')"
      >
        <Icon name="mirror" :size="16" />Mirror
      </button>
      <button
        id="symmetry-radial"
        class="seg"
        :class="{ on: kind() === 'radial' }"
        role="radio"
        :aria-checked="kind() === 'radial'"
        @click="choose('radial')"
      >
        <Icon name="radial" :size="16" />Radial
      </button>
    </div>
    <template v-if="symmetry && symmetry.segments > 1">
      <Slider
        id="symmetry-segments"
        label="Segments"
        :value="symmetry.segments"
        :min="2"
        :max="12"
        :step="1"
        :text="String(symmetry.segments)"
        @input="(v) => emit('change', { ...symmetry!, segments: Math.round(v) })"
      />
      <button
        id="symmetry-kaleidoscope"
        class="item"
        role="menuitemcheckbox"
        :aria-checked="symmetry.mirror"
        @click="emit('change', { ...symmetry!, mirror: !symmetry.mirror })"
      >
        <Icon name="mirror" :size="16" />Mirror each segment<Icon
          v-if="symmetry.mirror"
          class="check"
          name="check"
          :size="16"
        />
      </button>
    </template>
    <button v-if="symmetry" id="symmetry-centre" class="item" @click="emit('centre')">
      <Icon name="fit" :size="16" />Centre on view
    </button>
  </div>
</template>

<style scoped>
.symmetry-panel {
  width: 264px;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
</style>
