export type Bytes = Uint8Array<ArrayBuffer>;
export const LIMITS = {
  file: 48 * 1024 * 1024,
  expanded: 64 * 1024 * 1024,
  chunk: 24 * 1024 * 1024,
  chunks: 65_536,
  points: 1_100_000,
  pointsPerStroke: 64_000,
  pixels: 6_000_000,
  patchSide: 4096,
  events: 160_000,
  strokes: 55_000,
  removed: 220_000,
  layers: 32,
  symbols: 65_536,
  string: 4096,
  dabs: 2_000_000,
  vertices: 20_000_000,
  verticesPerStroke: 300_000,
} as const;
export const bad = (why: string): never => {
  throw new Error(`Invalid SKEV recording (${why}).`);
};
export const natural = (n: number) => Number.isSafeInteger(n) && n >= 0;
declare const TextEncoder: new () => { encode(s: string): Bytes };
declare const TextDecoder: new (encoding: string, options: { fatal: boolean }) => { decode(b: Uint8Array): string };
const utf8 = new TextEncoder(),
  utf8Reader = new TextDecoder("utf-8", { fatal: true });
export class Writer {
  private buf = new Uint8Array(256);
  private pos = 0;
  private reserve(n: number) {
    const size = this.pos + n;
    if (size <= this.buf.length) return;
    if (size > LIMITS.chunk + 16) bad("chunk too large");
    const next = new Uint8Array(Math.min(LIMITS.chunk + 16, Math.max(size, this.buf.length * 2)));
    next.set(this.buf);
    this.buf = next;
  }
  byte(n: number) {
    this.reserve(1);
    this.buf[this.pos++] = n;
  }
  u16(n: number) {
    this.byte(n);
    this.byte(n >>> 8);
  }
  u32(n: number) {
    this.u16(n);
    this.u16(n >>> 16);
  }
  u64(n: number) {
    if (!natural(n)) bad("invalid timestamp");
    this.u32(n >>> 0);
    this.u32(Math.floor(n / 2 ** 32));
  }
  float(n: number) {
    if (!Number.isFinite(n)) bad("nonfinite number");
    this.reserve(8);
    new DataView(this.buf.buffer).setFloat64(this.pos, n, true);
    this.pos += 8;
  }
  uint(n: number) {
    if (!natural(n)) bad("invalid integer");
    while (n >= 128) {
      this.byte(128 + (n % 128));
      n = Math.floor(n / 128);
    }
    this.byte(n);
  }
  sint(n: number) {
    this.uint(n < 0 ? -n * 2 - 1 : n * 2);
  }
  raw(b: Uint8Array) {
    this.reserve(b.length);
    this.buf.set(b, this.pos);
    this.pos += b.length;
  }
  block(b: Uint8Array) {
    this.uint(b.length);
    this.raw(b);
  }
  text(s: string) {
    if (s.length > LIMITS.string) bad("string too long");
    const b = utf8.encode(s);
    if (b.length > LIMITS.string) bad("string too long");
    this.block(b);
  }
  result() {
    return this.buf.subarray(0, this.pos);
  }
}
export class Reader {
  pos = 0;
  readonly view: DataView;
  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  get left() {
    return this.bytes.length - this.pos;
  }
  raw(n: number) {
    if (!natural(n) || n > this.left) bad("incomplete field");
    const at = this.pos;
    this.pos += n;
    return this.bytes.subarray(at, this.pos);
  }
  child(max: number = LIMITS.chunk) {
    return new Reader(this.raw(this.uint(max)));
  }
  byte(): number {
    return this.bytes[this.pos++] ?? bad("incomplete byte");
  }
  u16() {
    return this.byte() + this.byte() * 256;
  }
  u32() {
    return this.u16() + this.u16() * 65536;
  }
  u64() {
    const n = this.u32() + this.u32() * 2 ** 32;
    return natural(n) ? n : bad("invalid timestamp");
  }
  float() {
    if (this.left < 8) bad("incomplete number");
    const n = this.view.getFloat64(this.pos, true);
    this.pos += 8;
    return Number.isFinite(n) ? n : bad("nonfinite number");
  }
  uint(max: number = Number.MAX_SAFE_INTEGER): number {
    let v = 0;
    for (let i = 0; i < 8; i++) {
      const b = this.byte();
      v += (b & 127) * 128 ** i;
      if (b < 128) return natural(v) && v <= max ? v : bad("integer exceeds its limit");
    }
    return bad("oversized integer");
  }
  sint() {
    const n = this.uint();
    return n % 2 ? -(n + 1) / 2 : n / 2;
  }
  text() {
    return utf8Reader.decode(this.raw(this.uint(LIMITS.string)));
  }
}
export class LayerTable {
  private readonly names = new Map<number, string>();
  private readonly indices = new Map<string, number>();
  private next = 0;
  constructor(entries: readonly (readonly [number, string])[] = []) {
    for (const [id, name] of entries) this.bind(id, name);
  }
  private bind(id: number, name: string) {
    if (!natural(id) || id >= LIMITS.symbols || this.names.has(id) || this.indices.has(name))
      bad("invalid layer table");
    this.names.set(id, name);
    this.indices.set(name, id);
  }
  index(name: string) {
    const seen = this.indices.get(name);
    if (seen !== undefined) return seen;
    const m = /^layer-([1-9][0-9]{0,4})$/.exec(name);
    let id = m ? Number(m[1]) - 1 : -1;
    if (id < 0 || id >= LIMITS.symbols || this.names.has(id)) {
      while (this.names.has(this.next)) this.next++;
      id = this.next++;
    }
    this.bind(id, name);
    return id;
  }
  name(id: number) {
    return this.names.get(id) ?? `layer-${id + 1}`;
  }
  entries() {
    return Array.from(this.names.entries());
  }
  clone() {
    return new LayerTable(this.entries());
  }
}
export function joinBytes(parts: readonly Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
interface Deflater {
  writable: { getWriter(): { write(b: Uint8Array): Promise<void>; close(): Promise<void> } };
  readable: { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }>; cancel(): Promise<void> } };
}
declare const CompressionStream: new (f: "deflate-raw") => Deflater;
declare const DecompressionStream: new (f: "deflate-raw") => Deflater;
export async function transform(input: Uint8Array, decode: boolean, limit: number = LIMITS.chunk): Promise<Bytes> {
  const stream = decode ? new DecompressionStream("deflate-raw") : new CompressionStream("deflate-raw");
  const reader = stream.readable.getReader(),
    writer = stream.writable.getWriter();
  const read = async () => {
    let n = 0;
    const parts: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return joinBytes(parts);
      if (!value) continue;
      n += value.length;
      if (n > limit) {
        void reader.cancel().catch(() => {});
        return bad("expanded chunk too large");
      }
      parts.push(value);
    }
  };
  const write = async () => {
    // Bound native inflation per write before the readable side sees its output.
    const step = decode ? 4096 : Math.max(1, input.length);
    for (let i = 0; i < input.length; i += step) await writer.write(input.subarray(i, i + step));
    await writer.close();
  };
  const [out] = await Promise.all([read(), write()]);
  return out;
}
const crcTable = Uint32Array.from({ length: 256 }, (_, i) => {
  let c = i;
  for (let n = 0; n < 8; n++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  return c >>> 0;
});
export function crc32(data: Uint8Array) {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = crcTable[(c ^ data[i]!) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function applyShift(shift: Uint32Array, v: number) {
  return (
    shift[v & 255]! ^ shift[256 + ((v >>> 8) & 255)]! ^ shift[512 + ((v >>> 16) & 255)]! ^ shift[768 + (v >>> 24)]!
  );
}
// powers[k] advances a CRC by 2**k zero bytes. CRC is linear over GF(2), so each
// operator is the XOR of four byte-table entries and its square is the next power.
const powers: Uint32Array[] = [];
function shiftCrc(crc: number, length: number): number {
  for (let k = 0; length; k++, length >>>= 1) {
    if (!powers[k]) {
      const previous = powers[k - 1];
      const table = new Uint32Array(1024);
      for (let i = 0; i < 32; i++) {
        const basis = 1 << i;
        const value = previous
          ? applyShift(previous, applyShift(previous, basis))
          : crcTable[basis & 255]! ^ (basis >>> 8);
        const base = (i >>> 3) * 256,
          bit = 1 << (i & 7);
        for (let j = 0; j < bit; j++) table[base + bit + j] = table[base + j]! ^ value;
      }
      powers[k] = table;
    }
    if (length & 1) crc = applyShift(powers[k]!, crc);
  }
  return crc >>> 0;
}
/** CRC of arbitrary overlapping ranges without rescanning large payloads. Used only for damaged frame lengths. */
export function indexedCrc32(data: Uint8Array) {
  const stride = 32;
  const prefix = new Uint32Array(Math.floor(data.length / stride) + 1);
  let c = 0xffffffff;
  prefix[0] = c;
  for (let i = 0; i < data.length; i++) {
    c = crcTable[(c ^ data[i]!) & 255]! ^ (c >>> 8);
    if ((i + 1) % stride === 0) prefix[(i + 1) / stride] = c;
  }
  function at(end: number) {
    const block = Math.floor(end / stride);
    let state = prefix[block]!;
    for (let i = block * stride; i < end; i++) state = crcTable[(state ^ data[i]!) & 255]! ^ (state >>> 8);
    return (state ^ 0xffffffff) >>> 0;
  }
  // CRC(A || B) = shift(CRC(A), |B|) XOR CRC(B).
  return (start: number, end: number) => (at(end) ^ shiftCrc(at(start), end - start)) >>> 0;
}
export function packChunk(id: number, payload: Uint8Array) {
  const w = new Writer();
  w.byte(id);
  w.block(payload);
  w.u32(crc32(w.result()));
  return w.result();
}
