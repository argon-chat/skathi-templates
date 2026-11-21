<script lang="ts">
  import Knob from "./Knob.svelte";
  import Meter from "./Meter.svelte";
  import { PATTERNS, sequencer, STEPS } from "../lib/sequencer.svelte";
  import { quality } from "../lib/quality.svelte";

  const GO = "#7be3a0";
  let copied = $state(false);
  let startedAt = $state(-1000);

  const lamp = $derived(
    `pad(${sequencer.playing ? 1 : 0.12}, 0, ${startedAt.toFixed(3)}, ${GO}, 14px)`,
  );
  const percent = (value: number) => String(Math.round(value * 100));
  const two = (value: number) => String(value).padStart(2, "0");
  const position = $derived(
    sequencer.tick < 0
      ? "Stopped"
      : `${PATTERNS[sequencer.sounding]} · bar ${two(Math.floor(sequencer.tick / STEPS) + 1)} · step ${two((sequencer.tick % STEPS) + 1)}`,
  );

  function bank(at: number): string {
    const shown = sequencer.pattern === at;
    const waiting = sequencer.playing && sequencer.queued === at && sequencer.sounding !== at;
    const lamp = sequencer.sounding === at && sequencer.playing ? 1 : shown ? 0.55 : waiting ? 0.3 : 0;
    return `pad(${lamp}, ${shown ? 1 : 0}, -1000, #ffb45c, 8px)`;
  }

  function toggle() {
    sequencer.toggle();
    if (sequencer.playing) startedAt = performance.now() / 1000;
  }

  async function copy() {
    await navigator.clipboard.writeText(sequencer.write());
    copied = true;
    setTimeout(() => (copied = false), 1200);
  }
</script>

<svelte:window
  onkeydown={(event) => {
    if (event.code !== "Space") return;
    event.preventDefault();
    toggle();
  }}
/>

<header class="top">
  <button class="play" class:on={sequencer.playing} style:--shading={lamp} onclick={toggle}>
    {sequencer.playing ? "Stop" : "Play"}
  </button>
  <div class="screen">
    <Meter />
    <div class="readout">
      <span>{sequencer.tempo} BPM</span>
      <span>{position}</span>
      <span>{quality.pressure}</span>
    </div>
  </div>
  <div class="keys">
    <button class="key" class:on={quality.tier !== "auto"} onclick={() => quality.next()}>
      Effects: {quality.tier}
    </button>
    <button class="key" onclick={() => sequencer.clear()}>Clear</button>
    <button class="key" onclick={copy}>{copied ? "Copied" : "Copy pattern"}</button>
  </div>
</header>

<section class="knobs">
  <div class="bank">
    <div class="slots">
      {#each PATTERNS as name, at (name)}
        <button
          class="slot"
          class:shown={sequencer.pattern === at}
          style:--shading={bank(at)}
          aria-label="Pattern {name}"
          aria-pressed={sequencer.pattern === at}
          onclick={() => sequencer.select(at)}
        >
          {name}
        </button>
      {/each}
    </div>
    <div class="pair">
      <button class="key" class:on={sequencer.chain} title="Play the patterns one after another" onclick={() => (sequencer.chain = !sequencer.chain)}>
        Chain
      </button>
      <button class="key" title="Copy this pattern into the next slot" onclick={() => sequencer.duplicate()}>Copy →</button>
    </div>
    <span class="label">Pattern</span>
  </div>
  <span class="gap"></span>
  <Knob
    label="Tempo"
    unit="BPM"
    min={60}
    max={200}
    bind:value={sequencer.tempo}
    onchange={() => sequencer.save()}
  />
  <Knob
    label="Swing"
    unit="%"
    min={0}
    max={0.5}
    step={0.01}
    show={percent}
    bind:value={sequencer.swing}
    onchange={() => sequencer.save()}
  />
  <span class="gap"></span>
  <Knob label="Drive" unit="%" min={0} max={1} step={0.01} show={percent} accent="#ff6b5c" bind:value={sequencer.drive} />
  <Knob label="Echo" unit="%" min={0} max={0.7} step={0.01} show={percent} accent="#6bc5ff" bind:value={sequencer.echo} />
  <Knob label="Room" unit="%" min={0} max={0.6} step={0.01} show={percent} accent="#b48cff" bind:value={sequencer.reverb} />
  <span class="gap"></span>
  <Knob label="Volume" unit="%" min={0} max={1} step={0.01} show={percent} accent="#7be3a0" bind:value={sequencer.volume} />
</section>

<style>
  .top {
    display: flex;
    align-items: center;
    gap: 18px;
  }
  .bank {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding-top: 10px;
  }
  .slots {
    display: flex;
    gap: 8px;
  }
  .slot {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    padding: 0;
    border: 0;
    border-radius: 8px;
    background-color: transparent;
    color: var(--muted);
    font: inherit;
    font-size: 14px;
    font-weight: 700;
    haptic: press tick 0.35;
  }
  .slot.shown {
    color: var(--ink);
  }
  .pair {
    display: flex;
    gap: 8px;
  }
  .pair .key {
    width: 96px;
  }
  .label {
    margin-top: 5px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .play {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 96px;
    height: 64px;
    border: 0;
    border-radius: 12px;
    background-color: transparent;
    color: var(--muted);
    font: inherit;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    haptic: activate pattern(--start) 0.6;
  }
  .play.on {
    color: var(--ink);
  }
  .play:active {
    transform: translateY(1px);
  }
  .screen {
    position: relative;
    flex: 1;
    height: 76px;
    border-radius: 10px;
    border: 1px solid #000;
    background-image: linear-gradient(180deg, #060707, #0d0f10);
    box-shadow:
      inset 0 2px 6px rgba(0, 0, 0, 0.9),
      0 1px 0 rgba(255, 255, 255, 0.07);
    overflow: hidden;
  }
  /* The glass in front of the display. */
  .screen::after {
    content: "";
    position: absolute;
    inset: 0;
    background-image: linear-gradient(168deg, rgba(255, 255, 255, 0.09) 0%, rgba(255, 255, 255, 0.02) 38%, transparent 39%);
    pointer-events: none;
  }
  .readout {
    position: absolute;
    top: 7px;
    left: 12px;
    right: 12px;
    display: flex;
    justify-content: space-between;
    font-family: ui-monospace, Consolas, monospace;
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(255, 200, 140, 0.6);
  }
  .keys {
    display: flex;
    flex-direction: column;
    gap: 5px;
    width: 130px;
  }
  .key {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 22px;
    border: 1px solid #000;
    border-radius: 5px;
    background-image: linear-gradient(180deg, #2c2826, #1c1917);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.09);
    color: var(--muted);
    font: inherit;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .key:hover {
    color: var(--text);
  }
  .key:active {
    background-image: linear-gradient(180deg, #1c1917, #24201e);
  }
  .key.on {
    color: var(--accent);
  }
  .knobs {
    display: flex;
    align-items: flex-start;
    justify-content: center;
    gap: 26px;
    padding: 6px 0 2px;
  }
  .gap {
    width: 1px;
    height: 96px;
    margin: 4px 6px 0;
    background-image: linear-gradient(180deg, transparent, rgba(255, 255, 255, 0.1), transparent);
  }
</style>
