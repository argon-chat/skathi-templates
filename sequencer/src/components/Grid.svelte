<script lang="ts">
  // Every step is one element painted by shaders/pad.slang: the key, its lamp, the flare when it
  // sounds and the light it throws on the panel.
  import Knob from "./Knob.svelte";
  import { sequencer, STEPS, type Hit, type Row, type Track } from "../lib/sequencer.svelte";

  // How full the dice make a row, by instrument.
  const DENSITY: Record<string, number> = { kick: 0.3, snare: 0.16, hat: 0.6, open: 0.1, clap: 0.14, bass: 0.34 };

  // A press on a step decides what the drag paints: on if that step was off, off if it was on.
  let painting = $state<Hit | null>(null);

  const viewed = $derived(sequencer.playing && sequencer.sounding === sequencer.pattern);

  function press(event: PointerEvent, line: Row, index: number) {
    if (index >= line.length) return;
    const hit = line.steps[index] ?? 0;
    if (event.button === 2 || event.altKey) {
      sequencer.set(line, index, hit === 2 ? 1 : 2);
      return;
    }
    painting = hit ? 0 : 1;
    sequencer.set(line, index, painting);
  }

  function enter(line: Row, index: number) {
    if (painting !== null && index < line.length) sequencer.set(line, index, painting);
  }

  function wheel(event: WheelEvent, line: Row, index: number) {
    if (!line.steps[index]) return;
    event.preventDefault();
    sequencer.set(line, index, event.deltaY < 0 ? 2 : 1);
  }

  function at(line: Row): number {
    return viewed && sequencer.tick >= 0 ? sequencer.tick % line.length : -1;
  }

  function pad(track: Track, line: Row, at: number, index: number): string {
    const hit = line.steps[index] ?? 0;
    const lamp = (hit === 2 ? 1 : hit === 1 ? 0.5 : 0) * (track.muted ? 0.35 : 1);
    const sounded = viewed && hit && !track.muted ? (sequencer.soundedAt[at]?.[index] ?? -1000) : -1000;
    const now = sequencer.tick >= 0 && viewed && sequencer.tick % line.length === index ? 1 : 0;
    return `pad(${lamp}, ${now}, ${sounded.toFixed(3)}, ${track.colour}, 10px)`;
  }
</script>

<svelte:window onpointerup={() => (painting = null)} />

<section class="grid">
  <div class="ruler">
    {#each { length: STEPS } as _, index (index)}
      <span class:bar={index % 4 === 0} class:now={viewed && sequencer.tick % STEPS === index}>{index + 1}</span>
    {/each}
  </div>
  <div class="rows">
    {#each sequencer.tracks as track, number (track.id)}
      {@const line = sequencer.rows[number]}
      {#if line}
        <div class="row">
          <button
            class="name"
            class:off={track.muted}
            style:--lamp={track.colour}
            title="Mute"
            onclick={() => (track.muted = !track.muted)}
          >
            <i></i>
            {track.name}
          </button>
          <Knob
            small
            label="{track.name} level"
            min={0}
            max={1}
            step={0.01}
            accent={track.colour}
            show={(v) => String(Math.round(v * 100))}
            bind:value={track.level}
          />
          <Knob
            small
            label="{track.name} length"
            min={1}
            max={STEPS}
            accent="#d8d2cc"
            bind:value={line.length}
            onchange={() => sequencer.save()}
          />
          <div class="steps">
            {#each line.steps as hit, index (index)}
              <button
                class="step"
                class:on={hit > 0}
                class:accent={hit === 2}
                class:bar={index % 4 === 0}
                class:out={index >= line.length}
                class:now={at(line) === index}
                style:--shading={pad(track, line, number, index)}
                aria-label="{track.name} step {index + 1}"
                aria-pressed={hit > 0}
                onpointerdown={(event) => press(event, line, index)}
                onpointerenter={() => enter(line, index)}
                onwheel={(event) => wheel(event, line, index)}
                oncontextmenu={(event) => event.preventDefault()}
              ></button>
            {/each}
          </div>
          <div class="tools">
            <button title="Turn the row one step back" onclick={() => sequencer.shift(line, -1)}>‹</button>
            <button title="Turn the row one step on" onclick={() => sequencer.shift(line, 1)}>›</button>
            <button title="Throw dice for the row" onclick={() => sequencer.scatter(line, DENSITY[track.id] ?? 0.3)}>
              ⁙
            </button>
          </div>
        </div>
      {/if}
    {/each}
  </div>
</section>

<style>
  .grid {
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex: 1;
    min-height: 0;
    padding: 8px 14px 14px;
    border-radius: 12px;
    border: 1px solid rgba(0, 0, 0, 0.8);
    background-color: rgba(0, 0, 0, 0.28);
    box-shadow:
      inset 0 2px 8px rgba(0, 0, 0, 0.7),
      0 1px 0 rgba(255, 255, 255, 0.06);
  }
  .ruler {
    display: grid;
    grid-template-columns: repeat(16, 1fr);
    gap: 8px;
    margin-left: 240px;
    margin-right: 86px;
    font-family: ui-monospace, Consolas, monospace;
    font-size: 10px;
    color: #5d554e;
  }
  .ruler span {
    display: flex;
    justify-content: center;
    padding-bottom: 3px;
    border-bottom: 2px solid #2a2522;
    transition:
      color 80ms,
      border-color 80ms;
  }
  .ruler .bar {
    margin-left: 5px;
    color: var(--muted);
    border-bottom-color: #4a423c;
  }
  .ruler .now {
    color: var(--text);
    border-bottom-color: var(--text);
  }
  .rows {
    display: flex;
    flex-direction: column;
    gap: 9px;
    flex: 1;
    min-height: 0;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1;
    min-height: 0;
    transition:
      opacity 260ms,
      translate 260ms;
    transition-delay: calc(sibling-index() * 45ms);
  }
  @starting-style {
    .row {
      opacity: 0;
      translate: -12px 0;
    }
  }
  .name {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 106px;
    height: 30px;
    padding: 0 10px;
    border: 1px solid #000;
    border-radius: 6px;
    background-image: linear-gradient(180deg, #2c2826, #1c1917);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.09);
    color: var(--text);
    font: inherit;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .name i {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background-color: var(--lamp);
    box-shadow: 0 0 8px var(--lamp);
  }
  .name.off {
    color: var(--muted);
  }
  .name.off i {
    background-color: #3a3431;
    box-shadow: none;
  }
  .steps {
    display: grid;
    grid-template-columns: repeat(16, 1fr);
    gap: 8px;
    flex: 1;
    height: 100%;
    max-height: 58px;
  }
  .step {
    padding: 0;
    border: 0;
    border-radius: 8px;
    background-color: transparent;
    transition: opacity 140ms;
    haptic: press tick 0.35;
  }
  .step.bar {
    margin-left: 5px;
  }
  .step.out {
    opacity: 0.22;
  }
  .step:active {
    transform: translateY(1px);
  }
  .tools {
    display: flex;
    gap: 3px;
    width: 76px;
  }
  .tools button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 23px;
    height: 26px;
    padding: 0;
    border: 1px solid #000;
    border-radius: 5px;
    background-image: linear-gradient(180deg, #2c2826, #1c1917);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.09);
    color: var(--muted);
    font: inherit;
    font-size: 14px;
  }
  .tools button:hover {
    color: var(--text);
  }
  .tools button:active {
    background-image: linear-gradient(180deg, #1c1917, #24201e);
  }
</style>
