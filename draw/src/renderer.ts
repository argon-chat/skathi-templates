import { type Bounds, LiveStroke, Mesh, tessellate, VERTEX_BYTES } from "./ink";
import type { Layer, Stroke, Tool } from "./model";
import { compositeShader, strokeShader } from "./shaders";

const SAMPLES = 4;
const LAYER_FORMAT = "rgba8unorm";
const DEPTH_FORMAT = "depth32float";

type CanvasFormat = ReturnType<GPU["getPreferredCanvasFormat"]>;
const MAX_EXPORT = 8192;

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

interface Run {
  tool: Tool;
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
  ends: number[] = [];
  runs: Run[] = [];
  target: Target | null = null;
  visible = true;
  dirty = true;
}

export interface View {
  zoom: number;
  x: number;
  y: number;
}

type Rgb = readonly [number, number, number];

interface Composites {
  layer: GPURenderPipeline;
  grid: GPURenderPipeline;
  ring: GPURenderPipeline;
}

export class Renderer {
  view: View = { zoom: 1, x: 0, y: 0 };
  private width = 1;
  private height = 1;
  private dpr = 1;
  private paper: Rgb = [1, 1, 1];
  private ink: Rgb = [0, 0, 0];
  private grid = 0;
  private cursor = { x: 0, y: 0, r: 0, on: false };
  private layers = new Map<string, LayerGpu>();
  private order: readonly Layer[] = [];
  private live: { layer: string; stroke: LiveStroke; uploaded: number } | null = null;
  private liveBuffer: GPUBuffer | null = null;
  private liveCapacity = 0;
  private msaa: GPUTextureView | null = null;
  private depth: GPUTextureView | null = null;
  private owned: GPUTexture[] = [];
  private viewChanged = true;
  private scheduled = false;
  private uniform = new Float32Array(24);
  private readonly viewBuffer: GPUBuffer;
  private readonly viewGroup: GPUBindGroup;
  private readonly pipelines: Record<Tool, GPURenderPipeline>;
  private readonly screen: Composites;
  private readonly textureLayout: GPUBindGroupLayout;
  private readonly viewLayout: GPUBindGroupLayout;

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
    const usage = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST;
    this.viewLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      ],
    });
    this.textureLayout = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } }],
    });
    this.viewBuffer = device.createBuffer({ size: this.uniform.byteLength, usage });
    this.viewGroup = this.viewGroupFor(this.viewBuffer);
    this.pipelines = this.strokePipelines();
    this.screen = this.composites(format);
  }

  setLayers(layers: readonly Layer[]) {
    this.order = layers;
    const ids = new Set(layers.map((l) => l.id));
    for (const [id, gpu] of this.layers) {
      if (ids.has(id)) continue;
      gpu.buffer?.destroy();
      gpu.target?.texture.destroy();
      this.layers.delete(id);
    }
    for (const layer of layers) {
      let gpu = this.layers.get(layer.id);
      if (!gpu) this.layers.set(layer.id, (gpu = new LayerGpu()));
      if (gpu.visible !== layer.visible) gpu.dirty = true;
      gpu.visible = layer.visible;
      this.sync(gpu, layer.strokes);
    }
    this.request();
  }

  setView(view: View) {
    this.view = view;
    this.viewChanged = true;
    this.request();
  }

  setTheme(paper: Rgb, ink: Rgb, grid: number) {
    this.paper = paper;
    this.ink = ink;
    this.grid = grid;
    this.viewChanged = true;
    this.request();
  }

  setCursor(x: number, y: number, r: number, on: boolean) {
    if (!on && !this.cursor.on) return;
    this.cursor = { x, y, r, on };
    this.request();
  }

  resize(width: number, height: number, dpr: number) {
    const w = Math.max(1, Math.round(width * dpr));
    const h = Math.max(1, Math.round(height * dpr));
    if (w === this.width && h === this.height && dpr === this.dpr && this.msaa) return;
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

  beginLive(layer: string, stroke: LiveStroke) {
    this.live = { layer, stroke, uploaded: 0 };
    this.updateLive();
  }

  updateLive() {
    const live = this.live;
    if (!live) return;
    const { settled, tail } = live.stroke;
    const needed = (settled.count + tail.count) * VERTEX_BYTES;
    if (needed > this.liveCapacity || !this.liveBuffer) {
      this.liveBuffer?.destroy();
      this.liveCapacity = Math.max(needed * 2, 1 << 18);
      this.liveBuffer = this.device.createBuffer({
        size: this.liveCapacity,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      live.uploaded = 0;
    }
    if (settled.count > live.uploaded)
      this.device.queue.writeBuffer(this.liveBuffer, live.uploaded * VERTEX_BYTES, settled.view(live.uploaded));
    live.uploaded = settled.count;
    if (tail.count) this.device.queue.writeBuffer(this.liveBuffer, settled.count * VERTEX_BYTES, tail.view());
    const gpu = this.layers.get(live.layer);
    if (gpu) gpu.dirty = true;
    this.request();
  }

  endLive() {
    if (!this.live) return;
    const gpu = this.layers.get(this.live.layer);
    if (gpu) gpu.dirty = true;
    this.live = null;
    this.request();
  }

  request() {
    if (this.scheduled) return;
    this.scheduled = true;
    requestAnimationFrame(() => this.frame());
  }

  /** Renders the visible layers inside `bounds` at `scale` pixels per document unit, on the paper, as a PNG. */
  async exportPng(bounds: Bounds, scale: number): Promise<Blob> {
    const fit = Math.min(scale, MAX_EXPORT / (bounds.maxX - bounds.minX), MAX_EXPORT / (bounds.maxY - bounds.minY));
    const w = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) * fit));
    const h = Math.max(1, Math.ceil((bounds.maxY - bounds.minY) * fit));
    const device = this.device;
    const uniform = new Float32Array(24);
    this.fillUniform(uniform, { zoom: 1, x: -bounds.minX, y: -bounds.minY }, w, h, fit, false);
    const ubo = device.createBuffer({
      size: uniform.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(ubo, 0, uniform);
    const group = this.viewGroupFor(ubo);
    const [msaa, depth] = this.attachments(w, h);
    const layer = this.target(w, h);
    const out = device.createTexture({
      size: [w, h],
      format: LAYER_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const composite = this.composites(LAYER_FORMAT);
    const stride = Math.ceil((w * 4) / 256) * 256;
    const readback = device.createBuffer({
      size: stride * h,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = device.createCommandEncoder();
    const [r, g, b] = this.paper;
    encoder
      .beginRenderPass({
        colorAttachments: [
          { view: out.createView(), clearValue: { r, g, b, a: 1 }, loadOp: "clear", storeOp: "store" },
        ],
      })
      .end();
    for (const l of this.order) {
      const gpu = this.layers.get(l.id);
      if (!gpu || !l.visible || !gpu.vertices) continue;
      this.drawLayer(encoder, gpu, l.id, layer.view, msaa.view, depth.view, group, false);
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: out.createView(), loadOp: "load", storeOp: "store" }],
      });
      pass.setBindGroup(0, group);
      pass.setPipeline(composite.layer);
      pass.setBindGroup(1, layer.group);
      pass.draw(3);
      pass.end();
    }
    encoder.copyTextureToBuffer({ texture: out }, { buffer: readback, bytesPerRow: stride, rowsPerImage: h }, [w, h]);
    device.queue.submit([encoder.finish()]);
    try {
      await readback.mapAsync(GPUMapMode.READ);
      const pixels = new Uint8Array(readback.getMappedRange());
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("The image could not be encoded.");
      const image = ctx.createImageData(w, h);
      for (let y = 0; y < h; y++) image.data.set(pixels.subarray(y * stride, y * stride + w * 4), y * w * 4);
      readback.unmap();
      ctx.putImageData(image, 0, 0);
      return await canvas.convertToBlob({ type: "image/png" });
    } finally {
      for (const t of [msaa.texture, depth.texture, layer.texture, out]) t.destroy();
      readback.destroy();
      ubo.destroy();
    }
  }

  destroy() {
    for (const gpu of this.layers.values()) {
      gpu.buffer?.destroy();
      gpu.target?.texture.destroy();
    }
    for (const texture of this.owned) texture.destroy();
    this.liveBuffer?.destroy();
    this.context.unconfigure();
    this.device.destroy();
  }

  private frame() {
    this.scheduled = false;
    if (!this.msaa || !this.depth) return;
    this.fillUniform(this.uniform, this.view, this.width, this.height, this.dpr, true);
    this.device.queue.writeBuffer(this.viewBuffer, 0, this.uniform);
    const encoder = this.device.createCommandEncoder();
    const shown: LayerGpu[] = [];
    for (const layer of this.order) {
      const gpu = this.layers.get(layer.id);
      if (!gpu || !layer.visible) continue;
      const live = this.live?.layer === layer.id;
      if (!gpu.vertices && !live) continue;
      gpu.target ??= this.target(this.width, this.height);
      if (gpu.dirty || this.viewChanged)
        this.drawLayer(encoder, gpu, layer.id, gpu.target.view, this.msaa, this.depth, this.viewGroup, live);
      gpu.dirty = false;
      shown.push(gpu);
    }
    this.viewChanged = false;
    const [r, g, b] = this.paper;
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: { r, g, b, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    pass.setBindGroup(0, this.viewGroup);
    if (this.grid > 0) {
      pass.setPipeline(this.screen.grid);
      pass.draw(3);
    }
    pass.setPipeline(this.screen.layer);
    for (const gpu of shown) {
      pass.setBindGroup(1, gpu.target!.group);
      pass.draw(3);
    }
    if (this.cursor.on) {
      pass.setPipeline(this.screen.ring);
      pass.draw(6);
    }
    pass.end();
    this.device.queue.submit([encoder.finish()]);
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
    if (gpu.buffer && gpu.vertices) {
      pass.setVertexBuffer(0, gpu.buffer);
      for (const run of gpu.runs) {
        pass.setPipeline(this.pipelines[run.tool]);
        pass.draw(run.count, 1, run.first);
      }
    }
    const stroke = this.live?.stroke;
    if (live && stroke && this.liveBuffer && this.live?.layer === id) {
      const count = stroke.settled.count + stroke.tail.count;
      if (count) {
        pass.setVertexBuffer(0, this.liveBuffer);
        pass.setPipeline(this.pipelines[stroke.stroke.tool]);
        pass.draw(count);
      }
    }
    pass.end();
  }

  /** Uploads what changed: strokes appended at the end are added, anything else re-copies from where it differs. */
  private sync(gpu: LayerGpu, strokes: readonly Stroke[]) {
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
    if (added.length) {
      const bytes = new Uint8Array((total - gpu.vertices) * VERTEX_BYTES);
      let at = 0;
      for (const [i, mesh] of added.entries()) {
        bytes.set(mesh.bytes, at);
        at += mesh.bytes.length;
        gpu.strokes.push(strokes[same + i]!);
        gpu.ends.push(gpu.vertices + at / VERTEX_BYTES);
      }
      this.device.queue.writeBuffer(gpu.buffer!, gpu.vertices * VERTEX_BYTES, bytes);
    }
    gpu.vertices = total;
    gpu.runs = [];
    let first = 0;
    for (const [i, stroke] of gpu.strokes.entries()) {
      const end = gpu.ends[i]!;
      const last = gpu.runs.at(-1);
      if (last && last.tool === stroke.tool) last.count += end - first;
      else if (end > first) gpu.runs.push({ tool: stroke.tool, first, count: end - first });
      first = end;
    }
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

  private fillUniform(u: Float32Array, view: View, w: number, h: number, dpr: number, screen: boolean) {
    const scale = view.zoom * dpr;
    u.set([scale, 0, view.x * dpr, view.y * dpr, w, h, dpr, 0, ...this.ink, 1, ...this.paper, 1]);
    const c = this.cursor;
    u.set(screen && c.on ? [c.x * dpr, c.y * dpr, c.r * dpr, 1] : [0, 0, 0, 0], 16);
    u.set([screen ? this.grid : 0, 24, 0, 0], 20);
  }

  private viewGroupFor(buffer: GPUBuffer): GPUBindGroup {
    return this.device.createBindGroup({ layout: this.viewLayout, entries: [{ binding: 0, resource: { buffer } }] });
  }

  private target(w: number, h: number): Target {
    const texture = this.device.createTexture({
      size: [w, h],
      format: LAYER_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    const view = texture.createView();
    const group = this.device.createBindGroup({
      layout: this.textureLayout,
      entries: [{ binding: 0, resource: view }],
    });
    return { texture, view, group };
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

  private strokePipelines(): Record<Tool, GPURenderPipeline> {
    const module = this.device.createShaderModule({ code: strokeShader });
    const layout = this.device.createPipelineLayout({ bindGroupLayouts: [this.viewLayout] });
    const over = { srcFactor: "one", dstFactor: "one-minus-src-alpha" } as const;
    const erase = { srcFactor: "zero", dstFactor: "one-minus-src-alpha" } as const;
    const make = (entryPoint: string, blend: GPUBlendComponent, layered: boolean) =>
      this.device.createRenderPipeline({
        layout,
        vertex: {
          module,
          entryPoint: "vs",
          buffers: [
            {
              arrayStride: VERTEX_BYTES,
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
        fragment: { module, entryPoint, targets: [{ format: LAYER_FORMAT, blend: { color: blend, alpha: blend } }] },
        primitive: { topology: "triangle-list" },
        depthStencil: {
          format: DEPTH_FORMAT,
          depthWriteEnabled: layered,
          depthCompare: layered ? "greater" : "always",
        },
        multisample: { count: SAMPLES },
      });
    return {
      pen: make("fs_pen", over, false),
      brush: make("fs_brush", over, false),
      // Each stroke has its own depth: a marker or pencil stroke covers a sample once however
      // often it crosses itself, while a later stroke still layers over it.
      marker: make("fs_marker", over, true),
      pencil: make("fs_pencil", over, true),
      eraser: make("fs_eraser", erase, false),
    };
  }

  private composites(format: CanvasFormat): Composites {
    const module = this.device.createShaderModule({ code: compositeShader });
    const plain = this.device.createPipelineLayout({ bindGroupLayouts: [this.viewLayout] });
    const textured = this.device.createPipelineLayout({ bindGroupLayouts: [this.viewLayout, this.textureLayout] });
    const over = { srcFactor: "one", dstFactor: "one-minus-src-alpha" } as const;
    const make = (layout: GPUPipelineLayout, vertex: string, fragment: string) =>
      this.device.createRenderPipeline({
        layout,
        vertex: { module, entryPoint: vertex },
        fragment: { module, entryPoint: fragment, targets: [{ format, blend: { color: over, alpha: over } }] },
        primitive: { topology: "triangle-list" },
      });
    return {
      layer: make(textured, "vs_full", "fs_layer"),
      grid: make(plain, "vs_full", "fs_grid"),
      ring: make(plain, "vs_ring", "fs_ring"),
    };
  }
}
