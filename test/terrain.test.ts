import { describe, expect, it } from 'vitest';
import { applyBrush, generateProcedural, stampLine } from '../src/domain/terrain';
import { hashFloat32Array } from '../src/domain/util/hash';

describe('地形刷子', () => {
  it('同样参数两次盖印结果位级一致', () => {
    const n = 256;
    const a = new Float32Array(n * n);
    const b = new Float32Array(n * n);
    const params = { cx: 128, cy: 128, radius: 24, strength: 0.7, mode: 'raise' as const };
    applyBrush(a, n, params);
    applyBrush(b, n, params);
    expect(hashFloat32Array(a)).toBe(hashFloat32Array(b));
  });

  it('抬升增加高度、压低减小高度、推平收敛到目标值', () => {
    const n = 128;
    const map = new Float32Array(n * n).fill(0.3);
    applyBrush(map, n, { cx: 64, cy: 64, radius: 16, strength: 1, mode: 'raise' });
    expect(map[64 * n + 64]).toBeGreaterThan(0.3);

    applyBrush(map, n, { cx: 64, cy: 64, radius: 16, strength: 1, mode: 'lower' });
    const afterLower = map[64 * n + 64];
    applyBrush(map, n, { cx: 64, cy: 64, radius: 16, strength: 1, mode: 'lower' });
    expect(map[64 * n + 64]).toBeLessThan(afterLower);

    const target = 0.5;
    for (let i = 0; i < 30; i++) {
      applyBrush(map, n, { cx: 64, cy: 64, radius: 16, strength: 1, mode: 'flatten', flattenTarget: target });
    }
    expect(map[64 * n + 64]).toBeCloseTo(target, 4);
  });

  it('1024 网格半径 30 的单次盖印耗时低于 4ms（交互不卡基线）', () => {
    const n = 1024;
    const map = new Float32Array(n * n);
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) {
      applyBrush(map, n, { cx: 512, cy: 512, radius: 30, strength: 0.6, mode: 'raise' });
    }
    const per = (performance.now() - t0) / 20;
    expect(per).toBeLessThan(4);
  });

  it('快速拖拽插值不留零值空洞', () => {
    const n = 256;
    const map = new Float32Array(n * n);
    stampLine(map, n, { x: 30, y: 30 }, { x: 220, y: 200 }, { radius: 12, strength: 1, mode: 'raise' });
    let touched = 0;
    for (const v of map) if (v > 0) touched++;
    expect(touched).toBeGreaterThan(2000);
  });

  it('程序化地形同种子完全可复现，不同种子不同', () => {
    const a = generateProcedural(256, { seed: 42, baseFrequency: 3, octaves: 4, lacunarity: 2, gain: 0.5, amplitude: 0.5 });
    const b = generateProcedural(256, { seed: 42, baseFrequency: 3, octaves: 4, lacunarity: 2, gain: 0.5, amplitude: 0.5 });
    const c = generateProcedural(256, { seed: 43, baseFrequency: 3, octaves: 4, lacunarity: 2, gain: 0.5, amplitude: 0.5 });
    expect(hashFloat32Array(a)).toBe(hashFloat32Array(b));
    expect(hashFloat32Array(a)).not.toBe(hashFloat32Array(c));
  });
});
