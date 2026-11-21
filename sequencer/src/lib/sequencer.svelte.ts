// The patterns, the clock that plays them and the audio graph they play into.
//
// Notes are not started by a timer. A timer only looks a little way ahead and hands every step in
// that window to the audio clock (`start(time)`), which is exact; the timer itself may run late.

import { TOML } from "skathi:toml";
import { Frequency } from "skathi:units";
import { noiseBuffer, VOICES } from "./voices";

export const STEPS = 16;
export const BANDS = 16;
export const PATTERNS = ["A", "B", "C", "D"] as const;
/** A step is off, on, or on with an accent. */
export type Hit = 0 | 1 | 2;
const LOOKAHEAD_SECONDS = 0.12;
const WAKE_MS = 25;
const STORED = "sequencer.patterns";
const GAIN: Record<Hit, number> = { 0: 0, 1: 0.62, 2: 1 };

export interface Track {
  id: string;
  name: string;
  level: number;
  muted: boolean;
  colour: string;
}

/** One track's line in a pattern. Tracks of different lengths drift against each other. */
export interface Row {
  steps: Hit[];
  length: number;
}

const COLOURS: Record<string, string> = {
  kick: "#ff6b5c",
  snare: "#ffb45c",
  hat: "#ffe36b",
  open: "#7be3a0",
  clap: "#6bc5ff",
  bass: "#b48cff",
};

// `x` is a hit, `X` an accented one; the length of the text is the length of the track.
const STARTING: Record<string, string>[] = [
  {
    kick: "X...x...X...x.x.",
    snare: "....X.......X...",
    hat: "x.x.x.x.x.x.x.x.",
    open: "..............x.",
    clap: "....x..x....x...",
    bass: "X..x..x...x..x..",
  },
  {
    kick: "X..x..x.X..x..x.",
    snare: "....X..x....X...",
    hat: "xxXxxxXxxxXxxxXx",
    open: "..x...x...x...x.",
    clap: "............X..x",
    bass: "X.x..X.x..x.",
  },
];

function row(text = ""): Row {
  const length = Math.min(STEPS, Math.max(1, text.length || STEPS));
  return {
    steps: Array.from({ length: STEPS }, (_, i): Hit => (text[i] === "X" ? 2 : text[i] === "x" ? 1 : 0)),
    length,
  };
}

const text = (line: Row) =>
  line.steps
    .slice(0, line.length)
    .map((hit) => ".xX"[hit])
    .join("");

class Sequencer {
  tracks = $state<Track[]>(
    VOICES.map((voice) => ({
      id: voice.id,
      name: voice.name,
      level: 0.8,
      muted: false,
      colour: COLOURS[voice.id] ?? "#ffb45c",
    })),
  );
  /** Four patterns, each a row a track. */
  patterns = $state<Row[][]>(PATTERNS.map((_, at) => VOICES.map((voice) => row(STARTING[at]?.[voice.id]))));
  /** The pattern on the grid. */
  pattern = $state(0);
  /** The pattern that is sounding, and the one that takes over at the next bar. */
  sounding = $state(0);
  queued = $state(0);
  /** Plays the patterns that have notes one after another. */
  chain = $state(false);
  tempo = $state(118);
  /** How late every second sixteenth plays, as a part of a step: 0 is straight. */
  swing = $state(0.12);
  /** How hard the mix is pushed into the shaper: 0 is clean. */
  drive = $state(0.2);
  /** How much of the mix goes round the echo, three steps long. */
  echo = $state(0.25);
  /** How much of the mix goes through the room. */
  reverb = $state(0.18);
  volume = $state(0.8);
  playing = $state(false);
  /** Sixteenths since Play, or -1 while stopped. */
  tick = $state(-1);
  /** When a kick last sounded, in seconds of `performance.now()`: the panel's pulse. */
  kickAt = $state(-1000);
  /** When each step of each track last sounded, on the same clock: the pads flare from it. */
  soundedAt = $state<number[][]>(VOICES.map(() => Array.from({ length: STEPS }, () => -1000)));

  #context: AudioContext | null = null;
  #master: GainNode | null = null;
  #shaper: WaveShaperNode | null = null;
  #shaped = -1;
  #delay: DelayNode | null = null;
  #echo: GainNode | null = null;
  #room: GainNode | null = null;
  #analyser: AnalyserNode | null = null;
  #channels = new Map<string, GainNode>();
  #noise: AudioBuffer | null = null;
  #spectrum = new Uint8Array(0);
  #timer: ReturnType<typeof setInterval> | undefined;
  #next = 0;
  #nextTime = 0;
  #nextPattern = 0;
  /** Steps handed to the audio clock that have not sounded yet. */
  #pending: { tick: number; time: number; pattern: number; hits: number[]; kick: boolean }[] = [];

  constructor() {
    const stored = localStorage.getItem(STORED);
    if (!stored) return;
    try {
      this.read(stored);
    } catch {
      localStorage.removeItem(STORED);
    }
  }

  get rows(): Row[] {
    return this.patterns[this.pattern] ?? [];
  }

  get stepSeconds(): number {
    return Frequency.hz((this.tempo / 60) * 4).period.totalSeconds;
  }

  toggle(): void {
    if (this.playing) this.stop();
    else this.play();
  }

  play(): void {
    const context = this.#graph();
    void context.resume();
    this.playing = true;
    this.#next = 0;
    this.#nextTime = context.currentTime + 0.06;
    this.#nextPattern = this.queued = this.pattern;
    this.#pending = [];
    this.#timer = setInterval(() => this.#schedule(), WAKE_MS);
    this.#schedule();
  }

  stop(): void {
    clearInterval(this.#timer);
    this.playing = false;
    this.tick = -1;
    this.#pending = [];
  }

  /** Shows a pattern. While playing it takes over at the next bar. */
  select(pattern: number): void {
    this.pattern = pattern;
    this.queued = pattern;
    if (!this.playing) this.sounding = pattern;
  }

  set(line: Row, index: number, hit: Hit): void {
    if (line.steps[index] === hit) return;
    line.steps[index] = hit;
    this.save();
  }

  /** Turns the row by one step, inside its length. */
  shift(line: Row, by: -1 | 1): void {
    const live = line.steps.slice(0, line.length);
    const moved = live.map((_, i) => live[(i - by + live.length) % live.length] ?? 0);
    line.steps.splice(0, moved.length, ...moved);
    this.save();
  }

  /** Throws dice for the row: `density` of the steps come on, the strong beats more often. */
  scatter(line: Row, density: number): void {
    for (let i = 0; i < line.length; i++) {
      const on = Math.random() < density * (i % 4 === 0 ? 1.6 : i % 2 === 0 ? 1 : 0.6);
      line.steps[i] = on ? (Math.random() < 0.25 ? 2 : 1) : 0;
    }
    this.save();
  }

  clear(): void {
    for (const line of this.rows) line.steps.fill(0);
    this.save();
  }

  /** Puts the pattern on the grid into the next slot too, and shows that one. */
  duplicate(): void {
    const to = (this.pattern + 1) % PATTERNS.length;
    this.patterns[to] = this.rows.map((line) => ({ steps: [...line.steps], length: line.length }));
    this.select(to);
    this.save();
  }

  /** Everything as TOML: a line of `.`, `x` and `X` for each track of each pattern. */
  write(): string {
    return TOML.stringify({
      tempo: this.tempo,
      swing: this.swing,
      pattern: Object.fromEntries(
        this.patterns.map((rows, at) => [
          PATTERNS[at]?.toLowerCase() ?? "",
          Object.fromEntries(rows.map((line, track) => [this.tracks[track]?.id ?? "", text(line)])),
        ]),
      ),
    });
  }

  /** Takes what `write()` gave. Throws a `SyntaxError` for text that is not TOML. */
  read(source: string): void {
    const file = TOML.parse(source) as {
      tempo?: unknown;
      swing?: unknown;
      pattern?: Record<string, Record<string, unknown> | undefined>;
    };
    if (typeof file.tempo === "number") this.tempo = Math.min(200, Math.max(60, Math.round(file.tempo)));
    if (typeof file.swing === "number") this.swing = Math.min(0.5, Math.max(0, file.swing));
    for (const [at, name] of PATTERNS.entries()) {
      const lines = file.pattern?.[name.toLowerCase()];
      if (!lines) continue;
      this.patterns[at] = this.tracks.map((track) => {
        const line = lines[track.id];
        return row(typeof line === "string" ? line : "");
      });
    }
  }

  save(): void {
    localStorage.setItem(STORED, this.write());
  }

  /** Called once a display frame: moves the playhead to what is sounding and fills `into` with the spectrum. */
  frame(into: Float32Array): void {
    const context = this.#context;
    const analyser = this.#analyser;
    if (!context || !analyser) return;
    const now = performance.now() / 1000;
    while (this.#pending[0] && this.#pending[0].time <= context.currentTime) {
      const sounded = this.#pending.shift();
      if (!sounded) break;
      this.tick = sounded.tick;
      this.sounding = sounded.pattern;
      if (this.chain) this.pattern = sounded.pattern;
      for (const [track, index] of sounded.hits.entries()) {
        const times = this.soundedAt[track];
        if (times && index >= 0) times[index] = now;
      }
      if (sounded.kick) this.kickAt = now;
    }
    analyser.getByteFrequencyData(this.#spectrum);
    // The bands widen towards the treble, as the ear's do.
    const bins = this.#spectrum.length * 0.6;
    for (let band = 0; band < into.length; band++) {
      const from = Math.floor(bins ** (band / into.length));
      const to = Math.max(from + 1, Math.floor(bins ** ((band + 1) / into.length)));
      let peak = 0;
      for (let bin = from; bin < to; bin++) peak = Math.max(peak, this.#spectrum[bin] ?? 0);
      into[band] = peak / 255;
    }
  }

  /** The pattern after `from` that has a note in it, for the chain. */
  #following(from: number): number {
    for (let by = 1; by <= PATTERNS.length; by++) {
      const at = (from + by) % PATTERNS.length;
      if (this.patterns[at]?.some((line) => line.steps.slice(0, line.length).some((hit) => hit > 0))) return at;
    }
    return from;
  }

  #schedule(): void {
    const context = this.#context;
    const noise = this.#noise;
    if (!context || !noise) return;
    this.#mix();
    // A timer that woke far too late (the machine slept) skips what it missed instead of playing it all at once.
    const late = context.currentTime - this.#nextTime;
    if (late > 0.05) {
      const missed = Math.ceil(late / this.stepSeconds);
      this.#next += missed;
      this.#nextTime += missed * this.stepSeconds;
    }
    while (this.#nextTime < context.currentTime + LOOKAHEAD_SECONDS) {
      const tick = this.#next;
      if (tick % STEPS === 0 && tick > 0) {
        this.#nextPattern = this.chain ? this.#following(this.#nextPattern) : this.queued;
      }
      const rows = this.patterns[this.#nextPattern] ?? [];
      const time = this.#nextTime + (tick % 2 ? this.swing * this.stepSeconds : 0);
      const hits: number[] = [];
      let kick = false;
      for (const [at, track] of this.tracks.entries()) {
        const line = rows[at];
        const index = line ? tick % line.length : 0;
        const hit = line?.steps[index] ?? 0;
        const channel = this.#channels.get(track.id);
        if (!hit || track.muted || !channel) {
          hits.push(-1);
          continue;
        }
        channel.gain.value = track.level;
        const accent = context.createGain();
        accent.gain.value = GAIN[hit];
        accent.connect(channel);
        VOICES[at]?.play(context, accent, time, noise);
        hits.push(index);
        kick ||= track.id === "kick";
      }
      this.#pending.push({ tick, time, pattern: this.#nextPattern, hits, kick });
      // Nothing takes steps off the list while the window is hidden and no frame is drawn.
      if (this.#pending.length > STEPS * 4) this.#pending.shift();
      this.#next = tick + 1;
      this.#nextTime += this.stepSeconds;
    }
  }

  #mix(): void {
    if (!this.#master || !this.#echo || !this.#room || !this.#delay || !this.#shaper) return;
    this.#master.gain.value = this.volume;
    this.#echo.gain.value = this.echo;
    this.#room.gain.value = this.reverb;
    this.#delay.delayTime.value = Math.min(1, this.stepSeconds * 3);
    if (this.#shaped !== this.drive) {
      this.#shaper.curve = saturation(this.drive);
      this.#shaped = this.drive;
    }
  }

  // Built on the first Play: an AudioContext made before the user asked for sound starts suspended.
  // The channels meet on a bus, which goes through the shaper and, beside it, round the echo and
  // through the room; a compressor holds the three together before the master gain.
  #graph(): AudioContext {
    if (this.#context) return this.#context;
    const context = new AudioContext();
    const bus = context.createGain();
    const shaper = context.createWaveShaper();
    const compressor = context.createDynamicsCompressor();
    const master = context.createGain();
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.6;
    compressor.threshold.value = -14;
    compressor.ratio.value = 4;
    bus.connect(shaper).connect(compressor).connect(master).connect(analyser).connect(context.destination);
    for (const track of this.tracks) {
      const channel = context.createGain();
      channel.connect(bus);
      this.#channels.set(track.id, channel);
    }

    const delay = context.createDelay(1);
    const feedback = context.createGain();
    const echo = context.createGain();
    feedback.gain.value = 0.4;
    bus.connect(echo).connect(delay).connect(feedback).connect(delay);
    delay.connect(compressor);

    const room = context.createGain();
    const convolver = context.createConvolver();
    convolver.buffer = impulse(context, 1.4);
    bus.connect(room).connect(convolver).connect(compressor);

    this.#context = context;
    this.#master = master;
    this.#shaper = shaper;
    this.#delay = delay;
    this.#echo = echo;
    this.#room = room;
    this.#analyser = analyser;
    this.#noise = noiseBuffer(context);
    this.#spectrum = new Uint8Array(analyser.frequencyBinCount);
    this.#mix();
    return context;
  }
}

/** A soft clip that gets harder with `drive`, kept at the same peak. */
function saturation(drive: number): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(1024);
  const push = 1 + drive * 9;
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * push) / Math.tanh(push);
  }
  return curve;
}

/** The sound of a room, made up: noise in both ears that dies away over `seconds`. */
function impulse(context: AudioContext, seconds: number): AudioBuffer {
  const buffer = context.createBuffer(2, Math.floor(context.sampleRate * seconds), context.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const samples = buffer.getChannelData(channel);
    for (let i = 0; i < samples.length; i++) {
      samples[i] = (Math.random() * 2 - 1) * (1 - i / samples.length) ** 3;
    }
  }
  return buffer;
}

export const sequencer = new Sequencer();
