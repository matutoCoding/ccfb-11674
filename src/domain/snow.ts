import type { SnowGun, SnowmakingSettings } from './types';
import { hashFloat32Array } from './util/hash';

/**
 * 积雪厚度分布引擎（确定性、纯函数、无随机数）。
 *
 * 模型：每台造雪机喷出的雪在地面形成二维高斯堆积体，
 * 风使高斯中心沿风向漂移、顺风方向展宽。总雪量 = 出雪量 × 时长，
 * 通过对离散网格上的高斯权重归一化严格守恒（误差仅来自浮点舍入）。
 *
 * 可复现性保证：
 * 1. 喷枪按 id 字典序排序后处理，顺序与数组排列无关；
 * 2. 累加使用 Float64Array，行主序逐格写入，无并行、无 Map/Set 迭代；
 * 3. 不使用 Date/Math.random 或任何环境相关输入；
 * 4. 输出 Float32Array 的位级哈希应在任意机器、任意两次运行间一致。
 */

export interface SnowDepthInput {
  size: number;
  cellSize: number;
  guns: SnowGun[];
  settings: SnowmakingSettings;
}

export interface SnowDepthResult {
  /** 积雪厚度，米 */
  depth: Float32Array;
  /** 每台枪贡献的雪量（立方米），用于守恒核对 */
  perGunVolume: number[];
  /** 网格内实际沉积总量（立方米），理想情况等于总出雪量 */
  depositedVolume: number;
  /** 落在网格外的损失比例 0..1 */
  outOfBoundsRatio: number;
}

const DEG2RAD = Math.PI / 180;

/** 风向（吹向）角 -> 单位向量。0° 吹向 y 负方向（地图上方），顺时针。 */
function windVector(directionDeg: number): { wx: number; wy: number } {
  const a = directionDeg * DEG2RAD;
  return { wx: Math.sin(a), wy: -Math.cos(a) };
}

export function computeSnowDepth(input: SnowDepthInput): SnowDepthResult {
  const { size, cellSize, guns, settings } = input;
  // Float64 累加器：确定性的关键，避免 Float32 写序敏感
  const acc = new Float64Array(size * size);

  // 1) 固定处理顺序：按 id 排序（slice 避免修改入参）
  const ordered = guns.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const perGunVolume: number[] = [];
  let totalVolume = 0;

  const { wx, wy } = windVector(settings.wind.directionDeg);
  const drift = settings.wind.speed * settings.driftFactor * settings.durationHours;

  for (let g = 0; g < ordered.length; g++) {
    const gun = ordered[g];
    const volume = gun.output * settings.durationHours; // m³
    perGunVolume.push(volume);
    totalVolume += volume;
    if (volume <= 0 || gun.range <= 0) continue;

    // 2) 各向异性高斯参数（格点单位）
    const cx = gun.x + wx * drift;
    const cy = gun.y + wy * drift;
    // 张角 -> 横向基准 sigma：张角越大铺得越开
    const sigmaBase = Math.max(0.5, gun.range * 0.28 * (0.5 + gun.spreadDeg / 90));
    const sigmaAlong = sigmaBase * (1 + (settings.windStretch - 1) * Math.min(1, settings.wind.speed / 10));
    const sigmaAcross = sigmaBase;
    const cosA = wx;
    const sinA = wy;
    const inv2Along = 1 / (2 * sigmaAlong * sigmaAlong);
    const inv2Across = 1 / (2 * sigmaAcross * sigmaAcross);
    // 包围盒按最大 sigma 的 3.5 倍截断（高斯尾部 < 0.05%）
    const reach = gun.range + drift + 3.5 * sigmaAlong;

    const x0 = Math.max(0, Math.floor(cx - reach));
    const x1 = Math.min(size - 1, Math.ceil(cx + reach));
    const y0 = Math.max(0, Math.floor(cy - reach));
    const y1 = Math.min(size - 1, Math.ceil(cy + reach));

    // 3) 先在包围盒内算权重并求和，再归一化 -> 严格雪量守恒
    const boxW = x1 - x0 + 1;
    const boxH = y1 - y0 + 1;
    if (boxW <= 0 || boxH <= 0) continue;
    const weights = new Float64Array(boxW * boxH);
    let weightSum = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        const dy = y - cy;
        // 旋转到顺风/横风局部坐标
        const along = dx * cosA + dy * sinA;
        const across = -dx * sinA + dy * cosA;
        // 超出喷枪原始射程+漂移过多的格点直接截断
        if (Math.hypot(dx, dy) > reach) continue;
        const w = Math.exp(-(along * along * inv2Along + across * across * inv2Across));
        weights[(y - y0) * boxW + (x - x0)] = w;
        weightSum += w;
      }
    }
    if (weightSum === 0) continue;

    // 4) 行主序写回累加器（厚度 = 体积 / 格点面积）
    const cellArea = cellSize * cellSize;
    const scale = volume / (weightSum * cellArea);
    for (let y = y0; y <= y1; y++) {
      const rowBase = y * size;
      const boxRow = (y - y0) * boxW;
      for (let x = x0; x <= x1; x++) {
        const w = weights[boxRow + (x - x0)];
        if (w !== 0) acc[rowBase + x] += w * scale;
      }
    }
  }

  // 5) 统计沉积量与出界损失
  let deposited = 0;
  const cellArea = cellSize * cellSize;
  const depth = new Float32Array(size * size);
  for (let i = 0; i < acc.length; i++) {
    const v = acc[i];
    depth[i] = v;
    deposited += v * cellArea;
  }

  return {
    depth,
    perGunVolume,
    depositedVolume: deposited,
    outOfBoundsRatio: totalVolume > 0 ? Math.max(0, 1 - deposited / totalVolume) : 0,
  };
}

/**
 * 复现性自检：连续计算两次并比较位级哈希。
 * UI 与自动化测试都调用它，任何非确定性都会被立刻暴露。
 */
export function reproducibilityCheck(input: SnowDepthInput): {
  ok: boolean;
  hashA: number;
  hashB: number;
  result: SnowDepthResult;
} {
  const a = computeSnowDepth(input);
  const b = computeSnowDepth(input);
  const hashA = hashFloat32Array(a.depth);
  const hashB = hashFloat32Array(b.depth);
  return { ok: hashA === hashB, hashA, hashB, result: a };
}
