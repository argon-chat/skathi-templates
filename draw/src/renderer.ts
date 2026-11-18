import { paintGroups, type PaintGroup } from "./paintGroups";
import { BlendPass } from "./blend";
import { floodContours, type BucketOptions } from "./bucket";
import {
  SmudgeSession,
  cachedRaster,
  loadRaster,
  packRaster,
  drawingPixels,
  type RasterPlanes,
  type PixelRect,
} from "./smudge";
import { IDENTITY, union, type Affine } from "./geometry";
import { type Bounds, type LiveSource, Mesh, tessellate, tessellatePages, VERTEX_BYTES } from "./ink";
import { BLEND_MODES, INK, PAPER, rgb, STRIDE, type RasterPatch, type Layer, type Paper, type Stroke } from "./model";
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
  vertices: number;
  bounds: Bounds;
  copyTo(destination: Uint8Array, from: number, to: number, offset: number): void;
}

const CPU_CACHE_BYTES = 176 * 1024 * 1024;
const GPU_CACHE_BYTES = 192 * 1024 * 1024;
const LAYER_CACHE_BYTES = 64 * 1024 * 1024;
const PAGE_VERTICES = 131070;
interface CacheSlot {
  bytes?: Uint8Array;
}
interface MeshPage {
  end: number;
  slot: CacheSlot;
  rebuild: (target: Mesh) => void;
}
const meshes = new WeakMap<Stroke, Cached>();
// Slots held here contain only bytes, so the LRU never retains discarded strokes or their rebuild functions.
const recent = new Set<CacheSlot>();
let retainedBytes = 0;
class DrawingCommands {
  current: GPUCommandEncoder;
  constructor(private device: GPUDevice) {
    this.current = device.createCommandEncoder();
  }
  submit() {
    this.device.queue.submit([this.current.finish()]);
    this.current = this.device.createCommandEncoder();
  }
}

const scratch = new Mesh(1 << 16);

function retain(slot: CacheSlot, bytes: Uint8Array) {
  if (!bytes.length || bytes.length > CPU_CACHE_BYTES) return;
  while (retainedBytes + bytes.length > CPU_CACHE_BYTES || recent.size >= 32000) {
    const oldest = recent.values().next().value;
    if (!oldest) break;
    retainedBytes -= oldest.bytes!.length;
    delete oldest.bytes;
    recent.delete(oldest);
  }
  retainedBytes += bytes.length;
  recent.add(slot);
  slot.bytes = bytes;
}

function pageBytes(page: MeshPage) {
  if (page.slot.bytes) {
    recent.delete(page.slot);
    recent.add(page.slot);
    return page.slot.bytes;
  }
  page.rebuild(scratch);
  const bytes = scratch.view().slice();
  retain(page.slot, bytes);
  return bytes;
}

/** Cache independently recoverable geometry pages; a single long stroke can exceed the entire cache. */
export function meshOf(stroke: Stroke): Cached {
  const existing = meshes.get(stroke);
  if (existing) return existing;
  const pages: MeshPage[] = [];
  let vertices = 0;
  const bounds = tessellatePages(stroke, scratch, (rebuild) => {
    if (!scratch.count) return;
    vertices += scratch.count;
    const slot: CacheSlot = {};
    retain(slot, scratch.view().slice());
    pages.push({ end: vertices, slot, rebuild });
  });
  const mesh: Cached = {
    bounds,
    vertices,
    copyTo(destination, from, to, offset) {
      let lo = 0,
        hi = pages.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (pages[mid]!.end <= from) lo = mid + 1;
        else hi = mid;
      }
      for (let i = lo; from < to; i++) {
        const page = pages[i]!,
          start = i ? pages[i - 1]!.end : 0,
          end = Math.min(to, page.end);
        destination.set(
          pageBytes(page).subarray((from - start) * VERTEX_BYTES, (end - start) * VERTEX_BYTES),
          offset * VERTEX_BYTES,
        );
        offset += end - from;
        from = end;
      }
    },
  };
  meshes.set(stroke, mesh);
  return mesh;
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
  | "smudge"
  | "image";

function keyOf(stroke: Stroke): Key {
  const t = stroke.tool;
  if (t === "bucket" && stroke.patch) return "image";
  if (t === "marker" || t === "pencil" || t === "spray" || t === "airbrush" || t === "smudge") return t;
  if (t === "bucket" || t === "lasso-fill") return "pen";
  return (stroke.opacity ?? 1) < 1 ? `${t}+` : t;
}

const instanceKey = (key: Key) => key === "spray" || key === "airbrush";

interface Run {
  locked: boolean;
  key: Key;
  image?: RasterBinding;
  patch?: RasterPatch;
  scope?: number[];
  first: number;
  count: number;
}

interface RasterBinding {
  buffer: GPUBuffer;
  group: GPUBindGroup;
  refs: number;
  release(): void;
}
interface PreviewImage extends PixelRect {
  buffer: GPUBuffer;
  group: GPUBindGroup;
  flags: number;
}
const sameScope = (a?: number[], b?: number[]) =>
  a === b || ((a?.length ?? 0) === (b?.length ?? 0) && (!a || a.every((v, i) => v === b?.[i])));
interface Target {
  texture: GPUTexture;
  view: GPUTextureView;
  group: GPUBindGroup;
}

class LayerGpu {
  buffer: GPUBuffer | null = null;
  capacity = 0;
  limit = GPU_CACHE_BYTES;
  streamed = false;
  scoped = false;
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
    for (const run of this.runs) run.image?.release();
    this.target?.texture.destroy();
    this.runs = [];
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
  rawLayer?: boolean;
  pair?: readonly [Layer, Layer];
  theme?: "light" | "dark";
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
  preview?: PreviewImage;
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
  private scopePipeline: GPURenderPipeline | null = null;
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
  private pageBuffer: GPUBuffer | null = null;
  private pageBytes: Uint8Array<ArrayBuffer> | null = null;
  private singleTarget: GPUTexture | null = null;
  private singleView: GPUTextureView | null = null;
  private readonly layerGroups = new WeakMap<GPUTextureView, WeakMap<GPUBuffer, GPUBindGroup>>();
  private readonly maxGeometry = GPU_CACHE_BYTES;
  private readonly rasters = new WeakMap<Uint8Array, RasterBinding>();
  private readonly loads = new Set<Promise<void>>();
  private readonly smudges = new WeakMap<Stroke, { session: SmudgeSession; pending: Promise<void> }>();
  private readonly rasterLayout: GPUBindGroupLayout;
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
    this.rasterLayout = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } }],
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
      const limit = Math.floor((this.maxGeometry - (this.float?.gpu.limit ?? 0)) / Math.max(1, layers.length));
      if (gpu.limit !== limit) {
        gpu.limit = limit;
        gpu.source = null;
      }
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
    this.singleTarget?.destroy();
    this.singleTarget = null;
    this.singleView = null;
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
          const stroke = item.source.stroke;
          item.previewAt = stroke.points.length;
          void this.advanceSmudge(stroke, live.layer, (session) => session)
            .then((session) => {
              if (this.live !== live) return;
              const domain = session.workspace;
              if (!domain) return;
              const prev = item.preview;
              const resized =
                !prev ||
                prev.x !== domain.x ||
                prev.y !== domain.y ||
                prev.width !== domain.width ||
                prev.height !== domain.height;
              const pixels = session.result(!resized, true);
              if (!pixels) return;
              if (resized) {
                prev?.buffer.destroy();
                const flags = 3;
                const buf = this.rasterBuffer(domain, flags);
                item.preview = { ...domain, buffer: buf, flags, group: this.groupFor(this.rasterLayout, buf) };
              }
              const target = item.preview!;
              this.uploadRaster(target.buffer, target.flags, target, pixels);
              const mesh = new Mesh(6);
              const stub: RasterPatch = { ...domain, png: new Uint8Array(0) };
              tessellate({ ...stroke, patch: stub }, mesh);
              item.buffer ??= this.device.createBuffer({
                size: 6 * VERTEX_BYTES,
                usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
              });
              this.device.queue.writeBuffer(item.buffer, 0, mesh.view());
              item.previewCount = 6;
              const layer = this.layers.get(live.layer);
              if (layer) layer.dirty = true;
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
    for (const item of this.live.items) {
      item.buffer?.destroy();
      item.preview?.buffer.destroy();
    }
    this.live = null;
    this.request();
  }

  /** Lifts `strokes` out of `layer` and draws them through `m` until `dropFloat()`. */
  setFloat(layer: string, strokes: readonly Stroke[], m: Affine) {
    if (this.float?.layer !== layer || this.float.strokes !== strokes) {
      this.dropFloat();
      const gpu = new LayerGpu(this.uniformBuffer(16));
      gpu.limit = Math.min(32 * 1024 * 1024, Math.floor(this.maxGeometry / 4));
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
    if (this.loads.size) await this.rastersReady();
    const fit = Math.min(scale, MAX_EXPORT / (bounds.maxX - bounds.minX), MAX_EXPORT / (bounds.maxY - bounds.minY));
    const w = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) * fit));
    const h = Math.max(1, Math.ceil((bounds.maxY - bounds.minY) * fit));
    const device = this.device;
    const uniform = new Float32Array(24);
    const view = { zoom: 1, angle: 0, x: -bounds.minX, y: -bounds.minY };
    this.fillUniform(uniform, view, w, h, fit, false, options.pattern);
    if (options.theme) {
      uniform.set(
        [...rgb(INK[options.theme]).map((c) => c / 255), 1, ...rgb(PAPER[options.theme]).map((c) => c / 255), 1],
        8,
      );
    }
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
    const blend = options.pair || (!options.layer && this.needsBlend) ? new BlendPass(device, w, h) : null;
    const lowerParams = options.pair ? this.uniformBuffer(16) : null;
    if (lowerParams && options.pair)
      device.queue.writeBuffer(lowerParams, 0, new Float32Array([options.pair[0].opacity, 0, 0, 0]));
    const stride = Math.ceil((w * 4) / 256) * 256;
    const readback = device.createBuffer({
      size: stride * h,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const commands = new DrawingCommands(device);
    const transient: GPUTexture[] = [];
    const [r, g, b] = this.paper;
    const clear = options.background ? { r, g, b, a: 1 } : { r: 0, g: 0, b: 0, a: 0 };
    const base = commands.current.beginRenderPass({
      colorAttachments: [
        {
          view: blend?.begin(commands.current) ?? out.createView(),
          clearValue: clear,
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    if (options.pattern && this.grid.opacity > 0) {
      base.setBindGroup(0, group);
      base.setPipeline(composite.grid);
      base.draw(3);
    }
    base.end();
    const glow =
      (options.background || !!options.pair || !!options.layer) &&
      (options.theme ? options.theme === "dark" : this.dark);
    for (const l of options.pair ?? this.order) {
      const gpu = this.layers.get(l.id);
      if (!gpu) continue;
      if ((!l.visible && !options.pair) || !gpu.vertices) {
        blend?.layer(commands.current, null, gpu.opacityBuffer);
        continue;
      }
      if (options.layer && l.id !== options.layer) continue;
      this.drawLayer(commands, gpu, l.id, layerView, msaa.view, depth.view, group, false, glow, w, h, transient);
      if (blend) {
        blend.layer(commands.current, layerView, (l === options.pair?.[0] ? lowerParams : null) ?? gpu.opacityBuffer);
        continue;
      }
      const pass = commands.current.beginRenderPass({
        colorAttachments: [{ view: out.createView(), loadOp: "load", storeOp: "store" }],
      });
      pass.setBindGroup(0, group);
      pass.setPipeline(composite.layer);
      pass.setBindGroup(1, this.layerGroup(layerView, options.rawLayer ? this.fullOpacity : gpu.opacityBuffer));
      pass.draw(3);
      pass.end();
    }
    if (blend) {
      const pass = commands.current.beginRenderPass({
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
    commands.current.copyTextureToBuffer({ texture: out }, { buffer: readback, bytesPerRow: stride, rowsPerImage: h }, [
      w,
      h,
    ]);
    commands.submit();
    for (const t of transient) t?.destroy();
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
      lowerParams?.destroy();
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

  async mergeLayers(lower: Layer, upper: Layer, seq: number): Promise<Layer> {
    const merged: Layer = { ...lower, visible: lower.visible || upper.visible, opacity: 1, strokes: [] };
    let b: Bounds | null = null;
    for (const l of [lower, upper]) for (const s of l.strokes) b = union(b, meshOf(s).bounds);
    if (!b) return merged;
    const bounds = {
      minX: Math.floor(b.minX) - 1,
      minY: Math.floor(b.minY) - 1,
      maxX: Math.ceil(b.maxX) + 1,
      maxY: Math.ceil(b.maxY) + 1,
    };
    const w = bounds.maxX - bounds.minX,
      h = bounds.maxY - bounds.minY;
    if (w > 4096 || h > 4096 || w * h > 2500000)
      throw new Error("These layers are too large to merge at document resolution.");
    const planes = await this.themedSample(bounds, { pair: [lower, upper], background: false, pattern: false }, [
      lower,
      upper,
    ]);
    const { minX: x, minY: y, maxX: maxX, maxY: maxY } = bounds;
    const points = [x, y, 1, 0, 0, 0, 0, maxX, y, 1, 0, 0, 0, 0, maxX, maxY, 1, 0, 0, 0, 0, x, maxY, 1, 0, 0, 0, 0];
    return {
      ...merged,
      strokes: [
        {
          seq,
          tool: "bucket",
          color: "ink",
          width: 1,
          points,
          patch: await packRaster(planes),
        },
      ],
    };
  }

  private async themedSample(bounds: Bounds, options: Render, layers: readonly Layer[]): Promise<RasterPlanes> {
    const dual = layers.some((l) =>
      l.strokes.some((s) => s.color === "ink" || s.tool === "marker" || s.patch?.darkPng),
    );
    const [day, night] = await Promise.all([
      this.render(bounds, 1, { ...options, theme: "light" }),
      dual ? this.render(bounds, 1, { ...options, theme: "dark" }) : undefined,
    ]);
    return {
      x: bounds.minX,
      y: bounds.minY,
      width: day.w,
      height: day.h,
      light: drawingPixels(day.pixels),
      ...(night && { dark: drawingPixels(night.pixels) }),
    };
  }

  private async advanceSmudge<T>(stroke: Stroke, layer: string, read: (s: SmudgeSession) => T): Promise<T> {
    let state = this.smudges.get(stroke);
    if (!state) {
      state = { session: new SmudgeSession(stroke), pending: Promise.resolve() };
      this.smudges.set(stroke, state);
    }
    const session = state.session;
    const count = stroke.points.length / STRIDE;
    const job = state.pending.then(async () => {
      if (count <= session.processed) return read(session);
      const b = session.bounds(stroke.points, count);
      if (b) {
        const source = this.order.find((l) => l.id === layer);
        if (!source) throw new Error("The smudge layer is no longer available.");
        session.supply(
          await this.themedSample(
            { minX: b.x, minY: b.y, maxX: b.x + b.width, maxY: b.y + b.height },
            { layer, rawLayer: true, background: false, pattern: false },
            [source],
          ),
        );
      }
      session.advance(stroke.points, count);
      return read(session);
    });
    state.pending = job.then(
      () => {},
      () => {},
    );
    return job;
  }

  async smudge(stroke: Stroke, layer: string, checkpoint = false): Promise<Stroke> {
    const length = stroke.points.length;
    const result = await this.advanceSmudge(stroke, layer, (s) => s.result());
    const frozen = checkpoint ? { ...stroke, points: stroke.points.slice(0, length) } : stroke;
    if (!checkpoint) this.smudges.delete(stroke);
    return result ? { ...frozen, patch: await packRaster(result) } : frozen;
  }

  async rastersReady() {
    await Promise.all(this.loads);
  }
  private rasterBuffer(rect: PixelRect, flags: number) {
    const planes = 1 + Number(!!(flags & 1)) + Number(!!(flags & 2));
    const buffer = this.device.createBuffer({
      size: 12 + 4 * rect.width * rect.height * planes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(buffer, 0, new Uint32Array([rect.width, rect.height, flags]));
    return buffer;
  }
  private uploadRaster(buffer: GPUBuffer, flags: number, domain: PixelRect, area: RasterPlanes) {
    let base = 3;
    for (const plane of [
      area.light,
      ...(flags & 1 ? [area.dark ?? area.light] : []),
      ...(flags & 2 && area.coverage ? [area.coverage] : []),
    ]) {
      const x = area.x - domain.x,
        y = area.y - domain.y;
      if (domain.width === area.width) this.device.queue.writeBuffer(buffer, (base + y * domain.width) * 4, plane);
      else
        for (let row = 0; row < area.height; row++) {
          const dest = base + (y + row) * domain.width + x;
          this.device.queue.writeBuffer(buffer, dest * 4, plane.subarray(row * area.width, (row + 1) * area.width));
        }
      base += domain.width * domain.height;
    }
  }
  private bindRaster(patch: RasterPatch, planes: RasterPlanes) {
    let item = this.rasters.get(patch.png);
    if (!item) {
      const flags = Number(!!planes.dark) + 2 * Number(!!planes.coverage);
      const buffer = this.rasterBuffer(planes, flags);
      this.uploadRaster(buffer, flags, planes, planes);
      const key = patch.png;
      const resource: RasterBinding = {
        buffer,
        group: this.groupFor(this.rasterLayout, buffer),
        refs: 0,
        release: () => {
          resource.refs--;
          if (!resource.refs)
            queueMicrotask(() => {
              if (!resource.refs && this.rasters.get(key) === resource) {
                this.rasters.delete(key);
                resource.buffer.destroy();
              }
            });
        },
      };
      this.rasters.set(key, resource);
      item = resource;
    }
    item.refs++;
    return item;
  }
  private attachRaster(run: Run, gpu: LayerGpu, patch: RasterPatch) {
    const planes = cachedRaster(patch);
    if (planes) {
      run.image = this.bindRaster(patch, planes);
      return;
    }
    const pending = loadRaster(patch).then((data) => {
      if (gpu.runs.includes(run)) {
        run.image = this.bindRaster(patch, data);
        gpu.dirty = true;
        this.request();
      }
    });
    this.loads.add(pending);
    void pending.finally(() => this.loads.delete(pending)).catch(() => {});
  }

  /** The colour on screen at a document point, as drawn at the current zoom. */
  async pick(x: number, y: number): Promise<[number, number, number]> {
    const half = 0.5 / (this.view.zoom * this.dpr);
    const bounds = { minX: x - half, minY: y - half, maxX: x + half, maxY: y + half };
    const { pixels } = await this.render(bounds, this.view.zoom * this.dpr, { background: true, pattern: false });
    return [pixels[0]!, pixels[1]!, pixels[2]!];
  }

  destroy() {
    this.msaa = null;
    this.depth = null;
    for (const gpu of this.layers.values()) gpu.destroy();
    for (const texture of this.owned) texture.destroy();
    this.endLive();
    this.dropFloat();
    this.blend?.destroy();
    this.pageBuffer?.destroy();
    this.singleTarget?.destroy();
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
    const commands = new DrawingCommands(this.device);
    const transient: GPUTexture[] = [];
    const shown: LayerGpu[] = [];
    const glow = this.dark;
    const visible = (l: Layer, gpu: LayerGpu) =>
      l.visible && (gpu.vertices > 0 || this.live?.layer === l.id || this.float?.layer === l.id);
    const active = this.order.filter((l) => {
      const gpu = this.layers.get(l.id);
      return gpu && visible(l, gpu);
    }).length;
    const streaming = active * this.width * this.height * 4 > LAYER_CACHE_BYTES;
    for (const l of this.order) {
      const gpu = this.layers.get(l.id);
      if (!gpu) continue;
      if (streaming || !visible(l, gpu)) {
        if (gpu.target) {
          gpu.target.texture.destroy();
          gpu.target = null;
          gpu.dirty = true;
        }
        continue;
      }
      const recent = !!gpu.target;
      gpu.target ??= this.target(this.width, this.height, gpu);
      if (!recent || gpu.dirty || this.viewChanged)
        this.drawLayer(
          commands,
          gpu,
          l.id,
          gpu.target.view,
          this.msaa,
          this.depth,
          this.viewGroup,
          this.live?.layer === l.id,
          glow,
          this.width,
          this.height,
          transient,
        );
      gpu.dirty = false;
      shown.push(gpu);
    }
    if (this.overlayDirty || this.viewChanged) this.uploadOverlay();
    this.viewChanged = false;
    const [r, g, b] = this.paper;
    const target = this.context.getCurrentTexture().createView();
    const blend =
      streaming || this.needsBlend ? (this.blend ??= new BlendPass(this.device, this.width, this.height)) : null;
    const clear = { r, g, b, a: 1 };
    const attachment = blend?.begin(commands.current) ?? target;
    let pass = commands.current.beginRenderPass({
      colorAttachments: [{ view: attachment, clearValue: clear, loadOp: "clear", storeOp: "store" }],
    });
    pass.setBindGroup(0, this.viewGroup);
    if (this.grid.opacity > 0) {
      pass.setPipeline(blend ? (this.offscreen ??= this.composites(LAYER_FORMAT)).grid : this.screen.grid);
      pass.draw(3);
    }
    if (blend) {
      pass.end();
      const cached = new Set(shown);
      let shared: GPUTextureView | null = null;
      if (streaming) {
        this.singleTarget ??= this.device.createTexture({
          size: [this.width, this.height],
          format: LAYER_FORMAT,
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
        });
        shared = this.singleView ??= this.singleTarget.createView();
      }
      for (const l of this.order) {
        const gpu = this.layers.get(l.id);
        if (!gpu) continue;
        let view = cached.has(gpu) ? gpu.target!.view : null;
        if (shared && visible(l, gpu)) {
          this.drawLayer(
            commands,
            gpu,
            l.id,
            shared,
            this.msaa,
            this.depth,
            this.viewGroup,
            this.live?.layer === l.id,
            glow,
            this.width,
            this.height,
            transient,
          );
          view = shared;
        }
        blend.layer(commands.current, view, gpu.opacityBuffer);
      }
      pass = commands.current.beginRenderPass({
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
    commands.submit();
    for (const t of transient) t?.destroy();
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
    commands: DrawingCommands,
    gpu: LayerGpu,
    id: string,
    target: GPUTextureView,
    msaa: GPUTextureView,
    depth: GPUTextureView,
    group: GPUBindGroup,
    live: boolean,
    glow: boolean,
    width: number,
    height: number,
    transient: GPUTexture[],
  ) {
    const floating = this.float?.layer === id ? this.float.gpu : null;
    const paintLive = (pass: GPURenderPassEncoder) => {
      if (!live || this.live?.layer !== id) return;
      pass.setBindGroup(0, group);
      pass.setBindGroup(1, this.identity);
      for (const item of this.live.items) {
        const stroke = item.source.stroke;
        const count = stroke.tool === "smudge" ? item.previewCount : item.source.settled.count + item.source.tail.count;
        if (!count || !item.buffer) continue;
        const key = keyOf(stroke);
        pass.setPipeline(this.pipeline(key, glow, !!stroke.alphaLocked));
        pass.setVertexBuffer(0, item.buffer);
        if (item.preview) pass.setBindGroup(2, item.preview.group);
        if (instanceKey(key)) pass.draw(6, count);
        else pass.draw(count);
      }
    };
    if (!gpu.streamed && !gpu.scoped && !floating?.streamed && !floating?.scoped) {
      const pass = commands.current.beginRenderPass({
        colorAttachments: [
          {
            view: msaa,
            resolveTarget: target,
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: "clear",
            storeOp: "discard",
          },
        ],
        depthStencilAttachment: { view: depth, depthClearValue: 0, depthLoadOp: "clear", depthStoreOp: "discard" },
      });
      pass.setBindGroup(0, group);
      const batch = (gpu: LayerGpu, model: GPUBindGroup) => {
        if (!gpu.buffer || !gpu.vertices) return;
        pass.setVertexBuffer(0, gpu.buffer);
        pass.setBindGroup(1, model);
        for (const run of gpu.runs) {
          if (run.patch && !run.image) continue;
          pass.setPipeline(this.pipeline(run.key, glow, run.locked));
          if (run.image) pass.setBindGroup(2, run.image.group);
          if (instanceKey(run.key)) pass.draw(6, run.count, 0, run.first);
          else pass.draw(run.count, 1, run.first);
        }
      };
      batch(gpu, this.identity);
      if (floating) batch(floating, this.floatGroup);
      paintLive(pass);
      pass.end();
      return;
    }
    type Surface = { view: GPUTextureView; texture: GPUTexture; group: GPUBindGroup };
    const stack: Surface[][] = [];
    const scratch = (level: number, slot: number): Surface => {
      const pair = (stack[level] ??= []);
      stack[level] = pair;
      if (pair[slot]) return pair[slot]!;
      const index = level * 2 + slot;
      if (!transient[index] && (transient.filter(Boolean).length + 1) * width * height * 4 > 192 * 1024 * 1024)
        throw new Error("The nested paint groups exceed the image memory available at this resolution.");
      const t = (transient[index] ??= this.device.createTexture({
        size: [width, height],
        format: LAYER_FORMAT,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      }));
      const view = t.createView();
      return (pair[slot] = { view, texture: t, group: this.layerGroup(view, this.fullOpacity) });
    };
    const compose = (pass: GPURenderPassEncoder, src: GPUBindGroup) => {
      pass.setPipeline(this.isolatePipeline());
      pass.setBindGroup(0, group);
      pass.setBindGroup(1, src);
      pass.draw(3);
    };
    const draw = (
      pass: GPURenderPassEncoder,
      run: Run,
      buffer: GPUBuffer,
      model: GPUBindGroup,
      first: number,
      count: number,
    ) => {
      if (run.patch && !run.image) return;
      pass.setPipeline(this.pipeline(run.key, glow, run.locked));
      pass.setBindGroup(0, group);
      pass.setBindGroup(1, model);
      pass.setVertexBuffer(0, buffer);
      if (run.image) pass.setBindGroup(2, run.image.group);
      if (instanceKey(run.key)) pass.draw(6, count, 0, first);
      else pass.draw(count, 1, first);
    };
    const scene = (dst: GPUTextureView, level: number) => {
      let pass: GPURenderPassEncoder | null = null,
        hasContent = false;
      const open = () => {
        if (pass) return pass;
        const loadOp = hasContent ? "load" : "clear";
        pass = commands.current.beginRenderPass({
          colorAttachments: [
            { view: msaa, resolveTarget: dst, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp, storeOp: "store" },
          ],
          depthStencilAttachment: { view: depth, depthClearValue: 0, depthLoadOp: loadOp, depthStoreOp: "store" },
        });
        hasContent = true;
        return pass;
      };
      const end = () => {
        if (pass) {
          pass.end();
          pass = null;
        }
      };
      const paint = (source: LayerGpu, model: GPUBindGroup, items: readonly (Run | PaintGroup<Run>)[]) => {
        let used = 0;
        const pageRuns: { run: Run; first: number; count: number }[] = [];
        const flush = () => {
          if (!used) return;
          end();
          commands.submit();
          const buffer = (this.pageBuffer ??= this.device.createBuffer({
            size: PAGE_VERTICES * VERTEX_BYTES,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
          }));
          this.device.queue.writeBuffer(buffer, 0, this.pageBytes!.subarray(0, used * VERTEX_BYTES));
          const pass = open();
          for (const item of pageRuns) draw(pass, item.run, buffer, model, item.first, item.count);
          pageRuns.length = 0;
          used = 0;
        };
        for (const item of items) {
          if ("children" in item) {
            flush();
            end();
            if (item.children.length === 1 && "children" in item.children[0]!) {
              paint(source, model, item.children);
              continue;
            }
            const parent = hasContent ? scratch(level, 0) : null;
            if (parent) {
              const save = commands.current.beginRenderPass({
                colorAttachments: [
                  { view: parent.view, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" },
                ],
              });
              save.setPipeline((this.offscreen ??= this.composites(LAYER_FORMAT)).layer);
              save.setBindGroup(0, group);
              save.setBindGroup(1, this.layerGroup(dst, this.fullOpacity));
              save.draw(3);
              save.end();
            }
            const child = scratch(level, 1),
              sub = scene(child.view, level + 1);
            sub.paint(source, model, item.children);
            sub.finish();
            hasContent = false;
            const next = open();
            if (parent) compose(next, parent.group);
            compose(next, child.group);
          } else if (source.streamed) {
            let at = item.first,
              remaining = item.count;
            while (remaining) {
              let count = Math.min(remaining, PAGE_VERTICES - used);
              if (!instanceKey(item.key)) count -= count % 3;
              if (!count) {
                flush();
                continue;
              }
              this.copyPage(source, at, at + count, used);
              pageRuns.push({ run: item, first: used, count });
              used += count;
              at += count;
              remaining -= count;
              if (used === PAGE_VERTICES) flush();
            }
          } else if (source.buffer) draw(open(), item, source.buffer, model, item.first, item.count);
        }
        flush();
      };
      return {
        paint,
        open,
        finish: () => {
          open();
          end();
        },
      };
    };
    const root = scene(target, 0);
    const items = (source: LayerGpu) =>
      source.runs.some((r) => r.scope?.length) ? paintGroups(source.runs) : source.runs;
    root.paint(gpu, this.identity, items(gpu));
    if (this.float?.layer === id) root.paint(this.float.gpu, this.floatGroup, items(this.float.gpu));
    if (live) paintLive(root.open());
    root.finish();
  }

  private isolatePipeline() {
    if (this.scopePipeline) return this.scopePipeline;
    const module = this.device.createShaderModule({ code: compositeShader });
    const over = { srcFactor: "one", dstFactor: "one-minus-src-alpha" } as const;
    return (this.scopePipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.viewLayout, this.textureLayout] }),
      vertex: { module, entryPoint: "vs_full" },
      fragment: {
        module,
        entryPoint: "fs_layer",
        targets: [{ format: LAYER_FORMAT, blend: { color: over, alpha: over } }],
      },
      primitive: { topology: "triangle-list" },
      multisample: { count: SAMPLES },
      depthStencil: { format: DEPTH_FORMAT, depthCompare: "always", depthWriteEnabled: false },
    }));
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
    while (same < Math.min(strokes.length, gpu.strokes.length) && strokes[same] === gpu.strokes[same]) same++;
    const unchanged = same === gpu.strokes.length && same === strokes.length;
    gpu.strokes.length = same;
    gpu.ends.length = same;
    const prefix = same ? gpu.ends[same - 1]! : 0;
    while (gpu.runs.length && gpu.runs.at(-1)!.first >= prefix) gpu.runs.pop()!.image?.release();
    const tail = gpu.runs.at(-1);
    if (tail) tail.count = prefix - tail.first;
    let first = prefix;
    for (let i = same; i < strokes.length; i++) {
      const stroke = strokes[i]!,
        count = meshOf(stroke).vertices;
      const key = keyOf(stroke),
        locked = stroke.alphaLocked ?? false,
        scope = stroke.scope;
      const last = gpu.runs.at(-1);
      if (stroke.patch) {
        const run: Run = { key, locked, first, count, patch: stroke.patch, ...(scope && { scope }) };
        gpu.runs.push(run);
        this.attachRaster(run, gpu, stroke.patch);
      } else if (last && !last.patch && last.key === key && last.locked === locked && sameScope(last.scope, scope))
        last.count += count;
      else if (count) gpu.runs.push({ key, locked, first, count, ...(scope && { scope }) });
      first += count;
      gpu.strokes.push(stroke);
      gpu.ends.push(first);
    }
    const streamed = first * VERTEX_BYTES > gpu.limit;
    if (unchanged && gpu.streamed === streamed && gpu.capacity <= gpu.limit) return;
    const uploadFrom = gpu.streamed || gpu.capacity > gpu.limit ? 0 : prefix;
    gpu.streamed = streamed;
    if (streamed || gpu.capacity > gpu.limit) {
      gpu.buffer?.destroy();
      gpu.buffer = null;
      gpu.capacity = 0;
    }
    gpu.vertices = first;
    if (!streamed && first) {
      this.reserve(gpu, first * VERTEX_BYTES, uploadFrom);
      let start = uploadFrom;
      while (start < first) {
        const end = Math.min(first, start + PAGE_VERTICES);
        const page = this.copyPage(gpu, start, end, 0);
        this.device.queue.writeBuffer(
          gpu.buffer!,
          start * VERTEX_BYTES,
          page.subarray(0, (end - start) * VERTEX_BYTES),
        );
        start = end;
      }
    }
    gpu.scoped = gpu.runs.some((r) => r.scope?.length);
    gpu.dirty = true;
  }

  private copyPage(gpu: LayerGpu, start: number, end: number, offset: number) {
    const page = (this.pageBytes ??= new Uint8Array(PAGE_VERTICES * VERTEX_BYTES));
    let lo = 0,
      hi = gpu.ends.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (gpu.ends[mid]! <= start) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; start < end; i++) {
      const first = i ? gpu.ends[i - 1]! : 0,
        last = Math.min(end, gpu.ends[i]!);
      if (last <= start) continue;
      const mesh = meshOf(gpu.strokes[i]!);
      mesh.copyTo(page, start - first, last - first, offset);
      offset += last - start;
      start = last;
    }
    return page;
  }

  private reserve(gpu: LayerGpu, bytes: number, prefix: number) {
    if (gpu.buffer && bytes <= gpu.capacity) return;
    const capacity = Math.min(gpu.limit, Math.max(bytes, gpu.capacity * 1.5, 1 << 16));
    const next = this.device.createBuffer({
      size: capacity,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    if (gpu.buffer && prefix) {
      const encoder = this.device.createCommandEncoder();
      encoder.copyBufferToBuffer(gpu.buffer, 0, next, 0, prefix * VERTEX_BYTES);
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
    let groups = this.layerGroups.get(view);
    if (!groups) {
      groups = new WeakMap();
      this.layerGroups.set(view, groups);
    }
    const found = groups.get(opacity);
    if (found) return found;
    const group = this.device.createBindGroup({
      layout: this.textureLayout,
      entries: [
        { binding: 0, resource: view },
        { binding: 1, resource: { buffer: opacity } },
      ],
    });
    groups.set(opacity, group);
    return group;
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
        layout:
          entryPoint === "fs_image"
            ? this.device.createPipelineLayout({
                bindGroupLayouts: [this.viewLayout, this.modelLayout, this.rasterLayout],
              })
            : layout,
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
      image: make("fs_image", over, false),
      spray: make("fs_spray", over, false, over, true),
      airbrush: make("fs_airbrush", over, false, over, true),
      smudge: make("fs_image", replace, false),
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
