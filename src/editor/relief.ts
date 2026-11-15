/**
 * 网格数据 -> 离屏画布渲染器。
 * 输出分辨率固定 512，编辑时按 rAF 节流重算，1024² 源数据也只做 512² 次采样。
 */

const OUT_RES = 512;

function sampleBilinear(map: Float32Array, size: number, u: number, v: number): number {
  const x = Math.max(0, Math.min(size - 1.001, u * (size - 1)));
  const y = Math.max(0, Math.min(size - 1.001, v * (size - 1)));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const h00 = map[y0 * size + x0];
  const h10 = map[y0 * size + x0 + 1];
  const h01 = map[(y0 + 1) * size + x0];
  const h11 = map[(y0 + 1) * size + x0 + 1];
  return h00 * (1 - fx) * (1 - fy) + h10 * fx * (1 - fy) + h01 * (1 - fx) * fy + h11 * fx * fy;
}

/** 地形晕渲：高程设色 + 西北方向山体阴影 */
export function renderRelief(map: Float32Array, size: number): HTMLCanvasElement {
  const img = new ImageData(OUT_RES, OUT_RES);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < map.length; i++) {
    if (map[i] < min) min = map[i];
    if (map[i] > max) max = map[i];
  }
  const range = max - min || 1;
  const lightDx = -0.6;
  const lightDy = -0.6;

  for (let oy = 0; oy < OUT_RES; oy++) {
    for (let ox = 0; ox < OUT_RES; ox++) {
      const u = ox / (OUT_RES - 1);
      const v = oy / (OUT_RES - 1);
      const h = sampleBilinear(map, size, u, v);
      const hx = sampleBilinear(map, size, u + 1 / OUT_RES, v) - sampleBilinear(map, size, u - 1 / OUT_RES, v);
      const hy = sampleBilinear(map, size, u, v + 1 / OUT_RES) - sampleBilinear(map, size, u, v - 1 / OUT_RES);
      const shade = Math.max(0.35, Math.min(1.2, 1 + (hx * lightDx + hy * lightDy) * 6));
      const t = (h - min) / range;
      // 雪面青白色基调，低处略暗
      const base = 205 + t * 45;
      const idx = (oy * OUT_RES + ox) * 4;
      img.data[idx] = Math.min(255, base * shade * 0.96);
      img.data[idx + 1] = Math.min(255, base * shade * 0.99);
      img.data[idx + 2] = Math.min(255, base * shade * 1.05);
      img.data[idx + 3] = 255;
    }
  }
  const c = document.createElement('canvas');
  c.width = OUT_RES;
  c.height = OUT_RES;
  c.getContext('2d')!.putImageData(img, 0, 0);
  return c;
}

/** 积雪厚度热力图：蓝 -> 青 -> 绿 -> 黄 -> 红，零值透明 */
export function renderHeatmap(depth: Float32Array, size: number, maxDepth: number): HTMLCanvasElement {
  const img = new ImageData(OUT_RES, OUT_RES);
  const cap = maxDepth > 0 ? maxDepth : 1;
  const stops: [number, [number, number, number]][] = [
    [0.0, [30, 70, 160]],
    [0.25, [30, 180, 200]],
    [0.5, [60, 190, 90]],
    [0.75, [240, 210, 50]],
    [1.0, [220, 60, 40]],
  ];
  for (let oy = 0; oy < OUT_RES; oy++) {
    for (let ox = 0; ox < OUT_RES; ox++) {
      const d = sampleBilinear(depth, size, ox / (OUT_RES - 1), oy / (OUT_RES - 1));
      const idx = (oy * OUT_RES + ox) * 4;
      if (d <= cap * 0.002) {
        img.data[idx + 3] = 0;
        continue;
      }
      const t = Math.min(1, d / cap);
      let lo = stops[0];
      let hi = stops[stops.length - 1];
      for (let s = 0; s < stops.length - 1; s++) {
        if (t >= stops[s][0] && t <= stops[s + 1][0]) {
          lo = stops[s];
          hi = stops[s + 1];
          break;
        }
      }
      const k = (t - lo[0]) / (hi[0] - lo[0] || 1);
      img.data[idx] = lo[1][0] + (hi[1][0] - lo[1][0]) * k;
      img.data[idx + 1] = lo[1][1] + (hi[1][1] - lo[1][1]) * k;
      img.data[idx + 2] = lo[1][2] + (hi[1][2] - lo[1][2]) * k;
      img.data[idx + 3] = 210;
    }
  }
  const c = document.createElement('canvas');
  c.width = OUT_RES;
  c.height = OUT_RES;
  c.getContext('2d')!.putImageData(img, 0, 0);
  return c;
}

/** 坡度超标红色叠加（半透明），其余区域完全透明 */
export function renderSlopeOverlay(slopes: Float32Array, size: number, safeDeg: number): HTMLCanvasElement {
  const img = new ImageData(OUT_RES, OUT_RES);
  for (let oy = 0; oy < OUT_RES; oy++) {
    for (let ox = 0; ox < OUT_RES; ox++) {
      const v = sampleBilinear(slopes, size, ox / (OUT_RES - 1), oy / (OUT_RES - 1));
      const idx = (oy * OUT_RES + ox) * 4;
      if (v > safeDeg) {
        const intensity = Math.min(1, (v - safeDeg) / 15);
        img.data[idx] = 230;
        img.data[idx + 1] = 40 + (1 - intensity) * 60;
        img.data[idx + 2] = 40;
        img.data[idx + 3] = 120 + intensity * 110;
      }
    }
  }
  const c = document.createElement('canvas');
  c.width = OUT_RES;
  c.height = OUT_RES;
  c.getContext('2d')!.putImageData(img, 0, 0);
  return c;
}

/** 车辙叠加：灰白半透明条带 */
export function renderTrackOverlay(tracks: Float32Array, size: number): HTMLCanvasElement {
  const img = new ImageData(OUT_RES, OUT_RES);
  for (let oy = 0; oy < OUT_RES; oy++) {
    for (let ox = 0; ox < OUT_RES; ox++) {
      const v = sampleBilinear(tracks, size, ox / (OUT_RES - 1), oy / (OUT_RES - 1));
      const idx = (oy * OUT_RES + ox) * 4;
      if (v > 0.01) {
        img.data[idx] = 90;
        img.data[idx + 1] = 95;
        img.data[idx + 2] = 110;
        img.data[idx + 3] = Math.min(200, v * 220);
      }
    }
  }
  const c = document.createElement('canvas');
  c.width = OUT_RES;
  c.height = OUT_RES;
  c.getContext('2d')!.putImageData(img, 0, 0);
  return c;
}
