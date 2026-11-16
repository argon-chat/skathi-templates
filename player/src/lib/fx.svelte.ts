/** The latest burst of hearts: where it starts (0..1 across the window) and when, on the effect clock. */
export const burst = $state({ x: 0.5, y: 0.5, born: -1000 });

export function hearts(from: Element) {
  const box = from.getBoundingClientRect();
  const app = document.querySelector(".app")?.getBoundingClientRect();
  if (!app?.width || !app.height) return;
  burst.x = (box.left + box.width / 2 - app.left) / app.width;
  burst.y = (box.top + box.height / 2 - app.top) / app.height;
  burst.born = performance.now() / 1000;
}

export type Rgb = [number, number, number];
export type Tint = [number, number, number, number];

export function rgb(hex: string): Rgb {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const css = ([r, g, b]: Rgb | Tint) => `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;

const byte = (v: number) =>
  Math.round(Math.min(255, Math.max(0, v)))
    .toString(16)
    .padStart(2, "0");

export const hex = ([r, g, b]: Rgb | Tint, alpha?: number) =>
  `#${byte(r)}${byte(g)}${byte(b)}${alpha === undefined ? "" : byte(alpha * 255)}`;
