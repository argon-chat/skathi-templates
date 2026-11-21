<script lang="ts">
  // The meter is one element painted by shaders/meter.slang. The page hands it sixteen levels a
  // frame through `--shading`; the bars, the bloom and the kick flash are drawn on the GPU.
    import { BANDS, sequencer } from "../lib/sequencer.svelte";

  const ACCENT = "#ffb45c";
  const levels = new Float32Array(BANDS);
  let shading = $state(meter());

  function meter(): string {
    const values = Array.from(levels, (level) => level.toFixed(3)).join(", ");
    return `meter(${values}, ${sequencer.kickAt.toFixed(3)}, ${ACCENT})`;
  }

  $effect(() => {
    if (!sequencer.playing) {
      levels.fill(0);
      shading = meter();
      return;
    }
    let frame = requestAnimationFrame(function step() {
      sequencer.frame(levels);
      shading = meter();
      frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  });
</script>

<div class="meter" style:--shading={shading}></div>

<style>
  .meter {
    position: absolute;
    inset: 22px 10px 6px;
  }

  /* On battery saver or a hot CPU the meter is not worth a shader at all. */
  @media (currently-power-scheme: saving), (currently-compute-pressure: critical) {
    .meter {
      --shading: none !important;
    }
  }
</style>
