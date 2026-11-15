import type { Resort } from './types';
import { DEFAULT_RENDER_SETTINGS, DEFAULT_SNOW_SETTINGS, makeId } from './types';
import { generateProcedural } from './terrain';

export function createResort(name: string, size = 1024): Resort {
  const now = Date.now();
  return {
    id: makeId(),
    name,
    createdAt: now,
    updatedAt: now,
    size,
    cellSize: 2,
    heightScale: 20,
    heightmap: generateProcedural(size),
    guns: [],
    routes: [],
    snowmaking: structuredClone(DEFAULT_SNOW_SETTINGS),
    render: structuredClone(DEFAULT_RENDER_SETTINGS),
  };
}

/** 深拷贝雪场并分配新 id（复制功能）。高度图独立复制，避免共享缓冲。 */
export function cloneResort(source: Resort, newName: string): Resort {
  const now = Date.now();
  const heightmap = new Float32Array(source.heightmap.length);
  heightmap.set(source.heightmap);
  return {
    ...structuredClone(source),
    id: makeId(),
    name: newName,
    createdAt: now,
    updatedAt: now,
    heightmap,
    guns: source.guns.map((g) => ({ ...g, id: makeId() })),
    routes: source.routes.map((r) => ({ ...r, id: makeId(), points: r.points.map((p) => ({ ...p })) })),
  };
}
