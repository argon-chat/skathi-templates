<script setup lang="ts">
import { computed } from "vue";
import { conditionOf } from "../conditions";

const props = defineProps<{ code: number; night?: boolean; size?: number }>();

const kind = computed(() => {
  const c = conditionOf(props.code);
  if (c === "clear") return props.code === 1 ? "partly" : "clear";
  return c;
});
const night = computed(() => props.night);
const sunny = computed(() => kind.value === "clear" || kind.value === "partly");
const falling = computed(() => ["drizzle", "rain", "storm", "snow"].includes(kind.value));
const CLOUD = "M18 52h29a10 10 0 0 0 1.5-19.9A14 14 0 0 0 21.5 30 11 11 0 0 0 18 52z";
</script>

<template>
  <svg
    class="wicon"
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 64 64"
    :width="size ?? 32"
    :height="size ?? 32"
    :style="{ width: `${size ?? 32}px`, height: `${size ?? 32}px` }"
  >
    <defs>
      <radialGradient id="sun" cx="0.38" cy="0.34" r="0.7">
        <stop offset="0" stop-color="#fff8d6" />
        <stop offset="0.45" stop-color="#ffd65e" />
        <stop offset="1" stop-color="#ff9a3c" />
      </radialGradient>
      <radialGradient id="halo" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0.45" stop-color="#ffc864" stop-opacity="0.55" />
        <stop offset="1" stop-color="#ffb35c" stop-opacity="0" />
      </radialGradient>
      <radialGradient id="moon" cx="0.35" cy="0.3" r="0.8">
        <stop offset="0" stop-color="#fffbe8" />
        <stop offset="0.6" stop-color="#ffe9a8" />
        <stop offset="1" stop-color="#e9b860" />
      </radialGradient>
      <linearGradient id="cloud" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#ffffff" />
        <stop offset="0.55" stop-color="#f3f0ff" />
        <stop offset="1" stop-color="#c4bbec" />
      </linearGradient>
      <linearGradient id="cloud-back" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#e9e5fb" />
        <stop offset="1" stop-color="#a39bd3" />
      </linearGradient>
      <linearGradient id="cloud-dark" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#c9c3e4" />
        <stop offset="1" stop-color="#6c6494" />
      </linearGradient>
      <linearGradient id="drop" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#c4e4ff" />
        <stop offset="1" stop-color="#5f86ff" />
      </linearGradient>
      <linearGradient id="bolt" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#fff2a6" />
        <stop offset="1" stop-color="#ffa630" />
      </linearGradient>
      <mask id="crescent">
        <rect width="64" height="64" fill="#ffffff" />
        <circle :cx="kind === 'clear' ? 41 : 47" :cy="kind === 'clear' ? 22 : 13" r="12" fill="#000000" />
      </mask>
      <filter id="lift" x="-20%" y="-20%" width="140%" height="170%">
        <feDropShadow dx="0" dy="2.5" stdDeviation="2.2" flood-color="#2b1d66" flood-opacity="0.35" />
      </filter>
    </defs>

    <template v-if="sunny && !night">
      <circle
        :cx="kind === 'clear' ? 32 : 40"
        :cy="kind === 'clear' ? 32 : 23"
        :r="kind === 'clear' ? 26 : 19"
        fill="url(#halo)"
      />
      <circle
        :cx="kind === 'clear' ? 32 : 40"
        :cy="kind === 'clear' ? 32 : 23"
        :r="kind === 'clear' ? 15 : 12"
        fill="url(#sun)"
      />
    </template>
    <template v-if="sunny && night">
      <circle
        :cx="kind === 'clear' ? 32 : 40"
        :cy="kind === 'clear' ? 32 : 22"
        :r="kind === 'clear' ? 16 : 12"
        fill="url(#moon)"
        mask="url(#crescent)"
        filter="url(#lift)"
      />
      <circle v-if="kind === 'clear'" cx="48" cy="18" r="1.4" fill="#fff6d8" />
      <circle v-if="kind === 'clear'" cx="16" cy="44" r="1" fill="#fff6d8" />
    </template>

    <g v-if="kind !== 'clear'" :transform="falling ? 'translate(0 -7)' : ''">
      <path
        v-if="kind === 'cloudy' || kind === 'fog' || kind === 'storm'"
        :d="CLOUD"
        fill="url(#cloud-back)"
        transform="translate(19 -9) scale(0.72)"
      />
      <path
        :d="CLOUD"
        :fill="kind === 'storm' ? 'url(#cloud-dark)' : 'url(#cloud)'"
        filter="url(#lift)"
        :transform="kind === 'partly' ? 'translate(-3 1)' : ''"
      />
    </g>

    <template v-if="kind === 'drizzle' || kind === 'rain' || kind === 'storm'">
      <path d="M24 50s-3 3.6-3 5.6a3 3 0 0 0 6 0c0-2-3-5.6-3-5.6z" fill="url(#drop)" />
      <path v-if="kind !== 'storm'" d="M33 53s-3 3.6-3 5.6a3 3 0 0 0 6 0c0-2-3-5.6-3-5.6z" fill="url(#drop)" />
      <path v-if="kind !== 'drizzle'" d="M42 50s-3 3.6-3 5.6a3 3 0 0 0 6 0c0-2-3-5.6-3-5.6z" fill="url(#drop)" />
    </template>
    <path v-if="kind === 'storm'" d="M35 40l-7 11h5.5l-3.5 10 10-13h-5.5l3.5-8z" fill="url(#bolt)" />
    <template v-if="kind === 'snow'">
      <circle cx="23" cy="53" r="2.6" fill="#ffffff" />
      <circle cx="33" cy="58" r="2.6" fill="#ffffff" />
      <circle cx="43" cy="53" r="2.6" fill="#ffffff" />
      <circle cx="28" cy="61" r="1.6" fill="#e8e4ff" />
      <circle cx="39" cy="62" r="1.6" fill="#e8e4ff" />
    </template>
    <template v-if="kind === 'fog'">
      <rect x="12" y="50" width="40" height="3.4" rx="1.7" fill="#e9e5fb" />
      <rect x="18" y="57" width="30" height="3.4" rx="1.7" fill="#cfc8f0" />
    </template>
  </svg>
</template>
