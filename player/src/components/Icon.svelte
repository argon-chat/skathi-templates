<script lang="ts">
  import { FILLED, icons, type IconName } from "../lib/icons";

  let { name, size = 20, filled = FILLED.has(name) }: { name: IconName; size?: number; filled?: boolean } = $props();
</script>

<svg
  class="icon"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill={filled ? "currentColor" : "none"}
  stroke={filled ? "none" : "currentColor"}
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d={icons[name]} />
</svg>

<style>
  .icon {
    flex-shrink: 0;
  }
</style>
