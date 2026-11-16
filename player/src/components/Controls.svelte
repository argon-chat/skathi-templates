<script lang="ts">
  import { hearts } from "../lib/fx.svelte";
  import { player } from "../lib/player.svelte";
  import { clock } from "../lib/tracks";
  import Icon from "./Icon.svelte";
  import Slider from "./Slider.svelte";

  let scrub = $state<number | null>(null);
  const shownTime = $derived(scrub ?? player.position);
  const volumeIcon = $derived(
    player.muted || player.volume === 0 ? "mute" : player.volume < 0.5 ? "volumeLow" : "volume",
  );
  const track = $derived(player.current);
  const liked = $derived(track ? player.liked.has(track.id) : false);

  function like(e: MouseEvent) {
    if (!track) return;
    if (player.toggleLike(track.id) && e.currentTarget instanceof Element) hearts(e.currentTarget);
  }
</script>

<footer class="bar">
  <div class="now">
    {#if track?.cover}
      <img class="art" src={track.cover} alt="" />
    {:else}
      <span class="art blank"><Icon name="music" size={18} /></span>
    {/if}
    <div class="meta">
      <span class="name">{track?.title ?? ""}</span>
      <span class="by">{track?.artist ?? ""}</span>
    </div>
    <button class="like" class:liked onclick={like} title={liked ? "Unlike" : "Like"} aria-pressed={liked}>
      <Icon name="heart" size={18} filled={liked} />
    </button>
  </div>

  <div class="center">
    <div class="buttons">
      <button
        class="tool"
        class:on={player.shuffle}
        title="Shuffle"
        aria-pressed={player.shuffle}
        onclick={() => {
          player.shuffle = !player.shuffle;
          player.save();
        }}
      >
        <Icon name="shuffle" size={16} />
      </button>
      <button class="tool" title="Previous (P)" onclick={() => player.previous()}>
        <Icon name="prev" size={18} />
      </button>
      <button
        class="play"
        class:playing={player.playing}
        title={player.playing ? "Pause (Space)" : "Play (Space)"}
        onclick={() => player.toggle()}
      >
        {#if player.loading}
          <span class="spinner"></span>
        {:else}
          <Icon name={player.playing ? "pause" : "play"} size={20} />
        {/if}
      </button>
      <button class="tool" title="Next (N)" onclick={() => player.next()}>
        <Icon name="next" size={18} />
      </button>
      <button
        class="tool"
        class:on={player.repeat !== "off"}
        title="Repeat: {player.repeat}"
        onclick={() => player.cycleRepeat()}
      >
        <Icon name={player.repeat === "one" ? "repeatOne" : "repeat"} size={16} />
      </button>
    </div>
    <div class="seek">
      <span class="time">{clock(shownTime)}</span>
      <Slider
        label="Seek"
        value={player.position}
        max={player.duration || 1}
        oninput={(v) => (scrub = v)}
        onchange={(v) => {
          scrub = null;
          player.seek(v);
        }}
      />
      <span class="time">{clock(track?.duration ?? null)}</span>
    </div>
  </div>

  <div class="volume">
    <button class="tool" title={player.muted ? "Unmute" : "Mute"} onclick={() => player.toggleMute()}>
      <Icon name={volumeIcon} size={16} />
    </button>
    <Slider
      label="Volume"
      value={player.muted ? 0 : player.volume}
      oninput={(v) => player.setVolume(v)}
      onchange={(v) => player.setVolume(v)}
    />
  </div>
</footer>

<style>
  .bar {
    height: 84px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 0 20px;
    --shading: jelly(24px, 0px, 1px, #121118d9);
  }
  .now {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .art {
    width: 52px;
    height: 52px;
    flex-shrink: 0;
    border-radius: 8px;
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
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .name,
  .by {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .name {
    font-size: 14px;
    font-weight: 700;
    color: #ffffff;
  }
  .by {
    font-size: 12px;
    color: #9d96b0;
  }
  .center {
    width: 46%;
    max-width: 560px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }
  .buttons {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .seek {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .time {
    width: 34px;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    color: #9d96b0;
    text-align: center;
  }
  .volume {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
  }
  .volume :global(.slider) {
    max-width: 120px;
  }
  .tool,
  .like {
    width: 32px;
    height: 32px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 16px;
    background: transparent;
    color: #b3acc4;
    cursor: pointer;
    transition:
      color 140ms ease,
      transform 140ms ease;
  }
  .tool:hover,
  .like:hover {
    color: #ffffff;
  }
  .tool:active,
  .like:active {
    transform: scale(0.9);
  }
  .tool.on,
  .like.liked {
    color: var(--accent);
  }
  .play {
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 18px;
    background: #ffffff;
    color: #17161e;
    cursor: pointer;
    transition: transform 140ms ease;
  }
  .play:hover {
    transform: scale(1.06);
  }
  .play:active {
    transform: scale(0.94);
  }
  .spinner {
    width: 16px;
    height: 16px;
    border-radius: 8px;
    border: 2px solid #17161e33;
    border-top-color: #17161e;
    animation: spin 700ms linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
