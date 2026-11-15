import { buildTrackMap } from '../../domain/grooming';
import { computeSnowDepth, reproducibilityCheck } from '../../domain/snow';
import { computeResortSlopes, exportGridBin, exportGridPng, exportSlopeCsv } from '../../storage/exporters';
import { downloadJson, exportResortNow } from '../../storage/exportImport';
import { ResortStore } from '../ResortStore';
import { h, numberField, sliderField, toast } from '../dom';
import type { Page } from '../router';
import { pageLayout } from '../layout';
import { hashFloat32Array, toHex8 } from '../../domain/util/hash';

export const settingsPage: Page = {
  title: '设置导出',
  async render(_root, params): Promise<HTMLElement> {
    const id = params.get('id');
    if (!id) throw new Error('缺少雪场 id');
    const store = await ResortStore.load(id);
    const resort = store.resort;

    const verifyEl = h('div', { class: 'sim-result' }, h('p', { class: 'hint' }, '点击按钮运行可复现性自检'));

    const runVerify = () => {
      verifyEl.replaceChildren(h('span', { class: 'spinner' }), ' 连跑两次并比对位级哈希…');
      // 让出一帧渲染 spinner
      setTimeout(() => {
        const t0 = performance.now();
        const check = reproducibilityCheck({
          size: resort.size,
          cellSize: resort.cellSize,
          guns: resort.guns,
          settings: resort.snowmaking,
        });
        const elapsed = performance.now() - t0;
        verifyEl.replaceChildren(
          h(
            'div',
            { class: `sim-line ${check.ok ? 'ok' : 'bad'}` },
            check.ok ? `✓ 两次计算位级一致` : '✗ 两次计算不一致！',
          ),
          h('div', { class: 'sim-line' }, `哈希 A: ${toHex8(check.hashA)}`),
          h('div', { class: 'sim-line' }, `哈希 B: ${toHex8(check.hashB)}`),
          h('div', { class: 'sim-line' }, `单次耗时: ${elapsed.toFixed(0)} ms（CPU 单线程）`),
          h(
            'div',
            { class: 'sim-line' },
            `沉积 ${check.result.depositedVolume.toFixed(1)} m³ · 出界 ${(check.result.outOfBoundsRatio * 100).toFixed(2)}%`,
          ),
        );
      }, 30);
    };

    const safeName = resort.name.replace(/[\\/:*?"<>|]/g, '_');

    const panel = h(
      'div',
      { class: 'settings-grid' },
      h(
        'section',
        { class: 'card panel-section' },
        h('h3', {}, '地形参数'),
        numberField('网格边长', resort.size, 1, 64, 2048, () => toast('网格大小需重建雪场，请新建雪场时选择', 'error')),
        numberField('单格间距 (m)', resort.cellSize, 0.1, 0.5, 20, (v) => {
          resort.cellSize = v;
          store.markChanged();
        }),
        numberField('高度缩放 (m)', resort.heightScale, 0.5, 1, 200, (v) => {
          resort.heightScale = v;
          store.markChanged();
        }),
      ),
      h(
        'section',
        { class: 'card panel-section' },
        h('h3', {}, '安全坡度'),
        sliderField('安全坡度阈值 (°)', resort.render.safeSlopeDeg, 1, 10, 60, (v) => {
          resort.render.safeSlopeDeg = v;
          store.markChanged();
        }, (v) => v.toFixed(0)),
        h('p', { class: 'hint' }, '超过该角度的坡面在地图与 3D 预览中标红'),
      ),
      h(
        'section',
        { class: 'card panel-section' },
        h('h3', {}, '可复现性自检'),
        h('p', { class: 'hint' }, '纯 CPU 确定性引擎：固定喷枪排序、行主序遍历、Float64 累加、无随机数。'),
        h('button', { class: 'btn btn-primary btn-block', onclick: runVerify }, '运行双跑比对'),
        verifyEl,
      ),
      h(
        'section',
        { class: 'card panel-section' },
        h('h3', {}, '数据导出'),
        h(
          'button',
          {
            class: 'btn btn-block',
            onclick: () => {
              downloadJson(`${safeName}.json`, exportResortNow(resort));
              toast('雪场 JSON 已导出', 'ok');
            },
          },
          '导出完整雪场 JSON（含高度图）',
        ),
        h(
          'button',
          {
            class: 'btn btn-block',
            onclick: () => {
              const r = computeSnowDepth({
                size: resort.size,
                cellSize: resort.cellSize,
                guns: resort.guns,
                settings: resort.snowmaking,
              });
              let maxD = 0;
              for (const v of r.depth) if (v > maxD) maxD = v;
              exportGridPng(r.depth, resort.size, `${safeName}-积雪厚度.png`, 'm');
              exportGridBin(r.depth, resort.size, `${safeName}-积雪厚度`, {
                unit: 'meter',
                maxDepth: maxD,
                depthHash: toHex8(hashFloat32Array(r.depth)),
                guns: resort.guns.length,
                settings: resort.snowmaking,
              });
              toast('积雪厚度图已导出（PNG + float32 BIN）', 'ok');
            },
          },
          '导出积雪厚度图（PNG 灰度 + BIN 原始数据）',
        ),
        h(
          'button',
          {
            class: 'btn btn-block',
            onclick: () => {
              const slopes = computeResortSlopes(resort);
              exportSlopeCsv(resort, slopes, `${safeName}-坡度统计.csv`);
              toast('坡度统计 CSV 已导出', 'ok');
            },
          },
          '导出坡度统计 CSV',
        ),
        h(
          'button',
          {
            class: 'btn btn-block',
            onclick: () => {
              const { tracks } = buildTrackMap(resort.routes, resort.size);
              exportGridPng(tracks, resort.size, `${safeName}-车辙强度.png`, '0..1');
              toast('车辙强度图已导出', 'ok');
            },
          },
          '导出车辙强度图 PNG',
        ),
      ),
      h(
        'section',
        { class: 'card panel-section' },
        h('h3', {}, '存储'),
        h('p', { class: 'hint' }, `数据保存在浏览器 IndexedDB（库名 ski-resort-planner）。清理浏览器站点数据会删除全部雪场，请定期导出 JSON 备份。`),
        h(
          'button',
          {
            class: 'btn btn-block',
            onclick: async () => {
              await store.flush();
              toast('所有修改已写入 IndexedDB', 'ok');
            },
          },
          '立即保存',
        ),
      ),
    );

    return pageLayout('设置导出', panel, resort.name);
  },
  cleanup() {},
};
