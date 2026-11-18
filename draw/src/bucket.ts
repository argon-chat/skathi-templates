export interface BucketOptions {
  layer?: string;
  tolerance: number;
  gap: number;
  expand: number;
}

function grow(mask: Uint8Array, w: number, h: number, radius: number) {
  if (!radius) return mask;
  const temp = new Uint8Array(mask.length);
  const result = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let count = 0;
    for (let x = -radius; x < w; x++) {
      if (x + radius < w) count += mask[row + x + radius]!;
      if (x - radius - 1 >= 0) count -= mask[row + x - radius - 1]!;
      if (x >= 0) temp[row + x] = Number(count > 0);
    }
  }
  for (let x = 0; x < w; x++) {
    let count = 0;
    for (let y = -radius; y < h; y++) {
      if (y + radius < h) count += temp[(y + radius) * w + x]!;
      if (y - radius - 1 >= 0) count -= temp[(y - radius - 1) * w + x]!;
      if (y >= 0) result[y * w + x] = Number(count > 0);
    }
  }
  return result;
}

function rings(mask: Uint8Array, w: number, h: number, ox: number, oy: number) {
  const edges = new Map<number, number>();
  const stride = w + 1;
  const mark = (p: number, d: number) => edges.set(p, (edges.get(p) ?? 0) | (1 << d));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (!mask[p]) continue;
      const a = y * stride + x;
      if (!y || !mask[p - w]) mark(a, 0);
      if (x + 1 === w || !mask[p + 1]) mark(a + 1, 1);
      if (y + 1 === h || !mask[p + w]) mark(a + stride + 1, 2);
      if (!x || !mask[p - 1]) mark(a + stride, 3);
    }
  const output: number[][] = [];
  const steps = [1, stride, -1, -stride];
  while (edges.size) {
    const it = edges.keys().next();
    if (it.done) break;
    const start = it.value;
    let p = start,
      d = 0;
    while (!(edges.get(p)! & (1 << d))) d++;
    const ring: number[] = [ox + (start % stride), oy + Math.floor(start / stride)];
    do {
      const bits = edges.get(p)! & ~(1 << d);
      if (bits) edges.set(p, bits);
      else edges.delete(p);
      const next = p + steps[d]!;
      const remaining = edges.get(next) ?? 0;
      const turn = [(d + 1) % 4, d, (d + 3) % 4, (d + 2) % 4].find((k) => remaining & (1 << k));
      if (next !== start && turn !== d) ring.push(ox + (next % stride), oy + Math.floor(next / stride));
      p = next;
      if (p !== start && turn === undefined) throw new Error("Could not trace the fill boundary.");
      d = turn ?? 0;
    } while (p !== start);
    if (ring.length >= 6) output.push(simplify(ring));
  }
  return output;
}

function simplify(ring: number[]) {
  if (ring.length < 10) return ring;
  if (ring[0] === ring.at(-2) && ring[1] === ring.at(-1)) ring.splice(-2);
  const p = ring.concat(ring[0]!, ring[1]!);
  const keep = new Set([0, p.length - 2]);
  const pending = [[0, p.length - 2]];
  while (pending.length) {
    const [a, b] = pending.pop() as [number, number];
    const dx = p[b]! - p[a]!,
      dy = p[b + 1]! - p[a + 1]!;
    const length = dx * dx + dy * dy;
    let furthest = 0.32,
      index = -1;
    for (let j = a + 2; j < b; j += 2) {
      const ox = p[j]! - p[a]!,
        oy = p[j + 1]! - p[a + 1]!;
      const t = length ? Math.max(0, Math.min(1, (ox * dx + oy * dy) / length)) : 0;
      const dist = (ox - t * dx) ** 2 + (oy - t * dy) ** 2;
      if (dist > furthest) {
        index = j;
        furthest = dist;
      }
    }
    if (index >= 0) {
      keep.add(index);
      pending.push([a, index], [index, b]);
    }
  }
  const result: number[] = [];
  for (let i = 0; i < ring.length; i += 2) if (keep.has(i)) result.push(ring[i]!, ring[i + 1]!);
  return result.length >= 6 ? result : ring;
}

export function floodContours(
  pixels: Uint8ClampedArray,
  w: number,
  h: number,
  x: number,
  y: number,
  ox: number,
  oy: number,
  options: BucketOptions,
): number[][] | null {
  const start = y * w + x;
  if (x < 0 || y < 0 || x >= w || y >= h) return null;
  const wall = new Uint8Array(w * h);
  const seed = start * 4;
  for (let p = 0; p < wall.length; p++) {
    const a = pixels[p * 4 + 3]! / 255,
      b = pixels[seed + 3]! / 255;
    let diff = Math.abs(a - b) * 255;
    for (let c = 0; c < 3; c++) diff = Math.max(diff, Math.abs(pixels[p * 4 + c]! * a - pixels[seed + c]! * b));
    wall[p] = Number(diff > options.tolerance);
  }
  const close = Math.ceil(Math.max(0, options.gap) / 2);
  const blocked = grow(wall, w, h, close);
  if (blocked[start]) return [];
  const fill = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let read = 0,
    write = 1;
  queue[0] = start;
  fill[start] = 1;
  const push = (p: number) => {
    if (!blocked[p] && !fill[p]) {
      fill[p] = 1;
      queue[write++] = p;
    }
  };
  while (read < write) {
    const p = queue[read++]!;
    const col = p % w;
    if (!col || col === w - 1 || p < w || p >= w * (h - 1)) return null;
    push(p - 1);
    push(p + 1);
    push(p - w);
    push(p + w);
  }
  return rings(grow(fill, w, h, close + Math.round(Math.max(0, options.expand))), w, h, ox, oy);
}
