<script setup lang="ts">
import Icon from "./Icon.vue";

const emit = defineEmits<{ close: [] }>();
const mod = navigator.platform === "MacIntel" ? "⌘" : "Ctrl";

const groups: { title: string; keys: [string, string][] }[] = [
  {
    title: "Tools",
    keys: [
      ["Pen, brush, marker, pencil, eraser", "1–5"],
      ["Pen · Brush · Marker", "P · B · M"],
      ["Pencil · Eraser", "N · E"],
      ["Spray · Airbrush", "S · A"],
      ["Bucket · Lasso fill", "K · F"],
      ["Smudge", "D"],
      ["Lasso select", "L"],
      ["Shapes, again to cycle", "U"],
      ["Eyedropper", "I or hold Alt"],
      ["Hand", "H or hold Space"],
    ],
  },
  {
    title: "Brush",
    keys: [
      ["Smaller · larger", "[ · ]"],
      ["Less · more opaque", "{ · }"],
      ["Symmetry on or off", "Y"],
      ["Next paper", "G"],
    ],
  },
  {
    title: "Selection",
    keys: [
      ["Select all on the layer", `${mod}+A`],
      ["Copy · cut · paste", `${mod}+C · X · V`],
      ["Duplicate", `${mod}+D`],
      ["Delete", "Delete"],
      ["Nudge", "Arrows, Shift for 10"],
      ["Deselect", "Esc"],
    ],
  },
  {
    title: "View",
    keys: [
      ["Zoom in · out", `${mod}+= · −`],
      ["Actual size", `${mod}+0`],
      ["Fit the drawing", "Shift+1"],
      ["Rotate the canvas", ", · ."],
      ["Reset rotation", "R"],
      ["Navigator", "Shift+N"],
    ],
  },
  {
    title: "Drawing",
    keys: [
      ["Undo · redo", `${mod}+Z · ${mod}+Shift+Z`],
      ["New layer", `${mod}+Shift+N`],
      ["Export", `${mod}+Shift+E`],
      ["Copy as image", `${mod}+Shift+C`],
      ["This sheet", "?"],
    ],
  },
];
</script>

<template>
  <div class="scrim" @pointerdown.self="emit('close')">
    <section class="sheet pill" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title">
      <header>
        <h2 id="shortcuts-title"><Icon name="keyboard" />Keyboard shortcuts</h2>
        <button id="shortcuts-close" class="icon-button" aria-label="Close" @click="emit('close')">
          <Icon name="close" :size="16" />
        </button>
      </header>
      <div class="columns">
        <div v-for="g in groups" :key="g.title" class="group">
          <h3>{{ g.title }}</h3>
          <dl>
            <template v-for="[what, key] in g.keys" :key="what">
              <dt>{{ what }}</dt>
              <dd>
                <kbd>{{ key }}</kbd>
              </dd>
            </template>
          </dl>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.scrim {
  position: absolute;
  z-index: 3;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #0000002e;
}
.sheet {
  width: 760px;
  max-width: calc(100% - 48px);
  max-height: calc(100% - 96px);
  overflow-y: auto;
  box-sizing: border-box;
  padding: 14px 18px 18px;
  border-radius: 20px;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
h2 {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
.columns {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 14px 28px;
}
h3 {
  margin: 8px 0 6px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #f2f2f473;
}
dl {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 7px 12px;
  margin: 0;
}
dt {
  font-size: 12.5px;
  color: #f2f2f4d9;
}
dd {
  display: flex;
  justify-content: flex-end;
  margin: 0;
}
kbd {
  padding: 1px 6px;
  border-radius: 5px;
  background: #ffffff14;
  box-shadow: inset 0 -1px 0 #ffffff12;
  font: inherit;
  font-size: 11.5px;
  color: #f2f2f4c0;
  white-space: nowrap;
}
</style>
