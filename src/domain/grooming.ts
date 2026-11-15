import type { GroomerRoute, Vec2 } from './types';

/**
 * 压雪车辙：把每条折线按车宽栅格化为车辙强度图。
 * 强度 0..1，重复碾压的区域饱和到 1（固定写法，确定性）。
 * 路线处理顺序按 id 排序，与数组排列无关。
 */

function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): { dist: number; t: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const qx = a.x + dx * t;
  const qy = a.y + dy * t;
  return { dist: Math.hypot(p.x - qx, p.y - qy), t };
}

export interface TrackResult {
  /** 车辙强度 0..1，行主序 */
  tracks: Float32Array;
  /** 被碾压格点占比（百分比） */
  coveredRatio: number;
}

export function buildTrackMap(routes: GroomerRoute[], size: number): TrackResult {
  const tracks = new Float32Array(size * size);
  const ordered = routes.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  for (const route of ordered) {
    const pts = route.points;
    if (pts.length < 2) continue;
    const halfW = Math.max(0.5, route.width / 2);

    // 整条路线的包围盒，圈定需要扫描的格点范围
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    const x0 = Math.max(0, Math.floor(minX - halfW - 1));
    const x1 = Math.min(size - 1, Math.ceil(maxX + halfW + 1));
    const y0 = Math.max(0, Math.floor(minY - halfW - 1));
    const y1 = Math.min(size - 1, Math.ceil(maxY + halfW + 1));

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        let minDist = Infinity;
        // 格点中心到折线上任一段的最短距离
        for (let s = 0; s < pts.length - 1; s++) {
          const { dist } = distanceToSegment({ x: x + 0.5, y: y + 0.5 }, pts[s], pts[s + 1]);
          if (dist < minDist) minDist = dist;
        }
        if (minDist <= halfW) {
          const idx = y * size + x;
          // 软边缘：宽度内余弦衰减
          const edge = 0.5 * (1 + Math.cos(Math.PI * Math.min(1, minDist / halfW)));
          // 固定饱和写法，避免浮点求和顺序问题
          tracks[idx] = Math.max(tracks[idx], edge);
        }
      }
    }
  }

  let covered = 0;
  for (let i = 0; i < tracks.length; i++) if (tracks[i] > 0.01) covered++;
  return { tracks, coveredRatio: (covered / tracks.length) * 100 };
}

/** 路线总长度（格点单位），用于作业报表 */
export function routeLength(route: GroomerRoute): number {
  let len = 0;
  for (let i = 0; i < route.points.length - 1; i++) {
    len += Math.hypot(
      route.points[i + 1].x - route.points[i].x,
      route.points[i + 1].y - route.points[i].y,
    );
  }
  return len;
}
