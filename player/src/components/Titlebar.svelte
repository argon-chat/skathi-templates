<script lang="ts">
  // `window-drag: move` drags the window; `--window-control` gives each button its OS behaviour
  // (snap layouts on maximize).
  import { appWindow } from "skathi:app";
  import { onMount } from "svelte";
  import { productName } from "../lib/product";

  let hostControls = $state(appWindow.chrome.hostControls);
  let maximized = $state(appWindow.isMaximized());

  onMount(() => {
    const read = () => {
      hostControls = appWindow.chrome.hostControls;
      maximized = appWindow.isMaximized();
    };
    navigator.windowControlsOverlay.addEventListener("geometrychange", read);
    appWindow.addEventListener("maximize", read);
    appWindow.addEventListener("unmaximize", read);
    return () => {
      navigator.windowControlsOverlay.removeEventListener("geometrychange", read);
      appWindow.removeEventListener("maximize", read);
      appWindow.removeEventListener("unmaximize", read);
    };
  });
</script>

<header class="titlebar">
  <div class="brand">
    <img class="logo" src="assets/wolf.svg" alt="" />
    <span class="name">{productName}</span>
  </div>

  <div class="end">
    {#if !hostControls}
      <div class="controls">
        <div class="control minimize" title="Minimize">
          <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 5h10" stroke="currentColor" /></svg>
        </div>
        <div class="control maximize" title={maximized ? "Restore" : "Maximize"}>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            {#if maximized}
              <path d="M2.5 2.5V.5h7v7h-2 M.5 2.5h7v7h-7z" stroke="currentColor" />
            {:else}
              <path d="M.5 .5h9v9h-9z" stroke="currentColor" />
            {/if}
          </svg>
        </div>
        <div class="control close" title="Close">
          <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 0l10 10M10 0 0 10" stroke="currentColor" /></svg>
        </div>
      </div>
    {/if}
  </div>
</header>

<style>
  .titlebar {
    height: env(titlebar-area-height, 44px);
    padding-left: env(titlebar-area-x, 0px);
    flex-shrink: 0;
    display: flex;
    align-items: center;
    window-drag: move;
    user-select: none;
  }
  @media (display-mode: fullscreen) {
    .titlebar {
      display: none;
    }
  }
  .brand {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 9px;
    padding-left: 16px;
  }
  .logo {
    width: 26px;
    height: 26px;
  }
  .name {
    font-size: 13px;
    font-weight: 700;
    color: #edeaf3;
  }
  .end {
    flex: 1;
    height: 100%;
    display: flex;
    justify-content: flex-end;
  }
  .controls {
    height: 100%;
    display: flex;
    window-drag: none;
  }
  .control {
    width: 46px;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #b3acc4;
    transition:
      background-color 120ms ease,
      color 120ms ease;
  }
  .control:hover {
    background: #ffffff1a;
    color: #ffffff;
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
  .close:hover {
    background: #c42b1c;
    color: #ffffff;
  }
</style>
