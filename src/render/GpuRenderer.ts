import type { GroomerRoute, RenderSettings, SnowGun } from '../domain/types';
import { sunAtTime } from '../domain/sun';
import { sampleHeight } from '../domain/terrain';
import { mat4LookAt, mat4Multiply, mat4Perspective } from './mat4';
import { overlayShader, terrainShader } from './shaders';

/**
 * WebGPU 地形渲染器。
 * 三张 R32Float 纹理（高度/积雪/车辙）+ 程序化网格顶点（vertex_index 展开）。
 * 所有仿真数据均由 CPU 确定性模块产出，渲染器只负责可视化。
 */

/** mat4(4 个 vec4) + 7 个 vec4 = 11 个 vec4，共 176 字节 */
const UNIFORM_FLOATS = 11 * 4;

export interface RenderFrameData {
  heightmap: Float32Array;
  depth: Float32Array;
  tracks: Float32Array;
  guns: SnowGun[];
  routes: GroomerRoute[];
  settings: RenderSettings;
  cellSize: number;
  heightScale: number;
}

export class GpuRenderer {
  private device: GPUDevice;
  private context: GPUCanvasContext;
  private format: GPUTextureFormat;
  private size: number;
  private pipeline!: GPURenderPipeline;
  private overlayPipeline!: GPURenderPipeline;
  private uniformBuffer!: GPUBuffer;
  private heightTex!: GPUTexture;
  private depthTex!: GPUTexture;
  private trackTex!: GPUTexture;
  private bindGroup!: GPUBindGroup;
  private indexBuffer!: GPUBuffer;
  private indexCount = 0;
  private overlayUniformBuffer!: GPUBuffer;
  private overlayBindGroup!: GPUBindGroup;
  private overlayBuffer: GPUBuffer | null = null;
  private overlayVertexCount = 0;

  private constructor(device: GPUDevice, context: GPUCanvasContext, format: GPUTextureFormat, size: number) {
    this.device = device;
    this.context = context;
    this.format = format;
    this.size = size;
    this.init();
  }

  static async create(canvas: HTMLCanvasElement, size: number): Promise<GpuRenderer> {
    if (!('gpu' in navigator)) throw new Error('当前浏览器不支持 WebGPU，请使用 Chrome/Edge 113+');
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('未找到可用的 GPU 适配器');
    const device = await adapter.requestDevice();
    device.lost.then((info) => console.error('WebGPU device lost:', info.message));
    const context = canvas.getContext('webgpu');
    if (!context) throw new Error('无法获取 WebGPU 上下文');
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'opaque' });
    return new GpuRenderer(device, context, format, size);
  }

  private makeTexture(): GPUTexture {
    return this.device.createTexture({
      size: [this.size, this.size],
      format: 'r32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
  }

  private init(): void {
    const module = this.device.createShaderModule({ code: terrainShader });
    this.pipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
    });

    const overlayModule = this.device.createShaderModule({ code: overlayShader });
    this.overlayPipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: overlayModule,
        entryPoint: 'vs',
        buffers: [
          {
            arrayStride: 7 * 4,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },
              { shaderLocation: 1, offset: 3 * 4, format: 'float32x4' },
            ],
          },
        ],
      },
      fragment: { module: overlayModule, entryPoint: 'fs', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
    });

    this.uniformBuffer = this.device.createBuffer({
      size: UNIFORM_FLOATS * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.heightTex = this.makeTexture();
    this.depthTex = this.makeTexture();
    this.trackTex = this.makeTexture();
    this.bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: this.heightTex.createView() },
        { binding: 2, resource: this.depthTex.createView() },
        { binding: 3, resource: this.trackTex.createView() },
      ],
    });

    this.overlayUniformBuffer = this.device.createBuffer({
      size: 16 * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.overlayBindGroup = this.device.createBindGroup({
      layout: this.overlayPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.overlayUniformBuffer } }],
    });

    // 网格索引：(n-1)² 个四边形，每四边形 6 个索引
    const n = this.size;
    const indices = new Uint32Array((n - 1) * (n - 1) * 6);
    let k = 0;
    for (let y = 0; y < n - 1; y++) {
      for (let x = 0; x < n - 1; x++) {
        const a = y * n + x;
        const b = a + 1;
        const c = a + n;
        const d = c + 1;
        indices[k++] = a;
        indices[k++] = c;
        indices[k++] = b;
        indices[k++] = b;
        indices[k++] = c;
        indices[k++] = d;
      }
    }
    this.indexCount = indices.length;
    this.indexBuffer = this.device.createBuffer({
      size: indices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.indexBuffer, 0, indices);
  }

  private writeTexture(tex: GPUTexture, data: Float32Array): void {
    this.device.queue.writeTexture(
      { texture: tex },
      data,
      { bytesPerRow: this.size * 4, rowsPerImage: this.size },
      [this.size, this.size],
    );
  }

  updateHeightmap(data: Float32Array): void {
    this.writeTexture(this.heightTex, data);
  }

  updateDepth(data: Float32Array): void {
    this.writeTexture(this.depthTex, data);
  }

  updateTracks(data: Float32Array): void {
    this.writeTexture(this.trackTex, data);
  }

  /** 相机参数 -> 视图投影矩阵 */
  private buildViewProj(s: RenderSettings, aspect: number): Float32Array {
    const n = this.size;
    const az = (s.cameraAzimuth * Math.PI) / 180;
    const el = (s.cameraElevation * Math.PI) / 180;
    const dist = n * s.cameraDistance;
    const target: [number, number, number] = [0, 0, 0];
    const eye: [number, number, number] = [
      dist * Math.cos(el) * Math.sin(az),
      dist * Math.cos(el) * Math.cos(az),
      dist * Math.sin(el),
    ];
    const proj = mat4Perspective((50 * Math.PI) / 180, aspect, 1, n * 10);
    const view = mat4LookAt(eye, target, [0, 0, 1]);
    return mat4Multiply(proj, view);
  }

  /** 叠加层几何：造雪机红色菱形柱 + 路线黄色飘带（贴地抬高 1.5m） */
  private buildOverlayVertices(data: RenderFrameData): { verts: Float32Array; count: number } {
    const n = this.size;
    const verts: number[] = [];
    const groundZ = (gx: number, gy: number): number => {
      const h = sampleHeight(data.heightmap, n, gx, gy) * data.heightScale;
      const d = sampleHeight(data.depth, n, gx, gy);
      return h + d + 1.5;
    };
    const toWorld = (gx: number, gy: number): [number, number] => [
      (gx - n * 0.5) * data.cellSize,
      -(gy - n * 0.5) * data.cellSize,
    ];
    const pushTri = (
      a: [number, number, number],
      b: [number, number, number],
      c: [number, number, number],
      color: [number, number, number, number],
    ): void => {
      verts.push(...a, ...color, ...b, ...color, ...c, ...color);
    };

    if (data.settings.showGuns) {
      const r = n * 0.006;
      const h = n * 0.02;
      for (const gun of data.guns) {
        const [wx, wy] = toWorld(gun.x, gun.y);
        const z0 = groundZ(gun.x, gun.y);
        const col: [number, number, number, number] = [1.0, 0.25, 0.32, 1.0];
        // 四个侧面（菱形截面）
        const ring: [number, number][] = [
          [wx + r, wy],
          [wx, wy + r],
          [wx - r, wy],
          [wx, wy - r],
        ];
        for (let i = 0; i < 4; i++) {
          const p1 = ring[i];
          const p2 = ring[(i + 1) % 4];
          pushTri([p1[0], p1[1], z0], [p2[0], p2[1], z0], [wx, wy, z0 + h], col);
        }
      }
    }

    if (data.settings.showRoutes) {
      const halfW = Math.max(0.8, 1.2);
      const col: [number, number, number, number] = [1.0, 0.68, 0.15, 0.92];
      for (const route of data.routes) {
        const pts = route.points;
        const w = Math.max(halfW, route.width * 0.5);
        for (let i = 0; i < pts.length - 1; i++) {
          const p0 = pts[i];
          const p1 = pts[i + 1];
          const dx = p1.x - p0.x;
          const dy = p1.y - p0.y;
          const len = Math.hypot(dx, dy) || 1;
          const nx = (-dy / len) * w;
          const ny = (dx / len) * w;
          const a = toWorld(p0.x + nx, p0.y + ny);
          const b = toWorld(p0.x - nx, p0.y - ny);
          const c = toWorld(p1.x + nx, p1.y + ny);
          const d = toWorld(p1.x - nx, p1.y - ny);
          pushTri(
            [a[0], a[1], groundZ(p0.x + nx, p0.y + ny)],
            [b[0], b[1], groundZ(p0.x - nx, p0.y - ny)],
            [c[0], c[1], groundZ(p1.x + nx, p1.y + ny)],
            col,
          );
          pushTri(
            [b[0], b[1], groundZ(p0.x - nx, p0.y - ny)],
            [d[0], d[1], groundZ(p1.x - nx, p1.y - ny)],
            [c[0], c[1], groundZ(p1.x + nx, p1.y + ny)],
            col,
          );
        }
      }
    }

    return { verts: new Float32Array(verts), count: verts.length / 7 };
  }

  render(data: RenderFrameData): void {
    this.writeTexture(this.heightTex, data.heightmap);
    this.writeTexture(this.depthTex, data.depth);
    this.writeTexture(this.trackTex, data.tracks);

    const canvas = this.context.canvas as HTMLCanvasElement;
    const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
    const viewProj = this.buildViewProj(data.settings, aspect);
    const sun = sunAtTime(data.settings.timeOfDay);

    const uniforms = new Float32Array(UNIFORM_FLOATS);
    uniforms.set(viewProj, 0); // mat4 占 16 个 float
    uniforms.set([...sun.direction, 0], 16);
    uniforms.set([...sun.sunColor, 0], 20);
    uniforms.set([...sun.ambientColor, 0], 24);
    let maxDepth = 0;
    for (let i = 0; i < data.depth.length; i += 257) maxDepth = Math.max(maxDepth, data.depth[i]);
    uniforms.set(
      [data.settings.safeSlopeDeg, data.heightScale, data.cellSize, data.settings.timeOfDay],
      28,
    );
    uniforms.set(
      [
        data.settings.sssStrength,
        data.settings.sparkleStrength,
        data.settings.shadowBlue,
        sun.dayFactor,
      ],
      32,
    );
    uniforms.set(
      [data.settings.showSlopeOverlay ? 1 : 0, data.settings.showTracks ? 1 : 0, 0, 0],
      36,
    );
    uniforms.set([this.size, maxDepth || 1, 0, 0], 40);
    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniforms);
    this.device.queue.writeBuffer(this.overlayUniformBuffer, 0, viewProj);

    const { verts, count } = this.buildOverlayVertices(data);
    if (count > 0) {
      if (!this.overlayBuffer || this.overlayBuffer.size < verts.byteLength) {
        this.overlayBuffer?.destroy();
        this.overlayBuffer = this.device.createBuffer({
          size: Math.max(verts.byteLength, 256),
          usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
      }
      this.device.queue.writeBuffer(this.overlayBuffer, 0, verts);
      this.overlayVertexCount = count;
    } else {
      this.overlayVertexCount = 0;
    }

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: { r: 0.05, g: 0.08, b: 0.13, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.setIndexBuffer(this.indexBuffer, 'uint32');
    pass.drawIndexed(this.indexCount);

    if (this.overlayVertexCount > 0 && this.overlayBuffer) {
      pass.setPipeline(this.overlayPipeline);
      pass.setBindGroup(0, this.overlayBindGroup);
      pass.setVertexBuffer(0, this.overlayBuffer);
      pass.draw(this.overlayVertexCount);
    }
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  destroy(): void {
    this.indexBuffer.destroy();
    this.uniformBuffer.destroy();
    this.overlayUniformBuffer.destroy();
    this.overlayBuffer?.destroy();
    this.heightTex.destroy();
    this.depthTex.destroy();
    this.trackTex.destroy();
  }
}
