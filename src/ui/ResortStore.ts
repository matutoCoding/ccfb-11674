import type { Resort } from '../domain/types';
import { getResort, putResort } from '../storage/idb';

/**
 * 页面级雪场状态：加载、防抖自动保存。
 * 保存失败会显式抛错，绝不静默丢数据。
 */
export class ResortStore {
  resort: Resort;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;

  private constructor(resort: Resort) {
    this.resort = resort;
  }

  static async load(id: string): Promise<ResortStore> {
    const resort = await getResort(id);
    if (!resort) throw new Error(`雪场不存在或已被删除：${id}`);
    return new ResortStore(resort);
  }

  /** 标记数据已变，400ms 防抖后持久化 */
  markChanged(): void {
    this.dirty = true;
    this.resort.updatedAt = Date.now();
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      void this.flush();
    }, 400);
  }

  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (!this.dirty) return;
    await putResort(this.resort);
    this.dirty = false;
  }

  get isDirty(): boolean {
    return this.dirty;
  }

  dispose(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
  }
}
