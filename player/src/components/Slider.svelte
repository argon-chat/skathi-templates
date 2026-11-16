<script lang="ts">
  let {
    value,
    max = 1,
    label,
    onchange,
    oninput,
  }: {
    value: number;
    max?: number;
    label: string;
    onchange: (value: number) => void;
    oninput?: (value: number) => void;
  } = $props();

  let rail = $state<HTMLDivElement>();
  let dragging = $state<number | null>(null);
  let focused = $state(false);
  const shown = $derived(dragging ?? value);
  const ratio = $derived(max > 0 ? Math.min(1, Math.max(0, shown / max)) : 0);

  function at(e: MouseEvent) {
    const box = rail?.getBoundingClientRect();
    if (!box?.width) return value;
    return Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)) * max;
  }

  function move(e: MouseEvent) {
    dragging = at(e);
    oninput?.(dragging);
  }

  function up(e: MouseEvent) {
    document.removeEventListener("mousemove", move);
    document.removeEventListener("mouseup", up);
    const v = at(e);
    dragging = null;
    onchange(v);
  }

  function down(e: MouseEvent) {
    if (e.button !== 0) return;
    move(e);
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }

  function key(e: KeyboardEvent) {
    const step = max / 20;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") onchange(Math.min(max, value + step));
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") onchange(Math.max(0, value - step));
    else return;
    e.preventDefault();
    e.stopPropagation();
  }
</script>

<div
  class="slider"
  class:dragging={dragging !== null}
  class:focused
  role="slider"
  tabindex="0"
  aria-label={label}
  aria-valuemin={0}
  aria-valuemax={max}
  aria-valuenow={shown}
  onmousedown={down}
  onkeydown={key}
  onfocus={() => (focused = true)}
  onblur={() => (focused = false)}
>
  <div class="rail" bind:this={rail}>
    <div class="fill" style:width="{ratio * 100}%"></div>
  </div>
  <div class="thumb" style:left="{ratio * 100}%"></div>
</div>

<style>
  .slider {
    position: relative;
    flex: 1;
    height: 22px;
    display: flex;
    align-items: center;
    cursor: pointer;
  }
  .rail {
    position: relative;
    width: 100%;
    height: 4px;
    border-radius: 2px;
    background: #ffffff1f;
    overflow: hidden;
  }
  .fill {
    height: 100%;
    border-radius: 2px;
    background: linear-gradient(90deg, #c9a7f5, var(--accent, #f7a8d0));
  }
  .thumb {
    position: absolute;
    top: 4px;
    width: 14px;
    height: 14px;
    margin-left: -7px;
    border-radius: 7px;
    background: #ffffff;
    border: 2px solid var(--accent, #f7a8d0);
    box-shadow: 0 2px 8px #00000066;
    transform: scale(0);
    transition: transform 140ms ease;
  }
  .slider:hover .thumb,
  .slider.focused .thumb,
  .slider.dragging .thumb {
    transform: scale(1);
  }
  .slider:hover .rail,
  .slider.dragging .rail {
    height: 6px;
  }
</style>
