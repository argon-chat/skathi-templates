import { BinaryReader, BinaryWriter } from "skathi:binary";
import { Hex } from "skathi:encoding";
import { PROGRAM_START } from "./cpu";

// One line of the table is one instruction in both directions: the assembler matches the operands
// against `form`, the disassembler matches the opcode against `mask` and `bits`.
// In a form: x and y are registers, n a nibble, k a byte, a an address; anything else is literal.
interface Form {
  name: string;
  form: string;
  bits: number;
  mask: number;
}

const TABLE: [name: string, form: string, bits: number, mask: number][] = [
  ["CLS", "", 0x00e0, 0xffff],
  ["RET", "", 0x00ee, 0xffff],
  ["JP", "V0,a", 0xb000, 0xf000],
  ["JP", "a", 0x1000, 0xf000],
  ["CALL", "a", 0x2000, 0xf000],
  ["SE", "x,y", 0x5000, 0xf00f],
  ["SE", "x,k", 0x3000, 0xf000],
  ["SNE", "x,y", 0x9000, 0xf00f],
  ["SNE", "x,k", 0x4000, 0xf000],
  ["LD", "I,a", 0xa000, 0xf000],
  ["LD", "x,DT", 0xf007, 0xf0ff],
  ["LD", "x,K", 0xf00a, 0xf0ff],
  ["LD", "DT,x", 0xf015, 0xf0ff],
  ["LD", "ST,x", 0xf018, 0xf0ff],
  ["LD", "F,x", 0xf029, 0xf0ff],
  ["LD", "B,x", 0xf033, 0xf0ff],
  ["LD", "[I],x", 0xf055, 0xf0ff],
  ["LD", "x,[I]", 0xf065, 0xf0ff],
  ["LD", "x,y", 0x8000, 0xf00f],
  ["LD", "x,k", 0x6000, 0xf000],
  ["ADD", "I,x", 0xf01e, 0xf0ff],
  ["ADD", "x,y", 0x8004, 0xf00f],
  ["ADD", "x,k", 0x7000, 0xf000],
  ["OR", "x,y", 0x8001, 0xf00f],
  ["AND", "x,y", 0x8002, 0xf00f],
  ["XOR", "x,y", 0x8003, 0xf00f],
  ["SUB", "x,y", 0x8005, 0xf00f],
  ["SHR", "x", 0x8006, 0xf00f],
  ["SUBN", "x,y", 0x8007, 0xf00f],
  ["SHL", "x", 0x800e, 0xf00f],
  ["RND", "x,k", 0xc000, 0xf000],
  ["DRW", "x,y,n", 0xd000, 0xf000],
  ["SKP", "x", 0xe09e, 0xf0ff],
  ["SKNP", "x", 0xe0a1, 0xf0ff],
];
const FORMS: Form[] = TABLE.map(([name, form, bits, mask]) => ({ name, form, bits, mask }));

export class AssemblyError extends Error {
  constructor(
    readonly line: number,
    message: string,
  ) {
    super(`line ${line}: ${message}`);
  }
}

function register(text: string): number | null {
  const match = /^V([0-9A-F])$/i.exec(text);
  return match?.[1] ? parseInt(match[1], 16) : null;
}

function number(text: string, labels: Map<string, number>): number | null {
  if (labels.has(text)) return labels.get(text) ?? null;
  if (/^0x[0-9a-f]+$/i.test(text)) return parseInt(text.slice(2), 16);
  if (/^0b[01]+$/i.test(text)) return parseInt(text.slice(2), 2);
  if (/^\d+$/.test(text)) return parseInt(text, 10);
  return null;
}

function encode(form: Form, operands: string[], labels: Map<string, number>): number | null {
  const parts = form.form ? form.form.split(",") : [];
  if (parts.length !== operands.length) return null;
  let op = form.bits;
  for (const [index, part] of parts.entries()) {
    const text = operands[index] ?? "";
    if (part === "x" || part === "y") {
      const r = register(text);
      if (r === null) return null;
      op |= r << (part === "x" ? 8 : 4);
    } else if (part === "n" || part === "k" || part === "a") {
      const value = number(text, labels);
      const limit = part === "n" ? 0xf : part === "k" ? 0xff : 0xfff;
      if (value === null || value > limit) return null;
      op |= value;
    } else if (part.toUpperCase() !== text.toUpperCase()) return null;
  }
  return op;
}

interface Line {
  number: number;
  name: string;
  operands: string[];
}

/** Assembles a program that will be loaded at 0x200. Throws an `AssemblyError`. */
export function assemble(source: string): Uint8Array {
  const labels = new Map<string, number>();
  const lines: Line[] = [];
  let address = PROGRAM_START;
  for (const [index, raw] of source.split("\n").entries()) {
    let text = (raw.split(";")[0] ?? "").trim();
    const label = /^([A-Za-z_]\w*):/.exec(text);
    if (label?.[1]) {
      labels.set(label[1], address);
      text = text.slice(label[0].length).trim();
    }
    if (!text) continue;
    const [name = "", ...rest] = text.split(/\s+/);
    const operands = rest.join("").split(",").filter(Boolean);
    lines.push({ number: index + 1, name: name.toUpperCase(), operands });
    address += name.toUpperCase() === "DB" ? operands.length : 2;
  }

  const out = new BinaryWriter({ endian: "big" });
  for (const line of lines) {
    if (line.name === "DB") {
      const bytes = line.operands.map((text) => number(text, labels));
      if (bytes.some((b) => b === null || b > 0xff)) throw new AssemblyError(line.number, "DB takes bytes");
      out.writeAll(bytes as number[], "u8");
      continue;
    }
    const forms = FORMS.filter((form) => form.name === line.name);
    if (!forms.length) throw new AssemblyError(line.number, `no instruction is called ${line.name}`);
    let op: number | null = null;
    for (const form of forms) if ((op = encode(form, line.operands, labels)) !== null) break;
    if (op === null) throw new AssemblyError(line.number, `${line.name} does not take ${line.operands.join(", ")}`);
    out.writeAll([op], "u16");
  }
  return out.finish();
}

/** `LD V3, 0x1F` for an opcode, or `DB` and its two bytes for one that is not an instruction. */
export function disassemble(op: number): string {
  const form = FORMS.find((f) => (op & f.mask) === f.bits);
  if (!form) return `DB   ${Hex.format(op >> 8, 2)}, ${Hex.format(op & 0xff, 2)}`;
  const operands = (form.form ? form.form.split(",") : []).map((part) => {
    if (part === "x") return `V${((op >> 8) & 0xf).toString(16).toUpperCase()}`;
    if (part === "y") return `V${((op >> 4) & 0xf).toString(16).toUpperCase()}`;
    if (part === "n") return String(op & 0xf);
    if (part === "k") return Hex.format(op & 0xff, 2);
    if (part === "a") return Hex.format(op & 0xfff, 3);
    return part;
  });
  return `${form.name.padEnd(4)} ${operands.join(", ")}`.trimEnd();
}

/** The opcodes of a program, read as the CPU reads them: two bytes each, big-endian. */
export function opcodes(rom: Uint8Array): Uint16Array {
  return new BinaryReader(rom, { endian: "big" }).readArray(Uint16Array, rom.length >> 1);
}
