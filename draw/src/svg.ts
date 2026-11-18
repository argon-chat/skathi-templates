import { dabStream, strokeRings } from "./pigments";
import { pngUrl, encodePng, loadRaster } from "./smudge";
import { paintGroups, type PaintGroup } from "./paintGroups";
import { INK } from "./model";
import { STRIDE } from "./model";
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
export async function toSvg(layers: readonly Layer[], o: SvgOptions): Promise<string> {
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
  const area = `x="${n(minX)}" y="${n(minY)}" width="${n(w)}" height="${n(h)}"`;
  let below: string | null = null;
  let opaqueFilter = false;
  const mask = (body: string, alpha = false) => {
    const id = `mask-${++masks}`;
    defs.push(
      `<mask id="${id}" maskUnits="userSpaceOnUse" ${area}${alpha ? ' style="mask-type:alpha"' : ""}>${body}</mask>`,
    );
    return id;
  };
  for (const layer of layers) {
    if (!layer.visible || !layer.strokes.length) {
      if (!layer.clipping) below = null;
      continue;
    }
    async function paint(items: readonly (Stroke | PaintGroup<Stroke>)[]) {
      let content = "";
      for (const stroke of items) {
        if ("children" in stroke) {
          content += "<g>" + (await paint(stroke.children)) + "</g>";
          continue;
        }
        if (stroke.tool === "eraser" && stroke.alphaLocked) continue;
        const fill = stroke.color === "ink" ? o.ink : stroke.color;
        let mark = "";
        if (stroke.patch) {
          const p = stroke.patch,
            night = o.ink.toLowerCase() === INK.dark.toLowerCase();
          const img = pngUrl(night && p.darkPng ? p.darkPng : p.png);
          const attrs = `x="${p.x}" y="${p.y}" width="${p.width}" height="${p.height}"${p.transform ? ` transform="matrix(${p.transform.join(" ")})"` : ""}`;
          if (stroke.tool === "smudge" && p.coveragePng) {
            const result = await loadRaster(p);
            const cut = new Uint8ClampedArray(p.width * p.height * 4);
            if (result.coverage)
              for (let i = 0; i < result.coverage.length; i++) if (result.coverage[i]! & 0xffffff) cut[i * 4 + 3] = 255;
            const id = mask(
              `<rect ${area} fill="#fff"/><image ${attrs} href="${pngUrl(await encodePng(cut, p.width, p.height))}"/>`,
            );
            content = `<g mask="url(#${id})">${content}</g><image ${attrs} href="${img}"/>`;
            continue;
          }
          mark = `<image ${attrs} opacity="${n(stroke.opacity ?? 1)}" href="${img}"/>`;
        } else if (stroke.tool === "smudge") continue;
        else if (stroke.tool === "spray" || stroke.tool === "airbrush") {
          const add = dabStream(stroke);
          let paint = fill;
          if (stroke.tool === "airbrush") {
            const id = `air-${++masks}`,
              h = stroke.hardness ?? 0.25;
            const stops = [0, 0.25, 0.5, 0.75, 1]
              .map(
                (t) =>
                  `<stop offset="${h + (1 - h) * t}" stop-color="${fill}" stop-opacity="${(Math.exp(-4 * t * t) - Math.exp(-4)) / (1 - Math.exp(-4))}"/>`,
              )
              .join("");
            defs.push(`<radialGradient id="${id}">${stops}</radialGradient>`);
            paint = `url(#${id})`;
          }
          const dots: string[] = [];
          for (let i = 0; i < stroke.points.length; i += STRIDE)
            add(i, (d) =>
              dots.push(
                `<circle cx="${n(d.x)}" cy="${n(d.y)}" r="${n(d.radius)}" opacity="${n(d.opacity * (stroke.opacity ?? 1))}"/>`,
              ),
            );
          mark = `<g fill="${paint}">${dots.join("")}</g>`;
        } else {
          const d =
            stroke.tool === "lasso-fill" || stroke.tool === "bucket"
              ? strokeRings(stroke)
                  .filter((r) => r.length >= 6)
                  .map((r) => {
                    const points: string[] = [];
                    for (let i = 0; i < r.length; i += 2) points.push(`${n(r[i]!)} ${n(r[i + 1]!)}`);
                    return "M" + points.join("L") + "Z";
                  })
                  .join("")
              : outline(stroke);
          if (!d) continue;
          if (stroke.tool === "eraser") {
            const id = mask(`<rect ${area} fill="#fff"/><path d="${d}" fill="#000" fill-opacity="${alpha(stroke)}"/>`);
            content = `<g mask="url(#${id})">${content}</g>`;
            continue;
          }
          mark = `<path d="${d}" fill="${fill}" fill-rule="evenodd"${alpha(stroke) < 1 ? ` fill-opacity="${n(alpha(stroke))}"` : ""}/>`;
        }
        if (stroke.alphaLocked) {
          const base = `prior-${++masks}`;
          defs.push(`<g id="${base}">${content}</g>`);
          const id = mask(`<use href="#${base}"/>`, true);
          if (!opaqueFilter) {
            defs.push(
              `<filter id="opaque-ink" filterUnits="userSpaceOnUse" ${area} color-interpolation-filters="sRGB"><feComponentTransfer><feFuncA type="linear" slope="0" intercept="1"/></feComponentTransfer></filter>`,
            );
            opaqueFilter = true;
          }
          content = `<g mask="url(#${id})"><use href="#${base}" filter="url(#opaque-ink)"/>${mark}</g>`;
        } else content += mark;
      }
      return content;
    }
    let content = await paint(paintGroups(layer.strokes));
    if (layer.clipping) {
      if (!below) {
        below = null;
        continue;
      }
      const id = mask(`<use href="#${below}"/>`, true);
      content = `<g mask="url(#${id})">${content}</g>`;
    }
    const id = `layer-${++masks}`;
    const opacity = layer.opacity < 1 ? ` opacity="${n(layer.opacity)}"` : "";
    const blend = layer.blendMode === "add" ? "plus-lighter" : layer.blendMode;
    const style = blend && blend !== "normal" ? ` style="mix-blend-mode:${blend}"` : "";
    defs.push(`<g id="${id}"${opacity}>${content}</g>`);
    body.push(`<use data-layer-id="${escape(layer.id)}" data-name="${escape(layer.name)}" href="#${id}"${style}/>`);
    if (!layer.clipping) below = id;
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(minX)} ${n(minY)} ${n(w)} ${n(h)}" width="${Math.ceil(w)}" height="${Math.ceil(h)}">` +
    (defs.length ? `<defs>${defs.join("")}</defs>` : "") +
    body.join("") +
    "</svg>\n"
  );
}
