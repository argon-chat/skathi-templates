<script lang="ts">
  // A dial drawn by shaders/knob.slang. Drag up and down to turn it (Shift for fine steps), roll
  // the wheel over it, use the arrow keys, or double-click to put it back where it started.
  interface Props {
    value: number;
    min: number;
    max: number;
    step?: number;
    label: string;
    /** What is shown in the middle: the number, and a unit under it. */
    show?: (value: number) => string;
    unit?: string;
    accent?: string;
    small?: boolean;
    disabled?: boolean;
    onchange?: () => void;
  }

  let {
    value = $bindable(),
    min,
    max,
    step = 1,
    label,
    show = (v) => String(Math.round(v)),
    unit = "",
    accent = "#ffb45c",
    small = false,
    disabled = false,
    onchange,
  }: Props = $props();

  // The distance in pixels that turns the dial from one end to the other.
  const TRAVEL = 180;
  const initial = value;
  let touched = $state(-1000);
  let held: { y: number; from: number } | null = null;

  const turn = $derived((value - min) / (max - min));
  const shading = $derived(`knob(${turn.toFixed(4)}, ${accent}, ${touched.toFixed(3)})`);

  function set(next: number) {
    const snapped = Math.round(Math.min(max, Math.max(min, next)) / step) * step;
    if (snapped === value) return;
    value = snapped;
    touched = performance.now() / 1000;
    onchange?.();
  }

  function down(event: PointerEvent) {
    if (disabled) return;
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    held = { y: event.clientY, from: value };
  }

  function move(event: PointerEvent) {
    if (!held) return;
    const travel = event.shiftKey ? TRAVEL * 4 : TRAVEL;
    set(held.from + ((held.y - event.clientY) / travel) * (max - min));
  }

  function wheel(event: WheelEvent) {
    if (disabled) return;
    event.preventDefault();
    set(value - Math.sign(event.deltaY) * step * (event.shiftKey ? 1 : 2));
  }

  function key(event: KeyboardEvent) {
    const by = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[event.key];
    if (!by || disabled) return;
    event.preventDefault();
    set(value + by * step);
  }
</script>

<div class="knob" class:small class:disabled>
  <div
    class="dial"
    role="slider"
    tabindex={disabled ? -1 : 0}
    aria-label={label}
    aria-valuemin={min}
    aria-valuemax={max}
    aria-valuenow={value}
    style:--shading={shading}
    onpointerdown={down}
    onpointermove={move}
    onpointerup={() => (held = null)}
    onpointercancel={() => (held = null)}
    ondblclick={() => set(initial)}
    onwheel={wheel}
    onkeydown={key}
  >
    <b>{show(value)}</b>
    {#if unit && !small}<i>{unit}</i>{/if}
  </div>
  {#if !small}<div class="ends"><span>{show(min)}</span><span>{show(max)}</span></div>{/if}
  <span class="label">{label}</span>
</div>

<style>
  .knob {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }
  .knob.disabled {
    opacity: 0.35;
  }
  .dial {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 116px;
    height: 116px;
    outline: none;
    cursor: ns-resize;
    haptic: step tick 0.2;
  }
  .small .dial {
    width: 52px;
    height: 52px;
  }
  .dial b {
    font-size: 21px;
    font-weight: 600;
    line-height: 1;
    color: var(--text);
  }
  .small .dial b {
    font-size: 11px;
  }
  .dial i {
    margin-top: 3px;
    font-size: 10px;
    font-style: normal;
    color: var(--muted);
  }
  .ends {
    display: flex;
    justify-content: space-between;
    width: 92px;
    margin-top: -16px;
    font-size: 10px;
    color: var(--muted);
  }
  .label {
    margin-top: 4px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .small .label {
    display: none;
  }
</style>
