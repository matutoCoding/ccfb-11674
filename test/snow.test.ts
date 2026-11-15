import { describe, expect, it } from 'vitest';
import { computeSnowDepth, reproducibilityCheck } from '../src/domain/snow';
import { hashFloat32Array } from '../src/domain/util/hash';
import type { SnowGun, SnowmakingSettings } from '../src/domain/types';
import { DEFAULT_SNOW_SETTINGS } from '../src/domain/types';

function makeGun(id: string, x: number, y: number, output = 40): SnowGun {
  return { id, x, y, output, spreadDeg: 60, range: 80 };
}

const settings: SnowmakingSettings = structuredClone(DEFAULT_SNOW_SETTINGS);
settings.durationHours = 8;
settings.wind = { directionDeg: 45, speed: 4 };

describe('积雪厚度确定性引擎', () => {
  it('同输入两次计算返回位级完全一致的 Float32Array', () => {
    const input = {
      size: 256,
      cellSize: 2,
      guns: [makeGun('g2', 128, 128), makeGun('g1', 60, 70), makeGun('g3', 200, 30)],
      settings,
    };
    const check = reproducibilityCheck(input);
    expect(check.ok).toBe(true);
    expect(check.hashA).toBe(check.hashB);
    expect(check.hashA).toBe(hashFloat32Array(check.result.depth));
  });

  it('喷枪数组顺序不影响结果（按 id 固定累加顺序）', () => {
    const guns = [makeGun('g2', 128, 128), makeGun('g1', 60, 70), makeGun('g3', 200, 30)];
    const a = computeSnowDepth({ size: 256, cellSize: 2, guns, settings });
    const b = computeSnowDepth({ size: 256, cellSize: 2, guns: [...guns].reverse(), settings });
    expect(hashFloat32Array(a.depth)).toBe(hashFloat32Array(b.depth));
  });

  it('跨独立调用、打散中间运算后结果仍一致', () => {
    const guns = [makeGun('g1', 100, 100)];
    const first = computeSnowDepth({ size: 200, cellSize: 2, guns, settings });
    // 制造一些无关的浮点堆活动
    let noise = 0;
    for (let i = 0; i < 100000; i++) noise += Math.sqrt(i) * 1.1;
    const second = computeSnowDepth({ size: 200, cellSize: 2, guns, settings });
    expect(noise).toBeGreaterThan(0);
    expect(hashFloat32Array(first.depth)).toBe(hashFloat32Array(second.depth));
  });

  it('雪量守恒：网格内沉积体积 ≈ 总出雪体积（内部枪应无出界）', () => {
    const guns = [makeGun('g1', 128, 128, 50), makeGun('g2', 130, 132, 30)];
    const r = computeSnowDepth({ size: 256, cellSize: 2, guns, settings });
    const expected = guns.reduce((s, g) => s + g.output * settings.durationHours, 0);
    // 高斯包围盒截断会损失极小尾部，容差 2%
    expect(r.depositedVolume).toBeGreaterThan(expected * 0.98);
    expect(r.depositedVolume).toBeLessThanOrEqual(expected * 1.001);
    expect(r.outOfBoundsRatio).toBeLessThan(0.02);
  });

  it('无风时沉积中心位于枪位，顺风时中心沿风向漂移', () => {
    const gun = makeGun('g1', 128, 128);
    const calm = computeSnowDepth({
      size: 256,
      cellSize: 2,
      guns: [gun],
      settings: { ...settings, wind: { directionDeg: 90, speed: 0 } },
    });
    const windy = computeSnowDepth({
      size: 256,
      cellSize: 2,
      guns: [gun],
      settings: { ...settings, wind: { directionDeg: 90, speed: 8 } },
    });
    function centroid(d: Float32Array, n: number): { x: number; y: number } {
      let sx = 0;
      let sy = 0;
      let sw = 0;
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const v = d[y * n + x];
          sx += x * v;
          sy += y * v;
          sw += v;
        }
      return { x: sx / sw, y: sy / sw };
    }
    const c0 = centroid(calm.depth, 256);
    const c1 = centroid(windy.depth, 256);
    expect(Math.hypot(c0.x - 128, c0.y - 128)).toBeLessThan(2);
    // 90° 风吹向 +x，质心应明显向东偏移，y 基本不动
    expect(c1.x - c0.x).toBeGreaterThan(10);
    expect(Math.abs(c1.y - c0.y)).toBeLessThan(5);
  });

  it('无造雪机时输出全零且仍可复现', () => {
    const r = computeSnowDepth({ size: 64, cellSize: 2, guns: [], settings });
    expect(r.depositedVolume).toBe(0);
    for (const v of r.depth) expect(v).toBe(0);
  });

  it('1024 网格全量计算在合理时间内完成（性能基线）', () => {
    const guns = Array.from({ length: 12 }, (_, i) =>
      makeGun(`gun-${i}`, 100 + i * 70, 200 + (i % 3) * 220, 45),
    );
    const t0 = performance.now();
    const r = computeSnowDepth({ size: 1024, cellSize: 2, guns, settings });
    const elapsed = performance.now() - t0;
    expect(r.depth.length).toBe(1024 * 1024);
    // CI 宽松上限 3 秒，本机通常 100~500ms
    expect(elapsed).toBeLessThan(3000);
  });
});
