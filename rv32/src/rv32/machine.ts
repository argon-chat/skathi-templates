// The emulated computer: the CPU, its memory, and the host calls that stand in for hardware. The numbers
// are the guest's too (guest/host.h).

import { Rv32 } from "./cpu";

export const WIDTH = 320;
export const HEIGHT = 200;
export const LOAD_ADDRESS = 0x10000;
export const MEMORY_SIZE = 16 * 1024 * 1024;
/** The game data the engine knows by name, in the order the bench looks for it in assets/. */
export const WADS = ["doom1.wad", "freedoom1.wad"] as const;
const LOG_LINES = 200;
const EMPTY = new Uint8Array(0);

const enum Call {
  Exit = 1,
  Write = 2,
  Open = 3,
  Read = 4,
  Size = 5,
  Ticks = 6,
  Sleep = 7,
  Frame = 8,
  Key = 9,
  Args = 10,
}

export interface MachineOptions {
  image: Uint8Array;
  wad: Uint8Array;
  /** The WAD's file name: the engine tells the games apart by it. */
  wadName: string;
  /** The engine's command line after the program name. */
  args?: string[];
  /** The guest's clock, in milliseconds. */
  now?: () => number;
}

export class Machine {
  readonly cpu: Rv32;
  /** The last frame the guest drew, as canvas RGBA. */
  readonly pixels = new Uint32Array(WIDTH * HEIGHT);
  /** Frames drawn since the start. */
  frames = 0;
  /** Key events the guest has taken from the queue. */
  keysRead = 0;
  /** Milliseconds the guest asked to sleep in the call that last yielded. */
  sleep = 0;
  exitCode: number | null = null;
  /** What the guest printed, a line per entry; the last may be unfinished. */
  readonly log: string[] = [""];
  private readonly keys: number[] = [];
  private readonly palette = new Uint32Array(256);
  private readonly files: { name: string; data: Uint8Array }[];
  private readonly args: string[];
  private readonly now: () => number;

  constructor(options: MachineOptions) {
    this.files = [{ name: options.wadName, data: options.wad }];
    this.args = ["doom", "-iwad", options.wadName, ...(options.args ?? [])];
    this.now = options.now ?? (() => performance.now());
    this.cpu = new Rv32(MEMORY_SIZE, LOAD_ADDRESS + options.image.length, () => this.hostCall());
    this.cpu.u8.set(options.image, LOAD_ADDRESS);
    this.cpu.reset(LOAD_ADDRESS);
    this.cpu.x[10] = MEMORY_SIZE;
  }

  /** Runs until the guest draws a frame, sleeps or exits, or `budget` instructions have passed. */
  run(budget: number): number {
    this.sleep = 0;
    return this.cpu.run(budget);
  }

  /** Queues a key event; `key` is one of the engine's key codes. */
  key(key: number, down: boolean): void {
    this.keys.push((down ? 0x100 : 0) | (key & 0xff));
  }

  private hostCall(): void {
    const { cpu } = this;
    const x = cpu.x;
    const a0 = x[10] ?? 0;
    const a1 = x[11] ?? 0;
    const a2 = x[12] ?? 0;
    const a3 = x[13] ?? 0;
    switch (x[17]) {
      case Call.Exit:
        this.exitCode = a0;
        cpu.halted = true;
        break;
      case Call.Write:
        this.write(a0, a1);
        break;
      case Call.Open:
        x[10] = this.open(this.text(a0).toLowerCase());
        break;
      case Call.Read: {
        const data = this.files[a0]?.data ?? EMPTY;
        const count = Math.max(0, Math.min(a2, data.length - a3));
        cpu.u8.set(data.subarray(a3, a3 + count), a1 >>> 0);
        x[10] = count;
        break;
      }
      case Call.Size:
        x[10] = this.files[a0]?.data.length ?? 0;
        break;
      case Call.Ticks:
        x[10] = this.now();
        break;
      case Call.Sleep:
        this.sleep = a0;
        cpu.yielded = true;
        break;
      case Call.Frame:
        this.present(a0 >>> 0, a1 >>> 0);
        cpu.yielded = true;
        break;
      case Call.Key: {
        const event = this.keys.shift() ?? 0;
        if (event) this.keysRead++;
        x[10] = event;
        break;
      }
      case Call.Args: {
        const line = this.args.join("\0") + "\0";
        for (let i = 0; i < line.length && i < a1; i++) cpu.u8[(a0 >>> 0) + i] = line.charCodeAt(i);
        x[10] = this.args.length;
        break;
      }
      default:
        cpu.fault = `unknown host call ${x[17]}`;
        cpu.halted = true;
    }
  }

  private open(path: string): number {
    return this.files.findIndex((file) => path === file.name || path.endsWith(`/${file.name}`));
  }

  private present(frame: number, colors: number): void {
    const { palette, pixels } = this;
    const { u8, i32 } = this.cpu;
    for (let i = 0; i < 256; i++) {
      const c = i32[(colors >>> 2) + i] ?? 0;
      palette[i] = 0xff000000 | ((c & 0xff) << 16) | (c & 0xff00) | ((c >> 16) & 0xff);
    }
    for (let i = 0; i < WIDTH * HEIGHT; i++) pixels[i] = palette[u8[frame + i] ?? 0] ?? 0;
    this.frames++;
  }

  private text(at: number): string {
    const { u8 } = this.cpu;
    let end = at >>> 0;
    while (u8[end]) end++;
    return String.fromCharCode(...u8.subarray(at >>> 0, end));
  }

  private write(at: number, length: number): void {
    const { u8 } = this.cpu;
    const { log } = this;
    const parts = String.fromCharCode(...u8.subarray(at >>> 0, (at >>> 0) + length)).split("\n");
    log[log.length - 1] += parts[0] ?? "";
    for (let i = 1; i < parts.length; i++) log.push(parts[i] ?? "");
    if (log.length > LOG_LINES) log.splice(0, log.length - LOG_LINES);
  }
}
