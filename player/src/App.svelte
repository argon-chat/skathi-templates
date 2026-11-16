<script lang="ts">
  import { untrack } from "svelte";
  import { cubicOut } from "svelte/easing";
  import { Tween } from "svelte/motion";
  import Controls from "./components/Controls.svelte";
  import Disc from "./components/Disc.svelte";
  import Hearts from "./components/Hearts.svelte";
  import Playlist from "./components/Playlist.svelte";
  import Sidebar from "./components/Sidebar.svelte";
  import Titlebar from "./components/Titlebar.svelte";
  import TrackInfo from "./components/TrackInfo.svelte";
  import { css, hex, rgb, type Tint } from "./lib/fx.svelte";
  import { played } from "./lib/library.svelte";
  import { player } from "./lib/player.svelte";

  const palette = $derived(
    player.current?.palette ?? { first: "#f7a8d0", second: "#9fcdf5", accent: "#f7a8d0", heat: 0.3 },
  );

  // The backdrop cross-fades through a transition on --shading; the accent is tweened here because the UI
  // reads it as a plain CSS colour and the spectrum gets it every frame.
  const accent = Tween.of((): Tint => [...rgb(palette.accent), palette.heat], { duration: 900, easing: cubicOut });

  const backdrop = $derived(`aurora(0.05, ${player.playing ? 1 : 0}, ${palette.first}, ${palette.second})`);

  let heroWidth = $state(0);
  let heroHeight = $state(0);

  $effect(() => {
    const id = player.playing ? player.current?.id : undefined;
    if (id) untrack(() => played(id));
  });

  function key(e: KeyboardEvent) {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === " " || e.key === "k") player.toggle();
    else if (e.key === "ArrowRight") player.seek(player.position + 5);
    else if (e.key === "ArrowLeft") player.seek(player.position - 5);
    else if (e.key === "ArrowUp") player.setVolume(player.volume + 0.05);
    else if (e.key === "ArrowDown") player.setVolume(player.volume - 0.05);
    else if (e.key === "n") player.next();
    else if (e.key === "p") player.previous();
    else return;
    e.preventDefault();
  }
</script>

<svelte:window onkeydown={key} />

<div class="app" style:--shading={backdrop} style:--accent={css(accent.current)}>
  <Titlebar />
  <div class="body">
    <Sidebar />
    <main class="hero" bind:clientWidth={heroWidth} bind:clientHeight={heroHeight}>
      <Disc accent={hex(accent.current, accent.current[3])} room={Math.min(heroWidth, heroHeight - 90)} />
      <TrackInfo />
    </main>
    <Playlist />
  </div>
  <Controls />
  <Hearts />
</div>

<style>
  .app {
    position: relative;
    height: 100%;
    display: flex;
    flex-direction: column;
    background: #17161e;
    color: #edeaf3;
    font-family: system-ui, sans-serif;
    transition: --shading 1400ms ease;
  }
  .body {
    flex: 1;
    min-height: 0;
    display: flex;
    gap: 12px;
    padding: 0 12px 12px;
  }
  .hero {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }
  .app :global(.panel) {
    border-radius: 14px;
    --shading: jelly(18px, 6px, 12px, #16151cb8);
  }
  @media (max-width: 1040px) {
    .body :global(.sidebar) {
      display: none;
    }
  }
  @media (max-width: 760px) {
    .body :global(.playlist) {
      display: none;
    }
  }
</style>
