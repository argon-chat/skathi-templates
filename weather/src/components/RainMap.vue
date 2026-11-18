<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from "vue";
import { clock } from "../format";
import { mapTile, RADAR_MAX_ZOOM, radarTile, TILE, tilesAround, worldPixel } from "../radar";
import { weather } from "../scene";
import { app } from "../state";
import Glass from "./Glass.vue";
import Icon from "./Icon.vue";

const props = defineProps<{ large?: boolean }>();

const zoom = computed(() => Math.min(props.large ? 6 : 5, RADAR_MAX_ZOOM));
const view = shallowRef<HTMLElement | null>(null);
const size = ref({ width: 0, height: 0 });
let observer: ResizeObserver | null = null;
onMounted(() => {
  observer = new ResizeObserver(() => {
    const r = view.value?.getBoundingClientRect();
    if (r) size.value = { width: Math.round(r.width), height: Math.round(r.height) };
  });
  if (view.value) observer.observe(view.value);
});
onUnmounted(() => {
  observer?.disconnect();
  stop();
});

const sheet = computed(() => {
  const { width, height } = size.value;
  if (!width || !height) return null;
  return tilesAround(worldPixel(app.place.latitude, app.place.longitude, zoom.value), width, height, zoom.value);
});
const sheetStyle = computed(() => ({ left: `${sheet.value?.left ?? 0}px`, top: `${sheet.value?.top ?? 0}px` }));
const columns = computed(() => sheet.value?.columns ?? 1);
const place = (i: number) => ({
  left: `${(i % columns.value) * TILE}px`,
  top: `${Math.floor(i / columns.value) * TILE}px`,
});
// RainViewer allows 100 requests a minute from one address, so playback shows as many evenly spaced
// frames as about 80 tiles allow, ending with the latest, and loads each only when it is reached.
const frames = computed(() => {
  const all = app.radar?.frames ?? [];
  const perFrame = Math.max(1, sheet.value?.tiles.length ?? 1);
  const count = Math.max(2, Math.min(all.length, Math.floor(80 / perFrame)));
  if (all.length <= count) return all;
  return Array.from({ length: count }, (_, i) => all[Math.round((i * (all.length - 1)) / (count - 1))]!);
});
const latest = computed(() => Math.max(0, frames.value.length - 1));
const failed = ref(false);

const playing = ref(false);
const at = ref(1);
const reached = ref(0);
let timer: ReturnType<typeof setInterval> | undefined;
function stop() {
  clearInterval(timer);
  playing.value = false;
}
function play() {
  if (playing.value) {
    stop();
    return;
  }
  playing.value = true;
  at.value = 0;
  timer = setInterval(() => {
    at.value = Math.min(1, at.value + 1 / 24);
    if (at.value >= 1) stop();
  }, 250);
}
const frame = computed(() => (playing.value ? Math.round(at.value * latest.value) : latest.value));
watch(
  () => app.radar,
  () => {
    failed.value = false;
    reached.value = 0;
  },
);
watch(frame, (f) => {
  if (playing.value) reached.value = Math.max(reached.value, f);
});
const loaded = (i: number) => i === latest.value || (reached.value > 0 && i <= reached.value) || i === frame.value;
const shown = computed(() => frames.value[frame.value]);
const offset = computed(() => app.forecast?.offset ?? 0);
function broken(i: number) {
  if (i === latest.value) failed.value = true;
}

const live = computed(() => app.radar !== null && !failed.value);
const synth = computed(() => {
  if (live.value) return 0;
  const soon = bars.value.some((b) => b > 0.05) ? 0.35 : 0;
  return Math.max(soon, weather.value.rain, weather.value.snow);
});
const rain = computed(() => `radar(${synth.value.toFixed(2)}, ${(playing.value ? at.value : 1).toFixed(3)}, 1)`);

const bars = computed(() => {
  const cast = app.forecast?.nowcast ?? [];
  return Array.from({ length: 24 }, (_, i) => {
    const t = (i / 23) * 4;
    const a = cast[Math.floor(t)] ?? 0;
    const b = cast[Math.min(Math.floor(t) + 1, 4)] ?? a;
    const mm = a + (b - a) * (t - Math.floor(t));
    return Math.min(1, Math.sqrt(mm / 1.5));
  });
});
const summary = computed(() => {
  if (playing.value && shown.value) return `Radar ${clock(shown.value.time, offset.value)}`;
  return bars.value.some((b) => b > 0.05) ? "Rain forecast" : "No rain expected";
});

const open = (url: string) => window.open(url);
</script>

<template>
  <Glass class="rainmap" :class="{ large }">
    <div ref="view" class="map">
      <div class="base">
        <div v-if="sheet" class="sheet" :style="sheetStyle">
          <img
            v-for="(t, n) in sheet.tiles"
            :key="t.key"
            class="tile"
            :style="place(n)"
            :src="mapTile(t, zoom)"
            alt=""
          />
        </div>
      </div>
      <div class="rain" :style="{ '--shading': rain }">
        <template v-if="app.radar && live && sheet">
          <template v-for="(f, i) in frames" :key="f.path">
            <div v-if="loaded(i)" v-show="i === frame" class="sheet" :style="sheetStyle">
              <img
                v-for="(t, n) in sheet.tiles"
                :key="t.key"
                class="tile"
                :style="place(n)"
                :src="radarTile(app.radar, f, t, zoom)"
                alt=""
                @error="broken(i)"
              />
            </div>
          </template>
        </template>
      </div>
      <div class="you" :style="{ left: `${size.width / 2}px`, top: `${size.height / 2}px` }">
        <div class="pulse" />
        <div class="dot" />
      </div>
      <button class="expand" :title="large ? 'Back' : 'Open the map'" @click="app.view = large ? 'now' : 'map'">
        <Icon :name="large ? 'close' : 'expand'" :size="18" />
      </button>
      <div class="credit">
        <span @click="open('https://www.openstreetmap.org/copyright')">© OpenStreetMap</span>
        <span v-if="app.radar" @click="open('https://www.rainviewer.com/')">RainViewer</span>
      </div>
    </div>
    <div class="bar">
      <button class="play" :title="playing ? 'Pause' : 'Play'" @click="play">
        <Icon :name="playing ? 'pause' : 'play'" :size="18" />
      </button>
      <div class="forecast">
        <div class="caption">
          <span>{{ summary }}</span>
          <span class="faint">60 min</span>
        </div>
        <div class="bars">
          <span
            v-for="(b, i) in bars"
            :key="i"
            class="b"
            :class="{ past: playing && i / 23 <= at }"
            :style="{ height: `${3 + b * 16}px` }"
          />
        </div>
      </div>
    </div>
  </Glass>
</template>

<style scoped>
.rainmap {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.map {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  border-radius: 29px 29px 0 0;
  corner-shape: squircle;
}
.base,
.rain {
  position: absolute;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  overflow: hidden;
}
.base {
  --shading: nightmap(#241a4c, #110c2a, #b0a2ff);
}
.rain {
  transition: --shading 250ms linear;
}
.sheet {
  position: absolute;
}
.tile {
  position: absolute;
  width: 256px;
  height: 256px;
}
.you {
  position: absolute;
  width: 0;
  height: 0;
}
.dot {
  position: absolute;
  left: -8px;
  top: -8px;
  width: 16px;
  height: 16px;
  border-radius: 8px;
  border: 2.5px solid #ffffff;
  background: #5b8cff;
  box-shadow: 0 0 12px #8fb1ff;
}
@keyframes pulse {
  from {
    transform: scale(0.4);
    opacity: 0.9;
  }
  to {
    transform: scale(1.6);
    opacity: 0;
  }
}
.pulse {
  position: absolute;
  left: -18px;
  top: -18px;
  width: 36px;
  height: 36px;
  border-radius: 18px;
  background: #8fb1ff66;
  animation: pulse 2.4s ease-out infinite;
}
.expand {
  position: absolute;
  top: 14px;
  right: 14px;
  width: 38px;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  border: 1px solid #ffffff2e;
  background: #ffffff1f;
  color: #ffffff;
  cursor: pointer;
}
.expand:hover {
  background: #ffffff33;
}
.credit {
  position: absolute;
  right: 10px;
  bottom: 6px;
  display: flex;
  gap: 8px;
  font-size: 10px;
  color: #ffffff8c;
}
.credit span {
  cursor: pointer;
}
.bar {
  height: 66px;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 0 18px 0 14px;
  border-top: 1px solid #ffffff1f;
}
.play {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 20px;
  border: 1px solid #ffffff33;
  background: #ffffff26;
  color: #ffffff;
  cursor: pointer;
}
.play:hover {
  background: #ffffff38;
}
.forecast {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.caption {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  color: #ffffffe6;
}
.faint {
  color: #ffffff99;
}
.bars {
  height: 20px;
  display: flex;
  align-items: flex-end;
  gap: 3px;
}
.b {
  flex: 1;
  border-radius: 2px;
  background: #ffffff66;
}
.b.past {
  background: #ffffff;
}
</style>
