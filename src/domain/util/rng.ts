/**
 * 确定性伪随机数：mulberry32。
 * 仅用于程序化地形生成等“需要随机但仍可复现”的场景。
 * 积雪厚度仿真不使用任何随机数。
 */
export class DeterministicRng {
  private state: number;

  constructor(seed: number) {
    // 避免全零状态
    this.state = seed >>> 0 || 0x9e3779b9;
  }

  /** 返回 [0, 1) 的浮点，同一 seed 序列逐位一致 */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** [min, max) */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** 整数 [min, max] */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
}

/** 字符串种子 -> uint32（FNV-1a） */
export function hashStringToUint32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
