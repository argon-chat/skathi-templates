<script lang="ts">
  import { inView, library, VIEWS, type View } from "../lib/library.svelte";
  import { player } from "../lib/player.svelte";
  import Icon from "./Icon.svelte";

  const count = (view: View) => player.tracks.filter((t) => inView(t, view)).length;

  const recent = $derived(
    library.recent
      .map((id) => player.tracks.findIndex((t) => t.id === id))
      .filter((i) => i >= 0)
      .slice(0, 4),
  );
</script>

<nav class="sidebar panel">
  <p class="section">Library</p>
  {#each VIEWS as view (view.id)}
    <button class="view" class:on={library.view === view.id} onclick={() => (library.view = view.id)}>
      <span class="tile {view.id}"><Icon name={view.icon} size={16} filled={view.id === "liked"} /></span>
      <span class="label">{view.label}</span>
      <span class="count">{count(view.id)}</span>
    </button>
  {/each}

  {#if recent.length}
    <p class="section">Recently played</p>
    {#each recent as i (player.tracks[i]?.id)}
      {@const track = player.tracks[i]}
      {#if track}
        <button class="recent" class:on={i === player.index} onclick={() => player.select(i)}>
          {#if track.cover}
            <img class="thumb" src={track.cover} alt="" />
          {:else}
            <span class="thumb blank"><Icon name="music" size={14} /></span>
          {/if}
          <span class="meta">
            <span class="name">{track.title}</span>
            <span class="by">{track.artist}</span>
          </span>
        </button>
      {/if}
    {/each}
  {/if}

  <div class="spacer"></div>
  <button class="add" title="mp3, ogg, flac, wav, m4a" onclick={() => player.addFiles()}>
    <Icon name="plus" size={16} />
    Add music
  </button>
</nav>

<style>
  .sidebar {
    width: 228px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 14px 10px 12px;
  }
  .section {
    margin: 0;
    padding: 6px 10px 8px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.8px;
    text-transform: uppercase;
    color: #8f88a3;
  }
  .section:not(:first-child) {
    margin-top: 14px;
  }
  .view,
  .recent {
    height: 44px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 8px;
    border: none;
    border-radius: 10px;
    background: transparent;
    color: #d6d0e4;
    text-align: left;
    cursor: pointer;
    transition: background-color 140ms ease;
  }
  .view:hover,
  .recent:hover {
    background: #ffffff0d;
  }
  .view.on {
    background: #ffffff17;
    color: #ffffff;
  }
  .tile {
    width: 30px;
    height: 30px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 10px;
    corner-shape: squircle;
    color: #ffffff;
  }
  .tile.all {
    background: linear-gradient(135deg, #c9a7f5, #9fcdf5);
  }
  .tile.liked {
    background: linear-gradient(135deg, #f7a8d0, #c9a7f5);
  }
  .tile.files {
    background: linear-gradient(135deg, #fbe0a0, #f7a8d0);
  }
  .label {
    flex: 1;
    font-size: 13px;
    font-weight: 600;
  }
  .count {
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: #8f88a3;
  }
  .thumb {
    width: 30px;
    height: 30px;
    flex-shrink: 0;
    border-radius: 10px;
    corner-shape: squircle;
    object-fit: cover;
  }
  .blank {
    display: flex;
    align-items: center;
    justify-content: center;
    background: #ffffff14;
    color: #b3acc4;
  }
  .meta {
    min-width: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .name,
  .by {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .name {
    font-size: 13px;
    font-weight: 600;
  }
  .recent.on .name {
    color: var(--accent);
  }
  .by {
    font-size: 11px;
    color: #8f88a3;
  }
  .spacer {
    flex: 1;
  }
  .add {
    height: 38px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    border: none;
    border-radius: 10px;
    background: #ffffff14;
    color: #edeaf3;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    transition: background-color 140ms ease;
  }
  .add:hover {
    background: #ffffff24;
  }
</style>
