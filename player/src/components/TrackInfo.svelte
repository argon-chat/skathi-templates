<script lang="ts">
  import { untrack } from "svelte";
  import { player } from "../lib/player.svelte";

  // On a track change the title scatters into glitter, swaps while it is all glitter, and gathers back as
  // the transition on --shading returns it to 0.
  const SCATTER_MS = 320;

  let shown = $state(player.current);
  let scattering = $state(false);

  $effect(() => {
    const next = player.current;
    if (next?.id === untrack(() => shown?.id)) return;
    scattering = true;
    const timer = setTimeout(() => {
      shown = next;
      scattering = false;
    }, SCATTER_MS);
    return () => clearTimeout(timer);
  });
</script>

<div class="info" class:scattering>
  <h1 class="title">{shown?.title ?? "Nothing to play"}</h1>
  <p class="artist">{shown?.artist ?? ""}</p>
  {#if player.error}
    <p class="error">{player.error}</p>
  {/if}
</div>

<style>
  .info {
    max-width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    --shading: glitter(0, 3px, 28px);
    transition: --shading 320ms ease;
  }
  .info.scattering {
    --shading: glitter(1, 3px, 28px);
  }
  .title {
    max-width: 100%;
    margin: 0;
    font-size: 30px;
    font-weight: 800;
    letter-spacing: -0.4px;
    color: #ffffff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .artist {
    margin: 0;
    font-size: 15px;
    color: #b3acc4;
  }
  .error {
    margin: 0;
    font-size: 12px;
    color: #f7a8d0;
  }
</style>
