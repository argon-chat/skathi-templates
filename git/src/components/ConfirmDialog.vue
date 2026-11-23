<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { ui } from "../ui";

const cancel = ref<HTMLButtonElement | null>(null);

watch(
  () => ui.confirm,
  (c) => {
    if (c) void nextTick(() => cancel.value?.focus());
  },
);

function onKey(e: KeyboardEvent) {
  if (!ui.confirm) return;
  if (e.key === "Escape") {
    e.preventDefault();
    ui.confirm.resolve(false);
  }
}
</script>

<template>
  <div v-if="ui.confirm" class="overlay" @keydown="onKey" @pointerdown.self="ui.confirm.resolve(false)">
    <div id="confirm" class="dialog" role="alertdialog" aria-modal="true">
      <h3>{{ ui.confirm.title }}</h3>
      <p>{{ ui.confirm.body }}</p>
      <div class="buttons">
        <button ref="cancel" id="confirm-cancel" class="btn" @click="ui.confirm.resolve(false)">Cancel</button>
        <button id="confirm-ok" class="btn danger" @click="ui.confirm.resolve(true)">{{ ui.confirm.action }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: absolute;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: light-dark(#1d212733, #00000080);
  transition: opacity 140ms var(--ease);
}
@starting-style {
  .overlay {
    opacity: 0;
  }
  .dialog {
    opacity: 0;
    transform: scale(0.94) translateY(6px);
  }
}
.dialog {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 380px;
  padding: 20px;
  border: 1px solid var(--line-strong);
  border-radius: 12px;
  background-color: var(--raised);
  box-shadow: var(--shadow);
  transition:
    opacity 160ms var(--ease),
    transform 240ms var(--spring);
}
h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
p {
  margin: 0;
  color: var(--muted);
  line-height: 1.5;
}
.buttons {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}
@media (prefers-reduced-motion: reduce) {
  .overlay,
  .dialog {
    transition: none;
  }
}
</style>
