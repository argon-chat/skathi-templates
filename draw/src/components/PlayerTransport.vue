<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { DrawPlayer } from "../player";
import Icon from "./Icon.vue";

const { player } = defineProps<{ player: DrawPlayer }>();
const {
  position,
  duration,
  count,
  eventCount,
  playing,
  density,
  speed,
  title,
  viewOnly,
  camera,
  showCursor,
  showUndone,
  compressPausesTo,
} = player;
const track = ref<HTMLElement | null>(null);
const panel = ref<HTMLElement | null>(null);
const menu = ref<"speed" | "options" | null>(null);
const speeds = [0.5, 1, 2, 4, 8, 16, 64, Infinity];
const gaps = [0.5, 1, 2, 5, Infinity];
const progress = computed(() => (duration.value ? position.value / duration.value : 0));
const bars = computed(() => {
  const max = Math.max(1, ...density.value);
  return density.value.map((n) => 2 + Math.round(17 * Math.sqrt(n / max)));
});
let finger: number | null = null;

function time(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function scrub(e: PointerEvent) {
  const b = track.value?.getBoundingClientRect();
  if (b?.width) void player.seek(((e.clientX - b.x) / b.width) * duration.value);
}

function down(e: PointerEvent) {
  if (e.button !== 0 || finger !== null) return;
  finger = e.pointerId;
  track.value?.setPointerCapture(e.pointerId);
  scrub(e);
}

function key(e: KeyboardEvent) {
  const ms = e.shiftKey ? 10000 : 1000;
  const to =
    e.key === "ArrowLeft"
      ? position.value - ms
      : e.key === "ArrowRight"
        ? position.value + ms
        : e.key === "Home"
          ? 0
          : e.key === "End"
            ? duration.value
            : null;
  if (to !== null) {
    e.stopPropagation();
    e.preventDefault();
    void player.seek(to);
  }
}

function outside(e: PointerEvent) {
  if (!panel.value?.contains(e.target as Node)) menu.value = null;
}

function setSpeed(value: number) {
  player.change({ speed: value });
  menu.value = null;
}

function toggle() {
  if (playing.value) player.pause();
  else void player.play().catch(() => {});
}

const speedText = (n: number) => (Number.isFinite(n) ? `${n}×` : "Instant");
onMounted(() => addEventListener("pointerdown", outside));
onBeforeUnmount(() => removeEventListener("pointerdown", outside));
</script>

<template>
  <section
    id="player-transport"
    ref="panel"
    class="transport pill"
    aria-label="Drawing playback"
    :data-playing="playing"
    :data-position="Math.round(position)"
    :data-duration="duration"
    :data-events="eventCount"
    :data-count="count"
  >
    <div class="transport-heading">
      <strong>{{ title }}</strong>
      <span class="time"
        >{{ time(position) }} <span>/ {{ time(duration) }}</span></span
      >
    </div>
    <div
      id="player-timeline"
      ref="track"
      class="track"
      role="slider"
      tabindex="0"
      aria-label="Recording timeline"
      :aria-valuenow="Math.round(position)"
      :aria-valuemax="duration"
      :aria-valuemin="0"
      :aria-valuetext="time(position)"
      @pointerdown="down"
      @pointermove="
        (e: PointerEvent) => {
          if (finger === e.pointerId) scrub(e);
        }
      "
      @pointerup="
        (e: PointerEvent) => {
          if (finger === e.pointerId) {
            scrub(e);
            finger = null;
          }
        }
      "
      @pointercancel="finger = null"
      @keydown="key"
    >
      <i v-for="(height, i) in bars" :key="i" class="bar" :style="{ height: height + 'px' }" />
      <span class="playhead" :style="{ left: progress * 100 + '%' }" />
    </div>
    <div class="controls">
      <button
        id="player-play"
        class="icon-button play"
        :aria-label="playing ? 'Pause playback' : 'Play recording'"
        @click="toggle"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path
            :d="
              playing
                ? 'M6 4h4v16H6zm8 0h4v16h-4z'
                : 'M7 4.5a.85.85 0 0 1 1.3-.7L20 11.3a.85.85 0 0 1 0 1.4L8.3 20.2a.85.85 0 0 1-1.3-.7Z'
            "
          />
        </svg>
      </button>
      <button
        id="player-step"
        class="icon-button"
        aria-label="Next action"
        title="Next action"
        :disabled="count >= eventCount"
        @click="player.step"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="m5.5 5 9 7-9 7zM18.5 5v14" />
        </svg>
      </button>
      <button
        id="player-end"
        class="icon-button"
        aria-label="Go to end"
        title="Go to end"
        :disabled="position >= duration && count >= eventCount"
        @click="player.seek(duration)"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="m3 6 6 6-6 6zm8 0 6 6-6 6zM21 6v12" />
        </svg>
      </button>
      <button
        id="player-speed"
        class="text-button rate"
        aria-label="Playback speed"
        :aria-expanded="menu === 'speed'"
        @click="menu = menu === 'speed' ? null : 'speed'"
      >
        {{ speedText(speed) }} <Icon name="down" :size="13" />
      </button>
      <div class="spacer" />
      <button
        id="player-options"
        class="icon-button"
        :class="{ on: menu === 'options' }"
        aria-label="Playback options"
        title="Playback options"
        :aria-expanded="menu === 'options'"
        @click="menu = menu === 'options' ? null : 'options'"
      >
        <Icon name="more" />
      </button>
      <button
        id="player-close"
        class="icon-button"
        aria-label="Close recording"
        title="Close recording"
        @click="player.exit()"
      >
        <Icon name="close" />
      </button>
    </div>
    <div v-if="menu === 'speed'" class="popup pill rate-menu" aria-label="Playback speed">
      <p class="heading">Playback speed</p>
      <div class="speed-grid">
        <button
          v-for="n in speeds"
          :key="n"
          class="seg"
          :class="{ on: speed === n }"
          :aria-pressed="speed === n"
          @click="setSpeed(n)"
        >
          {{ speedText(n) }}
        </button>
      </div>
    </div>
    <div v-if="menu === 'options'" class="popup pill options" aria-label="Playback options">
      <p class="heading">Camera</p>
      <div class="segmented">
        <button
          class="seg"
          :class="{ on: camera === 'author' }"
          :aria-pressed="camera === 'author'"
          @click="player.change({ camera: 'author' })"
        >
          Artist’s view
        </button>
        <button
          class="seg"
          :class="{ on: camera === 'fit' }"
          :aria-pressed="camera === 'fit'"
          @click="player.change({ camera: 'fit' })"
        >
          Fit drawing
        </button>
      </div>
      <p class="heading">Limit pauses</p>
      <div class="segmented">
        <button
          v-for="n in gaps"
          :key="n"
          class="seg"
          :class="{ on: compressPausesTo === n }"
          :aria-pressed="compressPausesTo === n"
          @click="player.change({ compressPausesTo: n })"
        >
          {{ Number.isFinite(n) ? n + "s" : "Off" }}
        </button>
      </div>
      <button id="player-cursor" class="item" role="switch" :aria-checked="showCursor" @click="player.toggleCursor()">
        <Icon name="eyedropper" :size="15" />Pen cursor<Icon v-if="showCursor" class="check" name="check" :size="15" />
      </button>
      <button
        id="player-undone"
        class="item"
        role="switch"
        :aria-checked="showUndone"
        @click="player.change({ showUndone: !showUndone })"
      >
        <Icon name="undo" :size="15" />Show undone actions<Icon
          v-if="showUndone"
          class="check"
          name="check"
          :size="15"
        />
      </button>
      <button id="player-hide" class="item" @click="player.change({ hideUi: true })">
        <Icon name="hidden" :size="15" />Hide controls<kbd class="shortcut">Tab</kbd>
      </button>
      <i class="rule" />
      <button id="player-continue" class="item" :disabled="viewOnly" @click="player.continueDrawing()">
        <Icon name="vector" :size="15" />Continue drawing from here
      </button>
      <span v-if="viewOnly" class="protected">The author marked this recording as view-only.</span>
    </div>
  </section>
</template>

<style scoped>
.transport {
  position: absolute;
  bottom: 18px;
  left: 50%;
  transform: translateX(-50%);
  width: 400px;
  max-width: 94%;
  box-sizing: border-box;
  padding: 10px 12px 7px;
  border-radius: 16px;
}
.transport-heading,
.controls {
  display: flex;
  align-items: center;
  gap: 3px;
}
.transport-heading {
  justify-content: space-between;
  padding: 0 4px;
  font-size: 12px;
}
.transport-heading strong {
  font-weight: 600;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.time {
  margin-left: 12px;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.time span {
  color: #f2f2f4a0;
}
.track {
  position: relative;
  height: 24px;
  display: flex;
  align-items: flex-end;
  gap: 2px;
  margin: 3px 4px 7px;
  cursor: ew-resize;
  touch-action: none;
}
.track:focus-visible {
  outline: 2px solid #f2f2f4;
  outline-offset: 2px;
}
.bar {
  flex: 1;
  background: #f2f2f46e;
  border-radius: 2px 2px 0 0;
  pointer-events: none;
}
.playhead {
  position: absolute;
  bottom: -2px;
  height: 23px;
  width: 2px;
  border-radius: 1px;
  background: #ffffff;
  pointer-events: none;
}
.play {
  background: #f2f2f4;
  color: #1c1c1e;
}
.play:hover:not(:disabled) {
  background: white;
}
.rate {
  font-variant-numeric: tabular-nums;
  margin-left: 4px;
}
.spacer {
  flex: 1;
}
.popup {
  position: absolute;
  bottom: 100%;
  margin-bottom: 8px;
  padding: 6px;
  border-radius: 14px;
  display: flex;
  flex-direction: column;
}
.rate-menu {
  left: 0;
  width: 212px;
}
.speed-grid {
  display: flex;
  flex-wrap: wrap;
}
.speed-grid .seg {
  flex: none;
  width: 25%;
  box-sizing: border-box;
}
.options {
  right: 0;
  width: 242px;
}
.options .segmented {
  margin: 2px 4px 6px;
}
.options .heading {
  margin-top: 6px;
}
.protected {
  padding: 0 10px 6px;
  font-size: 11px;
  color: #f2f2f4ab;
}
</style>
