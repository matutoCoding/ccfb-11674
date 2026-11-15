/** 地形 + 雪面 WGSL 着色器。手工双线性采样，避免依赖 float32-filterable 特性。 */
export const terrainShader = /* wgsl */ `
struct Uniforms {
  viewProj: mat4x4<f32>,
  sunDir: vec4<f32>,    // xyz 指向太阳
  sunColor: vec4<f32>,
  ambient: vec4<f32>,
  params: vec4<f32>,   // safeSlopeDeg, heightScale, cellSize, timeOfDay
  render: vec4<f32>,   // sss, sparkle, shadowBlue, dayFactor
  flags: vec4<f32>,    // showSlope, showTracks, unused, unused
  grid: vec4<f32>,     // size, maxDepth, unused, unused
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var heightTex: texture_2d<f32>;
@group(0) @binding(2) var depthTex: texture_2d<f32>;
@group(0) @binding(3) var trackTex: texture_2d<f32>;

struct VSOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) world: vec3<f32>,
};

fn loadH(ic: vec2<i32>) -> f32 {
  let n = i32(u.grid.x);
  let c = clamp(ic, vec2<i32>(0), vec2<i32>(n - 1));
  let h = textureLoad(heightTex, c, 0).x;
  let d = textureLoad(depthTex, c, 0).x;
  // 高度图归一化值 * heightScale = 米；积雪厚度（米）叠加进地形
  return h * u.params.y + d;
}

@vertex
fn vs(@builtin(vertex_index) vid: u32) -> VSOut {
  let n = i32(u.grid.x);
  let x = i32(vid) % n;
  let y = i32(vid) / n;
  let h = loadH(vec2<i32>(x, y));
  // 世界坐标：网格居中，x 向东、y 向北（翻转）、z 向上
  let wx = (f32(x) - f32(n) * 0.5) * u.params.z;
  let wy = -(f32(y) - f32(n) * 0.5) * u.params.z;
  var out: VSOut;
  out.uv = vec2<f32>(f32(x), f32(y)) / f32(n - 1);
  out.world = vec3<f32>(wx, wy, h);
  out.clip = u.viewProj * vec4<f32>(out.world, 1.0);
  return out;
}

fn hash21(p: vec2<f32>) -> f32 {
  var q = p;
  q = fract(q * vec2<f32>(123.34, 456.21));
  q = q + dot(q, q + 45.32);
  return fract(q.x * q.y);
}

fn trackAt(uv: vec2<f32>) -> f32 {
  let n = u.grid.x;
  let p = uv * n;
  let c = vec2<i32>(p);
  let f = fract(p);
  let t00 = textureLoad(trackTex, clamp(c, vec2<i32>(0), vec2<i32>(i32(n) - 1)), 0).x;
  let t10 = textureLoad(trackTex, clamp(c + vec2<i32>(1, 0), vec2<i32>(0), vec2<i32>(i32(n) - 1)), 0).x;
  let t01 = textureLoad(trackTex, clamp(c + vec2<i32>(0, 1), vec2<i32>(0), vec2<i32>(i32(n) - 1)), 0).x;
  let t11 = textureLoad(trackTex, clamp(c + vec2<i32>(1, 1), vec2<i32>(0), vec2<i32>(i32(n) - 1)), 0).x;
  return mix(mix(t00, t10, f.x), mix(t01, t11, f.x), f.y);
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  let n = i32(u.grid.x);
  let cell = u.params.z;
  let ic = vec2<i32>(in.uv * f32(n - 1));

  // 中心差分法线（世界空间）
  let hL = loadH(ic - vec2<i32>(1, 0));
  let hR = loadH(ic + vec2<i32>(1, 0));
  let hD = loadH(ic - vec2<i32>(0, 1));
  let hU = loadH(ic + vec2<i32>(0, 1));
  let gx = (hR - hL) / (2.0 * cell);
  let gy = (hU - hD) / (2.0 * cell);
  var N = normalize(vec3<f32>(-gx, gy, 1.0));

  // 车辙：胎纹高频法线扰动 + 压雪变暗
  let track = trackAt(in.uv) * u.flags.y;
  var treadDark = 0.0;
  if (track > 0.01) {
    let gridP = in.uv * u.grid.x;
    let stripe = sin(gridP.x * 3.14159 * 2.0 * 0.9) * sin(gridP.y * 3.14159 * 2.0 * 0.9);
    let jitter = (hash21(floor(gridP * 2.0)) - 0.5) * 0.35;
    N = normalize(N + vec3<f32>(stripe * 0.12 + jitter, stripe * 0.12, 0.0) * track);
    treadDark = track * 0.18;
  }

  let V = normalize(vec3<f32>(0.0, 0.0, 1.0) - in.world);
  let L = normalize(u.sunDir.xyz);
  let ndl = dot(N, L);

  // 1) 包裹漫反射：雪的次表面散射近似，背光面不会死黑
  let wrap = clamp((ndl + 0.35) / 1.35, 0.0, 1.0);
  // 2) 背向透射：视线与阳光同侧、法线背光时雪体透暖光
  let back = clamp(pow(max(0.0, dot(-N, L)) * max(0.0, dot(V, L)), 0.0), 0.0, 1.0) * u.render.x;
  // 3) 阴影偏蓝：低 NdotL 区域混合冷色环境光
  let shadowT = clamp(1.0 - ndl * 2.2, 0.0, 1.0) * u.render.z;

  let snowAlbedo = vec3<f32>(0.93, 0.95, 1.0) - treadDark;
  let lit = snowAlbedo * (u.sunColor.xyz * (wrap + back * vec3<f32>(1.0, 0.75, 0.6)));
  let shadowCol = vec3<f32>(0.45, 0.6, 0.95);
  var color = mix(lit, snowAlbedo * u.ambient.xyz, clamp(1.0 - u.render.w, 0.0, 1.0));
  color = mix(color, snowAlbedo * shadowCol * 0.55, shadowT * (0.4 + 0.6 * (1.0 - u.render.w)));

  // 4) 闪光颗粒：格点级确定性哈希 + 视线高光角，随时间相位变化
  let cellId = floor(in.uv * u.grid.x);
  let glitterSeed = hash21(cellId);
  let H = normalize(L + V);
  let spec = pow(max(0.0, dot(N, H)), 90.0);
  let phase = 0.5 + 0.5 * sin(u.params.w * 1.7 + glitterSeed * 6.2831);
  let glitter = step(0.985, glitterSeed) * spec * phase * u.render.y * 2.2;
  color = color + vec3<f32>(1.0, 0.98, 0.92) * glitter;

  // 5) 坡度超标红色叠加
  let slopeDeg = atan2(length(vec2<f32>(gx, gy)), 1.0) * 57.2958;
  if (u.flags.x > 0.5 && slopeDeg > u.params.x) {
    let danger = clamp((slopeDeg - u.params.x) / 12.0, 0.0, 1.0);
    color = mix(color, vec3<f32>(0.9, 0.12, 0.08), 0.35 + danger * 0.4);
  }

  // 距离雾，融入背景
  let dist = length(V - in.world) * 0.0; // 占位，下方用世界高度差近似
  let fog = clamp((length(in.world.xy) / (u.grid.x * u.params.z)) - 0.45, 0.0, 1.0) * 0.5;
  color = mix(color, u.ambient.xyz * 0.4, fog);

  // 手动 gamma（canvas 为 sRGB 编码输出）
  color = clamp(color, vec3<f32>(0.0), vec3<f32>(1.0));
  let gamma = 1.0 / 2.2;
  return vec4<f32>(pow(color, vec3<f32>(gamma)), 1.0);
}
`;

export const overlayShader = /* wgsl */ `
struct OverlayUniforms {
  viewProj: mat4x4<f32>,
};
@group(0) @binding(0) var<uniform> u: OverlayUniforms;

struct VSOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) color: vec4<f32>,
};

@vertex
fn vs(@location(0) pos: vec3<f32>, @location(1) color: vec4<f32>) -> VSOut {
  var out: VSOut;
  out.clip = u.viewProj * vec4<f32>(pos, 1.0);
  out.color = color;
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  return in.color;
}
`;
