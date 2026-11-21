import { RingBuffer } from "skathi:collections";
import { u8, u16 } from "skathi:numeric";

export const WIDTH = 64;
export const HEIGHT = 32;
export const PROGRAM_START = 0x200;
export const MEMORY_SIZE = 0x1000;
export const MAX_ROM = MEMORY_SIZE - PROGRAM_START;
const FONT_START = 0x50;

// Each digit is five rows of four pixels, in the high nibble.
const FONT = [
  0xf0, 0x90, 0x90, 0x90, 0xf0, 0x20, 0x60, 0x20, 0x20, 0x70, 0xf0, 0x10, 0xf0, 0x80, 0xf0, 0xf0, 0x10, 0xf0, 0x10,
  0xf0, 0x90, 0x90, 0xf0, 0x10, 0x10, 0xf0, 0x80, 0xf0, 0x10, 0xf0, 0xf0, 0x80, 0xf0, 0x90, 0xf0, 0xf0, 0x10, 0x20,
  0x40, 0x40, 0xf0, 0x90, 0xf0, 0x90, 0xf0, 0xf0, 0x90, 0xf0, 0x10, 0xf0, 0xf0, 0x90, 0xf0, 0x90, 0x90, 0xe0, 0x90,
  0xe0, 0x90, 0xe0, 0xf0, 0x80, 0x80, 0x80, 0xf0, 0xe0, 0x90, 0x90, 0x90, 0xe0, 0xf0, 0x80, 0xf0, 0x80, 0xf0, 0xf0,
  0x80, 0xf0, 0x80, 0x80,
];

export type Halt = "breakpoint" | "bad-opcode" | "stack" | null;

export class Chip8 {
  readonly memory = new Uint8Array(MEMORY_SIZE);
  readonly v = new Uint8Array(16);
  readonly stack = new Uint16Array(16);
  readonly display = new Uint8Array(WIDTH * HEIGHT);
  readonly keys = new Uint8Array(16);
  /** The addresses of the last instructions run, oldest first. */
  readonly trace = new RingBuffer(64);
  i = 0;
  pc = PROGRAM_START;
  sp = 0;
  delay = 0;
  sound = 0;
  /** The register `Fx0A` is waiting to fill, or -1. */
  waiting = -1;
  halted: Halt = null;
  /** Instructions run since the last reset. */
  cycles = 0;
  romSize = 0;

  load(rom: Uint8Array): void {
    if (rom.length > MAX_ROM) throw new RangeError(`a CHIP-8 program is ${MAX_ROM} bytes at most; this is ${rom.length}`);
    this.memory.fill(0);
    this.memory.set(FONT, FONT_START);
    this.memory.set(rom, PROGRAM_START);
    this.romSize = rom.length;
    this.reset();
  }

  /** Starts the loaded program again; memory the program wrote to keeps its contents. */
  reset(): void {
    this.v.fill(0);
    this.stack.fill(0);
    this.display.fill(0);
    this.keys.fill(0);
    this.trace.clear();
    this.i = 0;
    this.pc = PROGRAM_START;
    this.sp = 0;
    this.delay = 0;
    this.sound = 0;
    this.waiting = -1;
    this.halted = null;
    this.cycles = 0;
  }

  /** One 60 Hz tick of the two timers. */
  tick(): void {
    if (this.delay > 0) this.delay--;
    if (this.sound > 0) this.sound--;
  }

  press(key: number, down: boolean): void {
    this.keys[key] = down ? 1 : 0;
    if (!down && this.waiting >= 0) {
      this.v[this.waiting] = key;
      this.waiting = -1;
    }
  }

  opcodeAt(address: number): number {
    return ((this.memory[address & 0xfff] ?? 0) << 8) | (this.memory[(address + 1) & 0xfff] ?? 0);
  }

  /** Runs one instruction. `record` keeps its address in `trace`. */
  step(record: boolean): void {
    if (this.waiting >= 0 || this.halted) return;
    const { v, memory } = this;
    const at = this.pc;
    const op = this.opcodeAt(at);
    if (record) this.trace.push(at);
    this.pc = u16.and(u16(at + 2), u16(0xfff));
    this.cycles++;

    const x = (op >> 8) & 0xf;
    const y = (op >> 4) & 0xf;
    const n = op & 0xf;
    const kk = op & 0xff;
    const nnn = op & 0xfff;
    const vx = u8(v[x] ?? 0);
    const vy = u8(v[y] ?? 0);

    switch (op >> 12) {
      case 0x0:
        if (op === 0x00e0) this.display.fill(0);
        else if (op === 0x00ee) {
          if (this.sp === 0) return this.stop("stack", at);
          this.pc = this.stack[--this.sp] ?? PROGRAM_START;
        } else return this.stop("bad-opcode", at);
        return;
      case 0x1:
        this.pc = nnn;
        return;
      case 0x2:
        if (this.sp === 16) return this.stop("stack", at);
        this.stack[this.sp++] = this.pc;
        this.pc = nnn;
        return;
      case 0x3:
        if (vx === kk) this.skip();
        return;
      case 0x4:
        if (vx !== kk) this.skip();
        return;
      case 0x5:
        if (vx === vy) this.skip();
        return;
      case 0x6:
        v[x] = kk;
        return;
      case 0x7:
        v[x] = u8.add(vx, u8(kk));
        return;
      case 0x8:
        switch (n) {
          case 0x0:
            v[x] = vy;
            return;
          case 0x1:
            v[x] = u8.or(vx, vy);
            return;
          case 0x2:
            v[x] = u8.and(vx, vy);
            return;
          case 0x3:
            v[x] = u8.xor(vx, vy);
            return;
          case 0x4:
            v[x] = u8.add(vx, vy);
            v[0xf] = u8.checkedAdd(vx, vy) === null ? 1 : 0;
            return;
          case 0x5:
            v[x] = u8.sub(vx, vy);
            v[0xf] = u8.lt(vx, vy) ? 0 : 1;
            return;
          case 0x6:
            v[x] = u8.shr(vx, 1);
            v[0xf] = vx & 1;
            return;
          case 0x7:
            v[x] = u8.sub(vy, vx);
            v[0xf] = u8.lt(vy, vx) ? 0 : 1;
            return;
          case 0xe:
            v[x] = u8.shl(vx, 1);
            v[0xf] = vx >> 7;
            return;
        }
        return this.stop("bad-opcode", at);
      case 0x9:
        if (vx !== vy) this.skip();
        return;
      case 0xa:
        this.i = nnn;
        return;
      case 0xb:
        this.pc = u16.and(u16(nnn + (v[0] ?? 0)), u16(0xfff));
        return;
      case 0xc:
        v[x] = (Math.random() * 256) & kk;
        return;
      case 0xd:
        this.draw(vx, vy, n);
        return;
      case 0xe:
        if (kk === 0x9e) {
          if (this.keys[vx & 0xf]) this.skip();
        } else if (kk === 0xa1) {
          if (!this.keys[vx & 0xf]) this.skip();
        } else return this.stop("bad-opcode", at);
        return;
      case 0xf:
        switch (kk) {
          case 0x07:
            v[x] = this.delay;
            return;
          case 0x0a:
            this.waiting = x;
            return;
          case 0x15:
            this.delay = vx;
            return;
          case 0x18:
            this.sound = vx;
            return;
          case 0x1e:
            this.i = u16.and(u16(this.i + vx), u16(0xfff));
            return;
          case 0x29:
            this.i = FONT_START + (vx & 0xf) * 5;
            return;
          case 0x33:
            memory[this.i & 0xfff] = Math.trunc(vx / 100);
            memory[(this.i + 1) & 0xfff] = Math.trunc(vx / 10) % 10;
            memory[(this.i + 2) & 0xfff] = vx % 10;
            return;
          case 0x55:
            for (let r = 0; r <= x; r++) memory[(this.i + r) & 0xfff] = v[r] ?? 0;
            return;
          case 0x65:
            for (let r = 0; r <= x; r++) v[r] = memory[(this.i + r) & 0xfff] ?? 0;
            return;
        }
        return this.stop("bad-opcode", at);
    }
  }

  private skip(): void {
    this.pc = (this.pc + 2) & 0xfff;
  }

  private stop(why: Halt, at: number): void {
    this.halted = why;
    this.pc = at;
    this.cycles--;
  }

  // A sprite starts inside the screen and is cut off at its right and bottom edges.
  private draw(vx: number, vy: number, rows: number): void {
    const { display, memory } = this;
    const left = vx % WIDTH;
    const top = vy % HEIGHT;
    let erased = 0;
    for (let row = 0; row < rows && top + row < HEIGHT; row++) {
      const bits = memory[(this.i + row) & 0xfff] ?? 0;
      const line = (top + row) * WIDTH;
      for (let bit = 0; bit < 8 && left + bit < WIDTH; bit++) {
        if (!(bits & (0x80 >> bit))) continue;
        const at = line + left + bit;
        if (display[at]) erased = 1;
        display[at] = (display[at] ?? 0) ^ 1;
      }
    }
    this.v[0xf] = erased;
  }
}
