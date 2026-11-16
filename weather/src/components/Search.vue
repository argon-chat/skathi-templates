<script setup lang="ts">
import { onMounted, onUnmounted, ref, shallowRef, watch } from "vue";
import { app, choose } from "../state";
import { searchPlaces, type Place } from "../weather";
import Glass from "./Glass.vue";
import Icon from "./Icon.vue";

const input = shallowRef<HTMLInputElement | null>(null);
const query = ref("");
const results = ref<Place[]>([]);
const status = ref("Type a city's name");

let pending: AbortController | null = null;
let wait: ReturnType<typeof setTimeout> | undefined;
watch(query, (q) => {
  clearTimeout(wait);
  pending?.abort();
  if (q.trim().length < 2) {
    results.value = [];
    status.value = "Type a city's name";
    return;
  }
  wait = setTimeout(async () => {
    const controller = new AbortController();
    pending = controller;
    status.value = "Searching…";
    try {
      results.value = await searchPlaces(q.trim(), controller.signal);
      status.value = results.value.length ? "" : "No places found";
    } catch {
      if (!controller.signal.aborted) status.value = "Search is unavailable offline";
    }
  }, 250);
});

const close = () => (app.searching = false);
const onKey = (e: KeyboardEvent) => {
  if (e.key === "Escape") close();
};
onMounted(() => {
  input.value?.focus();
  document.addEventListener("keydown", onKey);
});
onUnmounted(() => {
  clearTimeout(wait);
  pending?.abort();
  document.removeEventListener("keydown", onKey);
});
</script>

<template>
  <div class="scrim" @click.self="close">
    <Glass class="search">
      <div class="field">
        <Icon name="search" :size="20" />
        <input ref="input" v-model="query" class="input" placeholder="Search for a city" />
        <button class="close" title="Close" @click="close"><Icon name="close" :size="18" /></button>
      </div>
      <div v-if="results.length" class="results">
        <button v-for="p in results" :key="`${p.latitude},${p.longitude}`" class="result" @click="choose(p)">
          <Icon name="pin" :size="18" />
          <span class="name">{{ p.name }}</span>
          <span class="where">{{ [p.region, p.country].filter(Boolean).join(", ") }}</span>
        </button>
      </div>
      <p v-else class="status">{{ status }}</p>
    </Glass>
  </div>
</template>

<style scoped>
.scrim {
  position: absolute;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 20;
  display: flex;
  justify-content: center;
  padding-top: 110px;
  background: #0b061f59;
}
.search {
  width: 520px;
  height: fit-content;
  display: flex;
  flex-direction: column;
  padding: 10px;
  background: #2a1b5c59;
}
.field {
  height: 50px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 8px 0 14px;
  color: #ffffffcc;
}
.input {
  flex: 1;
  height: 40px;
  border: none;
  background: transparent;
  color: #ffffff;
  font-size: 18px;
  font-family: var(--font);
}
.close {
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: #ffffffb3;
  cursor: pointer;
}
.close:hover {
  background: #ffffff1a;
}
.results {
  display: flex;
  flex-direction: column;
  padding-top: 6px;
  border-top: 1px solid #ffffff1f;
}
.result {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 14px;
  border: none;
  border-radius: 12px;
  background: transparent;
  color: #ffffffcc;
  text-align: left;
  cursor: pointer;
}
.result:hover {
  background: #ffffff1a;
}
.name {
  font-size: 15px;
  color: #ffffff;
}
.where {
  font-size: 13px;
  color: #ffffff8c;
}
.status {
  margin: 0;
  padding: 12px 14px 14px;
  border-top: 1px solid #ffffff1f;
  font-size: 13px;
  color: #ffffff99;
}
</style>
