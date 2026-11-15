import type { BrushMode } from '../../domain/terrain';
import { applyBrush, generateProcedural, stampLine, type ProceduralParams } from '../../domain/terrain';
import { sampleHeight } from '../../domain/terrain';
import { renderRelief } from '../../editor/relief';
import { MapCanvas } from '../../editor/MapCanvas';
import { ResortStore } from '../ResortStore';
import { h, numberField, sliderField, toast } from '../dom';
import type { Page } from '../router';
import { pageLayout } from '../layout';

interface ToolState {
  mode: BrushMode;
  radius: number;
  strength: number;
  flattenTarget: number;
}

export const terrainPage: Page = {
  title: '地形编辑',
  async render(_root, params): Promise<HTMLElement> {
    const id = params.get('id');
    if (!id) throw new Error('缺少雪场 id');
    const store = await ResortStore.load(id);
    const resort = store.resort;

    const tool: ToolState = {
      mode: 'raise',
      radius: Math.round(resort.size * 0.03),
      strength: 0.6,
      flattenTarget: 0,
    };
    let reliefCanvas = renderRelief(resort.heightmap, resort.size);
    let lastPoint: { x: number; y: number } | null = null;
    let painting = false;
    let panning = false;
    let panLast: { x: number; y: number } | null = null;
    let rafQueued = false;

    const map = new MapCanvas(resort.size);
    map.setLayers([{ canvas: reliefCanvas, alpha: 1 }]);

    const heightReadout = h('span', { class: 'readout' }, '高度: —');
    const coordReadout = h('span', { class: 'readout' }, '坐标: —');
    const saveState = h('span', { class: 'save-state' }, '已保存');

    const scheduleRelief = () => {
      if (rafQueued) return;
      rafQueued = true;
      requestAnimationFrame(() => {
        rafQueued = false;
        reliefCanvas = renderRelief(resort.heightmap, resort.size);
        map.setLayers([{ canvas: reliefCanvas, alpha: 1 }]);
      });
    };

    const stampAt = (gx: number, gy: number) => {
      if (tool.mode === 'flatten') {
        applyBrush(resort.heightmap, resort.size, {
          cx: gx,
          cy: gy,
          radius: tool.radius,
          strength: tool.strength,
          mode: 'flatten',
          flattenTarget: tool.flattenTarget,
        });
      } else {
        applyBrush(resort.heightmap, resort.size, {
          cx: gx,
          cy: gy,
          radius: tool.radius,
          strength: tool.strength,
          mode: tool.mode,
        });
      }
    };

    // MapCanvas 自带的回调为空，这里直接在 canvas 上绑定编辑交互
    const canvasEl = map.canvas;
    canvasEl.addEventListener('pointerdown', (e) => {
      const p = map.getGridFromEvent(e);
      if (e.button === 1 || e.button === 2 || e.shiftKey) {
        panning = true;
        panLast = { x: e.clientX, y: e.clientY };
        return;
      }
      if (e.button !== 0) return;
      painting = true;
      if (tool.mode === 'flatten') {
        tool.flattenTarget = sampleHeight(resort.heightmap, resort.size, p.x, p.y);
      }
      stampAt(p.x, p.y);
      lastPoint = p;
      scheduleRelief();
      saveState.textContent = '编辑中…';
    });
    canvasEl.addEventListener('pointermove', (e) => {
      const p = map.getGridFromEvent(e);
      coordReadout.textContent = `坐标: ${p.x.toFixed(1)}, ${p.y.toFixed(1)}`;
      heightReadout.textContent = `高度: ${(
        sampleHeight(resort.heightmap, resort.size, p.x, p.y) * resort.heightScale
      ).toFixed(2)} m`;
      if (panning && panLast) {
        map.panBy(e.clientX - panLast.x, e.clientY - panLast.y);
        panLast = { x: e.clientX, y: e.clientY };
        return;
      }
      if (!painting) return;
      if (lastPoint) {
        stampLine(resort.heightmap, resort.size, lastPoint, p, {
          radius: tool.radius,
          strength: tool.strength,
          mode: tool.mode,
          flattenTarget: tool.flattenTarget,
        });
      } else {
        stampAt(p.x, p.y);
      }
      lastPoint = p;
      scheduleRelief();
    });
    const endStroke = () => {
      if (painting) {
        painting = false;
        lastPoint = null;
        store.markChanged();
        void store.flush().then(() => (saveState.textContent = '已保存'));
      }
      panning = false;
      panLast = null;
    };
    canvasEl.addEventListener('pointerup', endStroke);
    canvasEl.addEventListener('pointercancel', endStroke);

    const modeButtons = (['raise', 'lower', 'smooth', 'flatten'] as BrushMode[]).map((mode) => {
      const labels: Record<BrushMode, string> = {
        raise: '抬升',
        lower: '压低',
        smooth: '平滑',
        flatten: '推平',
      };
      const btn = h('button', { class: `btn tool-btn${mode === tool.mode ? ' active' : ''}` }, labels[mode]);
      btn.addEventListener('click', () => {
        tool.mode = mode;
        for (const b of modeButtons) b.classList.remove('active');
        btn.classList.add('active');
      });
      return btn;
    });

    const panel = h(
      'aside',
      { class: 'side-panel' },
      h('section', { class: 'panel-section' }, h('h3', {}, '笔刷工具'), h('div', { class: 'btn-row' }, ...modeButtons)),
      h(
        'section',
        { class: 'panel-section' },
        sliderField('笔刷半径', tool.radius, 1, 2, resort.size * 0.15, (v) => (tool.radius = v), (v) => v.toFixed(0)),
        sliderField('强度', tool.strength, 0.05, 0.05, 1, (v) => (tool.strength = v)),
      ),
      h(
        'section',
        { class: 'panel-section' },
        h('h3', {}, '程序化地形'),
        (() => {
          const params: ProceduralParams = {
            seed: 20261116,
            baseFrequency: 3,
            octaves: 5,
            lacunarity: 2.0,
            gain: 0.5,
            amplitude: 0.5,
          };
          const regen = h('button', { class: 'btn' }, '按参数重新生成（覆盖当前）');
          regen.addEventListener('click', () => {
            if (!window.confirm('重新生成会覆盖当前高度图，确定继续？')) return;
            resort.heightmap.set(generateProcedural(resort.size, params));
            scheduleRelief();
            store.markChanged();
            toast('地形已重新生成', 'ok');
          });
          return h(
            'div',
            {},
            numberField('随机种子', params.seed, 1, 1, 2 ** 31 - 1, (v) => (params.seed = v)),
            sliderField('基础频率', params.baseFrequency, 0.5, 1, 10, (v) => (params.baseFrequency = v), (v) => v.toFixed(1)),
            numberField('八度层数', params.octaves, 1, 1, 8, (v) => (params.octaves = Math.round(v))),
            sliderField('振幅', params.amplitude, 0.05, 0.1, 1.5, (v) => (params.amplitude = v)),
            regen,
          );
        })(),
      ),
      h(
        'section',
        { class: 'panel-section' },
        h('h3', {}, '视图'),
        h('button', { class: 'btn', onclick: () => map.fitView() }, '重置视图'),
        h('p', { class: 'hint' }, '左键编辑 · Shift/右键/中键平移 · 滚轮缩放'),
      ),
    );

    const stage = h('div', { class: 'map-stage' }, map.canvas, h('div', { class: 'hud' }, coordReadout, heightReadout, saveState));

    const layout = pageLayout('地形编辑', h('div', { class: 'editor-layout' }, panel, stage), resort.name);

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

    terrainPage.cleanup = () => {
      window.removeEventListener('resize', onResize);
      map.destroy();
      void store.flush();
      store.dispose();
    };
    return layout;
  },
  cleanup() {},
};
