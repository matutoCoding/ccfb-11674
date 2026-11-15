/**
 * 坡度分析：中心差分求梯度，输出角度（度）。
 * 边缘使用单侧差分。固定遍历顺序，结果可复现。
 */
export function computeSlopeDegrees(
  heightmap: Float32Array,
  size: number,
  cellSize: number,
  heightScale: number,
): Float32Array {
  const slopes = new Float32Array(size * size);
  const s = cellSize > 0 ? cellSize : 1;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const xl = x > 0 ? x - 1 : x;
      const xr = x < size - 1 ? x + 1 : x;
      const yt = y > 0 ? y - 1 : y;
      const yb = y < size - 1 ? y + 1 : y;
      const dxCells = x > 0 && x < size - 1 ? 2 : 1;
      const dyCells = y > 0 && y < size - 1 ? 2 : 1;

      const dhx = (heightmap[y * size + xr] - heightmap[y * size + xl]) * heightScale;
      const dhy = (heightmap[yb * size + x] - heightmap[yt * size + x]) * heightScale;
      const gx = dhx / (dxCells * s);
      const gy = dhy / (dyCells * s);
      slopes[y * size + x] = (Math.atan(Math.hypot(gx, gy)) * 180) / Math.PI;
    }
  }
  return slopes;
}

export interface SlopeReport {
  /** 各坡度区间占比（百分比），区间边界单位为度 */
  bands: { label: string; min: number; max: number; ratio: number; count: number }[];
  overSafeRatio: number;
  mean: number;
  max: number;
}

/** 坡度分区统计：常规雪道分级 + 安全坡度超标占比 */
export function slopeReport(slopes: Float32Array, safeSlopeDeg: number): SlopeReport {
  const bounds = [0, 6, 12, 18, 25, 30, 40, 90];
  const labels = ['0–6° 初级平台', '6–12° 初级道', '12–18° 中级道', '18–25° 中高级', '25–30° 高级道', '30–40° 专家道', '>40° 危险区'];
  const counts = new Array(bounds.length - 1).fill(0);
  let overSafe = 0;
  let sum = 0;
  let max = 0;

  for (let i = 0; i < slopes.length; i++) {
    const v = slopes[i];
    sum += v;
    if (v > max) max = v;
    if (v > safeSlopeDeg) overSafe++;
    for (let b = 0; b < counts.length; b++) {
      if (v >= bounds[b] && v < bounds[b + 1]) {
        counts[b]++;
        break;
      }
    }
  }

  const n = slopes.length;
  return {
    bands: counts.map((count, i) => ({
      label: labels[i],
      min: bounds[i],
      max: bounds[i + 1],
      count,
      ratio: (count / n) * 100,
    })),
    overSafeRatio: (overSafe / n) * 100,
    mean: sum / n,
    max,
  };
}
