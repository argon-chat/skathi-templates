export const NIBS = ["pen", "brush", "marker", "pencil", "eraser"] as const;
export const PAINT_TOOLS = ["spray", "airbrush", "bucket", "lasso-fill", "smudge"] as const;
export const TOOLS = [...NIBS, ...PAINT_TOOLS] as const;
export const BLEND_MODES = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "add",
  "color-dodge",
  "color-burn",
  "soft-light",
  "difference",
  "hue",
  "saturation",
  "color",
  "luminosity",
] as const;
export type BlendMode = (typeof BLEND_MODES)[number];
export interface RasterPatch {
  x: number;
  y: number;
  width: number;
  height: number;
  rgba: string;
  transform?: [number, number, number, number, number, number];
}
export type Tool = (typeof TOOLS)[number];

/** What a press on the canvas does: draw with a tool, or one of the canvas tools. */
export const MODES = [...TOOLS, "select", "shape", "eyedropper", "hand"] as const;
export type Mode = (typeof MODES)[number];
export type Ink = Exclude<(typeof NIBS)[number], "eraser">;
export const isInk = (t: unknown): t is Ink => NIBS.some((n) => n === t && n !== "eraser");

export const SHAPES = ["line", "arrow", "rect", "ellipse"] as const;
export type Shape = (typeof SHAPES)[number];

export const PAPERS = ["plain", "dots", "lines", "squares"] as const;
export type Paper = (typeof PAPERS)[number];

/** Floats per point in `Stroke.points`: x, y, pressure, tiltX, tiltY, twist, t. */
export const STRIDE = 7;

/** A colour is `#rrggbb`, or `ink`: black on light paper, near-white on dark. */
export type Color = string;

export interface Stroke {
  /** Unique and increasing across the drawing: the stroke's order within its layer. */
  seq: number;
  tool: Tool;
  color: Color;
  width: number;
  /** Document space, `STRIDE` numbers a point. */
  points: number[];
  /** 0–1; absent is opaque. */
  opacity?: number;
  /** Straight segments between the points, without smoothing or tapered ends. */
  shape?: boolean;
  seed?: number;
  density?: number;
  hardness?: number;
  scatter?: number;
  alphaLocked?: boolean;
  contours?: number[][];
  patch?: RasterPatch;
}

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  /** 0–1. */
  opacity: number;
  blendMode?: BlendMode;
  alphaLocked?: boolean;
  clipping?: boolean;
  strokes: readonly Stroke[];
}

export interface ToolSettings {
  size: number;
  opacity: number;
  /** 0–1: how far the line trails the pointer to steady it. */
  streamline: number;
  density?: number;
  scatter?: number;
  hardness?: number;
  tolerance?: number;
  gap?: number;
  expand?: number;
  currentLayer?: boolean;
}

export interface Symmetry {
  mirror: boolean;
  /** 1 is no rotation; 2–12 repeats each stroke around the centre. */
  segments: number;
  /** The axis's centre in document space. */
  x: number;
  y: number;
}

export const TOOL_INFO: Record<Tool, { name: string; key: string; min: number; max: number; size: number }> = {
  spray: { name: "Spray", key: "S", min: 2, max: 100, size: 24 },
  airbrush: { name: "Airbrush", key: "A", min: 3, max: 180, size: 56 },
  bucket: { name: "Paint bucket", key: "K", min: 1, max: 1, size: 1 },
  "lasso-fill": { name: "Lasso fill", key: "F", min: 1, max: 1, size: 1 },
  smudge: { name: "Smudge", key: "D", min: 3, max: 100, size: 26 },
  pen: { name: "Pen", key: "P", min: 0.8, max: 24, size: 3.2 },
  brush: { name: "Brush", key: "B", min: 2, max: 90, size: 16 },
  marker: { name: "Marker", key: "M", min: 4, max: 64, size: 16 },
  pencil: { name: "Pencil", key: "N", min: 1, max: 18, size: 3.4 },
  eraser: { name: "Eraser", key: "E", min: 4, max: 140, size: 24 },
};

export const MODE_INFO: Record<Exclude<Mode, Tool>, { name: string; key: string }> = {
  select: { name: "Lasso select", key: "L" },
  shape: { name: "Shapes", key: "U" },
  eyedropper: { name: "Eyedropper", key: "I" },
  hand: { name: "Hand", key: "H" },
};

export const SHAPE_INFO: Record<Shape, { name: string }> = {
  line: { name: "Line" },
  arrow: { name: "Arrow" },
  rect: { name: "Rectangle" },
  ellipse: { name: "Ellipse" },
};

export const PAPER_INFO: Record<Paper, { name: string }> = {
  plain: { name: "Plain" },
  dots: { name: "Dot grid" },
  lines: { name: "Ruled" },
  squares: { name: "Squared" },
};

export const PAPER = { light: "#F7F5F0", dark: "#1C1C1E" } as const;
export const INK = { light: "#1C1C1E", dark: "#F2F2F4" } as const;

export const SWATCHES: readonly Color[] = ["ink", "#3B82F6", "#FF5A52", "#34C38F", "#FFB020", "#A06BFF"];

export const defaultSettings = (): Record<Tool, ToolSettings> => ({
  spray: { size: 24, opacity: 1, streamline: 0, density: 0.55, scatter: 0.65 },
  airbrush: { size: 56, opacity: 0.75, streamline: 0, hardness: 0.25 },
  bucket: { size: 1, opacity: 1, streamline: 0, tolerance: 24, gap: 0, expand: 1, currentLayer: false },
  "lasso-fill": { size: 1, opacity: 1, streamline: 0 },
  smudge: { size: 26, opacity: 0.8, streamline: 0 },
  pen: { size: TOOL_INFO.pen.size, opacity: 1, streamline: 0 },
  brush: { size: TOOL_INFO.brush.size, opacity: 1, streamline: 0.15 },
  marker: { size: TOOL_INFO.marker.size, opacity: 1, streamline: 0.3 },
  pencil: { size: TOOL_INFO.pencil.size, opacity: 1, streamline: 0 },
  eraser: { size: TOOL_INFO.eraser.size, opacity: 1, streamline: 0 },
});

export const isTool = (m: unknown): m is Tool => TOOLS.includes(m as Tool);

export function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1, 7), 16);
  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [0, 0, 0];
}

export function hex(r: number, g: number, b: number): Color {
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

export function isColor(value: unknown): value is Color {
  return typeof value === "string" && (value === "ink" || /^#[0-9a-fA-F]{6}$/.test(value));
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
