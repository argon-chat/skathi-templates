// An RV32IM interpreter: one flat little-endian memory, no privilege levels, `ecall` as the door to the host.
// Each instruction is decoded once: `code` holds four words per instruction (operation, then its operands)
// at the index of the instruction's address, filled in on first execution. Code is assumed not to change
// once it has run.

export type HostCall = (cpu: Rv32) => void;

const enum Op {
  Decode = 0,
  Nop,
  Li,
  Mv,
  Addi,
  Slli,
  Slti,
  Sltiu,
  Xori,
  Srli,
  Srai,
  Ori,
  Andi,
  Add,
  Sub,
  Sll,
  Slt,
  Sltu,
  Xor,
  Srl,
  Sra,
  Or,
  And,
  Mul,
  Mulh,
  Mulhsu,
  Mulhu,
  Div,
  Divu,
  Rem,
  Remu,
  Lb,
  Lh,
  Lw,
  Lbu,
  Lhu,
  Sb,
  Sh,
  Sw,
  Beq,
  Bne,
  Blt,
  Bge,
  Bltu,
  Bgeu,
  Jal,
  J,
  Jalr,
  Jr,
  Ecall,
  Fault,
}

const IMM_OPS = [Op.Addi, Op.Slli, Op.Slti, Op.Sltiu, Op.Xori, Op.Srli, Op.Ori, Op.Andi];
const REG_OPS = [Op.Add, Op.Sll, Op.Slt, Op.Sltu, Op.Xor, Op.Srl, Op.Or, Op.And];
const MUL_OPS = [Op.Mul, Op.Mulh, Op.Mulhsu, Op.Mulhu, Op.Div, Op.Divu, Op.Rem, Op.Remu];
const LOAD_OPS = [Op.Lb, Op.Lh, Op.Lw, Op.Fault, Op.Lbu, Op.Lhu, Op.Fault, Op.Fault];
const STORE_OPS = [Op.Sb, Op.Sh, Op.Sw, Op.Fault, Op.Fault, Op.Fault, Op.Fault, Op.Fault];
const BRANCH_OPS = [Op.Beq, Op.Bne, Op.Fault, Op.Fault, Op.Blt, Op.Bge, Op.Bltu, Op.Bgeu];

export class Rv32 {
  readonly memory: ArrayBuffer;
  readonly u8: Uint8Array;
  readonly i8: Int8Array;
  readonly u16: Uint16Array;
  readonly i16: Int16Array;
  readonly i32: Int32Array;
  readonly x = new Int32Array(32);
  pc = 0;
  /** Instructions run since the last reset. */
  cycles = 0;
  halted = false;
  /** A host call sets this to leave `run` before its budget is spent. */
  yielded = false;
  /** Why the machine halted, when it was not the guest's own exit. */
  fault: string | null = null;
  private readonly code: Int32Array;

  /** `codeEnd` is the address past the last instruction: nothing above it can run. */
  constructor(
    size: number,
    codeEnd: number,
    private readonly hostCall: HostCall,
  ) {
    this.memory = new ArrayBuffer(size);
    this.u8 = new Uint8Array(this.memory);
    this.i8 = new Int8Array(this.memory);
    this.u16 = new Uint16Array(this.memory);
    this.i16 = new Int16Array(this.memory);
    this.i32 = new Int32Array(this.memory);
    this.code = new Int32Array((codeEnd + 3) & ~3);
  }

  reset(entry: number): void {
    this.x.fill(0);
    this.code.fill(0);
    this.pc = entry;
    this.cycles = 0;
    this.halted = false;
    this.yielded = false;
    this.fault = null;
  }

  /** Runs up to `budget` instructions; returns how many ran. */
  run(budget: number): number {
    const { x, u8, i8, u16, i16, i32, code } = this;
    let pc = this.pc;
    // An AOT image has no run to learn from that the budget is an integer: this tells it.
    const end = budget | 0;
    let left = end;
    let mark = end;
    this.yielded = false;
    if (this.halted) return 0;

    loop: while (left > 0) {
      left--;
      switch (code[pc]) {
        case Op.Decode:
          this.decode(pc);
          left++;
          if (this.fault !== null) break loop;
          continue;
        case Op.Nop:
          pc = (pc + 4) | 0;
          continue;
        case Op.Li:
          x[code[pc + 1]!] = code[pc + 3]!;
          pc = (pc + 4) | 0;
          continue;
        case Op.Mv:
          x[code[pc + 1]!] = x[code[pc + 2]!]!;
          pc = (pc + 4) | 0;
          continue;
        case Op.Addi:
          x[code[pc + 1]!] = x[code[pc + 2]!]! + code[pc + 3]!;
          pc = (pc + 4) | 0;
          continue;
        case Op.Slli:
          x[code[pc + 1]!] = x[code[pc + 2]!]! << code[pc + 3]!;
          pc = (pc + 4) | 0;
          continue;
        case Op.Slti:
          x[code[pc + 1]!] = x[code[pc + 2]!]! < code[pc + 3]! ? 1 : 0;
          pc = (pc + 4) | 0;
          continue;
        case Op.Sltiu:
          x[code[pc + 1]!] = x[code[pc + 2]!]! >>> 0 < code[pc + 3]! >>> 0 ? 1 : 0;
          pc = (pc + 4) | 0;
          continue;
        case Op.Xori:
          x[code[pc + 1]!] = x[code[pc + 2]!]! ^ code[pc + 3]!;
          pc = (pc + 4) | 0;
          continue;
        case Op.Srli:
          x[code[pc + 1]!] = x[code[pc + 2]!]! >>> code[pc + 3]!;
          pc = (pc + 4) | 0;
          continue;
        case Op.Srai:
          x[code[pc + 1]!] = x[code[pc + 2]!]! >> code[pc + 3]!;
          pc = (pc + 4) | 0;
          continue;
        case Op.Ori:
          x[code[pc + 1]!] = x[code[pc + 2]!]! | code[pc + 3]!;
          pc = (pc + 4) | 0;
          continue;
        case Op.Andi:
          x[code[pc + 1]!] = x[code[pc + 2]!]! & code[pc + 3]!;
          pc = (pc + 4) | 0;
          continue;
        case Op.Add:
          x[code[pc + 1]!] = x[code[pc + 2]!]! + x[code[pc + 3]!]!;
          pc = (pc + 4) | 0;
          continue;
        case Op.Sub:
          x[code[pc + 1]!] = x[code[pc + 2]!]! - x[code[pc + 3]!]!;
          pc = (pc + 4) | 0;
          continue;
        case Op.Sll:
          x[code[pc + 1]!] = x[code[pc + 2]!]! << (x[code[pc + 3]!]! & 31);
          pc = (pc + 4) | 0;
          continue;
        case Op.Slt:
          x[code[pc + 1]!] = x[code[pc + 2]!]! < x[code[pc + 3]!]! ? 1 : 0;
          pc = (pc + 4) | 0;
          continue;
        case Op.Sltu:
          x[code[pc + 1]!] = x[code[pc + 2]!]! >>> 0 < x[code[pc + 3]!]! >>> 0 ? 1 : 0;
          pc = (pc + 4) | 0;
          continue;
        case Op.Xor:
          x[code[pc + 1]!] = x[code[pc + 2]!]! ^ x[code[pc + 3]!]!;
          pc = (pc + 4) | 0;
          continue;
        case Op.Srl:
          x[code[pc + 1]!] = x[code[pc + 2]!]! >>> (x[code[pc + 3]!]! & 31);
          pc = (pc + 4) | 0;
          continue;
        case Op.Sra:
          x[code[pc + 1]!] = x[code[pc + 2]!]! >> (x[code[pc + 3]!]! & 31);
          pc = (pc + 4) | 0;
          continue;
        case Op.Or:
          x[code[pc + 1]!] = x[code[pc + 2]!]! | x[code[pc + 3]!]!;
          pc = (pc + 4) | 0;
          continue;
        case Op.And:
          x[code[pc + 1]!] = x[code[pc + 2]!]! & x[code[pc + 3]!]!;
          pc = (pc + 4) | 0;
          continue;
        case Op.Mul:
          x[code[pc + 1]!] = Math.imul(x[code[pc + 2]!]!, x[code[pc + 3]!]!);
          pc = (pc + 4) | 0;
          continue;
        case Op.Mulh: {
          const a = x[code[pc + 2]!]!;
          const b = x[code[pc + 3]!]!;
          x[code[pc + 1]!] = mulhu(a, b) - (a < 0 ? b : 0) - (b < 0 ? a : 0);
          pc = (pc + 4) | 0;
          continue;
        }
        case Op.Mulhsu: {
          const a = x[code[pc + 2]!]!;
          const b = x[code[pc + 3]!]!;
          x[code[pc + 1]!] = mulhu(a, b) - (a < 0 ? b : 0);
          pc = (pc + 4) | 0;
          continue;
        }
        case Op.Mulhu:
          x[code[pc + 1]!] = mulhu(x[code[pc + 2]!]!, x[code[pc + 3]!]!);
          pc = (pc + 4) | 0;
          continue;
        case Op.Div: {
          const a = x[code[pc + 2]!]!;
          const b = x[code[pc + 3]!]!;
          x[code[pc + 1]!] = b === 0 ? -1 : a === -0x80000000 && b === -1 ? a : (a / b) | 0;
          pc = (pc + 4) | 0;
          continue;
        }
        case Op.Divu: {
          const b = x[code[pc + 3]!]!;
          x[code[pc + 1]!] = b === 0 ? -1 : ((x[code[pc + 2]!]! >>> 0) / (b >>> 0)) | 0;
          pc = (pc + 4) | 0;
          continue;
        }
        case Op.Rem: {
          const a = x[code[pc + 2]!]!;
          const b = x[code[pc + 3]!]!;
          x[code[pc + 1]!] = b === 0 ? a : a === -0x80000000 && b === -1 ? 0 : a % b;
          pc = (pc + 4) | 0;
          continue;
        }
        case Op.Remu: {
          const a = x[code[pc + 2]!]!;
          const b = x[code[pc + 3]!]!;
          x[code[pc + 1]!] = b === 0 ? a : ((a >>> 0) % (b >>> 0)) | 0;
          pc = (pc + 4) | 0;
          continue;
        }
        case Op.Lb:
          x[code[pc + 1]!] = i8[(x[code[pc + 2]!]! + code[pc + 3]!) >>> 0]!;
          pc = (pc + 4) | 0;
          continue;
        case Op.Lbu:
          x[code[pc + 1]!] = u8[(x[code[pc + 2]!]! + code[pc + 3]!) >>> 0]!;
          pc = (pc + 4) | 0;
          continue;
        case Op.Lh: {
          const at = (x[code[pc + 2]!]! + code[pc + 3]!) | 0;
          x[code[pc + 1]!] = at & 1 ? (i8[(at + 1) >>> 0]! << 8) | u8[at >>> 0]! : i16[at >>> 1]!;
          pc = (pc + 4) | 0;
          continue;
        }
        case Op.Lhu: {
          const at = (x[code[pc + 2]!]! + code[pc + 3]!) | 0;
          x[code[pc + 1]!] = at & 1 ? (u8[(at + 1) >>> 0]! << 8) | u8[at >>> 0]! : u16[at >>> 1]!;
          pc = (pc + 4) | 0;
          continue;
        }
        case Op.Lw: {
          const at = (x[code[pc + 2]!]! + code[pc + 3]!) | 0;
          x[code[pc + 1]!] =
            at & 3
              ? u8[at >>> 0]! | (u8[(at + 1) >>> 0]! << 8) | (u8[(at + 2) >>> 0]! << 16) | (u8[(at + 3) >>> 0]! << 24)
              : i32[at >>> 2]!;
          pc = (pc + 4) | 0;
          continue;
        }
        case Op.Sb:
          u8[(x[code[pc + 2]!]! + code[pc + 3]!) >>> 0] = x[code[pc + 1]!]!;
          pc = (pc + 4) | 0;
          continue;
        case Op.Sh: {
          const at = (x[code[pc + 2]!]! + code[pc + 3]!) | 0;
          const value = x[code[pc + 1]!]!;
          if (at & 1) {
            u8[at >>> 0] = value;
            u8[(at + 1) >>> 0] = value >> 8;
          } else u16[at >>> 1] = value;
          pc = (pc + 4) | 0;
          continue;
        }
        case Op.Sw: {
          const at = (x[code[pc + 2]!]! + code[pc + 3]!) | 0;
          const value = x[code[pc + 1]!]!;
          if (at & 3) {
            u8[at >>> 0] = value;
            u8[(at + 1) >>> 0] = value >> 8;
            u8[(at + 2) >>> 0] = value >> 16;
            u8[(at + 3) >>> 0] = value >> 24;
          } else i32[at >>> 2] = value;
          pc = (pc + 4) | 0;
          continue;
        }
        case Op.Beq:
          pc = x[code[pc + 1]!]! === x[code[pc + 2]!]! ? code[pc + 3]! : (pc + 4) | 0;
          continue;
        case Op.Bne:
          pc = x[code[pc + 1]!]! !== x[code[pc + 2]!]! ? code[pc + 3]! : (pc + 4) | 0;
          continue;
        case Op.Blt:
          pc = x[code[pc + 1]!]! < x[code[pc + 2]!]! ? code[pc + 3]! : (pc + 4) | 0;
          continue;
        case Op.Bge:
          pc = x[code[pc + 1]!]! >= x[code[pc + 2]!]! ? code[pc + 3]! : (pc + 4) | 0;
          continue;
        case Op.Bltu:
          pc = x[code[pc + 1]!]! >>> 0 < x[code[pc + 2]!]! >>> 0 ? code[pc + 3]! : (pc + 4) | 0;
          continue;
        case Op.Bgeu:
          pc = x[code[pc + 1]!]! >>> 0 >= x[code[pc + 2]!]! >>> 0 ? code[pc + 3]! : (pc + 4) | 0;
          continue;
        case Op.Jal:
          x[code[pc + 1]!] = pc + 4;
          pc = code[pc + 3]!;
          continue;
        case Op.J:
          pc = code[pc + 3]!;
          continue;
        case Op.Jalr: {
          const to = (x[code[pc + 2]!]! + code[pc + 3]!) & ~3;
          x[code[pc + 1]!] = pc + 4;
          pc = to;
          continue;
        }
        case Op.Jr:
          pc = (x[code[pc + 2]!]! + code[pc + 3]!) & ~3;
          continue;
        case Op.Ecall:
          pc = (pc + 4) | 0;
          this.pc = pc;
          this.cycles += mark - left;
          mark = left;
          this.hostCall(this);
          x[0] = 0;
          if (this.halted || this.yielded) break loop;
          continue;
        default:
          this.fault = `illegal instruction ${hex(i32[pc >>> 2] ?? 0)} at ${hex(pc)}`;
          break loop;
      }
    }

    if (this.fault !== null) this.halted = true;
    this.pc = pc;
    this.cycles += mark - left;
    return end - left;
  }

  private decode(pc: number): void {
    const { code } = this;
    const ins = this.i32[pc >> 2] ?? 0;
    const rd = (ins >> 7) & 31;
    const rs1 = (ins >> 15) & 31;
    const rs2 = (ins >> 20) & 31;
    const funct3 = (ins >> 12) & 7;
    let op: number = Op.Fault;
    let a = rd;
    let b = rs1;
    let c = 0;
    switch (ins & 0x7f) {
      case 0x13:
        c = ins >> 20;
        op = funct3 === 5 && ins & 0x40000000 ? Op.Srai : (IMM_OPS[funct3] ?? Op.Fault);
        if (funct3 === 1 || funct3 === 5) c &= 31;
        if (funct3 === 0 && rs1 === 0) op = Op.Li;
        else if (funct3 === 0 && c === 0) op = Op.Mv;
        if (rd === 0) op = Op.Nop;
        break;
      case 0x33:
        c = rs2;
        if (ins >>> 25 === 1) op = MUL_OPS[funct3] ?? Op.Fault;
        else if (ins >>> 25 === 0x20) op = funct3 === 0 ? Op.Sub : funct3 === 5 ? Op.Sra : Op.Fault;
        else if (ins >>> 25 === 0) op = REG_OPS[funct3] ?? Op.Fault;
        if (rd === 0 && op !== Op.Fault) op = Op.Nop;
        break;
      case 0x03:
        c = ins >> 20;
        op = LOAD_OPS[funct3] ?? Op.Fault;
        if (rd === 0 && op !== Op.Fault) op = Op.Nop;
        break;
      case 0x23:
        a = rs2;
        c = ((ins >> 25) << 5) | rd;
        op = STORE_OPS[funct3] ?? Op.Fault;
        break;
      case 0x63:
        a = rs1;
        b = rs2;
        c = (pc + (((ins >> 31) << 12) | ((ins << 4) & 0x800) | ((ins >> 20) & 0x7e0) | ((ins >> 7) & 0x1e))) | 0;
        op = BRANCH_OPS[funct3] ?? Op.Fault;
        break;
      case 0x6f:
        c = (pc + (((ins >> 31) << 20) | (ins & 0xff000) | ((ins >> 9) & 0x800) | ((ins >> 20) & 0x7fe))) | 0;
        op = rd === 0 ? Op.J : Op.Jal;
        break;
      case 0x67:
        c = ins >> 20;
        op = rd === 0 ? Op.Jr : Op.Jalr;
        break;
      case 0x37:
        b = 0;
        c = ins & 0xfffff000;
        op = rd === 0 ? Op.Nop : Op.Li;
        break;
      case 0x17:
        b = 0;
        c = (pc + (ins & 0xfffff000)) | 0;
        op = rd === 0 ? Op.Nop : Op.Li;
        break;
      case 0x0f:
        op = Op.Nop;
        break;
      case 0x73:
        if (ins === 0x73) op = Op.Ecall;
        break;
    }
    code[pc] = op;
    code[pc + 1] = a;
    code[pc + 2] = b;
    code[pc + 3] = c;
  }
}

function hex(value: number): string {
  return `0x${(value >>> 0).toString(16).padStart(8, "0")}`;
}

/** The high word of the unsigned 64-bit product, by 16-bit halves so every partial product is exact. */
function mulhu(a: number, b: number): number {
  const al = a & 0xffff;
  const ah = a >>> 16;
  const bl = b & 0xffff;
  const bh = b >>> 16;
  const m1 = ah * bl;
  const m2 = al * bh;
  const carry = (((al * bl) >>> 16) + (m1 & 0xffff) + (m2 & 0xffff)) >>> 16;
  return (ah * bh + (m1 >>> 16) + (m2 >>> 16) + carry) | 0;
}
