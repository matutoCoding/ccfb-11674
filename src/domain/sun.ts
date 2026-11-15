/**
 * 太阳位置与光照颜色（确定性纯函数，无环境依赖）。
 * timeOfDay: 0..24 小时；6 点日出、12 点正午、18 点日落。
 */

export interface SunState {
  /** 指向太阳的单位向量（x 东, y 北, z 上） */
  direction: [number, number, number];
  /** 太阳高度角，度，地平线以下为负 */
  elevationDeg: number;
  /** 0=黑夜 1=白昼，用于颜色混合 */
  dayFactor: number;
  /** 阳光颜色（线性 0..1） */
  sunColor: [number, number, number];
  /** 环境天光颜色（线性 0..1） */
  ambientColor: [number, number, number];
}

const DEG2RAD = Math.PI / 180;

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function mix3(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export function sunAtTime(timeOfDay: number, azimuthDeg = 135): SunState {
  const t = ((timeOfDay % 24) + 24) % 24;
  // 太阳高度角：6:00 升起、12:00 天顶、18:00 落下
  const elevation = Math.sin(((t - 6) / 12) * Math.PI) * 75; // 度，正午 75°
  const az = azimuthDeg * DEG2RAD;
  const el = elevation * DEG2RAD;
  const ce = Math.cos(el);
  const direction: [number, number, number] = [
    ce * Math.sin(az),
    ce * Math.cos(az),
    Math.sin(el),
  ];

  // 日落后太阳不可用，方向压到地平线
  if (elevation < 0) direction[2] = -0.1;

  // dayFactor：太阳在地平线附近平滑过渡
  const dayFactor = clamp01((elevation + 6) / 12);

  // 色温三段：夜晚冷蓝 -> 日出日落暖橙 -> 正午白
  const night: [number, number, number] = [0.18, 0.24, 0.42];
  const dawn: [number, number, number] = [1.0, 0.55, 0.28];
  const noon: [number, number, number] = [1.0, 0.97, 0.9];
  let sunColor: [number, number, number];
  if (dayFactor < 0.5) {
    sunColor = mix3(night, dawn, dayFactor * 2);
  } else {
    sunColor = mix3(dawn, noon, (dayFactor - 0.5) * 2);
  }

  const ambientNight: [number, number, number] = [0.05, 0.07, 0.13];
  const ambientDay: [number, number, number] = [0.55, 0.68, 0.85];
  const ambientColor = mix3(ambientNight, ambientDay, dayFactor);

  return { direction, elevationDeg: elevation, dayFactor, sunColor, ambientColor };
}
