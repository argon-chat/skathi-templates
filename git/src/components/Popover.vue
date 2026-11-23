<script setup lang="ts">
import { onMounted, ref } from "vue";

const props = defineProps<{ anchor: string; width: number }>();
const emit = defineEmits<{ close: [] }>();

const pos = ref({ x: 0, y: 0, above: false });

onMounted(() => {
  const box = document.getElementById(props.anchor)?.getBoundingClientRect();
  if (!box) return;
  const above = box.bottom + 320 > innerHeight && box.top > 320;
  pos.value = {
    x: Math.max(8, Math.min(box.x, innerWidth - props.width - 8)),
    y: above ? innerHeight - box.top + 6 : box.bottom + 6,
    above,
  };
});

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") {
    e.preventDefault();
    emit("close");
  }
}
</script>

<template>
  <div class="scrim" @pointerdown.self="emit('close')" />
  <div
    class="pop"
    :class="{ above: pos.above }"
    :style="{
      left: `${pos.x}px`,
      [pos.above ? 'bottom' : 'top']: `${pos.y}px`,
      width: `${width}px`,
    }"
    @keydown="onKey"
  >
    <slot />
  </div>
</template>

<style scoped>
.scrim {
  position: absolute;
  inset: 0;
  z-index: 30;
}
.pop {
  position: absolute;
  z-index: 31;
  display: flex;
  flex-direction: column;
  max-height: 460px;
  overflow: hidden;
  border: 1px solid var(--line-strong);
  border-radius: 12px;
  background-color: var(--raised);
  box-shadow: var(--shadow);
  transition:
    opacity 140ms var(--ease),
    transform 200ms var(--spring),
    box-shadow 280ms var(--ease);
}
@starting-style {
  .pop {
    opacity: 0;
    transform: translateY(-6px) scale(0.98);
    box-shadow:
      0 0 0 transparent,
      0 0 0 transparent;
  }
  .pop.above {
    transform: translateY(6px) scale(0.98);
  }
}
@media (prefers-reduced-motion: reduce) {
  .pop {
    transition: none;
  }
}
</style>
