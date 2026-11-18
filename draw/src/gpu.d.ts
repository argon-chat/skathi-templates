// The runtime's typings cover WebGPU only as far as a full-screen shader needs; Skathi implements
// the rest of the API, typed here as far as this app uses it.

type GPUBlendFactor = "zero" | "one" | "src-alpha" | "one-minus-src-alpha" | "dst" | "one-minus-dst-alpha";
type GPUCompare = "never" | "less" | "equal" | "less-equal" | "greater" | "not-equal" | "greater-equal" | "always";

interface GPUBlendComponent {
  srcFactor: GPUBlendFactor;
  dstFactor: GPUBlendFactor;
  operation?: "add" | "subtract" | "reverse-subtract" | "min" | "max";
}

interface GPUVertexBufferLayout {
  arrayStride: number;
  attributes: { format: string; offset: number; shaderLocation: number }[];
}

interface GPUFullPipelineDescriptor {
  layout: GPUPipelineLayout;
  vertex: { module: GPUShaderModule; entryPoint: string; buffers?: GPUVertexBufferLayout[] };
  fragment: {
    module: GPUShaderModule;
    entryPoint: string;
    targets: { format: string; blend?: { color: GPUBlendComponent; alpha: GPUBlendComponent } }[];
  };
  primitive?: { topology: "triangle-list" };
  depthStencil?: { format: string; depthWriteEnabled: boolean; depthCompare: GPUCompare };
  multisample?: { count: number };
}

interface GPUFullRenderPassDescriptor {
  colorAttachments: {
    view: GPUTextureView;
    resolveTarget?: GPUTextureView;
    clearValue?: { r: number; g: number; b: number; a: number };
    loadOp: "load" | "clear";
    storeOp: "store" | "discard";
  }[];
  depthStencilAttachment?: {
    view: GPUTextureView;
    depthClearValue: number;
    depthLoadOp: "load" | "clear";
    depthStoreOp: "store" | "discard";
  };
}

interface GPUBindGroupLayoutEntry {
  binding: number;
  visibility: number;
  buffer?: { type: "uniform" };
  texture?: { sampleType: "float" | "unfilterable-float" };
}

type GPUPipelineLayout = object;

interface GPUBuffer {
  readonly size: number;
  mapAsync(mode: number): Promise<void>;
  getMappedRange(): ArrayBuffer;
  unmap(): void;
}

interface GPUTexture {
  destroy(): void;
}

interface GPURenderPassEncoder {
  setVertexBuffer(slot: number, buffer: GPUBuffer): void;
}

interface GPUCommandEncoder {
  beginRenderPass(descriptor: GPUFullRenderPassDescriptor): GPURenderPassEncoder;
  copyBufferToBuffer(
    source: GPUBuffer,
    sourceOffset: number,
    target: GPUBuffer,
    targetOffset: number,
    size: number,
  ): void;
  copyTextureToBuffer(
    source: { texture: GPUTexture },
    target: { buffer: GPUBuffer; bytesPerRow: number; rowsPerImage: number },
    size: [number, number],
  ): void;
}

interface GPUDevice {
  readonly lost: Promise<{ reason: string; message: string }>;
  createRenderPipeline(descriptor: GPUFullPipelineDescriptor): GPURenderPipeline;
  createTexture(descriptor: {
    size: [number, number];
    format: string;
    usage: number;
    sampleCount?: number;
  }): GPUTexture;
  createBindGroupLayout(descriptor: { entries: GPUBindGroupLayoutEntry[] }): GPUBindGroupLayout;
  createPipelineLayout(descriptor: { bindGroupLayouts: GPUBindGroupLayout[] }): GPUPipelineLayout;
  createBindGroup(descriptor: {
    layout: GPUBindGroupLayout;
    entries: { binding: number; resource: { buffer: GPUBuffer } | GPUTextureView }[];
  }): GPUBindGroup;
}

declare var GPUTextureUsage: {
  readonly COPY_SRC: number;
  readonly COPY_DST: number;
  readonly TEXTURE_BINDING: number;
  readonly STORAGE_BINDING: number;
  readonly RENDER_ATTACHMENT: number;
};

declare var GPUShaderStage: { readonly VERTEX: number; readonly FRAGMENT: number; readonly COMPUTE: number };

declare var GPUMapMode: { readonly READ: number; readonly WRITE: number };

interface OffscreenCanvas {
  width: number;
  height: number;
  getContext(contextId: "2d"): CanvasRenderingContext2D | null;
  convertToBlob(options?: { type?: string; quality?: number }): Promise<Blob>;
}

declare var OffscreenCanvas: { new (width: number, height: number): OffscreenCanvas; prototype: OffscreenCanvas };
