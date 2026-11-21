// The running machine: the CPU, its clock, its breakpoints and what the panels show of it.

import { CRC32 } from "skathi:binary";
import { BitSet } from "skathi:collections";
import { Hex } from "skathi:encoding";
import { Stopwatch } from "skathi:time";
import { reactive, shallowRef, triggerRef } from "vue";
import { assemble } from "./chip8/asm";
import { Chip8, MAX_ROM, MEMORY_SIZE } from "./chip8/cpu";
import { PROGRAMS } from "./chip8/roms";
import { Beeper } from "./sound";

const TIMER_MS = 1000 / 60;
/** How long a turbo frame may run instructions before it lets the window draw. */
const TURBO_BUDGET_MS = 8;

export const cpu = new Chip8();
const breakpoints = new BitSet(MEMORY_SIZE);
const beeper = new Beeper();
const clock = new Stopwatch();

export const machine = reactive({
  running: false,
  /** Instructions per 60 Hz tick. */
  speed: 12,
  /** As many instructions as a frame has time for, with the timers still at 60 Hz. */
  turbo: false,
  muted: false,
  program: "",
  /** The CRC-32 of the loaded bytes: two files with the same number are the same program. */
  id: "",
  size: 0,
  perSecond: 0,
  error: "",
  breakpoints: 0,
});

/** Bumped whenever the CPU's state should be read again by the panels. */
export const frame = shallowRef(0);

let last = 0;
let owed = 0;
let counted = 0;

export function load(name: string, rom: Uint8Array): void {
  if (rom.length === 0 || rom.length > MAX_ROM) {
    machine.error = `${name} is ${rom.length} bytes; a CHIP-8 program is 1 to ${MAX_ROM}`;
    return;
  }
  cpu.load(rom);
  breakpoints.clear();
  machine.breakpoints = 0;
  machine.program = name;
  machine.id = Hex.format(CRC32.compute(rom), 8);
  machine.size = rom.length;
  machine.error = "";
  triggerRef(frame);
}

export function open(index: number): void {
  const program = PROGRAMS[index];
  if (program) load(program.name, assemble(program.source));
}

export function run(): void {
  if (machine.running) return;
  if (cpu.halted === "breakpoint") cpu.halted = null;
  if (cpu.halted) return;
  machine.running = true;
  last = performance.now();
  owed = 0;
  counted = cpu.cycles;
  clock.restart();
  requestAnimationFrame(tick);
}

export function pause(): void {
  machine.running = false;
  machine.perSecond = 0;
  beeper.set(false);
  triggerRef(frame);
}

export function step(): void {
  pause();
  if (cpu.halted === "breakpoint") cpu.halted = null;
  cpu.step(true);
  triggerRef(frame);
}

export function reset(): void {
  const was = machine.running;
  pause();
  cpu.reset();
  triggerRef(frame);
  if (was) run();
}

export function toggleBreakpoint(address: number): void {
  if (breakpoints.has(address)) breakpoints.clear(address);
  else breakpoints.set(address);
  machine.breakpoints = breakpoints.count();
  triggerRef(frame);
}

export function hasBreakpoint(address: number): boolean {
  return machine.breakpoints > 0 && breakpoints.has(address);
}

export function key(index: number, down: boolean): void {
  cpu.press(index, down);
  if (!machine.running) triggerRef(frame);
}

function instructions(count: number, record: boolean): void {
  const watched = machine.breakpoints > 0;
  for (let n = 0; n < count && !cpu.halted && cpu.waiting < 0; n++) {
    cpu.step(record);
    if (watched && breakpoints.has(cpu.pc)) cpu.halted = "breakpoint";
  }
}

function tick(now: number): void {
  if (!machine.running) return;
  // A window that was hidden comes back owing seconds: it does not replay them.
  owed = Math.min(owed + now - last, 4 * TIMER_MS);
  last = now;
  while (owed >= TIMER_MS) {
    owed -= TIMER_MS;
    cpu.tick();
    if (!machine.turbo) instructions(machine.speed, true);
  }
  if (machine.turbo) {
    const until = performance.now() + TURBO_BUDGET_MS;
    while (performance.now() < until && !cpu.halted && cpu.waiting < 0) instructions(2000, false);
  }
  beeper.set(cpu.sound > 0 && !machine.muted);

  const seconds = clock.elapsed.totalSeconds;
  if (seconds >= 0.5) {
    machine.perSecond = Math.round((cpu.cycles - counted) / seconds);
    counted = cpu.cycles;
    clock.restart();
  }
  triggerRef(frame);
  if (cpu.halted) pause();
  else requestAnimationFrame(tick);
}
