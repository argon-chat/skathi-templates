// RV32IM instructions as text, in the assembler's own spelling: ABI register names and the common
// pseudo-instructions.

export const REGISTERS =
  "zero ra sp gp tp t0 t1 t2 s0 s1 a0 a1 a2 a3 a4 a5 a6 a7 s2 s3 s4 s5 s6 s7 s8 s9 s10 s11 t3 t4 t5 t6".split(" ");

const IMM = ["addi", "slli", "slti", "sltiu", "xori", "srli", "ori", "andi"];
const REG = ["add", "sll", "slt", "sltu", "xor", "srl", "or", "and"];
const MUL = ["mul", "mulh", "mulhsu", "mulhu", "div", "divu", "rem", "remu"];
const LOAD = ["lb", "lh", "lw", "", "lbu", "lhu", "", ""];
const STORE = ["sb", "sh", "sw", "", "", "", "", ""];
const BRANCH = ["beq", "bne", "", "", "blt", "bge", "bltu", "bgeu"];

export const hex = (value: number, digits = 8): string => (value >>> 0).toString(16).padStart(digits, "0");

const reg = (index: number): string => REGISTERS[index & 31] ?? "?";

/** The instruction word `ins`, as it reads at address `pc`. */
export function disassemble(ins: number, pc: number): string {
  const rd = reg(ins >> 7);
  const rs1 = reg(ins >> 15);
  const rs2 = reg(ins >> 20);
  const funct3 = (ins >> 12) & 7;
  const imm = ins >> 20;
  switch (ins & 0x7f) {
    case 0x13: {
      if (ins === 0x13) return "nop";
      if (funct3 === 0 && rs1 === "zero") return `li ${rd}, ${imm}`;
      if (funct3 === 0 && imm === 0) return `mv ${rd}, ${rs1}`;
      if (funct3 === 1) return `slli ${rd}, ${rs1}, ${imm & 31}`;
      if (funct3 === 5) return `${ins & 0x40000000 ? "srai" : "srli"} ${rd}, ${rs1}, ${imm & 31}`;
      return `${IMM[funct3]} ${rd}, ${rs1}, ${imm}`;
    }
    case 0x33: {
      const funct7 = ins >>> 25;
      const name =
        funct7 === 1
          ? MUL[funct3]
          : funct7 === 0x20
            ? funct3 === 0
              ? "sub"
              : funct3 === 5
                ? "sra"
                : ""
            : funct7 === 0
              ? REG[funct3]
              : "";
      return name ? `${name} ${rd}, ${rs1}, ${rs2}` : word(ins);
    }
    case 0x03:
      return LOAD[funct3] ? `${LOAD[funct3]} ${rd}, ${imm}(${rs1})` : word(ins);
    case 0x23:
      return STORE[funct3] ? `${STORE[funct3]} ${rs2}, ${((ins >> 25) << 5) | ((ins >> 7) & 31)}(${rs1})` : word(ins);
    case 0x63: {
      const to = pc + (((ins >> 31) << 12) | ((ins << 4) & 0x800) | ((ins >> 20) & 0x7e0) | ((ins >> 7) & 0x1e));
      return BRANCH[funct3] ? `${BRANCH[funct3]} ${rs1}, ${rs2}, ${hex(to, 6)}` : word(ins);
    }
    case 0x6f: {
      const to = pc + (((ins >> 31) << 20) | (ins & 0xff000) | ((ins >> 9) & 0x800) | ((ins >> 20) & 0x7fe));
      return rd === "zero" ? `j ${hex(to, 6)}` : `jal ${rd}, ${hex(to, 6)}`;
    }
    case 0x67:
      if (ins === 0x8067) return "ret";
      return rd === "zero" ? `jr ${imm}(${rs1})` : `jalr ${rd}, ${imm}(${rs1})`;
    case 0x37:
      return `lui ${rd}, 0x${hex(ins >>> 12, 5)}`;
    case 0x17:
      return `auipc ${rd}, 0x${hex(ins >>> 12, 5)}`;
    case 0x0f:
      return "fence";
    case 0x73:
      return ins === 0x73 ? "ecall" : ins === 0x100073 ? "ebreak" : word(ins);
    default:
      return word(ins);
  }
}

const word = (ins: number): string => `.word 0x${hex(ins)}`;
