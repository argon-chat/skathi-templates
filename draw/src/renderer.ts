import { BlendPass } from "./blend";
import { floodContours, type BucketOptions } from "./bucket";
import { base64 } from "./smudge";
import { pathBounds } from "./pigments";
import { IDENTITY, union, type Affine } from "./geometry";
import { type Bounds, type LiveSource, Mesh, tessellate, VERTEX_BYTES } from "./ink";
import { BLEND_MODES, type Layer, type Paper, type Stroke } from "./model";
import { compositeShader, strokeShader } from "./shaders";

const SAMPLES = 4;
const LAYER_FORMAT: GPUTextureFormat = "rgba8unorm";
const DEPTH_FORMAT: GPUTextureFormat = "depth32float";
export const MARK_BYTES = 40;

type CanvasFormat = ReturnType<GPU["getPreferredCanvasFormat"]>;
const MAX_EXPORT = 8192;
const PATTERN: Record<Paper, { mode: number; spacing: number }> = {
  plain: { mode: 0, spacing: 24 },
  dots: { mode: 1, spacing: 24 },
  lines: { mode: 2, spacing: 32 },
  squares: { mode: 3, spacing: 24 },
};

interface Cached {
  bytes: Uint8Array;
  vertices: number;
  bounds: Bounds;
}

const meshes = new WeakMap<Stroke, Cached>();
const scratch = new Mesh(1 << 16);

/** A stroke's triangles, tessellated the first time they are asked for. */
export function meshOf(stroke: Stroke): Cached {
  let cached = meshes.get(stroke);
  if (!cached) {
    scratch.reset();
    const bounds = tessellate(stroke, scratch);
    cached = { bytes: scratch.view().slice(), vertices: scratch.count, bounds };
    meshes.set(stroke, cached);
  }
  return cached;
}

type Key =
  | "pen"
  | "pen+"
  | "brush"
  | "brush+"
  | "marker"
  | "marker-glow"
  | "pencil"
  | "eraser"
  | "eraser+"
  | "spray"
  | "airbrush"
  | "smudge";

function keyOf(stroke: Stroke): Key {
  const t = stroke.tool;
  if (t === "marker" || t === "pencil" || t === "spray" || t === "airbrush" || t === "smudge") return t;
  if (t === "bucket" || t === "lasso-fill") return "pen";
  return (stroke.opacity ?? 1) < 1 ? `${t}+` : t;
}

const instanceKey = (key: Key) => key === "spray" || key === "airbrush";

interface Run {
  locked: boolean;
  key: Key;
  first: number;
  count: number;
}

interface Target {
  texture: GPUTexture;
  view: GPUTextureView;
  group: GPUBindGroup;
}

class LayerGpu {
  buffer: GPUBuffer | null = null;
  capacity = 0;
  vertices = 0;
  strokes: Stroke[] = [];
  source: readonly Stroke[] | null = null;
  ends: number[] = [];
  runs: Run[] = [];
  target: Target | null = null;
  visible = true;
  opacity = -1;
  blend = -1;
  clipping = false;
  dirty = true;

  constructor(readonly opacityBuffer: GPUBuffer) {}

  destroy() {
    this.buffer?.destroy();
    this.target?.texture.destroy();
    this.opacityBuffer.destroy();
  }
}

export interface View {
  zoom: number;
  /** Radians, clockwise on screen. */
  angle: number;
  x: number;
  y: number;
}

export interface Render {
  /** Paints the paper colour under the drawing; without it the image is transparent. */
  background: boolean;
  /** Paints the paper's dots or lines. */
  pattern: boolean;
  layer?: string;
}

type Rgb = readonly [number, number, number];

interface Composites {
  layer: GPURenderPipeline;
  grid: GPURenderPipeline;
  ring: GPURenderPipeline;
  mark: GPURenderPipeline;
}

interface LiveItem {
  source: LiveSource;
  buffer: GPUBuffer | null;
  capacity: number;
  uploaded: number;
  previewCount: number;
  previewAt: number;
  reading: boolean;
}

export class Renderer {
  view: View = { zoom: 1, angle: 0, x: 0, y: 0 };
  /** Called at frame time, after `invalidateOverlay()` or a view change, for the overlay's vertices. */
  overlay: (() => Uint8Array) | null = null;
  private width = 1;
  private height = 1;
  private dpr = 1;
  private paper: Rgb = [1, 1, 1];
  private ink: Rgb = [0, 0, 0];
  private grid = { opacity: 0, mode: 0, spacing: 24 };
  private cursor = { x: 0, y: 0, r: 0, on: false };
  private layers = new Map<string, LayerGpu>();
  private order: readonly Layer[] = [];
  private live: { layer: string; items: LiveItem[] } | null = null;
  private float: { layer: string; strokes: readonly Stroke[]; hidden: Set<Stroke>; gpu: LayerGpu } | null = null;
  private overlayBuffer: GPUBuffer | null = null;
  private overlayCapacity = 0;
  private overlayCount = 0;
  private overlayDirty = true;
  private msaa: GPUTextureView | null = null;
  private depth: GPUTextureView | null = null;
  private owned: GPUTexture[] = [];
  private viewChanged = true;
  private scheduled = false;
  private uniform = new Float32Array(24);
  private readonly fullOpacity: GPUBuffer;
  private readonly viewBuffer: GPUBuffer;
  private readonly viewGroup: GPUBindGroup;
  private readonly identity: GPUBindGroup;
  private readonly floatModel: GPUBuffer;
  private readonly floatGroup: GPUBindGroup;
  private readonly pipelines: Record<Key, GPURenderPipeline>;
  private lockedPipelines: Record<Key, GPURenderPipeline> | null = null;
  private readonly screen: Composites;
  private offscreen: Composites | null = null;
  private blend: BlendPass | null = null;
  private readonly textureLayout: GPUBindGroupLayout;
  private readonly viewLayout: GPUBindGroupLayout;
  private readonly modelLayout: GPUBindGroupLayout;

  static async create(canvas: HTMLCanvasElement): Promise<Renderer> {
    const gpu = (navigator as { gpu?: GPU }).gpu;
    if (!gpu) throw new Error("WebGPU is not available in this build.");
    const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) throw new Error("No graphics adapter supports WebGPU on this machine.");
    const device = await adapter.requestDevice();
    const context = canvas.getContext("webgpu");
    if (!context) throw new Error("This canvas cannot draw with WebGPU.");
    return new Renderer(canvas, device, context, gpu.getPreferredCanvasFormat());
  }

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly device: GPUDevice,
    private readonly context: GPUCanvasContext,
    private readonly format: CanvasFormat,
  ) {
    const both = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
    this.viewLayout = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: both, buffer: { type: "uniform" } }],
    });
    this.modelLayout = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } }],
    });
    this.textureLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      ],
    });
    this.fullOpacity = this.uniformBuffer(16);
    device.queue.writeBuffer(this.fullOpacity, 0, new Float32Array([1, 0, 0, 0]));
    this.viewBuffer = this.uniformBuffer(this.uniform.byteLength);
    this.viewGroup = this.groupFor(this.viewLayout, this.viewBuffer);
    const identity = this.uniformBuffer(32);
    device.queue.writeBuffer(identity, 0, modelData(IDENTITY));
    this.identity = this.groupFor(this.modelLayout, identity);
    this.floatModel = this.uniformBuffer(32);
    this.floatGroup = this.groupFor(this.modelLayout, this.floatModel);
    this.pipelines = this.strokePipelines();
    this.screen = this.composites(format);
  }

  setLayers(layers: readonly Layer[]) {
    this.order = layers;
    const ids = new Set(layers.map((l) => l.id));
    for (const [id, gpu] of this.layers) {
      if (ids.has(id)) continue;
      gpu.destroy();
      this.layers.delete(id);
    }
    for (const layer of layers) {
      let gpu = this.layers.get(layer.id);
      if (!gpu) this.layers.set(layer.id, (gpu = new LayerGpu(this.uniformBuffer(16))));
      if (gpu.visible !== layer.visible) gpu.dirty = true;
      gpu.visible = layer.visible;
      const mode = BLEND_MODES.indexOf(layer.blendMode ?? "normal"),
        clipping = layer.clipping ?? false;
      if (gpu.opacity !== layer.opacity || gpu.blend !== mode || gpu.clipping !== clipping) {
        gpu.blend = mode;
        gpu.clipping = clipping;
        gpu.opacity = layer.opacity;
        this.device.queue.writeBuffer(
          gpu.opacityBuffer,
          0,
          new Float32Array([layer.opacity, mode, Number(clipping), 0]),
        );
      }
      const hidden = this.float?.layer === layer.id ? this.float.hidden : null;
      this.sync(gpu, hidden ? layer.strokes.filter((s) => !hidden.has(s)) : layer.strokes);
    }
    this.request();
  }

  setView(view: View) {
    this.view = view;
    this.viewChanged = true;
    this.request();
  }

  setTheme(paper: Rgb, ink: Rgb, pattern: Paper, opacity: number) {
    const opacityValue = pattern === "plain" ? 0 : opacity;
    if (
      this.grid.mode === PATTERN[pattern].mode &&
      this.grid.opacity === opacityValue &&
      this.ink.every((v, i) => v === ink[i]) &&
      this.paper.every((v, i) => v === paper[i])
    )
      return;
    this.paper = paper;
    this.ink = ink;
    this.grid = { opacity: pattern === "plain" ? 0 : opacity, ...PATTERN[pattern] };
    this.viewChanged = true;
    this.request();
  }

  setCursor(x: number, y: number, r: number, on: boolean) {
    if (!on && !this.cursor.on) return;
    this.cursor = { x, y, r, on };
    this.request();
  }

  invalidateOverlay() {
    this.overlayDirty = true;
    this.request();
  }

  resize(width: number, height: number, dpr: number) {
    const w = Math.max(1, Math.round(width * dpr));
    const h = Math.max(1, Math.round(height * dpr));
    if (w === this.width && h === this.height && dpr === this.dpr && this.msaa) return;
    this.blend?.destroy();
    this.blend = null;
    this.width = w;
    this.height = h;
    this.dpr = dpr;
    this.canvas.width = w;
    this.canvas.height = h;
    this.context.configure({ device: this.device, format: this.format, alphaMode: "opaque" });
    for (const texture of this.owned) texture.destroy();
    const [msaa, depth] = this.attachments(w, h);
    this.owned = [msaa.texture, depth.texture];
    this.msaa = msaa.view;
    this.depth = depth.view;
    for (const gpu of this.layers.values()) {
      gpu.target?.texture.destroy();
      gpu.target = null;
    }
    this.viewChanged = true;
    this.request();
  }

  /** Strokes in progress on `layer`: one, or one per mirrored copy. */
  beginLive(layer: string, sources: readonly LiveSource[]) {
    this.endLive();
    this.live = {
      layer,
      items: sources.map((source) => ({
        source,
        buffer: null,
        capacity: 0,
        uploaded: 0,
        previewCount: 0,
        previewAt: 0,
        reading: false,
      })),
    };
    this.updateLive();
  }

  updateLive() {
    const live = this.live;
    if (!live) return;
    for (const item of live.items) {
      if (item.source.stroke.tool === "smudge") {
        if (
          !item.reading &&
          item.source.stroke.points.length >= 14 &&
          item.source.stroke.points.length !== item.previewAt
        ) {
          item.reading = true;
          const stroke = { ...item.source.stroke, points: item.source.stroke.points.slice() };
          item.previewAt = stroke.points.length;
          void this.smudge(stroke, live.layer)
            .then((sample) => {
              if (this.live !== live) return;
              const mesh = meshOf(sample);
              if (mesh.bytes.length > item.capacity || !item.buffer) {
                item.buffer?.destroy();
                item.capacity = Math.max(65536, mesh.bytes.length * 2);
                item.buffer = this.device.createBuffer({
                  size: item.capacity,
                  usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
                });
              }
              if (mesh.vertices) this.device.queue.writeBuffer(item.buffer, 0, mesh.bytes);
              item.previewCount = mesh.vertices;
              const target = this.layers.get(live.layer);
              if (target) target.dirty = true;
              this.request();
            })
            .catch(() => {})
            .finally(() => {
              item.reading = false;
              if (this.live === live && item.source.stroke.points.length !== item.previewAt) this.updateLive();
            });
        }
        continue;
      }
      const { settled, tail } = item.source;
      const needed = (settled.count + tail.count) * VERTEX_BYTES;
      if (needed > item.capacity || !item.buffer) {
        item.buffer?.destroy();
        item.capacity = Math.max(needed * 2, 1 << 18);
        item.buffer = this.device.createBuffer({
          size: item.capacity,
          usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        item.uploaded = 0;
      }
      if (settled.count > item.uploaded)
        this.device.queue.writeBuffer(item.buffer, item.uploaded * VERTEX_BYTES, settled.view(item.uploaded));
      item.uploaded = settled.count;
      if (tail.count) this.device.queue.writeBuffer(item.buffer, settled.count * VERTEX_BYTES, tail.view());
    }
    const gpu = this.layers.get(live.layer);
    if (gpu) gpu.dirty = true;
    this.request();
  }

  endLive() {
    if (!this.live) return;
    const gpu = this.layers.get(this.live.layer);
    if (gpu) gpu.dirty = true;
    for (const item of this.live.items) item.buffer?.destroy();
    this.live = null;
    this.request();
  }

  /** Lifts `strokes` out of `layer` and draws them through `m` until `dropFloat()`. */
  setFloat(layer: string, strokes: readonly Stroke[], m: Affine) {
    if (this.float?.layer !== layer || this.float.strokes !== strokes) {
      this.dropFloat();
      const gpu = new LayerGpu(this.uniformBuffer(16));
      this.float = { layer, strokes, hidden: new Set(strokes), gpu };
      this.sync(gpu, strokes);
      this.setLayers(this.order);
    }
    this.device.queue.writeBuffer(this.floatModel, 0, modelData(m));
    const gpu = this.layers.get(layer);
    if (gpu) gpu.dirty = true;
    this.request();
  }

  /** Puts floated strokes back; the caller passes the layers they belong in to `setLayers()`. */
  dropFloat() {
    if (!this.float) return;
    const { layer, gpu } = this.float;
    gpu.destroy();
    this.float = null;
    const target = this.layers.get(layer);
    if (target) target.dirty = true;
  }

  request() {
    if (this.scheduled) return;
    this.scheduled = true;
    requestAnimationFrame(() => this.frame());
  }

  /** The visible layers inside `bounds` at `scale` pixels per document unit, as straight-alpha RGBA rows. */
  async render(
    bounds: Bounds,
    scale: number,
    options: Render,
  ): Promise<{ pixels: Uint8ClampedArray; w: number; h: number }> {
    const fit = Math.min(scale, MAX_EXPORT / (bounds.maxX - bounds.minX), MAX_EXPORT / (bounds.maxY - bounds.minY));
    const w = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) * fit));
    const h = Math.max(1, Math.ceil((bounds.maxY - bounds.minY) * fit));
    const device = this.device;
    const uniform = new Float32Array(24);
    const view = { zoom: 1, angle: 0, x: -bounds.minX, y: -bounds.minY };
    this.fillUniform(uniform, view, w, h, fit, false, options.pattern);
    const ubo = this.uniformBuffer(uniform.byteLength);
    device.queue.writeBuffer(ubo, 0, uniform);
    const group = this.groupFor(this.viewLayout, ubo);
    const [msaa, depth] = this.attachments(w, h);
    const layer = device.createTexture({
      size: [w, h],
      format: LAYER_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    const layerView = layer.createView();
    const out = device.createTexture({
      size: [w, h],
      format: LAYER_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const composite = (this.offscreen ??= this.composites(LAYER_FORMAT));
    const blend = !options.layer && this.needsBlend ? new BlendPass(device, w, h) : null;
    const stride = Math.ceil((w * 4) / 256) * 256;
    const readback = device.createBuffer({
      size: stride * h,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = device.createCommandEncoder();
    const [r, g, b] = this.paper;
    const clear = options.background ? { r, g, b, a: 1 } : { r: 0, g: 0, b: 0, a: 0 };
    const base = encoder.beginRenderPass({
      colorAttachments: [
        { view: blend?.begin(encoder) ?? out.createView(), clearValue: clear, loadOp: "clear", storeOp: "store" },
      ],
    });
    if (options.pattern && this.grid.opacity > 0) {
      base.setBindGroup(0, group);
      base.setPipeline(composite.grid);
      base.draw(3);
    }
    base.end();
    const glow = options.background && this.dark;
    for (const l of this.order) {
      const gpu = this.layers.get(l.id);
      if (!gpu) continue;
      if (!l.visible || !gpu.vertices) {
        blend?.layer(encoder, null, gpu.opacityBuffer);
        continue;
      }
      if (options.layer && l.id !== options.layer) continue;
      this.drawLayer(encoder, gpu, l.id, layerView, msaa.view, depth.view, group, false, glow);
      if (blend) {
        blend.layer(encoder, layerView, gpu.opacityBuffer);
        continue;
      }
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: out.createView(), loadOp: "load", storeOp: "store" }],
      });
      pass.setBindGroup(0, group);
      pass.setPipeline(composite.layer);
      pass.setBindGroup(1, this.layerGroup(layerView, options.layer ? this.fullOpacity : gpu.opacityBuffer));
      pass.draw(3);
      pass.end();
    }
    if (blend) {
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          { view: out.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" },
        ],
      });
      pass.setPipeline(composite.layer);
      pass.setBindGroup(0, group);
      pass.setBindGroup(1, this.layerGroup(blend.view, this.fullOpacity));
      pass.draw(3);
      pass.end();
    }
    encoder.copyTextureToBuffer({ texture: out }, { buffer: readback, bytesPerRow: stride, rowsPerImage: h }, [w, h]);
    device.queue.submit([encoder.finish()]);
    try {
      await readback.mapAsync(GPUMapMode.READ);
      const mapped = new Uint8Array(readback.getMappedRange());
      const pixels = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++) pixels.set(mapped.subarray(y * stride, y * stride + w * 4), y * w * 4);
      readback.unmap();
      if (!options.background) {
        for (let i = 0; i < pixels.length; i += 4) {
          const a = pixels[i + 3]!;
          if (a === 0 || a === 255) continue;
          pixels[i] = (pixels[i]! * 255) / a;
          pixels[i + 1] = (pixels[i + 1]! * 255) / a;
          pixels[i + 2] = (pixels[i + 2]! * 255) / a;
        }
      }
      return { pixels, w, h };
    } finally {
      blend?.destroy();
      for (const t of [msaa.texture, depth.texture, layer, out]) t.destroy();
      readback.destroy();
      ubo.destroy();
    }
  }

  async exportPng(bounds: Bounds, scale: number, options: Render): Promise<Blob> {
    const { pixels, w, h } = await this.render(bounds, scale, options);
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("The image could not be encoded.");
    const image = ctx.createImageData(w, h);
    image.data.set(pixels);
    ctx.putImageData(image, 0, 0);
    return canvas.convertToBlob({ type: "image/png" });
  }

  async bucket(x: number, y: number, options: BucketOptions): Promise<number[][] | null> {
    let content: Bounds | null = null;
    for (const layer of this.order) {
      if (!layer.visible || (options.layer && options.layer !== layer.id)) continue;
      for (const stroke of layer.strokes) content = union(content, meshOf(stroke).bounds);
    }
    if (!content || x < content.minX - 2 || x > content.maxX + 2 || y < content.minY - 2 || y > content.maxY + 2)
      return null;
    const pad = Math.ceil(options.gap + options.expand) + 4;
    for (let half = 128; ; half *= 2) {
      const bounds = {
        minX: Math.max(Math.floor(content.minX) - pad, Math.floor(x) - half),
        minY: Math.max(Math.floor(content.minY) - pad, Math.floor(y) - half),
        maxX: Math.min(Math.ceil(content.maxX) + pad, Math.ceil(x) + half),
        maxY: Math.min(Math.ceil(content.maxY) + pad, Math.ceil(y) + half),
      };
      const width = bounds.maxX - bounds.minX,
        height = bounds.maxY - bounds.minY;
      if (width > MAX_EXPORT || height > MAX_EXPORT || width * height > 16_777_216)
        throw new Error("This fill region is too large for a document-resolution sample.");
      const { pixels, w, h } = await this.render(bounds, 1, {
        background: !options.layer,
        pattern: false,
        ...(options.layer ? { layer: options.layer } : {}),
      });
      const result = floodContours(
        pixels,
        w,
        h,
        Math.floor(x) - bounds.minX,
        Math.floor(y) - bounds.minY,
        bounds.minX,
        bounds.minY,
        options,
      );
      if (
        result ||
        (bounds.minX <= Math.floor(content.minX) - pad &&
          bounds.maxX >= Math.ceil(content.maxX) + pad &&
          bounds.minY <= Math.floor(content.minY) - pad &&
          bounds.maxY >= Math.ceil(content.maxY) + pad)
      )
        return result;
    }
  }

  async smudge(stroke: Stroke, layer: string): Promise<Stroke> {
    const b = pathBounds(stroke, stroke.width / 2 + 2);
    const bounds = {
      minX: Math.floor(b.minX),
      minY: Math.floor(b.minY),
      maxX: Math.ceil(b.maxX),
      maxY: Math.ceil(b.maxY),
    };
    const w = bounds.maxX - bounds.minX,
      h = bounds.maxY - bounds.minY;
    if (w > MAX_EXPORT || h > MAX_EXPORT || w * h > 16_777_216)
      throw new Error("This smudge is too large for a document-resolution sample.");
    const image = await this.render(bounds, 1, { background: false, pattern: false, layer });
    return { ...stroke, patch: { x: bounds.minX, y: bounds.minY, width: w, height: h, rgba: base64(image.pixels) } };
  }

  /** The colour on screen at a document point, as drawn at the current zoom. */
  async pick(x: number, y: number): Promise<[number, number, number]> {
    const half = 0.5 / (this.view.zoom * this.dpr);
    const bounds = { minX: x - half, minY: y - half, maxX: x + half, maxY: y + half };
    const { pixels } = await this.render(bounds, this.view.zoom * this.dpr, { background: true, pattern: false });
    return [pixels[0]!, pixels[1]!, pixels[2]!];
  }

  destroy() {
    for (const gpu of this.layers.values()) gpu.destroy();
    for (const texture of this.owned) texture.destroy();
    this.endLive();
    this.dropFloat();
    this.blend?.destroy();
    this.overlayBuffer?.destroy();
    this.context.unconfigure();
    this.device.destroy();
  }

  private get needsBlend() {
    return this.order.some((l) => l.visible && (l.clipping || (l.blendMode ?? "normal") !== "normal"));
  }

  private get dark() {
    const [r, g, b] = this.paper;
    return r * 0.299 + g * 0.587 + b * 0.114 < 0.5;
  }

  private frame() {
    this.scheduled = false;
    if (!this.msaa || !this.depth) return;
    this.fillUniform(this.uniform, this.view, this.width, this.height, this.dpr, true, true);
    this.device.queue.writeBuffer(this.viewBuffer, 0, this.uniform);
    const encoder = this.device.createCommandEncoder();
    const shown: LayerGpu[] = [];
    const glow = this.dark;
    for (const layer of this.order) {
      const gpu = this.layers.get(layer.id);
      if (!gpu || !layer.visible) continue;
      const live = this.live?.layer === layer.id;
      const floating = this.float?.layer === layer.id;
      if (!gpu.vertices && !live && !floating) continue;
      gpu.target ??= this.target(this.width, this.height, gpu);
      if (gpu.dirty || this.viewChanged)
        this.drawLayer(encoder, gpu, layer.id, gpu.target.view, this.msaa, this.depth, this.viewGroup, live, glow);
      gpu.dirty = false;
      shown.push(gpu);
    }
    if (this.overlayDirty || this.viewChanged) this.uploadOverlay();
    this.viewChanged = false;
    const [r, g, b] = this.paper;
    const target = this.context.getCurrentTexture().createView();
    const blend = this.needsBlend ? (this.blend ??= new BlendPass(this.device, this.width, this.height)) : null;
    const clear = { r, g, b, a: 1 };
    const attachment = blend?.begin(encoder) ?? target;
    let pass = encoder.beginRenderPass({
      colorAttachments: [{ view: attachment, clearValue: clear, loadOp: "clear", storeOp: "store" }],
    });
    pass.setBindGroup(0, this.viewGroup);
    if (this.grid.opacity > 0) {
      pass.setPipeline(blend ? (this.offscreen ??= this.composites(LAYER_FORMAT)).grid : this.screen.grid);
      pass.draw(3);
    }
    if (blend) {
      pass.end();
      const visible = new Set(shown);
      for (const l of this.order) {
        const gpu = this.layers.get(l.id);
        if (gpu) blend.layer(encoder, visible.has(gpu) ? gpu.target!.view : null, gpu.opacityBuffer);
      }
      pass = encoder.beginRenderPass({
        colorAttachments: [{ view: target, clearValue: clear, loadOp: "clear", storeOp: "store" }],
      });
      pass.setBindGroup(0, this.viewGroup);
      pass.setPipeline(this.screen.layer);
      pass.setBindGroup(1, this.layerGroup(blend.view, this.fullOpacity));
      pass.draw(3);
    } else {
      pass.setPipeline(this.screen.layer);
      for (const gpu of shown) {
        pass.setBindGroup(1, gpu.target!.group);
        pass.draw(3);
      }
    }
    if (this.overlayCount && this.overlayBuffer) {
      pass.setPipeline(this.screen.mark);
      pass.setVertexBuffer(0, this.overlayBuffer);
      pass.draw(this.overlayCount);
    }
    if (this.cursor.on) {
      pass.setPipeline(this.screen.ring);
      pass.draw(6);
    }
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  private uploadOverlay() {
    this.overlayDirty = false;
    const bytes = this.overlay?.() ?? null;
    this.overlayCount = bytes ? bytes.byteLength / MARK_BYTES : 0;
    if (!bytes || !this.overlayCount) return;
    if (!this.overlayBuffer || bytes.byteLength > this.overlayCapacity) {
      this.overlayBuffer?.destroy();
      this.overlayCapacity = Math.max(bytes.byteLength * 2, 1 << 14);
      this.overlayBuffer = this.device.createBuffer({
        size: this.overlayCapacity,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
    }
    this.device.queue.writeBuffer(this.overlayBuffer, 0, bytes);
  }

  private drawLayer(
    encoder: GPUCommandEncoder,
    gpu: LayerGpu,
    id: string,
    resolve: GPUTextureView,
    msaa: GPUTextureView,
    depth: GPUTextureView,
    group: GPUBindGroup,
    live: boolean,
    glow: boolean,
  ) {
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: msaa,
          resolveTarget: resolve,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "discard",
        },
      ],
      depthStencilAttachment: { view: depth, depthClearValue: 0, depthLoadOp: "clear", depthStoreOp: "discard" },
    });
    pass.setBindGroup(0, group);
    pass.setBindGroup(1, this.identity);
    this.drawRuns(pass, gpu, glow);
    const float = this.float;
    if (float?.layer === id && float.gpu.vertices) {
      pass.setBindGroup(1, this.floatGroup);
      this.drawRuns(pass, float.gpu, glow);
      pass.setBindGroup(1, this.identity);
    }
    if (live && this.live?.layer === id) {
      for (const item of this.live.items) {
        const count =
          item.source.stroke.tool === "smudge" ? item.previewCount : item.source.settled.count + item.source.tail.count;
        if (!count || !item.buffer) continue;
        pass.setVertexBuffer(0, item.buffer);
        const key = keyOf(item.source.stroke);
        pass.setPipeline(this.pipeline(key, glow, item.source.stroke.alphaLocked ?? false));
        if (instanceKey(key)) pass.draw(6, count);
        else pass.draw(count);
      }
    }
    pass.end();
  }

  private drawRuns(pass: GPURenderPassEncoder, gpu: LayerGpu, glow: boolean) {
    if (!gpu.buffer || !gpu.vertices) return;
    pass.setVertexBuffer(0, gpu.buffer);
    for (const run of gpu.runs) {
      pass.setPipeline(this.pipeline(run.key, glow, run.locked));
      if (instanceKey(run.key)) pass.draw(6, run.count, 0, run.first);
      else pass.draw(run.count, 1, run.first);
    }
  }

  private pipeline(key: Key, glow: boolean, locked: boolean): GPURenderPipeline {
    const pipelines = locked ? (this.lockedPipelines ??= this.strokePipelines(true)) : this.pipelines;
    return pipelines[glow && key === "marker" ? "marker-glow" : key];
  }

  /** Uploads what changed: strokes appended at the end are added, anything else re-copies from where it differs. */
  private sync(gpu: LayerGpu, strokes: readonly Stroke[]) {
    if (gpu.source === strokes) return;
    gpu.source = strokes;
    let same = 0;
    const n = Math.min(strokes.length, gpu.strokes.length);
    while (same < n && gpu.strokes[same] === strokes[same]) same++;
    if (same === strokes.length && same === gpu.strokes.length) return;
    gpu.strokes.length = same;
    gpu.ends.length = same;
    gpu.vertices = same ? gpu.ends[same - 1]! : 0;
    const added = strokes.slice(same).map(meshOf);
    const total = gpu.vertices + added.reduce((sum, m) => sum + m.vertices, 0);
    this.reserve(gpu, total * VERTEX_BYTES);
    while (gpu.runs.length && gpu.runs.at(-1)!.first >= gpu.vertices) gpu.runs.pop();
    const tail = gpu.runs.at(-1);
    if (tail) tail.count = gpu.vertices - tail.first;
    let first = gpu.vertices;
    const bytes = added.length === 1 ? added[0]!.bytes : new Uint8Array((total - first) * VERTEX_BYTES);
    for (let i = 0; i < added.length; i++) {
      const mesh = added[i]!,
        stroke = strokes[same + i]!;
      if (added.length > 1) bytes.set(mesh.bytes, (first - gpu.vertices) * VERTEX_BYTES);
      const key = keyOf(stroke),
        locked = stroke.alphaLocked ?? false;
      const last = gpu.runs.at(-1);
      if (last && last.key === key && last.locked === locked) last.count += mesh.vertices;
      else if (mesh.vertices) gpu.runs.push({ key, locked, first, count: mesh.vertices });
      first += mesh.vertices;
      gpu.strokes.push(stroke);
      gpu.ends.push(first);
    }
    if (bytes.length) this.device.queue.writeBuffer(gpu.buffer!, gpu.vertices * VERTEX_BYTES, bytes);
    gpu.vertices = total;
    gpu.dirty = true;
  }

  private reserve(gpu: LayerGpu, bytes: number) {
    if (gpu.buffer && bytes <= gpu.capacity) return;
    const capacity = Math.max(bytes, gpu.capacity * 2, 1 << 16);
    const next = this.device.createBuffer({
      size: capacity,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    if (gpu.buffer && gpu.vertices) {
      const encoder = this.device.createCommandEncoder();
      encoder.copyBufferToBuffer(gpu.buffer, 0, next, 0, gpu.vertices * VERTEX_BYTES);
      this.device.queue.submit([encoder.finish()]);
    }
    gpu.buffer?.destroy();
    gpu.buffer = next;
    gpu.capacity = capacity;
  }

  private fillUniform(
    u: Float32Array,
    view: View,
    w: number,
    h: number,
    dpr: number,
    screen: boolean,
    pattern: boolean,
  ) {
    const s = view.zoom * dpr;
    u.set([s * Math.cos(view.angle), s * Math.sin(view.angle), view.x * dpr, view.y * dpr, w, h, dpr, 0]);
    u.set([...this.ink, 1, ...this.paper, 1], 8);
    const c = this.cursor;
    u.set(screen && c.on ? [c.x * dpr, c.y * dpr, c.r * dpr, 1] : [0, 0, 0, 0], 16);
    const g = this.grid;
    u.set([pattern ? g.opacity : 0, g.spacing, g.mode, 0], 20);
  }

  private uniformBuffer(size: number): GPUBuffer {
    return this.device.createBuffer({ size, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  }

  private groupFor(layout: GPUBindGroupLayout, buffer: GPUBuffer): GPUBindGroup {
    return this.device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer } }] });
  }

  private layerGroup(view: GPUTextureView, opacity: GPUBuffer): GPUBindGroup {
    return this.device.createBindGroup({
      layout: this.textureLayout,
      entries: [
        { binding: 0, resource: view },
        { binding: 1, resource: { buffer: opacity } },
      ],
    });
  }

  private target(w: number, h: number, gpu: LayerGpu): Target {
    const texture = this.device.createTexture({
      size: [w, h],
      format: LAYER_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    const view = texture.createView();
    return { texture, view, group: this.layerGroup(view, gpu.opacityBuffer) };
  }

  private attachments(w: number, h: number) {
    return [LAYER_FORMAT, DEPTH_FORMAT].map((format) => {
      const texture = this.device.createTexture({
        size: [w, h],
        format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
        sampleCount: SAMPLES,
      });
      return { texture, view: texture.createView() };
    }) as [{ texture: GPUTexture; view: GPUTextureView }, { texture: GPUTexture; view: GPUTextureView }];
  }

  private strokePipelines(locked = false): Record<Key, GPURenderPipeline> {
    const module = this.device.createShaderModule({ code: strokeShader });
    const layout = this.device.createPipelineLayout({ bindGroupLayouts: [this.viewLayout, this.modelLayout] });
    const over = { srcFactor: "one", dstFactor: "one-minus-src-alpha" } as const;
    const erase = { srcFactor: "zero", dstFactor: "one-minus-src-alpha" } as const;
    const screen = { srcFactor: "one", dstFactor: "one-minus-src" } as const;
    const preserve = { srcFactor: "zero", dstFactor: "one" } as const;
    const atop = { srcFactor: "dst-alpha", dstFactor: "one-minus-src-alpha" } as const;
    const replace = { srcFactor: "one", dstFactor: "zero" } as const;
    const make = (entryPoint: string, color: GPUBlendComponent, layered: boolean, alpha = color, instances = false) =>
      this.device.createRenderPipeline({
        layout,
        vertex: {
          module,
          entryPoint: instances ? "vs_dab" : "vs",
          buffers: [
            {
              arrayStride: VERTEX_BYTES,
              stepMode: instances ? "instance" : "vertex",
              attributes: [
                { format: "float32x2", offset: 0, shaderLocation: 0 },
                { format: "snorm8x4", offset: 8, shaderLocation: 1 },
                { format: "unorm8x4", offset: 12, shaderLocation: 2 },
                { format: "float32", offset: 16, shaderLocation: 3 },
                { format: "float32x2", offset: 20, shaderLocation: 4 },
              ],
            },
          ],
        },
        fragment: {
          module,
          entryPoint,
          targets: [
            {
              format: LAYER_FORMAT,
              blend:
                locked && color !== replace
                  ? { color: color === erase ? preserve : atop, alpha: preserve }
                  : { color, alpha },
            },
          ],
        },
        primitive: { topology: "triangle-list" },
        depthStencil: {
          format: DEPTH_FORMAT,
          depthWriteEnabled: layered,
          depthCompare: layered ? "greater" : "always",
        },
        multisample: { count: SAMPLES },
      });
    return {
      spray: make("fs_spray", over, false, over, true),
      airbrush: make("fs_airbrush", over, false, over, true),
      smudge: make("fs_pen", replace, false),
      pen: make("fs_pen", over, false),
      "pen+": make("fs_pen_layered", over, true),
      brush: make("fs_brush", over, false),
      "brush+": make("fs_brush_layered", over, true),
      // Each stroke has its own depth: a marker or pencil stroke covers a sample once however
      // often it crosses itself, while a later stroke still layers over it.
      marker: make("fs_marker", over, true),
      "marker-glow": make("fs_marker_glow", screen, true, over),
      pencil: make("fs_pencil", over, true),
      eraser: make("fs_eraser", erase, false),
      "eraser+": make("fs_eraser_layered", erase, true),
    };
  }

  private composites(format: CanvasFormat): Composites {
    const module = this.device.createShaderModule({ code: compositeShader });
    const plain = this.device.createPipelineLayout({ bindGroupLayouts: [this.viewLayout] });
    const textured = this.device.createPipelineLayout({ bindGroupLayouts: [this.viewLayout, this.textureLayout] });
    const over = { srcFactor: "one", dstFactor: "one-minus-src-alpha" } as const;
    const target = { format, blend: { color: over, alpha: over } };
    const make = (layout: GPUPipelineLayout, vertex: string, fragment: string) =>
      this.device.createRenderPipeline({
        layout,
        vertex: { module, entryPoint: vertex },
        fragment: { module, entryPoint: fragment, targets: [target] },
        primitive: { topology: "triangle-list" },
      });
    return {
      layer: make(textured, "vs_full", "fs_layer"),
      grid: make(plain, "vs_full", "fs_grid"),
      ring: make(plain, "vs_ring", "fs_ring"),
      mark: this.device.createRenderPipeline({
        layout: plain,
        vertex: {
          module,
          entryPoint: "vs_mark",
          buffers: [
            {
              arrayStride: MARK_BYTES,
              attributes: [
                { format: "float32x2", offset: 0, shaderLocation: 0 },
                { format: "float32x2", offset: 8, shaderLocation: 1 },
                { format: "unorm8x4", offset: 16, shaderLocation: 2 },
                { format: "unorm8x4", offset: 20, shaderLocation: 3 },
                { format: "float32x4", offset: 24, shaderLocation: 4 },
              ],
            },
          ],
        },
        fragment: { module, entryPoint: "fs_mark", targets: [target] },
        primitive: { topology: "triangle-list" },
      }),
    };
  }
}

function modelData(m: Affine): Float32Array {
  return new Float32Array([m[0], m[1], m[2], m[3], m[4], m[5], 0, 0]);
}
