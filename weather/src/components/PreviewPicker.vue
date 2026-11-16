<script setup lang="ts">
import { CONDITION_NAMES, CONDITIONS, type Condition } from "../conditions";
import { app, TIMES_OF_DAY } from "../state";

const TIME_NAMES = { live: "Live", dawn: "Dawn", day: "Day", dusk: "Sunset", night: "Night" } as const;

function preview(c: Condition | null) {
  app.cycling = false;
  app.preview = c;
}
</script>

<template>
  <div class="picker">
    <div class="label">Weather</div>
    <div class="chips">
      <button class="chip live" :class="{ on: app.preview === null && !app.cycling }" @click="preview(null)">
        Live
      </button>
      <button v-for="c in CONDITIONS" :key="c" class="chip" :class="[c, { on: app.preview === c }]" @click="preview(c)">
        {{ CONDITION_NAMES[c] }}
      </button>
      <button class="chip cycle" :class="{ on: app.cycling }" @click="app.cycling = !app.cycling">Cycle all</button>
    </div>
    <div class="label">Time of day</div>
    <div class="chips">
      <button
        v-for="t in TIMES_OF_DAY"
        :key="t"
        class="chip"
        :class="[`time-${t}`, { on: app.timeOfDay === t }]"
        @click="app.timeOfDay = t"
      >
        {{ TIME_NAMES[t] }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.picker {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.label {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  color: #ffffff99;
}
</style>
