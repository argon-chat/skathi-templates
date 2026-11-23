<script setup lang="ts">
import { dismiss, repo, type Notice } from "../git/repo";
import Icon from "./Icon.vue";

async function copy(n: Notice) {
  await navigator.clipboard.writeText(n.detail ? `${n.title}\n${n.detail}` : n.title);
}
</script>

<template>
  <div class="notices" aria-live="polite">
    <div v-for="n in repo.notices" :key="n.id" class="notice" :class="n.kind" role="status">
      <span class="icon-wrap">
        <Icon :name="n.kind === 'error' ? 'alert' : n.kind === 'ok' ? 'check' : 'info'" :size="15" />
      </span>
      <div class="content">
        <b
          >{{ n.title.replace(/ [0-9a-f]{7,}$/, "") }}
          <code v-if="/ [0-9a-f]{7,}$/.test(n.title)" class="hash">{{ n.title.split(" ").pop() }}</code></b
        >
        <pre v-if="n.detail">{{ n.detail }}</pre>
      </div>
      <div class="buttons">
        <button v-if="n.kind === 'error'" class="icon-btn" aria-label="Copy" @click="copy(n)">
          <Icon name="copy" :size="13" />
        </button>
        <button class="icon-btn" aria-label="Dismiss" @click="dismiss(n.id)">
          <Icon name="close" :size="13" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.notices {
  position: absolute;
  right: 16px;
  bottom: 16px;
  z-index: 40;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 400px;
  pointer-events: none;
}
.notice {
  display: flex;
  gap: 10px;
  padding: 10px 8px 10px 12px;
  border: 1px solid var(--line-strong);
  border-radius: 12px;
  background-color: var(--raised);
  box-shadow: var(--shadow);
  pointer-events: auto;
  transition:
    opacity 180ms var(--ease),
    transform 260ms var(--spring);
}
@starting-style {
  .notice {
    opacity: 0;
    transform: translateY(12px) scale(0.97);
  }
}
.hash {
  margin-left: 4px;
  padding: 1px 6px;
  border-radius: 6px;
  background-color: var(--accent-soft);
  color: var(--accent);
  font-family: var(--mono);
  font-size: 12px;
  font-weight: 600;
}
.icon-wrap {
  display: flex;
  flex: none;
  padding-top: 1px;
  color: var(--accent);
}
.ok .icon-wrap {
  color: var(--ok);
}
.error {
  border-color: light-dark(#f0b8b8, #5a2b2e);
}
.error .icon-wrap {
  color: var(--danger);
}
.content {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.content b {
  font-weight: 600;
}
pre {
  max-height: 160px;
  margin: 0;
  overflow: auto;
  color: var(--muted);
  font-family: var(--mono);
  font-size: 11.5px;
  line-height: 1.45;
  white-space: pre-wrap;
  user-select: text;
}
.buttons {
  display: flex;
  flex: none;
  align-items: flex-start;
}
.icon-btn {
  width: 22px;
  height: 22px;
}
@media (prefers-reduced-motion: reduce) {
  .notice {
    transition: none;
  }
}
</style>
