<script setup lang="ts">
// What the CPU holds right now. Everything here is read again when `frame` changes: once a
// display frame while the machine runs, and after every step while it is paused.
import { Hex } from "skathi:encoding";
import { computed } from "vue";
import { disassemble } from "../chip8/asm";
import { PROGRAM_START } from "../chip8/cpu";
import { cpu, frame, hasBreakpoint, machine, toggleBreakpoint } from "../machine";

const ROWS = 12;
const hex = (value: number, digits: number) => value.toString(16).toUpperCase().padStart(digits, "0");

const registers = computed(() => {
  void frame.value;
  return [...cpu.v].map((value, index) => ({ name: `V${hex(index, 1)}`, value: hex(value, 2) }));
});

const special = computed(() => {
  void frame.value;
  return [
    { name: "PC", value: hex(cpu.pc, 3) },
    { name: "I", value: hex(cpu.i, 3) },
    { name: "SP", value: String(cpu.sp) },
    { name: "DT", value: hex(cpu.delay, 2) },
    { name: "ST", value: hex(cpu.sound, 2) },
  ];
});

// The listing keeps the current instruction a few rows down, and never starts before the program.
const listing = computed(() => {
  void frame.value;
  const first = Math.max(PROGRAM_START, cpu.pc - 8);
  return Array.from({ length: ROWS }, (_, row) => {
    const address = first + row * 2;
    return {
      address,
      label: hex(address, 3),
      text: disassemble(cpu.opcodeAt(address)),
      current: address === cpu.pc,
      breakpoint: hasBreakpoint(address),
    };
  });
});

const memory = computed(() => {
  void frame.value;
  const start = cpu.i & 0xff8;
  return Hex.dump(cpu.memory.subarray(start, start + 32), { width: 8, offset: start }).trimEnd();
});

const trace = computed(() => {
  void frame.value;
  return [...cpu.trace.toArray()]
    .slice(-4)
    .map((address) => `${hex(address, 3)}  ${disassemble(cpu.opcodeAt(address))}`);
});

const halted = computed(() => {
  void frame.value;
  return cpu.halted !== null;
});

const status = computed(() => {
  void frame.value;
  if (cpu.halted === "breakpoint") return `Stopped at a breakpoint, ${hex(cpu.pc, 3)}`;
  if (cpu.halted === "bad-opcode") return `${hex(cpu.opcodeAt(cpu.pc), 4)} at ${hex(cpu.pc, 3)} is not an instruction`;
  if (cpu.halted === "stack") return `The call stack ran out at ${hex(cpu.pc, 3)}`;
  if (cpu.waiting >= 0) return `Waiting for a key (V${hex(cpu.waiting, 1)})`;
  return machine.running ? "Running" : "Paused";
});
</script>

<template>
  <aside class="debugger">
    <p class="status" :class="{ halted }">{{ status }}</p>

    <section>
      <h2>Registers</h2>
      <div class="registers">
        <span v-for="r in registers" :key="r.name" class="register"
          ><i>{{ r.name }}</i
          >{{ r.value }}</span
        >
      </div>
      <div class="registers special">
        <span v-for="r in special" :key="r.name" class="register"
          ><i>{{ r.name }}</i
          >{{ r.value }}</span
        >
      </div>
    </section>

    <section>
      <h2>Program <small>click a line for a breakpoint</small></h2>
      <ol class="listing">
        <li
          v-for="line in listing"
          :key="line.address"
          :class="{ current: line.current, breakpoint: line.breakpoint }"
          @click="toggleBreakpoint(line.address)"
        >
          <span class="dot" /><span class="address">{{ line.label }}</span
          >{{ line.text }}
        </li>
      </ol>
    </section>

    <section>
      <h2>Memory at I</h2>
      <pre class="memory">{{ memory }}</pre>
    </section>

    <section>
      <h2>Last instructions</h2>
      <pre class="memory">{{ trace.join("\n") || "none yet" }}</pre>
    </section>
  </aside>
</template>

<style>
.debugger {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}
.debugger h2 {
  margin: 0 0 6px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}
.debugger h2 small {
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
.registers {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 4px;
}
.registers.special {
  grid-template-columns: repeat(5, 1fr);
  margin-top: 4px;
}
.register {
  display: flex;
  flex-direction: column;
  padding: 3px 0;
  border-radius: 4px;
  background-color: var(--raised);
  text-align: center;
}
.register i {
  font-size: 10px;
  font-style: normal;
  color: var(--muted);
}
.listing {
  margin: 0;
  padding: 0;
  list-style: none;
}
.listing li {
  display: flex;
  align-items: center;
  height: 20px;
  padding: 0 6px;
  border-radius: 4px;
  white-space: pre;
}
.listing li:hover {
  background-color: var(--raised);
}
.listing li.current {
  background-color: var(--accent);
  color: var(--ink);
}
.listing .dot {
  width: 8px;
  height: 8px;
  margin-right: 8px;
  border-radius: 4px;
}
.listing .breakpoint .dot {
  background-color: var(--danger);
}
.listing .address {
  width: 44px;
  color: var(--muted);
}
.listing .current .address {
  color: var(--ink);
}
.memory {
  margin: 0;
  padding: 8px 10px;
  border-radius: 6px;
  background-color: var(--raised);
  font: inherit;
  white-space: pre;
  overflow: hidden;
}
</style>
