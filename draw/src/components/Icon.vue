<script setup lang="ts">
const paths = {
  undo: "M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11",
  redo: "m15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13",
  layers: "m12 3 9 5-9 5-9-5 9-5ZM3 12.5l9 5 9-5M3 17l9 5 9-5",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  eye: "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12ZM12 14.75a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5Z",
  hidden:
    "M3 3l18 18M10.6 5.6A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.9 3.7M6.6 6.6C4 8.3 2.5 12 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4.4-1.1M9.9 9.9a2.75 2.75 0 0 0 4.2 4.2",
  plus: "M12 5v14M5 12h14",
  trash:
    "M4 7h16M10 11v6M14 11v6M6 7l1 12.5A1.5 1.5 0 0 0 8.5 21h7a1.5 1.5 0 0 0 1.5-1.5L18 7M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7",
  up: "m6 15 6-6 6 6",
  down: "m6 9 6 6 6-6",
  page: "M14 3H7.5A1.5 1.5 0 0 0 6 4.5v15A1.5 1.5 0 0 0 7.5 21h9a1.5 1.5 0 0 0 1.5-1.5V7l-4-4ZM14 3v4h4",
  flower:
    "M12 21v-7M12 14c-3 0-5-2-5-5 2 0 3.5.7 4.3 2M12 14c3 0 5-2 5-5-2 0-3.5.7-4.3 2M12 3c2 1.5 2 5 0 7-2-2-2-5.5 0-7Z",
  export: "M12 15V3M7 8l5-5 5 5M5 14v5.5A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V14",
  copy: "M9 9h10.5A1.5 1.5 0 0 1 21 10.5v9A1.5 1.5 0 0 1 19.5 21h-9A1.5 1.5 0 0 1 9 19.5V9ZM15 9V4.5A1.5 1.5 0 0 0 13.5 3h-9A1.5 1.5 0 0 0 3 4.5v9A1.5 1.5 0 0 0 4.5 15H9",
  grid: "M6 6h.01M12 6h.01M18 6h.01M6 12h.01M12 12h.01M18 12h.01M6 18h.01M12 18h.01M18 18h.01",
  check: "m5 12.5 4.5 4.5L19 7.5",
  erase: "M7 21h13M5.5 14.5 14 6a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L11 19H8L5.5 16.5a1.4 1.4 0 0 1 0-2Z",
} as const;

export type IconName = keyof typeof paths;

defineProps<{ name: IconName; size?: number }>();
</script>

<template>
  <svg
    class="icon"
    :width="size ?? 18"
    :height="size ?? 18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="paths[name]" />
  </svg>
</template>
