import type { SnowGun } from '../../domain/types';
import { DEFAULT_SNOW_SETTINGS, makeId } from '../../domain/types';
import { renderHeatmap, renderRelief, renderSlopeOverlay } from '../../editor/relief';
import { MapCanvas } from '../../editor/MapCanvas';
import { computeSlopeDegrees } from '../../domain/slope';
import { ResortStore } from '../ResortStore';
import { h, numberField, sliderField, toast } from '../dom';
import type { Page } from '../router';
import { pageLayout } from '../layout';
import SnowWorker from '../../workers/snowWorker?worker';
import type { SnowWorkerRequest, SnowWorkerResponse } from '../../workers/snowWorker';
import { toHex8 } from '../../domain/util/hash';

export const gunsPage: Page = {
  title: '造雪布点',
  async render(_root, params): Promise<HTMLElement> {
    const id = params.get('id');
    if (!id) throw new Error('缺少雪场 id');
    const store = await ResortStore.load(id);
    const resort = store.resort;

    let depth = new Float32Array(resort.size * resort.size);
    let slopes = computeSlopeDegrees(resort.heightmap, resort.size, resort.cellSize, resort.heightScale);
    const relief = renderRelief(resort.heightmap, resort.size);
    let heat = renderHeatmap(depth, resort.size, 1);
    let slopeLayer = renderSlopeOverlay(slopes, resort.size, resort.render.safeSlopeDeg);
    const map = new MapCanvas(resort.size);
    let showHeat = true;
    let showSlope = false;
    let selectedId: string | null = resort.guns[0]?.id ?? null;

    function refreshLayers(): void {
      const layers = [{ canvas: relief, alpha: 1 }];
      if (showSlope) layers.push({ canvas: slopeLayer, alpha: 0.7 });
      if (showHeat) layers.push({ canvas: heat, alpha: 0.75 });
      map.setLayers(layers);
      map.setOverlays(resort.guns, resort.routes, { guns: true, routes: false });
    }
    refreshLayers();

    // ---- 造雪机列表与属性面板 ----
    const gunListEl = h('div', { class: 'item-list' });
    const detailEl = h('div', { class: 'panel-section' });

    function renderGunList(): void {
      gunListEl.replaceChildren();
      if (resort.guns.length === 0) {
        gunListEl.append(h('p', { class: 'hint' }, '在地图上点击空白处即可添加造雪机'));
      }
      for (const gun of resort.guns) {
        const item = h(
          'div',
          { class: `list-item${gun.id === selectedId ? ' selected' : ''}` },
          h('span', {}, `造雪机 ${gun.id.slice(0, 4)}`),
          h(
            'button',
            {
              class: 'btn btn-mini btn-danger',
              onclick: () => {
                resort.guns = resort.guns.filter((g) => g.id !== gun.id);
                if (selectedId === gun.id) selectedId = resort.guns[0]?.id ?? null;
                store.markChanged();
                renderGunList();
                renderDetail();
                refreshLayers();
              },
            },
            '删',
          ),
        );
        item.addEventListener('click', () => {
          selectedId = gun.id;
          renderGunList();
          renderDetail();
        });
        gunListEl.append(item);
      }
    }

    function renderDetail(): void {
      detailEl.replaceChildren();
      const gun = resort.guns.find((g) => g.id === selectedId);
      if (!gun) {
        detailEl.append(h('p', { class: 'hint' }, '未选中造雪机'));
        return;
      }
      const update = (patch: Partial<SnowGun>) => {
        Object.assign(gun, patch);
        store.markChanged();
        refreshLayers();
      };
      detailEl.append(
        h('h3', {}, `造雪机 ${gun.id.slice(0, 8)}`),
        numberField('X 坐标', gun.x, 1, 0, resort.size - 1, (v) => update({ x: v })),
        numberField('Y 坐标', gun.y, 1, 0, resort.size - 1, (v) => update({ y: v })),
        numberField('出雪量 (m³/h)', gun.output, 1, 0, 500, (v) => update({ output: v })),
        sliderField('喷射张角 (°)', gun.spreadDeg, 1, 10, 120, (v) => update({ spreadDeg: v }), (v) => v.toFixed(0)),
        sliderField('射程 (格)', gun.range, 1, 5, resort.size * 0.5, (v) => update({ range: v }), (v) => v.toFixed(0)),
      );
    }

    // ---- 地图点击：空白处加机，点中已有机则选中 ----
    map.canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const p = map.getGridFromEvent(e);
      const gx = Math.max(0, Math.min(resort.size - 1, p.x));
      const gy = Math.max(0, Math.min(resort.size - 1, p.y));
      const hit = resort.guns.find((g) => Math.hypot(g.x - gx, g.y - gy) < Math.max(6, g.range * 0.15));
      if (hit) {
        selectedId = hit.id;
        renderGunList();
        renderDetail();
        return;
      }
      const gun: SnowGun = {
        id: makeId(),
        x: gx,
        y: gy,
        output: 40,
        spreadDeg: 60,
        range: Math.round(resort.size * 0.12),
      };
      resort.guns.push(gun);
      selectedId = gun.id;
      store.markChanged();
      renderGunList();
      renderDetail();
      refreshLayers();
    });

    // ---- 工况参数 ----
    const s = resort.snowmaking;
    const settingsEl = h(
      'div',
      { class: 'panel-section' },
      h('h3', {}, '风场与工况'),
      sliderField('风向 (°)', s.wind.directionDeg, 5, 0, 360, (v) => (s.wind.directionDeg = v), (v) => v.toFixed(0)),
      sliderField('风速 (m/s)', s.wind.speed, 0.5, 0, 20, (v) => (s.wind.speed = v), (v) => v.toFixed(1)),
      numberField('作业时长 (h)', s.durationHours, 0.5, 0.5, 168, (v) => (s.durationHours = v)),
      sliderField('漂移系数', s.driftFactor, 0.1, 0, 8, (v) => (s.driftFactor = v)),
      sliderField('顺风展宽', s.windStretch, 0.1, 1, 4, (v) => (s.windStretch = v)),
      h('button', { class: 'btn btn-ghost', onclick: () => Object.assign(s, structuredClone(DEFAULT_SNOW_SETTINGS)) }, '恢复默认工况'),
    );

    // ---- 仿真执行（Worker + 双跑校验）----
    const resultEl = h('div', { class: 'sim-result' });
    const runBtn = h('button', { class: 'btn btn-primary btn-block' }, '开始计算积雪厚度');
    const verifyToggle = h('input', { type: 'checkbox', checked: 'true' }) as HTMLInputElement;
    let worker: Worker | null = null;
    let requestSeq = 0;

    runBtn.addEventListener('click', () => {
      if (resort.guns.length === 0) {
        toast('请先布置至少一台造雪机', 'error');
        return;
      }
      runBtn.setAttribute('disabled', 'true');
      runBtn.textContent = '计算中…';
      resultEl.replaceChildren(h('span', { class: 'spinner' }), ' 确定性仿真运行中');
      worker ??= new SnowWorker();
      const reqId = ++requestSeq;
      const req: SnowWorkerRequest = {
        requestId: reqId,
        verify: verifyToggle.checked,
        size: resort.size,
        cellSize: resort.cellSize,
        guns: structuredClone(resort.guns),
        settings: structuredClone(resort.snowmaking),
      };
      worker.onmessage = (ev: MessageEvent<SnowWorkerResponse>) => {
        if (ev.data.requestId !== reqId) return;
        depth = ev.data.result.depth;
        let maxD = 0;
        for (let i = 0; i < depth.length; i++) if (depth[i] > maxD) maxD = depth[i];
        heat = renderHeatmap(depth, resort.size, maxD);
        refreshLayers();
        const r = ev.data.result;
        const nodes: (Node | string)[] = [
          h('div', { class: 'sim-line' }, `耗时: ${ev.data.elapsedMs.toFixed(0)} ms`),
          h('div', { class: 'sim-line' }, `厚度哈希: ${toHex8(ev.data.hash)}`),
        ];
        if (ev.data.verifyOk !== undefined) {
          nodes.push(
            h(
              'div',
              { class: `sim-line ${ev.data.verifyOk ? 'ok' : 'bad'}` },
              ev.data.verifyOk
                ? `✓ 双跑一致（${toHex8(ev.data.hash)} == ${toHex8(ev.data.verifyHash!)}）`
                : `✗ 两次结果不一致！`,
            ),
          );
        }
        nodes.push(
          h('div', { class: 'sim-line' }, `沉积总量: ${r.depositedVolume.toFixed(1)} m³`),
          h(
            'div',
            { class: 'sim-line' },
            `出界损失: ${(r.outOfBoundsRatio * 100).toFixed(2)}% · 最大厚度: ${maxD.toFixed(3)} m`,
          ),
        );
        resultEl.replaceChildren(...nodes);
        runBtn.removeAttribute('disabled');
        runBtn.textContent = '重新计算积雪厚度';
      };
      worker.onerror = (err) => {
        resultEl.replaceChildren(h('div', { class: 'sim-line bad' }, `计算失败: ${err.message}`));
        runBtn.removeAttribute('disabled');
        runBtn.textContent = '开始计算积雪厚度';
      };
      worker.postMessage(req);
    });

    const panel = h(
      'aside',
      { class: 'side-panel side-panel-wide' },
      h('section', { class: 'panel-section' }, h('h3', {}, '造雪机列表'), gunListEl),
      detailEl,
      settingsEl,
      h(
        'section',
        { class: 'panel-section' },
        h('h3', {}, '仿真'),
        h('label', { class: 'check-row' }, verifyToggle, '计算后双跑比对（可复现性自检）'),
        runBtn,
        resultEl,
      ),
      h(
        'section',
        { class: 'panel-section' },
        h('h3', {}, '图层'),
        h(
          'label',
          { class: 'check-row' },
          (() => {
            const c = h('input', { type: 'checkbox', checked: 'true' }) as HTMLInputElement;
            c.addEventListener('change', () => {
              showHeat = c.checked;
              refreshLayers();
            });
            return c;
          })(),
          '积雪热力图',
        ),
        h(
          'label',
          { class: 'check-row' },
          (() => {
            const c = h('input', { type: 'checkbox' }) as HTMLInputElement;
            c.addEventListener('change', () => {
              showSlope = c.checked;
              refreshLayers();
            });
            return c;
          })(),
          '坡度超标叠加',
        ),
      ),
    );

    const stage = h('div', { class: 'map-stage' }, map.canvas);
    const layout = pageLayout('造雪布点', h('div', { class: 'editor-layout' }, panel, stage), resort.name);

    renderGunList();
    renderDetail();
    requestAnimationFrame(() => {
      const rect = stage.getBoundingClientRect();
      map.resize(Math.max(320, rect.width), Math.max(320, rect.height));
      map.fitView();
    });
    const onResize = () => {
      const rect = stage.getBoundingClientRect();
      map.resize(rect.width, rect.height);
    };
    window.addEventListener('resize', onResize);

    gunsPage.cleanup = () => {
      window.removeEventListener('resize', onResize);
      worker?.terminate();
      map.destroy();
      void store.flush();
      store.dispose();
    };
    return layout;
  },
  cleanup() {},
};
