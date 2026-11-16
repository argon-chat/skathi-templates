<script setup lang="ts">
import { icons, type IconName } from "../icons";

defineProps<{ name: IconName; size?: number }>();
</script>

<template>
  <svg
    class="icon"
    xmlns="http://www.w3.org/2000/svg"
    :width="size ?? 20"
    :height="size ?? 20"
    :style="{ width: `${size ?? 20}px`, height: `${size ?? 20}px` }"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path :d="icons[name]" />
  </svg>
</template>
