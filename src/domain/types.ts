/**
 * 领域模型：雪场工程的全部持久化数据结构。
 * 所有数值字段都使用普通 number / TypedArray，序列化后可跨机器复现。
 */

export interface Vec2 {
  x: number;
  y: number;
}

/** 造雪机布点。坐标单位为格点（与高度图同一网格），id 决定积雪累加顺序。 */
export interface SnowGun {
  id: string;
  /** 网格坐标（浮点，允许落在格点之间） */
  x: number;
  y: number;
  /** 出雪量，立方米/小时 */
  output: number;
  /** 横向喷射张角，度 */
  spreadDeg: number;
  /** 有效射程，格点单位 */
  range: number;
}

/** 压雪路线：一条折线 + 车身宽度（格点单位） */
export interface GroomerRoute {
  id: string;
  name: string;
  points: Vec2[];
  /** 压雪车作业宽度，格点单位 */
  width: number;
}

/** 风场：风向（度，0=向北/y负方向，顺时针）与风速 m/s */
export interface WindState {
  /** 风向角，度。指风“吹向”的方向 */
  directionDeg: number;
  speed: number;
}

/** 造雪工况参数，是积雪厚度计算的全部输入之一 */
export interface SnowmakingSettings {
  /** 连续作业小时数 */
  durationHours: number;
  /** 漂移系数：每 (m/s) 风速每小时的雪质心漂移距离（格点单位） */
  driftFactor: number;
  /** 顺风方向展宽倍数 */
  windStretch: number;
  wind: WindState;
}

/** 渲染设置（非仿真参数，不参与可复现计算） */
export interface RenderSettings {
  safeSlopeDeg: number;
  showSlopeOverlay: boolean;
  showTracks: boolean;
  showGuns: boolean;
  showRoutes: boolean;
  sssStrength: number;
  sparkleStrength: number;
  shadowBlue: number;
  /** 一天中的时刻 0..24（小时） */
  timeOfDay: number;
  /** 相机俯仰/方位，度 */
  cameraAzimuth: number;
  cameraElevation: number;
  cameraDistance: number;
}

/** 雪场元数据 + 全部场景数据 */
export interface Resort {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** 网格边长（正方形高度图，如 1024） */
  size: number;
  /** 单格水平间距，米 */
  cellSize: number;
  /** 高度缩放：高度图数值 1.0 对应的真实米数 */
  heightScale: number;
  /** 行主序高度图，长度 size*size，数值无单位（乘 heightScale 得米） */
  heightmap: Float32Array;
  guns: SnowGun[];
  routes: GroomerRoute[];
  snowmaking: SnowmakingSettings;
  render: RenderSettings;
}

/** IndexedDB 中不含大数组的列表项 */
export type ResortSummary = Omit<Resort, 'heightmap'> & { heightmap: undefined };

export const DEFAULT_RENDER_SETTINGS: RenderSettings = {
  safeSlopeDeg: 30,
  showSlopeOverlay: true,
  showTracks: true,
  showGuns: true,
  showRoutes: true,
  sssStrength: 0.55,
  sparkleStrength: 0.6,
  shadowBlue: 0.5,
  timeOfDay: 10,
  cameraAzimuth: 35,
  cameraElevation: 42,
  cameraDistance: 1.35,
};

export const DEFAULT_SNOW_SETTINGS: SnowmakingSettings = {
  durationHours: 8,
  driftFactor: 2.0,
  windStretch: 1.8,
  wind: { directionDeg: 0, speed: 0 },
};

export function makeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  // 退化路径（老旧环境），不参与确定性计算
  return `id-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}
