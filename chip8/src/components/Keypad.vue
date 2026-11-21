<script setup lang="ts">
// The sixteen keys, laid out as on the COSMAC VIP and mapped to the left of a keyboard by position.
import { onMounted, onUnmounted, reactive } from "vue";
import { key } from "../machine";

const LAYOUT = [0x1, 0x2, 0x3, 0xc, 0x4, 0x5, 0x6, 0xd, 0x7, 0x8, 0x9, 0xe, 0xa, 0x0, 0xb, 0xf];
const CODES = [
  "Digit1",
  "Digit2",
  "Digit3",
  "Digit4",
  "KeyQ",
  "KeyW",
  "KeyE",
  "KeyR",
  "KeyA",
  "KeyS",
  "KeyD",
  "KeyF",
  "KeyZ",
  "KeyX",
  "KeyC",
  "KeyV",
];
const ARROWS: Record<string, number> = { ArrowLeft: 0x4, ArrowRight: 0x6, ArrowUp: 0x2, ArrowDown: 0x8 };

const down = reactive(new Set<number>());

function set(index: number, pressed: boolean) {
  if (pressed === down.has(index)) return;
  if (pressed) down.add(index);
  else down.delete(index);
  key(index, pressed);
}

function keyOf(event: KeyboardEvent): number | undefined {
  const at = CODES.indexOf(event.code);
  return at >= 0 ? LAYOUT[at] : ARROWS[event.code];
}

function onKey(event: KeyboardEvent) {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
  const index = keyOf(event);
  if (index === undefined) return;
  event.preventDefault();
  set(index, event.type === "keydown");
}

function release() {
  for (const index of [...down]) set(index, false);
}

onMounted(() => {
  window.addEventListener("keydown", onKey);
  window.addEventListener("keyup", onKey);
  window.addEventListener("blur", release);
});
onUnmounted(() => {
  window.removeEventListener("keydown", onKey);
  window.removeEventListener("keyup", onKey);
  window.removeEventListener("blur", release);
});
</script>

<template>
  <div class="keypad">
    <button
      v-for="index in LAYOUT"
      :key="index"
      class="key"
      :class="{ down: down.has(index) }"
      @pointerdown="set(index, true)"
      @pointerup="set(index, false)"
      @pointerleave="set(index, false)"
    >
      {{ index.toString(16).toUpperCase() }}
    </button>
  </div>
</template>

<style>
.keypad {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}
.key {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 34px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background-color: var(--raised);
  color: var(--text);
  font: inherit;
  transition: background-color 80ms;
}
.key:hover {
  background-color: var(--hover);
}
.key.down {
  background-color: var(--accent);
  color: var(--ink);
}
</style>
