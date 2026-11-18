const view = /* wgsl */ `
struct View {
  xform: vec4f, // zoom × dpr, unused, offset in device pixels
  size: vec4f, // target width, height, dpr
  ink: vec4f,
  paper: vec4f,
  cursor: vec4f, // x, y, radius in device pixels, opacity
  grid: vec4f, // opacity, spacing in document units
}
@group(0) @binding(0) var<uniform> view: View;

fn clip(px: vec2f) -> vec4f {
  return vec4f(px.x / view.size.x * 2.0 - 1.0, 1.0 - px.y / view.size.y * 2.0, 0.0, 1.0);
}
`;

export const strokeShader = /* wgsl */ `${view}
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
  o.pos = clip(p * view.xform.x + view.xform.zw);
  o.edge = attr.x;
  o.density = attr.y;
  o.shade = attr.z;
  o.color = select(color, vec4f(view.ink.rgb, color.a), attr.w > 0.5);
  o.doc = p;
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

@fragment fn fs_pen(i: Ink) -> @location(0) vec4f {
  return premultiply(i.color.rgb, coverage(i.edge) * i.color.a);
}

@fragment fn fs_brush(i: Ink) -> @location(0) vec4f {
  let soft = 1.0 - smoothstep(0.7, 1.0, abs(i.edge));
  return premultiply(i.color.rgb, min(soft, coverage(i.edge)) * i.color.a);
}

@fragment fn fs_eraser(i: Ink) -> @location(0) vec4f {
  return vec4f(0.0, 0.0, 0.0, coverage(i.edge));
}

struct Layered {
  @location(0) color: vec4f,
  @builtin(frag_depth) depth: f32,
}

@fragment fn fs_marker(i: Ink) -> Layered {
  return Layered(premultiply(i.color.rgb, i.color.a), i.depth);
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

@vertex fn vs_full(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

@fragment fn fs_layer(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  return textureLoad(layer, vec2i(pos.xy), 0);
}

@fragment fn fs_grid(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let scale = view.xform.x;
  let spacing = view.grid.y * scale;
  let doc = (pos.xy - view.xform.zw) / scale;
  let f = (fract(doc / view.grid.y + 0.5) - 0.5) * spacing;
  let r = 1.1 * view.size.z;
  let dot = 1.0 - smoothstep(r - 0.7, r + 0.7, length(f));
  let a = dot * smoothstep(5.0 * view.size.z, 14.0 * view.size.z, spacing) * view.grid.x;
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
`;
