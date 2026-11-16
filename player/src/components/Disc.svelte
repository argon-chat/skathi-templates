<script lang="ts">
  import { BANDS, player } from "../lib/player.svelte";
  import { seedOf } from "../lib/tracks";

  let { accent, room }: { accent: string; room: number } = $props();

  const COVER = 236;
  const INNER = 126;
  const REACH = 96;
  const MARGIN = 16;

  const fit = $derived(Math.min(1, Math.max(0.5, room / (2 * (INNER + REACH + MARGIN)))));
  const inner = $derived(Math.round(INNER * fit));
  const reach = $derived(Math.round(REACH * fit));
  const cover = $derived(Math.round(COVER * fit));
  const size = $derived(2 * (inner + reach + MARGIN));

  const levels = new Float32Array(BANDS);
  let shading = $state("");
  let kick = -1000;
  let bassAverage = 0;
  let pulse = $state(0);

  function spectrum(now: number) {
    const values = Array.from(levels, (v) => v.toFixed(3)).join(", ");
    return `spectrum(${values}, ${inner}px, ${reach}px, ${now.toFixed(3)}, ${kick.toFixed(3)}, ${accent})`;
  }

  $effect(() => {
    if (!player.playing) {
      levels.fill(0);
      pulse = 0;
      shading = spectrum(performance.now() / 1000);
      return;
    }
    let frame = requestAnimationFrame(function step() {
      const now = performance.now() / 1000;
      player.levels(levels);
      const bass = ((levels[0] ?? 0) + (levels[1] ?? 0) + (levels[2] ?? 0)) / 3;
      if (bass > bassAverage * 1.3 + 0.12 && now - kick > 0.22) kick = now;
      bassAverage += (bass - bassAverage) * 0.08;
      pulse = bass;
      shading = spectrum(now);
      frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  });

  const track = $derived(player.current);
  const art = $derived(
    track && !track.cover
      ? `cover(${seedOf(track.id).toFixed(2)}, ${track.palette.first}, ${track.palette.second}, ${track.palette.accent})`
      : "",
  );
</script>

<div class="disc" style:width="{size}px" style:height="{size}px" style:--shading={shading}>
  <div
    class="cover"
    class:playing={player.playing}
    style:width="{cover}px"
    style:height="{cover}px"
    style:border-radius="{cover / 2}px"
    style:transform="scale({player.playing ? 1 + pulse * 0.035 : 0.94})"
    style:--shading={art}
  >
    {#if track?.cover}
      {#key track.cover}
        <img class="art" src={track.cover} alt={track.title} />
      {/key}
    {:else}
      <img class="wolf" src="assets/wolf.svg" alt="" />
    {/if}
  </div>
</div>

<style>
  .disc {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .cover {
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #211f2a;
    border: 3px solid #ffffff2e;
    box-shadow: 0 18px 48px #00000080;
    transition:
      --shading 900ms ease,
      transform 120ms ease-out;
  }
  .art {
    width: 100%;
    height: 100%;
    object-fit: cover;
    animation: arrive 600ms ease;
  }
  @keyframes arrive {
    from {
      opacity: 0;
      transform: scale(1.08);
    }
  }
  .wolf {
    width: 74px;
    height: 74px;
  }
</style>
