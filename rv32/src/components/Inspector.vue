<script setup lang="ts">
// What the machine holds right now. Everything here is read again when `frame` changes: four times
// a second while the machine runs, and after every step while it is paused.
import { Runtime } from "skathi:runtime";
import { computed } from "vue";
import { disassemble, hex, REGISTERS } from "../rv32/disasm";
import { LOAD_ADDRESS, MEMORY_SIZE } from "../rv32/machine";
import { before, bench, frame, machine, stepped, time, TIMED_DEMO } from "../workbench";

const ROWS = 9;
// The same loop runs from a native image after `sk publish --aot`; the timing shows what that changes.
const engine = Runtime.isAot() ? "AOT" : "JIT";
const count = (value: number) => value.toLocaleString("en-US");
const size = (bytes: number) =>
  bytes >= 1 << 20 ? `${(bytes / (1 << 20)).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;

const status = computed(() => {
  void frame.value;
  const game = machine();
  if (bench.error) return bench.error;
  if (!game) return "Loading the guest image and the WAD";
  if (game.cpu.fault) return game.cpu.fault;
  if (game.exitCode !== null) return `The guest exited with ${game.exitCode}`;
  if (bench.timing) return `Timing ${TIMED_DEMO}`;
  return bench.running ? "Running" : `Paused at ${hex(game.cpu.pc)}`;
});

const halted = computed(() => {
  void frame.value;
  return bench.error !== "" || machine()?.cpu.halted === true;
});

const counters = computed(() => {
  void frame.value;
  const game = machine();
  return [
    { name: "pc", value: hex(game?.cpu.pc ?? 0) },
    { name: "frames", value: count(game?.frames ?? 0) },
    { name: "keys", value: count(game?.keysRead ?? 0) },
    { name: "instructions", value: count(game?.cpu.cycles ?? 0) },
  ];
});

const registers = computed(() => {
  void frame.value;
  const x = machine()?.cpu.x;
  const marked = stepped.value;
  return REGISTERS.map((name, index) => ({
    name,
    value: hex(x?.[index] ?? 0),
    changed: marked && x !== undefined && x[index] !== before[index],
  }));
});

// The listing keeps the next instruction two rows down, and never starts before the image.
const listing = computed(() => {
  void frame.value;
  const at = machine()?.cpu;
  if (!at) return [];
  const first = Math.max(LOAD_ADDRESS, at.pc - 8);
  return Array.from({ length: ROWS }, (_, row) => {
    const address = first + row * 4;
    return {
      address,
      label: hex(address, 6),
      text: disassemble(at.i32[address >>> 2] ?? 0, address),
      current: address === at.pc,
    };
  });
});
</script>

<template>
  <aside class="inspector">
    <p class="status" :class="{ halted }">{{ status }}</p>

    <section>
      <h2>
        Machine <small>RV32IM, {{ size(MEMORY_SIZE) }}</small>
      </h2>
      <div class="counters">
        <span v-for="c in counters" :key="c.name" class="counter" :class="c.name"
          ><i>{{ c.name }}</i
          >{{ c.value }}</span
        >
      </div>
      <p class="files">doom.bin {{ size(bench.imageBytes) }} at {{ hex(LOAD_ADDRESS, 6) }}</p>
      <p class="files">doom1.wad {{ size(bench.wadBytes) }}</p>
    </section>

    <section>
      <h2>Registers</h2>
      <div class="registers">
        <span v-for="r in registers" :key="r.name" class="register" :class="{ changed: r.changed }"
          ><i>{{ r.name }}</i
          >{{ r.value }}</span
        >
      </div>
    </section>

    <section>
      <h2>Next instructions</h2>
      <ol class="listing">
        <li v-for="line in listing" :key="line.address" :class="{ current: line.current }">
          <span class="address">{{ line.label }}</span>{{ line.text }}
        </li>
      </ol>
    </section>

    <section>
      <h2>Timing <small>the recorded demo, as fast as it goes</small></h2>
      <div class="timing">
        <button class="control" :class="{ on: bench.timing }" :disabled="!bench.loaded" @click="time">
          {{ bench.timing ? "Stop" : `Time ${TIMED_DEMO}` }}
        </button>
        <span v-if="bench.timed" class="timed"
          ><b>{{ engine }}</b> {{ bench.timed.fps.toFixed(0) }} fps · {{ bench.timed.mips.toFixed(0) }} MIPS ·
          {{ count(bench.timed.frames) }} frames</span
        >
      </div>
    </section>
  </aside>
</template>

<style>
.inspector {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}
.inspector h2 {
  margin: 0 0 6px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}
.inspector h2 small {
  margin-left: 6px;
  font-size: 11px;
  font-weight: 400;
  letter-spacing: 0;
  text-transform: none;
}
.status {
  margin: 0;
  padding: 6px 10px;
  border-radius: 6px;
  background-color: var(--raised);
  color: var(--text);
}
.status.halted {
  background-color: var(--warn);
  color: var(--ink);
}

.counters {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
}
.counter.instructions {
  grid-column: 1 / -1;
}
.counter,
.register {
  display: flex;
  justify-content: space-between;
  padding: 3px 8px;
  border-radius: 4px;
  background-color: var(--panel);
  color: var(--text);
}
.counter i,
.register i {
  font-style: normal;
  color: var(--muted);
}
.files {
  margin: 6px 0 0;
  color: var(--muted);
}
.files + .files {
  margin-top: 0;
}

.registers {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 3px;
  font-size: 11px;
}
.register {
  padding: 2px 5px;
}
.register.changed {
  background-color: var(--accent);
  color: var(--ink);
}
.register.changed i {
  color: var(--ink);
}

.listing {
  margin: 0;
  padding: 4px 0;
  border-radius: 6px;
  background-color: var(--panel);
  list-style: none;
}
.listing li {
  padding: 1px 10px;
  white-space: pre;
  overflow: hidden;
  color: var(--text);
}
.listing li.current {
  background-color: var(--accent);
  color: var(--ink);
}
.listing .address {
  margin-right: 14px;
  color: var(--muted);
}
.listing li.current .address {
  color: var(--ink);
}

.timing {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}
.timed {
  color: var(--text);
}
.timed b {
  margin-right: 4px;
  padding: 2px 6px;
  border-radius: 4px;
  background-color: var(--raised);
  color: var(--accent);
  font-weight: 600;
}
</style>
