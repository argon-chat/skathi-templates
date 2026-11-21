// The bench the machine sits on: its files, its clock, the loop that runs it a display frame at a time,
// and what the panels show of it.

import { reactive, shallowRef, triggerRef } from "vue";
import { HEIGHT, Machine, WIDTH } from "./rv32/machine";

const SLICE = 500_000;
/** How long a display frame may run instructions before it lets the window draw. */
const BUDGET_MS = 12;
const RATE_MS = 500;
const PANEL_MS = 250;
const TIC_MS = 1000 / 35;
/** The recorded demo a timing plays; the WAD has demo1 to demo3. */
export const TIMED_DEMO = "demo1";

export interface Timing {
  frames: number;
  fps: number;
  mips: number;
}

export const bench = reactive({
  loaded: false,
  running: false,
  error: "",
  fps: 0,
  mips: 0,
  imageBytes: 0,
  wadBytes: 0,
  /** The demo is being played as fast as the emulator goes. */
  timing: false,
  timed: null as Timing | null,
});

/** Bumped whenever the machine's state should be read again by the panels. */
export const frame = shallowRef(0);
/** The registers as they were before the last single step, while that step is what the panels show. */
export const before = new Int32Array(32);
export const stepped = shallowRef(false);

let files: { image: Uint8Array; wad: Uint8Array } | null = null;
let active: Machine | null = null;
let context: CanvasRenderingContext2D | null = null;
let picture: ImageData | null = null;
let drawn = new Uint8ClampedArray(0);
let shown = 0;

// The guest's clock stands still while the machine is paused.
let clock = 0;
let resumed = 0;

let since = 0;
let panels = 0;
let frames = 0;
let instructions = 0;
let emulated = 0;
let timedInstructions = 0;
let timedMs = 0;

export const machine = (): Machine | null => active;

function guestNow(): number {
  return bench.running ? clock + performance.now() - resumed : clock;
}

function boot(timed: boolean): void {
  if (!files) return;
  let fake = 0;
  active = new Machine(
    // A timing's clock jumps a tic per reading, so nothing in the demo waits on real time.
    timed ? { ...files, args: ["-timedemo", TIMED_DEMO], now: () => (fake += 29) } : { ...files, now: guestNow },
  );
  drawn = new Uint8ClampedArray(active.pixels.buffer);
  shown = 0;
  frames = instructions = emulated = timedInstructions = timedMs = 0;
  stepped.value = false;
  bench.timing = timed;
  bench.fps = bench.mips = 0;
  context?.clearRect(0, 0, WIDTH, HEIGHT);
  triggerRef(frame);
}

async function bytes(path: string): Promise<Uint8Array> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

export async function load(): Promise<void> {
  try {
    const image = await bytes("assets/doom.bin");
    const wad = await bytes("assets/doom1.wad").catch(() => null);
    if (!wad) {
      bench.error = "assets/doom1.wad is missing. Run `bun run wad` to fetch the shareware episode, then start again.";
      return;
    }
    files = { image, wad };
    bench.imageBytes = image.length;
    bench.wadBytes = wad.length;
    bench.loaded = true;
    boot(false);
    run();
  } catch (error) {
    bench.error = `The guest did not load: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/** The canvas the framebuffer is drawn on, or null when it goes away. */
export function attach(target: CanvasRenderingContext2D | null): void {
  context = target;
  picture = target?.createImageData(WIDTH, HEIGHT) ?? null;
  shown = 0;
  paint();
}

function paint(): void {
  if (!active || !context || !picture || active.frames === shown) return;
  frames += active.frames - shown;
  shown = active.frames;
  picture.data.set(drawn);
  context.putImageData(picture, 0, 0);
}

export function run(): void {
  if (bench.running || !active || active.cpu.halted) return;
  resumed = since = panels = performance.now();
  frames = instructions = emulated = 0;
  stepped.value = false;
  bench.running = true;
  requestAnimationFrame(tick);
}

export function pause(): void {
  if (bench.running) clock = guestNow();
  bench.running = false;
  bench.fps = bench.mips = 0;
  triggerRef(frame);
}

/** Runs one instruction. */
export function step(): void {
  pause();
  if (!active) return;
  before.set(active.cpu.x);
  active.run(1);
  stepped.value = true;
  paint();
  triggerRef(frame);
}

/** Runs to the next frame the guest draws, with the guest's clock moved on by one game tic. */
export function stepFrame(): void {
  pause();
  if (!active) return;
  clock += TIC_MS;
  const at = active.frames;
  for (const end = performance.now() + 500; active.frames === at && !active.cpu.halted && performance.now() < end;)
    active.run(SLICE);
  stepped.value = false;
  paint();
  triggerRef(frame);
}

export function reset(): void {
  const was = bench.running;
  pause();
  boot(false);
  if (was) run();
}

/** Starts a timing, or abandons the one that is running. */
export function time(): void {
  const timing = bench.timing;
  pause();
  boot(!timing);
  run();
}

/** Queues a key event for the guest; `code` is one of the engine's key codes. */
export function key(code: number, down: boolean): void {
  if (!bench.timing) active?.key(code, down);
}

function tick(): void {
  const game = active;
  if (!bench.running || !game) return;
  const began = performance.now();
  let now = began;
  // The guest sleeps when it has no tic to run: that, or the time budget, ends the display frame.
  do {
    const playing = game.frames > 0;
    const ran = game.run(SLICE);
    const then = performance.now();
    instructions += ran;
    if (playing) {
      timedInstructions += ran;
      timedMs += then - now;
    }
    now = then;
  } while (!game.cpu.halted && (bench.timing || game.sleep === 0) && now - began < BUDGET_MS);
  emulated += now - began;
  paint();

  if (now - since >= RATE_MS) {
    bench.fps = (frames * 1000) / (now - since);
    bench.mips = instructions / Math.max(emulated, 1) / 1000;
    since = now;
    frames = instructions = emulated = 0;
  }
  if (now - panels >= PANEL_MS) {
    panels = now;
    triggerRef(frame);
  }

  if (!game.cpu.halted) requestAnimationFrame(tick);
  else if (bench.timing && game.cpu.fault === null) {
    // The first frame ends the boot and is not part of the demo.
    const played = game.frames - 1;
    bench.timed = {
      frames: played,
      fps: (played * 1000) / Math.max(timedMs, 1),
      mips: timedInstructions / Math.max(timedMs, 1) / 1000,
    };
    pause();
    boot(false);
    run();
  } else pause();
}
