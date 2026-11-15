import type { Resort } from '../domain/types';

/**
 * 雪场导出/导入。
 * 为避免 String.fromCharCode 对超大数组爆栈，base64 分块处理。
 * 导出格式版本化，未来可迁移。
 */

export interface ExportEnvelope {
  format: 'ski-resort-planner';
  version: 1;
  exportedAt: string;
  resort: Omit<Resort, 'heightmap'>;
  /** heightmap 的 base64（小端 float32 原始字节） */
  heightmapBase64: string;
}

const CHUNK = 0x8000;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += CHUNK) {
    const end = Math.min(binary.length, i + CHUNK);
    for (let j = i; j < end; j++) bytes[j] = binary.charCodeAt(j);
  }
  return bytes;
}

export function exportResort(resort: Resort): ExportEnvelope {
  const { heightmap, ...meta } = resort;
  const bytes = new Uint8Array(heightmap.buffer, heightmap.byteOffset, heightmap.byteLength);
  return {
    format: 'ski-resort-planner',
    version: 1,
    exportedAt: new Date(0).toISOString().replace('1970-01-01T00:00:00.000Z', '1970-01-01'), // 占位，调用方可覆盖
    resort: meta,
    heightmapBase64: bytesToBase64(bytes),
  };
}

/** 实际导出时用真实时间；仿真可复现性不受该字段影响 */
export function exportResortNow(resort: Resort): ExportEnvelope {
  const env = exportResort(resort);
  env.exportedAt = new Date().toISOString();
  return env;
}

export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  triggerDownload(filename, blob);
}

export function triggerDownload(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export class ImportError extends Error {}

export function importResort(envelope: unknown): Resort {
  if (typeof envelope !== 'object' || envelope === null) throw new ImportError('文件格式不正确');
  const env = envelope as Partial<ExportEnvelope>;
  if (env.format !== 'ski-resort-planner') throw new ImportError('缺少格式标识，不是本系统的导出文件');
  if (env.version !== 1) throw new ImportError(`不支持的版本: ${String(env.version)}`);
  if (!env.resort || typeof env.resort.id !== 'string' || !env.heightmapBase64) {
    throw new ImportError('文件内容不完整');
  }
  const bytes = base64ToBytes(env.heightmapBase64);
  const expected = env.resort.size * env.resort.size * 4;
  if (bytes.byteLength !== expected) {
    throw new ImportError(`高度图字节数不符：期望 ${expected}，实际 ${bytes.byteLength}`);
  }
  // 复制一份独立的 ArrayBuffer，避免与解码缓冲共享内存
  const heightmap = new Float32Array(bytes.byteLength / 4);
  heightmap.set(new Float32Array(bytes.buffer, bytes.byteOffset, heightmap.length));
  return { ...(env.resort as Omit<Resort, 'heightmap'>), heightmap };
}

export async function readImportFile(file: File): Promise<Resort> {
  try {
    const text = await file.text();
    return importResort(JSON.parse(text));
  } catch (e) {
    if (e instanceof ImportError) throw e;
    throw new ImportError(`无法解析文件：${(e as Error).message}`);
  }
}
