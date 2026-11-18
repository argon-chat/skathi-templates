<script lang="ts">
  import { flip } from "svelte/animate";
  import { cubicOut } from "svelte/easing";
  import { fly } from "svelte/transition";
  import { inView, library, VIEWS } from "../lib/library.svelte";
  import { player } from "../lib/player.svelte";
  import { clock, seedOf } from "../lib/tracks";
  import Icon from "./Icon.svelte";

  const label = $derived(VIEWS.find((v) => v.id === library.view)?.label ?? "");
  const shown = $derived(player.tracks.filter((t) => inView(t, library.view)));
  const total = $derived(shown.reduce((sum, t) => sum + (t.duration ?? 0), 0));
</script>

<aside class="playlist panel">
  <header class="head">
    <h2 class="heading">{label}</h2>
    <p class="count">
      {shown.length}
      {shown.length === 1 ? "song" : "songs"}{total ? ` · ${clock(total)}` : ""}
    </p>
  </header>

  <ul class="list">
    {#each shown as track (track.id)}
      {@const i = player.tracks.indexOf(track)}
      <li class="item" in:fly={{ y: 12, duration: 260 }} animate:flip={{ duration: 280, easing: cubicOut }}>
        <div
          class="row"
          class:current={i === player.index}
          onclick={() => (i === player.index ? player.toggle() : player.select(i))}
          onkeydown={(e) => e.key === "Enter" && player.select(i)}
          role="button"
          tabindex="0"
        >
          <div class="thumb">
            {#if track.cover}
              <img class="thumb-art" src={track.cover} alt="" />
            {:else}
              <div
                class="thumb-art"
                style:--shading="cover({seedOf(track.id).toFixed(2)}, {track.palette.first}, {track.palette.second}, {track
                  .palette.accent})"
              ></div>
            {/if}
            {#if i === player.index}
              <div class="eq" class:paused={!player.playing}>
                <span></span><span></span><span></span>
              </div>
            {/if}
          </div>
          <div class="meta">
            <span class="name">{track.title}</span>
            <span class="by"
              >{#if player.liked.has(track.id)}<span class="heart"><Icon name="heart" size={11} /></span
                >{/if}{track.artist}</span
            >
          </div>
          {#if typeof track.source !== "string"}
            <button
              class="remove"
              title="Remove from the playlist"
              onclick={(e) => {
                e.stopPropagation();
                player.remove(i);
              }}
            >
              <Icon name="close" size={14} />
            </button>
          {/if}
          <span class="length">{clock(track.duration)}</span>
        </div>
      </li>
    {/each}
  </ul>
  {#if !shown.length}
    <p class="empty">
      {library.view === "liked"
        ? "Songs you like with ♥ show up here."
        : "Music you add from your computer shows up here."}
    </p>
  {/if}
</aside>

<style>
  .playlist {
    width: 320px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    padding: 16px 10px 10px;
  }
  .head {
    padding: 0 10px 12px;
  }
  .heading {
    margin: 0;
    font-size: 17px;
    font-weight: 800;
    color: #ffffff;
  }
  .count {
    margin: 3px 0 0;
    font-size: 12px;
    color: #9d96b0;
  }
  .list {
    flex: 1;
    min-height: 0;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow-y: auto;
  }
  .item {
    flex-shrink: 0;
    list-style: none;
  }
  .row {
    position: relative;
    height: 56px;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 10px;
    border-radius: 10px;
    cursor: pointer;
    transition: background-color 140ms ease;
  }
  .row:hover {
    background: #ffffff0f;
  }
  .row.current {
    background: #ffffff17;
    box-shadow: inset 0 0 0 1px #ffffff1a;
  }
  .thumb {
    position: relative;
    width: 44px;
    height: 44px;
    flex-shrink: 0;
    border-radius: 14px;
    corner-shape: squircle;
    overflow: hidden;
    background: #2b2836;
  }
  .thumb-art {
    width: 44px;
    height: 44px;
    object-fit: cover;
  }
  .eq {
    position: absolute;
    left: 0;
    top: 0;
    right: 0;
    bottom: 0;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    gap: 3px;
    padding-bottom: 12px;
    background: #17161e8c;
  }
  .eq span {
    width: 4px;
    height: 18px;
    border-radius: 2px;
    background: var(--accent);
    animation: bounce 900ms ease-in-out infinite;
  }
  .eq span:nth-child(2) {
    animation-delay: 200ms;
    animation-duration: 700ms;
  }
  .eq span:nth-child(3) {
    animation-delay: 400ms;
    animation-duration: 1100ms;
  }
  .eq.paused span {
    animation: none;
    height: 6px;
  }
  @keyframes bounce {
    0%,
    100% {
      height: 6px;
    }
    50% {
      height: 20px;
    }
  }
  .meta {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .name {
    font-size: 14px;
    font-weight: 700;
    color: #edeaf3;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .row.current .name {
    color: var(--accent);
  }
  .by {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: #9d96b0;
    white-space: nowrap;
    overflow: hidden;
  }
  .heart {
    display: flex;
    color: #f7a8d0;
  }
  .length {
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: #9d96b0;
  }
  .remove {
    width: 26px;
    height: 26px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 13px;
    background: transparent;
    color: #9d96b0;
    cursor: pointer;
    opacity: 0;
    transition: opacity 120ms ease;
  }
  .row:hover .remove {
    opacity: 1;
  }
  .remove:hover {
    background: #ffffff1a;
    color: #ffffff;
  }
  .empty {
    margin: 0;
    padding: 24px 16px;
    font-size: 13px;
    line-height: 1.5;
    text-align: center;
    color: #8f88a3;
  }
</style>
