<script setup lang="ts">
import Glass from "../components/Glass.vue";
import PreviewPicker from "../components/PreviewPicker.vue";
import { app, load } from "../state";
</script>

<template>
  <div class="view settings">
    <h1 class="title">Settings</h1>
    <Glass class="section">
      <h2 class="heading">Units</h2>
      <div class="chips">
        <button class="chip metric" :class="{ on: app.units === 'metric' }" @click="app.units = 'metric'">
          °C, km/h
        </button>
        <button class="chip imperial" :class="{ on: app.units === 'imperial' }" @click="app.units = 'imperial'">
          °F, mph
        </button>
      </div>
    </Glass>

    <Glass class="section">
      <h2 class="heading">Preview weather</h2>
      <p class="note">
        The sky, the rain and the glass are shaders in shaders/. Pick a condition to see its effects without waiting for
        it: a CSS transition on --shading blends one into the next.
      </p>
      <PreviewPicker />
    </Glass>

    <Glass class="section">
      <h2 class="heading">Data</h2>
      <p class="note">
        Forecasts and place search by Open-Meteo (open-meteo.com, CC BY 4.0). Radar by RainViewer (rainviewer.com), map
        © OpenStreetMap contributors. Without a connection the app shows a sample forecast.
      </p>
      <p v-if="app.offline" class="note warn">The live forecast could not be loaded: {{ app.offline }}</p>
      <div class="chips">
        <button class="chip" :disabled="app.loading" @click="load()">
          {{ app.loading ? "Loading…" : "Reload forecast" }}
        </button>
      </div>
    </Glass>
  </div>
</template>

<style scoped>
.settings {
  width: 660px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding-left: 20px;
}
.title {
  margin: 0 0 6px;
  font-size: 34px;
  font-weight: 300;
}
.section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px 24px 22px;
}
.heading {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: #ffffffe6;
}
.note {
  margin: 0;
  font-size: 13px;
  line-height: 19px;
  color: #ffffffb3;
}
.warn {
  color: #ffd2c4;
}
</style>
