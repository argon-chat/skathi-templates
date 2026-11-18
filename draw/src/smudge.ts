import { apply, IDENTITY, type Affine } from "./geometry";
import { STRIDE, type Stroke } from "./model";

export function base64(bytes: Uint8Array | Uint8ClampedArray) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

export function unpackPixels(data: string): Uint8Array<ArrayBuffer> {
  const text = atob(data);
  return Uint8Array.from(text, (c) => c.charCodeAt(0));
}

export function smudgedPixels(stroke: Stroke) {
  const patch = stroke.patch;
  if (!patch) return null;
  const { width: w, height: h, x: ox, y: oy } = patch;
  const bytes = atob(patch.rgba);
  if (bytes.length !== w * h * 4) throw new Error("The smudge sample is incomplete.");
  const pixels = new Uint8ClampedArray(bytes.length);
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < pixels.length; i += 4) {
    const a = bytes.charCodeAt(i + 3);
    for (let c = 0; c < 3; c++) pixels[i + c] = (bytes.charCodeAt(i + c) * a) / 255;
    pixels[i + 3] = a;
  }
  const m = patch.transform ?? IDENTITY;
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-9) return null;
  const inverse: Affine = [
    m[3] / det,
    -m[1] / det,
    -m[2] / det,
    m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det,
  ];
  const radius = Math.max(1, stroke.width / (2 * Math.sqrt(Math.abs(det))));
  const p = stroke.points;
  let last = apply(inverse, p[0] ?? 0, p[1] ?? 0);
  let cx = Math.round(last.x - ox),
    cy = Math.round(last.y - oy);
  const side = 2 * Math.ceil(radius) + 1,
    mid = side >> 1;
  const paint = new Uint8ClampedArray(side * side * 4);
  const offsets: { dx: number; dy: number; weight: number; at: number }[] = [];
  for (let dy = -mid; dy <= mid; dy++)
    for (let dx = -mid; dx <= mid; dx++) {
      const r = Math.hypot(dx, dy) / radius;
      if (r >= 1) continue;
      const at = ((dy + mid) * side + dx + mid) * 4;
      offsets.push({ dx, dy, weight: (1 - r * r) ** 2, at });
      const x = cx + dx,
        y = cy + dy;
      if (x >= 0 && y >= 0 && x < w && y < h) paint.set(pixels.subarray((y * w + x) * 4, (y * w + x) * 4 + 4), at);
    }
  for (let i = STRIDE; i < p.length; i += STRIDE) {
    const next = apply(inverse, p[i]!, p[i + 1]!);
    const dist = Math.hypot(next.x - last.x, next.y - last.y);
    const steps = Math.max(1, Math.ceil(dist / Math.max(1, radius * 0.16)));
    for (let j = 1; j <= steps; j++) {
      const x0 = Math.round(last.x + ((next.x - last.x) * j) / steps - ox),
        y0 = Math.round(last.y + ((next.y - last.y) * j) / steps - oy);
      if (cx === x0 && cy === y0) continue;
      cx = x0;
      cy = y0;
      for (const { dx, dy, weight, at } of offsets) {
        const x = cx + dx,
          y = cy + dy;
        if (x < 0 || x >= w || y < 0 || y >= h) continue;
        const cell = y * w + x,
          k = cell * 4;
        const amt = weight * p[i + 2]! * (stroke.opacity ?? 1) * 0.86;
        const alpha = pixels[k + 3]!;
        for (let c = 0; c < 4; c++) {
          const orig = pixels[k + c]!,
            carried = paint[at + c]!;
          const blended = orig + (carried - orig) * amt;
          const targetAlpha = alpha + (paint[at + 3]! - alpha) * amt;
          const val = stroke.alphaLocked
            ? c === 3
              ? alpha
              : targetAlpha
                ? (blended * alpha) / targetAlpha
                : 0
            : blended;
          pixels[k + c] = val;
          if (pixels[k + c] !== orig) mask[cell] = 1;
          paint[at + c] = carried + (orig - carried) * (0.04 + 0.08 * (1 - p[i + 2]!));
        }
      }
    }
    last = next;
  }
  for (let k = 0; k < pixels.length; k += 4) {
    const alpha = pixels[k + 3]!;
    if (!alpha) continue;
    for (let c = 0; c < 3; c++) pixels[k + c] = (pixels[k + c]! * 255) / alpha;
  }
  return { pixels, mask, w, h };
}

export async function pngData(pixels: Uint8ClampedArray, w: number, h: number) {
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not encode the smudge image.");
  const image = ctx.createImageData(w, h);
  image.data.set(pixels);
  ctx.putImageData(image, 0, 0);
  const blob = await canvas.convertToBlob({ type: "image/png" });
  return "data:image/png;base64," + base64(new Uint8Array(await blob.arrayBuffer()));
}
