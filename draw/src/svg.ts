import type { Bounds } from "./geometry";
import { trace } from "./ink";
import type { Color, Layer, Paper, Stroke } from "./model";

const n = (v: number) => String(Math.round(v * 100) / 100);

/** The stroke's outline as a filled path: its left edge, the end cap, its right edge back, the start cap. */
function outline(stroke: Stroke): string {
  const xs: number[] = [];
  const ys: number[] = [];
  const rs: number[] = [];
  trace(stroke, (x, y, r) => {
    const last = xs.length - 1;
    if (last >= 0 && Math.hypot(x - xs[last]!, y - ys[last]!) < 0.05) {
      rs[last] = Math.max(rs[last]!, r);
      return;
    }
    xs.push(x);
    ys.push(y);
    rs.push(r);
  });
  const count = xs.length;
  if (!count) return "";
  if (count === 1) {
    const r = rs[0]!;
    return `M${n(xs[0]! - r)} ${n(ys[0]!)}a${n(r)} ${n(r)} 0 1 0 ${n(2 * r)} 0a${n(r)} ${n(r)} 0 1 0 ${n(-2 * r)} 0Z`;
  }
  const left: string[] = [];
  const right: string[] = [];
  for (let i = 0; i < count; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(count - 1, i + 1);
    const dx = xs[b]! - xs[a]!;
    const dy = ys[b]! - ys[a]!;
    const d = Math.hypot(dx, dy) || 1;
    const r = rs[i]!;
    left.push(`${n(xs[i]! - (dy / d) * r)} ${n(ys[i]! + (dx / d) * r)}`);
    right.push(`${n(xs[i]! + (dy / d) * r)} ${n(ys[i]! - (dx / d) * r)}`);
  }
  const end = rs[count - 1]!;
  const start = rs[0]!;
  return (
    `M${left.join("L")}` +
    `A${n(end)} ${n(end)} 0 0 0 ${right[count - 1]}` +
    `L${right.reverse().join("L")}` +
    `A${n(start)} ${n(start)} 0 0 0 ${left[0]}Z`
  );
}

function alpha(stroke: Stroke): number {
  const base = stroke.tool === "marker" ? 0.4 : stroke.tool === "pencil" ? 0.92 : 1;
  return base * (stroke.opacity ?? 1);
}

const PATTERNS: Record<Exclude<Paper, "plain">, (ink: string, opacity: number) => string> = {
  dots: (ink, o) =>
    `<pattern id="paper" patternUnits="userSpaceOnUse" x="-12" y="-12" width="24" height="24"><circle cx="12" cy="12" r="1.1" fill="${ink}" fill-opacity="${o}"/></pattern>`,
  lines: (ink, o) =>
    `<pattern id="paper" patternUnits="userSpaceOnUse" y="-16" width="32" height="32"><path d="M0 16H32" stroke="${ink}" stroke-opacity="${o * 0.7}" stroke-width="0.6"/></pattern>`,
  squares: (ink, o) =>
    `<pattern id="paper" patternUnits="userSpaceOnUse" x="-12" y="-12" width="24" height="24"><path d="M12 0V24M0 12H24" stroke="${ink}" stroke-opacity="${o * 0.5}" stroke-width="0.6"/></pattern>`,
};

export interface SvgOptions {
  bounds: Bounds;
  ink: Color;
  paper: Color;
  background: boolean;
  pattern: Paper | null;
  patternOpacity: number;
}

const escape = (s: string) => s.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** The visible layers as vector paths; an eraser stroke masks out what was drawn before it on its layer. */
export function toSvg(layers: readonly Layer[], o: SvgOptions): string {
  const { minX, minY, maxX, maxY } = o.bounds;
  const w = maxX - minX;
  const h = maxY - minY;
  const defs: string[] = [];
  const body: string[] = [];
  let masks = 0;
  if (o.background)
    body.push(`<rect x="${n(minX)}" y="${n(minY)}" width="${n(w)}" height="${n(h)}" fill="${o.paper}"/>`);
  if (o.pattern && o.pattern !== "plain") {
    defs.push(PATTERNS[o.pattern](o.ink, o.patternOpacity));
    body.push(`<rect x="${n(minX)}" y="${n(minY)}" width="${n(w)}" height="${n(h)}" fill="url(#paper)"/>`);
  }
  for (const layer of layers) {
    if (!layer.visible || !layer.strokes.length) continue;
    let content = "";
    for (const stroke of layer.strokes) {
      const d = outline(stroke);
      if (!d) continue;
      if (stroke.tool === "eraser") {
        const id = `erase-${++masks}`;
        defs.push(
          `<mask id="${id}" maskUnits="userSpaceOnUse" x="${n(minX)}" y="${n(minY)}" width="${n(w)}" height="${n(h)}">` +
            `<rect x="${n(minX)}" y="${n(minY)}" width="${n(w)}" height="${n(h)}" fill="#fff"/>` +
            `<path d="${d}" fill="#000" fill-opacity="${alpha(stroke)}"/></mask>`,
        );
        content = `<g mask="url(#${id})">${content}</g>`;
        continue;
      }
      const fill = stroke.color === "ink" ? o.ink : stroke.color;
      const a = alpha(stroke);
      content += `<path d="${d}" fill="${fill}"${a < 1 ? ` fill-opacity="${n(a)}"` : ""}/>`;
    }
    const opacity = layer.opacity < 1 ? ` opacity="${n(layer.opacity)}"` : "";
    body.push(`<g id="${escape(layer.id)}" data-name="${escape(layer.name)}"${opacity}>${content}</g>`);
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(minX)} ${n(minY)} ${n(w)} ${n(h)}" width="${Math.ceil(w)}" height="${Math.ceil(h)}">` +
    (defs.length ? `<defs>${defs.join("")}</defs>` : "") +
    body.join("") +
    "</svg>\n"
  );
}
