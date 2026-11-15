import type { GroomerRoute, Vec2 } from '../../domain/types';
import { makeId } from '../../domain/types';
import { renderRelief, renderTrackOverlay } from '../../editor/relief';
import { MapCanvas } from '../../editor/MapCanvas';
import { buildTrackMap, routeLength } from '../../domain/grooming';
import { ResortStore } from '../ResortStore';
import { h, numberField, toast } from '../dom';
import type { Page } from '../router';
import { pageLayout } from '../layout';

export const groomingPage: Page = {
  title: '压雪路线',
  async render(_root, params): Promise<HTMLElement> {
    const id = params.get('id');
    if (!id) throw new Error('缺少雪场 id');
    const store = await ResortStore.load(id);
    const resort = store.resort;

    const relief = renderRelief(resort.heightmap, resort.size);
    let trackResult = buildTrackMap(resort.routes, resort.size);
    let trackLayer = renderTrackOverlay(trackResult.tracks, resort.size);
    const map = new MapCanvas(resort.size);
    let showTracks = true;

    let selectedId: string | null = resort.routes[0]?.id ?? null;
    /** 正在绘制的临时折线 */
    let draft: Vec2[] = [];
    let drawing = false;

    function selectedRoute(): GroomerRoute | undefined {
      return resort.routes.find((r) => r.id === selectedId);
    }

    function refreshLayers(): void {
      const layers = [{ canvas: relief, alpha: 1 }];
      if (showTracks) layers.push({ canvas: trackLayer, alpha: 0.9 });
      map.setLayers(layers);
      map.setOverlays(resort.guns, resort.routes, { guns: false, routes: true });
      map.setActiveRoute(drawing ? draft : null);
    }
    refreshLayers();

    const routeListEl = h('div', { class: 'item-list' });
    const detailEl = h('div', { class: 'panel-section' });
    const trackStatEl = h('div', { class: 'sim-result' });

    function renderTrackStats(): void {
      trackStatEl.replaceChildren(
        h('div', { class: 'sim-line' }, `碾压覆盖: ${trackResult.coveredRatio.toFixed(2)}% 格点`),
        h('div', { class: 'sim-line' }, `路线总长: ${(totalRouteLength() * resort.cellSize).toFixed(1)} m`),
      );
    }

    function totalRouteLength(): number {
      return resort.routes.reduce((sum, r) => sum + routeLength(r), 0);
    }

    function rebuildTracks(): void {
      trackResult = buildTrackMap(resort.routes, resort.size);
      trackLayer = renderTrackOverlay(trackResult.tracks, resort.size);
      renderTrackStats();
      refreshLayers();
    }

    function renderRouteList(): void {
      routeListEl.replaceChildren();
      if (resort.routes.length === 0) {
        routeListEl.append(h('p', { class: 'hint' }, '点击「开始绘制」后在地图上逐点画线'));
      }
      for (const route of resort.routes) {
        const item = h(
          'div',
          { class: `list-item${route.id === selectedId ? ' selected' : ''}` },
          h('div', { class: 'list-item-main' }, h('strong', {}, route.name), h('small', {}, `${route.points.length} 点 · ${(routeLength(route) * resort.cellSize).toFixed(0)} m`)),
          h(
            'button',
            {
              class: 'btn btn-mini btn-danger',
              onclick: () => {
                resort.routes = resort.routes.filter((r) => r.id !== route.id);
                if (selectedId === route.id) selectedId = resort.routes[0]?.id ?? null;
                store.markChanged();
                renderRouteList();
                renderDetail();
                rebuildTracks();
              },
            },
            '删',
          ),
        );
        item.addEventListener('click', () => {
          selectedId = route.id;
          renderRouteList();
          renderDetail();
        });
        routeListEl.append(item);
      }
    }

    function renderDetail(): void {
      detailEl.replaceChildren();
      const route = selectedRoute();
      if (!route) {
        detailEl.append(h('p', { class: 'hint' }, '未选中路线'));
        return;
      }
      detailEl.append(
        h('h3', {}, route.name),
        (() => {
          const nameInput = h('input', { class: 'input', type: 'text', value: route.name }) as HTMLInputElement;
          nameInput.addEventListener('change', () => {
            route.name = nameInput.value.trim() || route.name;
            store.markChanged();
            renderRouteList();
          });
          return h('label', { class: 'field' }, h('span', {}, '路线名称'), nameInput);
        })(),
        numberField('作业宽度 (格)', route.width, 0.5, 1, 60, (v) => {
          route.width = v;
          store.markChanged();
          rebuildTracks();
        }),
        h(
          'button',
          {
            class: 'btn',
            onclick: () => {
              if (route.points.length < 2) return toast('至少需要两个点', 'error');
              route.points.pop();
              store.markChanged();
              renderDetail();
              rebuildTracks();
            },
          },
          '撤销最后一个点',
        ),
      );
    }

    // ---- 绘制交互 ----
    const drawBtn = h('button', { class: 'btn btn-primary' }, '开始绘制');
    const finishBtn = h('button', { class: 'btn', disabled: 'true' }, '完成路线');
    let nameSeq = resort.routes.length;

    drawBtn.addEventListener('click', () => {
      drawing = true;
      draft = [];
      nameSeq += 1;
      drawBtn.setAttribute('disabled', 'true');
      finishBtn.removeAttribute('disabled');
      map.canvas.classList.add('drawing-cursor');
      refreshLayers();
      toast('单击添加节点，双击或点「完成路线」结束', 'info');
    });

    finishBtn.addEventListener('click', finishDraft);

    function finishDraft(): void {
      if (!drawing) return;
      drawing = false;
      map.canvas.classList.remove('drawing-cursor');
      drawBtn.removeAttribute('disabled');
      finishBtn.setAttribute('disabled', 'true');
      if (draft.length >= 2) {
        const route: GroomerRoute = {
          id: makeId(),
          name: `路线 ${nameSeq + 1}`,
          points: draft.map((p) => ({ ...p })),
          width: 6,
        };
        resort.routes.push(route);
        selectedId = route.id;
        store.markChanged();
        renderRouteList();
        renderDetail();
        rebuildTracks();
        toast('路线已保存，车辙已更新', 'ok');
      } else {
        toast('点数不足，已取消', 'error');
      }
      draft = [];
      refreshLayers();
    }

    map.canvas.addEventListener('pointerdown', (e) => {
      if (!drawing || e.button !== 0) return;
      const p = map.getGridFromEvent(e);
      const gx = Math.max(0, Math.min(resort.size - 1, p.x));
      const gy = Math.max(0, Math.min(resort.size - 1, p.y));
      draft.push({ x: gx, y: gy });
      refreshLayers();
    });
    map.canvas.addEventListener('dblclick', () => {
      if (drawing) finishDraft();
    });

    const panel = h(
      'aside',
      { class: 'side-panel side-panel-wide' },
      h('section', { class: 'panel-section' }, h('h3', {}, '路线列表'), routeListEl),
      detailEl,
      h(
        'section',
        { class: 'panel-section' },
        h('h3', {}, '绘制'),
        h('div', { class: 'btn-row' }, drawBtn, finishBtn),
        h(
          'label',
          { class: 'check-row' },
          (() => {
            const c = h('input', { type: 'checkbox', checked: 'true' }) as HTMLInputElement;
            c.addEventListener('change', () => {
              showTracks = c.checked;
              refreshLayers();
            });
            return c;
          })(),
          '显示车辙纹理',
        ),
      ),
      h('section', { class: 'panel-section' }, h('h3', {}, '作业统计'), trackStatEl),
    );

    const stage = h('div', { class: 'map-stage' }, map.canvas);
    const layout = pageLayout('压雪路线', h('div', { class: 'editor-layout' }, panel, stage), resort.name);

    renderRouteList();
    renderDetail();
    renderTrackStats();
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

    groomingPage.cleanup = () => {
      window.removeEventListener('resize', onResize);
      map.destroy();
      void store.flush();
      store.dispose();
    };
    return layout;
  },
  cleanup() {},
};
