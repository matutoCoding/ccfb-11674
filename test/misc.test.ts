import { describe, expect, it } from 'vitest';
import { buildTrackMap, routeLength } from '../src/domain/grooming';
import { computeSlopeDegrees, slopeReport } from '../src/domain/slope';
import { hashFloat32Array } from '../src/domain/util/hash';
import type { GroomerRoute } from '../src/domain/types';
import { makeId } from '../src/domain/types';
import { importResort, exportResort, ImportError } from '../src/storage/exportImport';
import { createResort } from '../src/domain/factory';

describe('压雪车辙', () => {
  it('路线栅格化结果可复现且与路线顺序无关', () => {
    const mk = (id: string): GroomerRoute => ({
      id,
      name: id,
      width: 6,
      points: [
        { x: 20, y: 20 },
        { x: 100, y: 80 },
        { x: 180, y: 40 },
      ],
    });
    const routes = [mk('b'), mk('a'), mk('c')];
    const r1 = buildTrackMap(routes, 256);
    const r2 = buildTrackMap([...routes].reverse(), 256);
    expect(hashFloat32Array(r1.tracks)).toBe(hashFloat32Array(r2.tracks));
    expect(r1.coveredRatio).toBeGreaterThan(0);
    expect(routeLength(routes[0])).toBeCloseTo(Math.hypot(80, 60) + Math.hypot(80, -40), 5);
  });
});

describe('坡度分析', () => {
  it('平面坡度为 0，45° 斜坡识别正确', () => {
    const n = 64;
    const flat = new Float32Array(n * n).fill(0.5);
    const s0 = computeSlopeDegrees(flat, n, 2, 20);
    expect(s0[32 * n + 32]).toBeCloseTo(0, 6);

    // 每格高度差 = cellSize -> 梯度 1 -> 45°
    const ramp = new Float32Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) ramp[y * n + x] = (x * 2) / 20;
    const s1 = computeSlopeDegrees(ramp, n, 2, 20);
    expect(s1[32 * n + 32]).toBeCloseTo(45, 1);

    const report = slopeReport(s1, 30);
    expect(report.overSafeRatio).toBeGreaterThan(90);
  });
});

describe('导出导入往返', () => {
  it('雪场导出再导入后高度图位级一致', () => {
    const resort = createResort('往返测试', 128);
    resort.guns.push({ id: makeId(), x: 10, y: 10, output: 30, spreadDeg: 50, range: 40 });
    const env = exportResort(resort);
    const restored = importResort(env);
    expect(restored.heightmap.byteLength).toBe(resort.heightmap.byteLength);
    expect(hashFloat32Array(restored.heightmap)).toBe(hashFloat32Array(resort.heightmap));
    expect(restored.guns).toEqual(resort.guns);
  });

  it('损坏文件抛出明确错误', () => {
    expect(() => importResort({})).toThrow(ImportError);
    expect(() => importResort({ format: 'other', version: 1 })).toThrow(ImportError);
  });
});
