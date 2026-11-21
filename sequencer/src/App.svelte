<script lang="ts">
  import Grid from "./components/Grid.svelte";
  import TitleBar from "./components/TitleBar.svelte";
  import Transport from "./components/Transport.svelte";
  import { quality } from "./lib/quality.svelte";
  import { sequencer } from "./lib/sequencer.svelte";

  let dragging = $state(0);
  let problem = $state("");

  const plate = $derived(`plate(${sequencer.kickAt.toFixed(3)}, #ff6b5c)`);

  function over(event: DragEvent) {
    if (!event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  // A pattern is a small TOML file: dropping one on the window opens it.
  async function drop(event: DragEvent) {
    dragging = 0;
    const file = event.dataTransfer?.files[0];
    if (!file) return;
    event.preventDefault();
    try {
      sequencer.read(await file.text());
      sequencer.save();
      problem = "";
    } catch (error) {
      problem = `${file.name}: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
</script>

<main
  class="app"
  class:dragging={dragging > 0}
  style:--shading={plate}
  style:effect-quality={quality.tier}
  ondragenter={() => dragging++}
  ondragleave={() => dragging--}
  ondragover={over}
  ondrop={drop}
>
  <TitleBar />
  <div class="deck">
    <Transport />
    <Grid />
  <footer class="hint">
    {#if problem}
      <span class="problem">{problem}</span>
    {:else}
      <span>
        Space plays and stops. Drag a dial up and down, or roll the wheel over it; double-click puts it back. Drag
        across a row to paint steps; right-click or roll the wheel on a step for an accent. Drop a pattern file on the window to open it.
      </span>
    {/if}
  </footer>
  </div>
</main>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .deck {
    display: flex;
    flex-direction: column;
    gap: 12px;
    flex: 1;
    min-height: 0;
    padding: 14px 22px 10px;
  }
  .app.dragging {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .hint {
    color: var(--muted);
    font-size: 11px;
  }
  .problem {
    color: var(--danger);
  }
</style>
