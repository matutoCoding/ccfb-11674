import { DeterministicRng } from './util/rng';

/**
 * 高度图地形编辑。
 * 设计要点：
 * - 数据为行主序 Float32Array，索引 idx = y * size + x
 * - 所有刷子只访问半径包围盒内像素，1024² 下半径 30 的刷子每次仅 ~2800 次运算
 * - 累加顺序固定（行主序、从包围盒左上角开始），同输入同结果
 */

export type BrushMode = 'raise' | 'lower' | 'smooth' | 'flatten';

export interface BrushParams {
  /** 笔刷中心，网格坐标（浮点） */
  cx: number;
  cy: number;
  /** 半径，格点单位 */
  radius: number;
  /** 强度 0..1 */
  strength: number;
  mode: BrushMode;
  /** flatten 模式的目标高度（通常在按下时抓取一次） */
  flattenTarget?: number;
}

/** 平滑模式的邻域混合权重（固定值，不做随机） */
const SMOOTH_LATTICE = [
  [0, 0, 4],
  [-1, 0, 1],
  [1, 0, 1],
  [0, -1, 1],
  [0, 1, 1],
] as const;

/**
 * 在高度图上盖一个笔刷印。原地修改 map。
 * 平滑采用“就地”更新，处理顺序固定，因此仍然是确定性的。
 */
export function applyBrush(map: Float32Array, size: number, p: BrushParams): void {
  const r = Math.max(0.5, p.radius);
  const x0 = Math.max(0, Math.floor(p.cx - r));
  const x1 = Math.min(size - 1, Math.ceil(p.cx + r));
  const y0 = Math.max(0, Math.floor(p.cy - r));
  const y1 = Math.min(size - 1, Math.ceil(p.cy + r));
  const r2 = r * r;
  const k = Math.max(0, Math.min(1, p.strength));

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - p.cx;
      const dy = y - p.cy;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      // 余弦衰减，边缘为 0、中心为 1
      const falloff = 0.5 * (1 + Math.cos(Math.PI * Math.sqrt(d2) / r));
      const idx = y * size + x;

      switch (p.mode) {
        case 'raise':
          map[idx] += k * falloff * 0.02;
          break;
        case 'lower':
          map[idx] -= k * falloff * 0.02;
          break;
        case 'flatten': {
          const target = p.flattenTarget ?? map[idx];
          map[idx] += (target - map[idx]) * k * falloff;
          break;
        }
        case 'smooth': {
          let num = 0;
          let den = 0;
          for (const [ox, oy, w] of SMOOTH_LATTICE) {
            const nx = x + ox;
            const ny = y + oy;
            if (nx < 0 || nx >= size || ny < 0 || ny >= size) continue;
            num += map[ny * size + nx] * w;
            den += w;
          }
          const avg = num / den;
          map[idx] += (avg - map[idx]) * k * falloff;
          break;
        }
      }
    }
  }
}

/** 沿线段按 spacing 间隔线性插值盖印，保证快速拖拽不留空洞 */
export function stampLine(
  map: Float32Array,
  size: number,
  from: { x: number; y: number },
  to: { x: number; y: number },
  brush: Omit<BrushParams, 'cx' | 'cy'>,
): void {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  const spacing = Math.max(0.25, brush.radius * 0.35);
  const steps = Math.max(1, Math.ceil(dist / spacing));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    applyBrush(map, size, {
      ...brush,
      cx: from.x + dx * t,
      cy: from.y + dy * t,
    });
  }
}

/**
 * 确定性程序化地形：value-noise fBm + 可选山脊。
 * 同一 (size, seed, params) 产生完全相同的高度图。
 */
export interface ProceduralParams {
  seed: number;
  /** 基础频率（网格上的周期数） */
  baseFrequency: number;
  octaves: number;
  lacunarity: number;
  gain: number;
  /** 输出高度范围约 [-amplitude, amplitude] */
  amplitude: number;
}

export const DEFAULT_PROCEDURAL: ProceduralParams = {
  seed: 20261116,
  baseFrequency: 3,
  octaves: 5,
  lacunarity: 2.0,
  gain: 0.5,
  amplitude: 0.5,
};

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** 2D value noise，格点哈希来自确定性 RNG 之外的整数哈希，保证无状态 */
function hashGrid(ix: number, iy: number, seed: number): number {
  let h = seed ^ Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1);
  h = Math.imul(h ^ (h >>> 13), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 16), 0xc2b2ae35);
  return (h >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smoothstep(x - ix);
  const fy = smoothstep(y - iy);
  const v00 = hashGrid(ix, iy, seed);
  const v10 = hashGrid(ix + 1, iy, seed);
  const v01 = hashGrid(ix, iy + 1, seed);
  const v11 = hashGrid(ix + 1, iy + 1, seed);
  const a = v00 + (v10 - v00) * fx;
  const b = v01 + (v11 - v01) * fx;
  return a + (b - a) * fy; // 0..1
}

export function generateProcedural(size: number, params: ProceduralParams = DEFAULT_PROCEDURAL): Float32Array {
  const map = new Float32Array(size * size);
  const rng = new DeterministicRng(params.seed);
  // 每八度独立种子，仍由主种子确定性派生
  const octaveSeeds: number[] = [];
  for (let o = 0; o < params.octaves; o++) {
    rng.next();
    octaveSeeds.push((params.seed + o * 0x9e3779b9) >>> 0);
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      let sum = 0;
      let amp = 1;
      let freq = params.baseFrequency;
      let norm = 0;
      for (let o = 0; o < params.octaves; o++) {
        const n = valueNoise(u * freq, v * freq, octaveSeeds[o]) * 2 - 1;
        sum += n * amp;
        norm += amp;
        amp *= params.gain;
        freq *= params.lacunarity;
      }
      // 叠加一条对角缓坡，模拟雪场依山而建
      const ridge = (u + v) * 0.5 - 0.5;
      map[y * size + x] = (sum / norm) * params.amplitude + ridge * params.amplitude * 0.6;
    }
  }
  return map;
}

/** 双线性采样高度图（坐标越界钳制） */
export function sampleHeight(map: Float32Array, size: number, x: number, y: number): number {
  const cx = Math.max(0, Math.min(size - 1.001, x));
  const cy = Math.max(0, Math.min(size - 1.001, y));
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const fx = cx - x0;
  const fy = cy - y0;
  const h00 = map[y0 * size + x0];
  const h10 = map[y0 * size + x0 + 1];
  const h01 = map[(y0 + 1) * size + x0];
  const h11 = map[(y0 + 1) * size + x0 + 1];
  const a = h00 + (h10 - h00) * fx;
  const b = h01 + (h11 - h01) * fx;
  return a + (b - a) * fy;
}
