<script lang="ts">
  // The window has no OS title bar (`titleBarStyle: "hidden"`): this strip is the drag region, and
  // the three keys are the caption buttons. `--window-control` hands each to the OS, so there are
  // no click handlers. macOS keeps its own traffic lights and the strip starts past them.
  const ownKeys = navigator.platform !== "MacIntel";
</script>

<header class="bar">
  <b>SK-16</b>
  <span>Rhythm composer</span>
  {#if ownKeys}
    <div class="keys">
      <div class="minimize" aria-label="Minimize"><i></i></div>
      <div class="maximize" aria-label="Maximize"><i></i></div>
      <div class="close" aria-label="Close"><i></i></div>
    </div>
  {/if}
</header>

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: 12px;
    height: env(titlebar-area-height, 40px);
    padding-left: calc(env(titlebar-area-x, 0px) + 22px);
    padding-right: 12px;
    border-bottom: 1px solid rgba(0, 0, 0, 0.7);
    box-shadow: 0 1px 0 rgba(255, 255, 255, 0.05);
    app-region: drag;
  }
  .bar b {
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: var(--text);
  }
  .bar span {
    font-size: 10px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .keys {
    display: flex;
    gap: 6px;
    margin-left: auto;
  }
  .keys div {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 22px;
    border: 1px solid #000;
    border-radius: 5px;
    background-image: linear-gradient(180deg, #2c2826, #1c1917);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.09);
  }
  .keys i {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background-color: #4a423c;
    transition:
      background-color 120ms,
      box-shadow 120ms;
  }
  .keys div:hover i {
    background-color: var(--lamp);
    box-shadow: 0 0 8px var(--lamp);
  }
  .minimize {
    --window-control: minimize;
    --lamp: #ffe36b;
  }
  .maximize {
    --window-control: maximize;
    --lamp: #7be3a0;
  }
  .close {
    --window-control: close;
    --lamp: #ff6b5c;
  }
  @media (display-mode: fullscreen) {
    .bar {
      display: none;
    }
  }
</style>
