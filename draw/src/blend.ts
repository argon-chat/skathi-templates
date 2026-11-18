export const blendShader = /* wgsl */ `
@group(0) @binding(0) var src:texture_2d<f32>;
@group(0) @binding(1) var dst:texture_2d<f32>;
@group(0) @binding(2) var mask:texture_2d<f32>;
@group(0) @binding(3) var<uniform> params:vec4f;

@vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f {
  return vec4f(vec2f(f32((i<<1u)&2u),f32(i&2u))*2.0-1.0,0,1);
}
fn lum(c:vec3f)->f32 {return dot(c,vec3f(0.3,0.59,0.11));}
fn sat(c:vec3f)->f32 {return max(c.r,max(c.g,c.b))-min(c.r,min(c.g,c.b));}
fn set_lum(c:vec3f,l:f32)->vec3f {
  var v=c+vec3f(l-lum(c));
  let n=min(v.r,min(v.g,v.b)); let x=max(v.r,max(v.g,v.b));
  if(n<0.0){v=vec3f(l)+(v-vec3f(l))*l/max(l-n,0.00001);}
  if(x>1.0){v=vec3f(l)+(v-vec3f(l))*(1.0-l)/max(x-l,0.00001);}
  return v;
}
fn set_sat(c:vec3f,s:f32)->vec3f {return (c-vec3f(min(c.r,min(c.g,c.b))))*(s/max(sat(c),0.00001));}
fn blend(b:vec3f,s:vec3f,mode:u32)->vec3f {
  let one=vec3f(1.0);
  switch(mode){
    case 1u:{return b*s;}
    case 2u:{return one-(one-b)*(one-s);}
    case 3u:{return select(2.0*b*s,one-2.0*(one-b)*(one-s),b>vec3f(0.5));}
    case 4u:{return min(b,s);}
    case 5u:{return max(b,s);}
    case 6u:{return min(one,b+s);}
    case 7u:{return select(min(one,b/max(one-s,vec3f(0.00001))),vec3f(0.0),b==vec3f(0.0));}
    case 8u:{return select(one-min(one,(one-b)/max(s,vec3f(0.00001))),one,b==one);}
    case 9u:{
      let d=select(((16.0*b-12.0)*b+4.0)*b,sqrt(b),b>vec3f(0.25));
      return select(b-(one-2.0*s)*b*(one-b),b+(2.0*s-one)*(d-b),s>vec3f(0.5));
    }
    case 10u:{return abs(b-s);}
    case 11u:{return set_lum(set_sat(s,sat(b)),lum(b));}
    case 12u:{return set_lum(set_sat(b,sat(s)),lum(b));}
    case 13u:{return set_lum(s,lum(b));}
    case 14u:{return set_lum(b,lum(s));}
    default:{return s;}
  }
}
struct Result {@location(0) color:vec4f,@location(1) alpha:vec4f}
@fragment fn fs(@builtin(position) pos:vec4f)->Result {
  let xy=vec2i(pos.xy);
  let source=textureLoad(src,xy,0)*params.x*select(1.0,textureLoad(mask,xy,0).r,params.z>0.5);
  let base=textureLoad(dst,xy,0);
  let ca=source.a;let ba=base.a;
  let b=clamp(base.rgb/max(ba,0.00001),vec3f(0),vec3f(1));
  let s=clamp(source.rgb/max(ca,0.00001),vec3f(0),vec3f(1));
  let rgb=base.rgb*(1.0-ca)+source.rgb*(1.0-ba)+blend(b,s,u32(params.y))*ca*ba;
  return Result(vec4f(rgb,ca+ba*(1.0-ca)),vec4f(ca));
}
`;

export class BlendPass {
  private layout: GPUBindGroupLayout;
  private pipeline: GPURenderPipeline;
  readonly colors: GPUTexture[];
  readonly masks: GPUTexture[];
  readonly blank: GPUTexture;
  private index = 0;

  constructor(
    private device: GPUDevice,
    width: number,
    height: number,
  ) {
    const entries: GPUBindGroupLayoutEntry[] = [0, 1, 2].map((binding) => ({
      binding,
      visibility: GPUShaderStage.FRAGMENT,
      texture: {},
    }));
    entries.push({ binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } });
    this.layout = device.createBindGroupLayout({ entries });
    const module = device.createShaderModule({ code: blendShader });
    this.pipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.layout] }),
      vertex: { module, entryPoint: "vs" },
      fragment: { module, entryPoint: "fs", targets: [{ format: "rgba8unorm" }, { format: "r8unorm" }] },
      primitive: { topology: "triangle-list" },
    });
    const target = (format: GPUTextureFormat, w = width, h = height) =>
      device.createTexture({
        size: [w, h],
        format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
    this.colors = [target("rgba8unorm"), target("rgba8unorm")];
    this.masks = [target("r8unorm"), target("r8unorm")];
    this.blank = target("rgba8unorm", 1, 1);
  }

  begin(encoder: GPUCommandEncoder) {
    this.index = 0;
    encoder
      .beginRenderPass({
        colorAttachments: [
          {
            view: this.masks[0]!.createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: "clear",
            storeOp: "store",
          },
        ],
      })
      .end();
    return this.colors[0]!.createView();
  }

  layer(encoder: GPUCommandEncoder, src: GPUTextureView | null, params: GPUBuffer) {
    const a = this.index,
      b = 1 - a;
    const group = this.device.createBindGroup({
      layout: this.layout,
      entries: [
        { binding: 0, resource: src ?? this.blank.createView() },
        { binding: 1, resource: this.colors[a]!.createView() },
        { binding: 2, resource: this.masks[a]!.createView() },
        { binding: 3, resource: { buffer: params } },
      ],
    });
    const views = [this.colors[b]!, this.masks[b]!];
    const pass = encoder.beginRenderPass({
      colorAttachments: views.map((t) => ({
        view: t.createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: "clear" as const,
        storeOp: "store" as const,
      })),
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, group);
    pass.draw(3);
    pass.end();
    this.index = b;
  }

  get view() {
    return this.colors[this.index]!.createView();
  }
  destroy() {
    for (const texture of [...this.colors, ...this.masks, this.blank]) texture.destroy();
  }
}
