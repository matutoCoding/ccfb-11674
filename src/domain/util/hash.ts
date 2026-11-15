/**
 * 数值数组校验和：FNV-1a 32 位，按小端字节遍历。
 * 用于积雪厚度“两次计算完全一致”的位级校验与导出报告。
 */
export function fnv1aBytes(bytes: ArrayLike<number>, offset = 0, length?: number): number {
  const len = length ?? bytes.length;
  let h = 0x811c9dc5;
  for (let i = 0; i < len; i++) {
    h ^= bytes[offset + i];
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function hashFloat32Array(a: Float32Array): number {
  // 直接遍历底层字节，确保 -0 / NaN 的位差异也能被发现
  return fnv1aBytes(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
}

export function hashUint8Array(a: Uint8Array): number {
  return fnv1aBytes(a);
}

export function toHex8(h: number): string {
  return h.toString(16).padStart(8, '0');
}

/** 统计信息（坡度/厚度报表用），全部为可序列化普通对象 */
export interface GridStats {
  min: number;
  max: number;
  mean: number;
  std: number;
  /** 分位数，键为百分位 0..100 */
  percentiles: Record<number, number>;
}

/**
 * 确定性分位数统计：直方图外不做采样，全量排序。
 * 1024² = 100 万个 number，排序约几十毫秒，可接受。
 */
export function computeStats(values: Float32Array, percentilePoints: number[] = [0, 25, 50, 75, 90, 95, 99, 100]): GridStats {
  const n = values.length;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  const mean = sum / n;
  let sq = 0;
  for (let i = 0; i < n; i++) {
    const d = values[i] - mean;
    sq += d * d;
  }
  const sorted = Array.from(values).sort((a, b) => a - b);
  const percentiles: Record<number, number> = {};
  for (const p of percentilePoints) {
    const idx = Math.min(n - 1, Math.max(0, Math.round((p / 100) * (n - 1))));
    percentiles[p] = sorted[idx];
  }
  return { min, max, mean, std: Math.sqrt(sq / n), percentiles };
}
