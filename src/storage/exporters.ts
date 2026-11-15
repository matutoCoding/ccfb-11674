import type { Resort } from '../domain/types';
import { computeSlopeDegrees, slopeReport } from '../domain/slope';
import { computeStats } from '../domain/util/hash';
import { triggerDownload } from '../storage/exportImport';

/** Float32 网格 -> 灰度 PNG（黑=最小，白=最大），通过离屏 canvas 编码 */
export function exportGridPng(grid: Float32Array, size: number, filename: string, unitLabel: string): void {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] < min) min = grid[i];
    if (grid[i] > max) max = grid[i];
  }
  const range = max - min || 1;
  const img = new ImageData(size, size);
  for (let i = 0; i < grid.length; i++) {
    const v = Math.round(((grid[i] - min) / range) * 255);
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  canvas.getContext('2d')!.putImageData(img, 0, 0);
  canvas.toBlob((blob) => {
    if (blob) triggerDownload(filename, blob);
  }, 'image/png');
  // 单位与量程写进文件名外的控制台信息，便于复现核对
  console.info(`[export] ${filename} 单位=${unitLabel} min=${min.toFixed(4)} max=${max.toFixed(4)}`);
}

/** 原始 float32 小端二进制 + 同名 JSON 侧车（元数据） */
export function exportGridBin(grid: Float32Array, size: number, baseName: string, meta: Record<string, unknown>): void {
  const bytes = new Uint8Array(grid.buffer, grid.byteOffset, grid.byteLength).slice();
  triggerDownload(`${baseName}.bin`, new Blob([bytes], { type: 'application/octet-stream' }));
  triggerDownload(
    `${baseName}.meta.json`,
    new Blob([JSON.stringify({ size, dtype: 'float32le', ...meta }, null, 2)], { type: 'application/json' }),
  );
}

/** 坡度统计 CSV（含分带与分位数） */
export function exportSlopeCsv(resort: Resort, slopes: Float32Array, filename: string): void {
  const report = slopeReport(slopes, resort.render.safeSlopeDeg);
  const stats = computeStats(slopes);
  const lines: string[] = [];
  lines.push('雪场名称,' + csvCell(resort.name));
  lines.push(`网格大小,${resort.size}x${resort.size}`);
  lines.push(`安全坡度阈值(度),${resort.render.safeSlopeDeg}`);
  lines.push(`平均坡度(度),${report.mean.toFixed(3)}`);
  lines.push(`最大坡度(度),${report.max.toFixed(3)}`);
  lines.push(`超标面积占比(%),${report.overSafeRatio.toFixed(3)}`);
  lines.push('');
  lines.push('坡度分区,下限(度),上限(度),格点数,占比(%)');
  for (const b of report.bands) {
    lines.push(`${csvCell(b.label)},${b.min},${b.max},${b.count},${b.ratio.toFixed(3)}`);
  }
  lines.push('');
  lines.push('分位数,坡度(度)');
  for (const [p, v] of Object.entries(stats.percentiles)) {
    lines.push(`P${p},${v.toFixed(3)}`);
  }
  // 加 UTF-8 BOM，Excel 打开中文不乱码
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  triggerDownload(filename, blob);
}

function csvCell(s: string): string {
  return `"${s.replaceAll('"', '""')}"`;
}

export function computeResortSlopes(resort: Resort): Float32Array {
  return computeSlopeDegrees(resort.heightmap, resort.size, resort.cellSize, resort.heightScale);
}
