<script setup lang="ts">
// The window has no OS title bar (`titleBarStyle: "hidden"`): this strip is the drag region, and
// the three keys are the caption buttons. `--window-control` hands each to the OS, so there are
// no click handlers. macOS keeps its own traffic lights and the strip starts past them.
const ownKeys = navigator.platform !== "MacIntel";
</script>

<template>
  <header class="title">
    <b>RV32</b>
    <span>Workbench</span>
    <div v-if="ownKeys" class="caption">
      <div class="minimize" aria-label="Minimize"><i /></div>
      <div class="maximize" aria-label="Maximize"><i /></div>
      <div class="close" aria-label="Close"><i /><i /></div>
    </div>
  </header>
</template>

<style>
.title {
  display: flex;
  align-items: center;
  gap: 10px;
  height: env(titlebar-area-height, 40px);
  padding-left: calc(env(titlebar-area-x, 0px) + 16px);
  background-color: var(--panel);
  app-region: drag;
}
.title b {
  padding: 2px 7px;
  border-radius: 4px;
  background-color: var(--accent);
  color: var(--ink);
  font-weight: 700;
  letter-spacing: 0.06em;
}
.title span {
  font-size: 11px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--muted);
}
.caption {
  display: flex;
  align-self: stretch;
  margin-left: auto;
}
.caption div {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  transition: background-color 100ms;
}
.caption i {
  width: 10px;
  height: 10px;
  border: 1px solid var(--muted);
}
.caption .minimize i {
  height: 0;
  border-width: 1px 0 0;
}
.caption .close i {
  width: 13px;
  height: 0;
  border-width: 1px 0 0;
  rotate: 45deg;
}
.caption .close i + i {
  margin-left: -13px;
  rotate: -45deg;
}
.caption div:hover {
  background-color: var(--hover);
}
.caption .close:hover {
  background-color: var(--danger);
}
.caption div:hover i {
  border-color: var(--text);
}
.minimize {
  --window-control: minimize;
}
.maximize {
  --window-control: maximize;
}
.close {
  --window-control: close;
}
@media (display-mode: fullscreen) {
  .title {
    display: none;
  }
}
</style>
