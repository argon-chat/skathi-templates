<script lang="ts">
  import { burst } from "../lib/fx.svelte";

  const shading = $derived(`hearts(${burst.x.toFixed(4)}, ${burst.y.toFixed(4)}, ${burst.born.toFixed(3)})`);
</script>

<div class="hearts" style:--shading={shading}></div>

<style>
  .hearts {
    position: absolute;
    left: 0;
    top: 0;
    right: 0;
    bottom: 0;
    z-index: 50;
    pointer-events: none;
  }
</style>
