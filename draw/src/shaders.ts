const view = /* wgsl */ `
struct View {
  xform: vec4f, // zoom × dpr as a rotation (cos, sin), then the offset in device pixels
  size: vec4f, // target width, height, dpr
  ink: vec4f,
  paper: vec4f,
  cursor: vec4f, // x, y, radius in device pixels, opacity
  grid: vec4f, // opacity, spacing in document units, pattern (1 dots, 2 ruled, 3 squared)
}
@group(0) @binding(0) var<uniform> view: View;

fn clip(px: vec2f) -> vec4f {
  return vec4f(px.x / view.size.x * 2.0 - 1.0, 1.0 - px.y / view.size.y * 2.0, 0.0, 1.0);
}

fn to_screen(p: vec2f) -> vec2f {
  let r = view.xform.xy;
  return vec2f(r.x * p.x - r.y * p.y, r.y * p.x + r.x * p.y) + view.xform.zw;
}

fn to_doc(px: vec2f) -> vec2f {
  let r = view.xform.xy;
  let q = px - view.xform.zw;
  return vec2f(r.x * q.x + r.y * q.y, r.x * q.y - r.y * q.x) / dot(r, r);
}

fn dark_paper() -> bool {
  return dot(view.paper.rgb, vec3f(0.299, 0.587, 0.114)) < 0.5;
}
`;

export const strokeShader = /* wgsl */ `${view}
struct Model {
  m: vec4f, // a, b, c, d
  t: vec4f, // e, f
}
@group(1) @binding(0) var<uniform> model: Model;

struct Ink {
  @builtin(position) pos: vec4f,
  @location(0) edge: f32,
  @location(1) density: f32,
  @location(2) shade: f32,
  @location(3) color: vec4f,
  @location(4) doc: vec2f,
  @location(5) @interpolate(flat) depth: f32,
  @location(6) along: vec2f,
}

@vertex fn vs(
  @location(0) p: vec2f,
  @location(1) attr: vec4f,
  @location(2) color: vec4f,
  @location(3) depth: f32,
  @location(4) along: vec2f,
) -> Ink {
  var o: Ink;
  let q = vec2f(model.m.x * p.x + model.m.z * p.y, model.m.y * p.x + model.m.w * p.y) + model.t.xy;
  o.pos = clip(to_screen(q));
  o.edge = attr.x;
  o.density = attr.y;
  o.shade = attr.z;
  o.color = select(color, vec4f(view.ink.rgb, color.a), attr.w > 0.5);
  o.doc = q;
  o.depth = depth;
  o.along = along;
  return o;
}

fn coverage(edge: f32) -> f32 {
  let d = abs(edge);
  return clamp((1.0 - d) / max(fwidth(d), 1e-4) + 0.5, 0.0, 1.0);
}

fn premultiply(c: vec3f, a: f32) -> vec4f {
  return vec4f(c * a, a);
}

struct Layered {
  @location(0) color: vec4f,
  @builtin(frag_depth) depth: f32,
}

fn pen(i: Ink) -> vec4f {
  return premultiply(i.color.rgb, coverage(i.edge) * i.color.a);
}

fn brush(i: Ink) -> vec4f {
  let soft = 1.0 - smoothstep(0.7, 1.0, abs(i.edge));
  return premultiply(i.color.rgb, min(soft, coverage(i.edge)) * i.color.a);
}

fn eraser(i: Ink) -> vec4f {
  return vec4f(0.0, 0.0, 0.0, coverage(i.edge) * i.color.a);
}

@fragment fn fs_pen(i: Ink) -> @location(0) vec4f {
  return pen(i);
}

@fragment fn fs_brush(i: Ink) -> @location(0) vec4f {
  return brush(i);
}

@fragment fn fs_eraser(i: Ink) -> @location(0) vec4f {
  return eraser(i);
}

// Translucent strokes cover a sample once however often the ribbon overlaps itself.
@fragment fn fs_pen_layered(i: Ink) -> Layered {
  return Layered(pen(i), i.depth);
}

@fragment fn fs_brush_layered(i: Ink) -> Layered {
  return Layered(brush(i), i.depth);
}

@fragment fn fs_eraser_layered(i: Ink) -> Layered {
  return Layered(eraser(i), i.depth);
}

@fragment fn fs_marker(i: Ink) -> Layered {
  return Layered(premultiply(i.color.rgb, i.color.a), i.depth);
}

// On dark paper the marker screens what is under it, like a highlighter catching the light,
// rather than laying a translucent film of its colour over the paper.
@fragment fn fs_marker_glow(i: Ink) -> Layered {
  let c = mix(i.color.rgb, vec3f(1.0), 0.14);
  let a = min(1.0, i.color.a * 2.2);
  return Layered(vec4f(c * a * 0.92, a * 0.1), i.depth);
}

// Simplex noise (Gustavson, Ashima Arts), in [-1, 1].
fn mod289(x: vec3f) -> vec3f {
  return x - floor(x / 289.0) * 289.0;
}

fn permute(x: vec3f) -> vec3f {
  return mod289((x * 34.0 + 1.0) * x);
}

fn simplex(v: vec2f) -> f32 {
  let C = vec4f(0.211324865, 0.366025404, -0.577350269, 0.024390244);
  var i = floor(v + dot(v, C.yy));
  let x0 = v - i + dot(i, C.xx);
  let o = select(vec2f(0.0, 1.0), vec2f(1.0, 0.0), x0.x > x0.y);
  let x1 = x0 + C.xx - o;
  let x2 = x0 + C.zz;
  i = i - floor(i / 289.0) * 289.0;
  let p = permute(permute(i.y + vec3f(0.0, o.y, 1.0)) + i.x + vec3f(0.0, o.x, 1.0));
  var m = max(0.5 - vec3f(dot(x0, x0), dot(x1, x1), dot(x2, x2)), vec3f(0.0));
  m = m * m;
  m = m * m;
  let x = 2.0 * fract(p * C.www) - 1.0;
  let h = abs(x) - 0.5;
  let a0 = x - floor(x + 0.5);
  m *= 1.79284291 - 0.85373472 * (a0 * a0 + h * h);
  let g = vec3f(a0.x * x0.x + h.x * x0.y, a0.y * x1.x + h.y * x1.y, a0.z * x2.x + h.z * x2.y);
  return 130.0 * dot(m, g);
}

// Graphite: the paper's tooth, fixed in the document, with a fainter grain drawn out along the
// stroke. Pressure decides how much of the tooth the lead reaches; tilt lays the lead on its side.
@fragment fn fs_pencil(i: Ink) -> Layered {
  let tooth = simplex(i.doc * 0.42) * 0.6 + simplex(i.doc * 1.1 + vec2f(31.0, 7.0)) * 0.4;
  let streak = simplex(vec2f(i.along.x * 0.1, i.along.y * 0.7));
  let mixed = mix(tooth, streak, 0.25 + 0.35 * i.shade) * 0.5 + 0.5;
  let blur = clamp(length(fwidth(i.doc * 1.1)) - 0.7, 0.0, 1.0);
  let g = mix(mixed, 0.5, blur);
  let reach = i.density * 1.1 - 0.05 - smoothstep(0.55, 1.0, abs(i.edge)) * 0.45;
  let lead = smoothstep(g - 0.12, g + 0.12, reach);
  let a = i.color.a * lead * (1.0 - 0.25 * i.shade);
  return Layered(premultiply(i.color.rgb, a), i.depth);
}
`;

export const compositeShader = /* wgsl */ `${view}
@group(1) @binding(0) var layer: texture_2d<f32>;
@group(1) @binding(1) var<uniform> opacity: vec4f;

@vertex fn vs_full(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

@fragment fn fs_layer(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  return textureLoad(layer, vec2i(pos.xy), 0) * opacity.x;
}

fn rule(d: f32, px: f32) -> f32 {
  return clamp(0.5 * px + 0.5 - d, 0.0, 1.0);
}

@fragment fn fs_grid(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let scale = length(view.xform.xy);
  let unit = view.grid.y;
  let spacing = unit * scale;
  let doc = to_doc(pos.xy);
  let px = view.size.z;
  let f = (fract(doc / unit + 0.5) - 0.5) * spacing;
  var a = 0.0;
  if (view.grid.z < 1.5) {
    let r = 1.1 * px;
    a = 1.0 - smoothstep(r - 0.7, r + 0.7, length(f));
  } else if (view.grid.z < 2.5) {
    a = rule(abs(f.y), px) * 0.7;
  } else {
    a = max(rule(abs(f.x), px), rule(abs(f.y), px)) * 0.5;
  }
  a *= smoothstep(5.0 * px, 14.0 * px, spacing) * view.grid.x;
  return vec4f(view.ink.rgb * a, a);
}

@vertex fn vs_ring(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var corners = array(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));
  return clip(view.cursor.xy + corners[i] * (view.cursor.z + 4.0 * view.size.z));
}

@fragment fn fs_ring(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let d = length(pos.xy - view.cursor.xy);
  let r = view.cursor.z;
  let px = view.size.z;
  let dark = (1.0 - smoothstep(0.35 * px, 0.35 * px + 1.0, abs(d - r))) * 0.8 * view.cursor.w;
  let light = (1.0 - smoothstep(0.35 * px, 0.35 * px + 1.0, abs(d - r - 1.4 * px))) * 0.75 * view.cursor.w * (1.0 - dark);
  return vec4f(view.ink.rgb * dark + view.paper.rgb * light, dark + light);
}

struct Mark {
  @builtin(position) pos: vec4f,
  @location(0) local: vec2f,
  @location(1) color: vec4f,
  @location(2) fill: vec4f,
  @location(3) params: vec4f,
}

@vertex fn vs_mark(
  @location(0) p: vec2f,
  @location(1) local: vec2f,
  @location(2) color: vec4f,
  @location(3) fill: vec4f,
  @location(4) params: vec4f,
) -> Mark {
  var o: Mark;
  o.pos = clip(p * view.size.z);
  o.local = local;
  o.color = color;
  o.fill = fill;
  o.params = params;
  return o;
}

// Overlay marks in CSS pixels. Lines: local is (along, across), params (0, half width, dash).
// Discs: local is the offset from the centre, params (1, radius, ring). Squares: (2, half side, ring).
@fragment fn fs_mark(i: Mark) -> @location(0) vec4f {
  let px = view.size.z;
  let kind = i.params.x;
  if (kind < 0.5) {
    var a = clamp((i.params.y - abs(i.local.y)) * px + 0.5, 0.0, 1.0);
    if (i.params.z > 0.0 && fract(i.local.x / i.params.z) > 0.5) {
      a = 0.0;
    }
    return vec4f(i.color.rgb, 1.0) * i.color.a * a;
  }
  var d = length(i.local);
  if (kind > 1.5) {
    let q = abs(i.local) - vec2f(i.params.y - 2.0);
    d = length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) + 2.0;
  }
  let outer = clamp((i.params.y - d) * px + 0.5, 0.0, 1.0);
  let inner = clamp((i.params.y - i.params.z - d) * px + 0.5, 0.0, 1.0);
  let ring = vec4f(i.color.rgb, 1.0) * i.color.a;
  let fill = vec4f(i.fill.rgb, 1.0) * i.fill.a;
  return mix(ring, fill, inner) * outer;
}
`;
