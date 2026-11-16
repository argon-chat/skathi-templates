// The player: a Web Audio graph (buffer source -> analyser -> gain -> speakers) behind rune state the
// components read. Tracks are decoded whole with decodeAudioData, so seeking is starting a new source at an
// offset, and the analyser before the gain shows the music whatever the volume.

import { SvelteSet } from "svelte/reactivity";
import { AUDIO_TYPES, DEMO, fileTrack, type Track } from "./tracks";

export type Repeat = "off" | "all" | "one";

export const BANDS = 24;
const KEEP_DECODED = 3;
const SETTINGS = "player.settings";

interface Settings {
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: Repeat;
  liked: string[];
}

function loadSettings(): Partial<Settings> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(SETTINGS) ?? "{}");
    return typeof raw === "object" && raw !== null ? (raw as Partial<Settings>) : {};
  } catch {
    return {};
  }
}

class Player {
  tracks = $state<Track[]>(DEMO.map((t) => ({ ...t })));
  index = $state(0);
  playing = $state(false);
  loading = $state(false);
  error = $state("");
  position = $state(0);
  volume = $state(0.8);
  muted = $state(false);
  shuffle = $state(false);
  repeat = $state<Repeat>("all");
  liked = new SvelteSet<string>();

  current = $derived(this.tracks[this.index] ?? null);
  duration = $derived(this.current?.duration ?? 0);

  #ctx: AudioContext | null = null;
  #gain: GainNode | null = null;
  #tap: AnalyserNode | null = null;
  #bins = new Uint8Array(0);
  #hi = new Float32Array(BANDS);
  #lo = new Float32Array(BANDS).fill(1);
  #source: AudioBufferSourceNode | null = null;
  #zero = 0;
  #decoded = new Map<string, Promise<AudioBuffer>>();
  #request = 0;
  #frame = 0;

  constructor() {
    const saved = loadSettings();
    if (typeof saved.volume === "number") this.volume = Math.min(1, Math.max(0, saved.volume));
    if (typeof saved.muted === "boolean") this.muted = saved.muted;
    if (typeof saved.shuffle === "boolean") this.shuffle = saved.shuffle;
    if (saved.repeat === "off" || saved.repeat === "all" || saved.repeat === "one") this.repeat = saved.repeat;
    for (const id of saved.liked ?? []) if (typeof id === "string") this.liked.add(id);
    this.#mediaSession();
  }

  save() {
    const settings: Settings = {
      volume: this.volume,
      muted: this.muted,
      shuffle: this.shuffle,
      repeat: this.repeat,
      liked: [...this.liked],
    };
    try {
      localStorage.setItem(SETTINGS, JSON.stringify(settings));
    } catch {
      // Settings are a nicety; a full or missing store just forgets them.
    }
  }

  #engine() {
    if (this.#ctx && this.#gain && this.#tap) return { ctx: this.#ctx, gain: this.#gain, tap: this.#tap };
    const ctx = new AudioContext();
    const gain = ctx.createGain();
    const tap = ctx.createAnalyser();
    tap.fftSize = 2048;
    tap.smoothingTimeConstant = 0.4;
    tap.minDecibels = -90;
    tap.maxDecibels = -12;
    tap.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.value = this.#loudness();
    this.#bins = new Uint8Array(tap.frequencyBinCount);
    this.#ctx = ctx;
    this.#gain = gain;
    this.#tap = tap;
    return { ctx, gain, tap };
  }

  #loudness() {
    return this.muted ? 0 : this.volume * this.volume;
  }

  #decode(track: Track): Promise<AudioBuffer> {
    let pending = this.#decoded.get(track.id);
    if (!pending) {
      const { ctx } = this.#engine();
      pending = (async () => {
        const bytes =
          typeof track.source === "string"
            ? await fetch(track.source).then((res) => {
                if (!res.ok) throw new Error(`${track.source}: ${res.status} ${res.statusText}`);
                return res.arrayBuffer();
              })
            : await track.source.arrayBuffer();
        return ctx.decodeAudioData(bytes);
      })();
      this.#decoded.set(track.id, pending);
      pending.catch(() => this.#decoded.delete(track.id));
      // Decoded audio is large (a few minutes of stereo is ~100 MB), so only the latest few stay.
      for (const id of this.#decoded.keys()) {
        if (this.#decoded.size <= KEEP_DECODED) break;
        if (id !== track.id) this.#decoded.delete(id);
      }
    }
    return pending;
  }

  #stopSource() {
    const source = this.#source;
    this.#source = null;
    if (!source) return;
    source.onended = null;
    try {
      source.stop();
    } catch {
      // Already ended.
    }
    source.disconnect();
  }

  async play(at = this.position) {
    const track = this.current;
    if (!track) return;
    const request = ++this.#request;
    const { ctx, tap } = this.#engine();
    this.loading = true;
    this.error = "";
    let buffer: AudioBuffer;
    try {
      if (ctx.state !== "running") await ctx.resume();
      buffer = await this.#decode(track);
    } catch (e) {
      if (request === this.#request) {
        this.loading = false;
        this.playing = false;
        this.error = `Could not play ${track.title}: ${e instanceof Error ? e.message : String(e)}`;
      }
      return;
    }
    if (request !== this.#request) return;
    track.duration = buffer.duration;
    this.#stopSource();
    const from = Math.min(Math.max(at, 0), Math.max(buffer.duration - 0.05, 0));
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(tap);
    source.onended = () => {
      if (this.#source === source) this.#ended();
    };
    source.start(0, from);
    this.#source = source;
    this.#zero = ctx.currentTime - from;
    this.position = from;
    this.loading = false;
    this.playing = true;
    this.#tick();
    this.#publish();
  }

  pause() {
    if (!this.playing) return;
    ++this.#request;
    this.position = this.#now();
    this.#stopSource();
    this.playing = false;
    this.loading = false;
    cancelAnimationFrame(this.#frame);
    this.#publish();
  }

  close() {
    this.pause();
    void this.#ctx?.close();
    this.#ctx = null;
    this.#gain = null;
    this.#tap = null;
    this.#decoded.clear();
  }

  toggle() {
    if (this.playing || this.loading) this.pause();
    else void this.play();
  }

  seek(seconds: number) {
    this.position = Math.min(Math.max(seconds, 0), this.duration || 0);
    if (this.playing) void this.play(this.position);
    else this.#publish();
  }

  select(index: number, start = true) {
    if (index < 0 || index >= this.tracks.length) return;
    this.index = index;
    this.position = 0;
    if (start || this.playing) void this.play(0);
    else this.#publish();
  }

  next(automatic = false) {
    const count = this.tracks.length;
    if (!count) return;
    if (automatic && this.repeat === "one") return void this.play(0);
    let index = this.index + 1;
    if (this.shuffle && count > 1) {
      do index = Math.floor(Math.random() * count);
      while (index === this.index);
    } else if (index >= count) {
      if (automatic && this.repeat === "off") {
        this.pause();
        this.position = 0;
        return;
      }
      index = 0;
    }
    this.select(index, automatic || this.playing);
  }

  previous() {
    if (this.#now() > 3) return this.seek(0);
    const count = this.tracks.length;
    this.select((this.index - 1 + count) % count, this.playing);
  }

  cycleRepeat() {
    this.repeat = this.repeat === "off" ? "all" : this.repeat === "all" ? "one" : "off";
    this.save();
  }

  setVolume(volume: number) {
    this.volume = Math.min(1, Math.max(0, volume));
    if (this.volume > 0) this.muted = false;
    this.#applyVolume();
  }

  toggleMute() {
    this.muted = !this.muted;
    this.#applyVolume();
  }

  #applyVolume() {
    if (this.#ctx && this.#gain) this.#gain.gain.setTargetAtTime(this.#loudness(), this.#ctx.currentTime, 0.03);
    this.save();
  }

  toggleLike(id: string) {
    if (this.liked.has(id)) this.liked.delete(id);
    else this.liked.add(id);
    this.save();
    return this.liked.has(id);
  }

  async addFiles() {
    let handles: FileSystemFileHandle[];
    try {
      handles = await showOpenFilePicker({
        id: "music",
        multiple: true,
        types: [{ description: "Music", accept: { "audio/*": AUDIO_TYPES } }],
      });
    } catch {
      return;
    }
    const files = await Promise.all(handles.map((h) => h.getFile()));
    const first = this.tracks.length;
    this.tracks.push(...files.map(fileTrack));
    if (files.length) this.select(first);
  }

  remove(index: number) {
    const track = this.tracks[index];
    if (!track || typeof track.source === "string") return;
    this.#decoded.delete(track.id);
    if (index === this.index) {
      this.pause();
      this.tracks.splice(index, 1);
      this.index = Math.min(index, this.tracks.length - 1);
      this.position = 0;
    } else {
      this.tracks.splice(index, 1);
      if (index < this.index) this.index--;
    }
  }

  /** The analyser's spectrum in `out.length` bands, 0..1, bass first, spaced evenly in pitch. */
  levels(out: Float32Array) {
    out.fill(0);
    const ctx = this.#ctx;
    const tap = this.#tap;
    if (!ctx || !tap || !this.playing) return;
    tap.getByteFrequencyData(this.#bins);
    const bins = this.#bins;
    const hzPerBin = ctx.sampleRate / tap.fftSize;
    const low = 45;
    const high = 14000;
    for (let i = 0; i < out.length; i++) {
      const from = low * (high / low) ** (i / out.length);
      const to = low * (high / low) ** ((i + 1) / out.length);
      const a = Math.floor(from / hzPerBin);
      const b = Math.max(a + 1, Math.ceil(to / hzPerBin));
      let peak = 0;
      for (let k = a; k < b && k < bins.length; k++) peak = Math.max(peak, bins[k] ?? 0);
      // Each band is measured within its own recent range, so it jumps on every hit however loud the mix.
      const level = Math.max(0, (peak / 255 - 0.2) / 0.8);
      const hi = Math.max(level, (this.#hi[i] ?? 0) - 0.005);
      const lo = Math.min(level, (this.#lo[i] ?? 1) + 0.005);
      this.#hi[i] = hi;
      this.#lo[i] = lo;
      const swing = (level - lo) / Math.max(hi - lo, 0.2);
      out[i] = Math.min(1, swing ** 1.3 * (0.35 + 0.65 * Math.min(1, level / 0.7)));
    }
  }

  #now() {
    return this.playing && this.#ctx ? this.#ctx.currentTime - this.#zero : this.position;
  }

  #tick() {
    cancelAnimationFrame(this.#frame);
    const step = () => {
      if (!this.playing) return;
      this.position = Math.min(this.#now(), this.duration || Infinity);
      this.#frame = requestAnimationFrame(step);
    };
    this.#frame = requestAnimationFrame(step);
  }

  #ended() {
    this.#source = null;
    this.playing = false;
    this.position = this.duration;
    this.next(true);
  }

  #publish() {
    const session = navigator.mediaSession;
    const track = this.current;
    if (!session || !track) return;
    session.playbackState = this.playing ? "playing" : "paused";
    session.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album,
      artwork: track.cover ? [{ src: track.cover, sizes: "640x640", type: "image/jpeg" }] : [],
    });
    if (this.duration > 0)
      session.setPositionState({ duration: this.duration, position: Math.min(this.position, this.duration) });
  }

  #mediaSession() {
    const session = navigator.mediaSession;
    if (!session) return;
    session.setActionHandler("play", () => void this.play());
    session.setActionHandler("pause", () => this.pause());
    session.setActionHandler("nexttrack", () => this.next());
    session.setActionHandler("previoustrack", () => this.previous());
    session.setActionHandler("seekto", (details) => {
      if (details.seekTime !== undefined) this.seek(details.seekTime);
    });
  }
}

export const player = new Player();

// An edit to this module under `sk dev` builds a new player; the old one's audio must not play on.
import.meta.hot?.dispose(() => player.close());
