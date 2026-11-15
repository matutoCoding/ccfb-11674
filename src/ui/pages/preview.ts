import { buildTrackMap } from '../../domain/grooming';
import { computeSnowDepth } from '../../domain/snow';
import { ResortStore } from '../ResortStore';
import { h, sliderField } from '../dom';
import type { Page } from '../router';
import { pageLayout } from '../layout';
import { GpuRenderer } from '../../render/GpuRenderer';
import { sunAtTime } from '../../domain/sun';
import { toHex8 } from '../../domain/util/hash';
import { hashFloat32Array } from '../../domain/util/hash';

export const previewPage: Page = {
  title: '渲染预览',
  async render(_root, params): Promise<HTMLElement> {
    const id = params.get('id');
    if (!id) throw new Error('缺少雪场 id');
    const store = await ResortStore.load(id);
    const resort = store.resort;

    const canvas = h('canvas', { class: 'gpu-canvas' }) as HTMLCanvasElement;
    const statusEl = h('div', { class: 'gpu-status' }, '正在初始化 WebGPU…');
    const stage = h('div', { class: 'gpu-stage' }, canvas, statusEl);

    // CPU 侧直接计算（页面数据即真实数据，同样走确定性引擎）
    const snowResult = computeSnowDepth({
      size: resort.size,
      cellSize: resort.cellSize,
      guns: resort.guns,
      settings: resort.snowmaking,
    });
    const { tracks } = buildTrackMap(resort.routes, resort.size);

    let renderer: GpuRenderer | null = null;
    let rafHandle = 0;
    let disposed = false;

    const render = () => {
      if (!renderer || disposed) return;
      renderer.render({
        heightmap: resort.heightmap,
        depth: snowResult.depth,
        tracks,
        guns: resort.guns,
        routes: resort.routes,
        settings: resort.render,
        cellSize: resort.cellSize,
        heightScale: resort.heightScale,
      });
    };

    const timeLabel = h('span', { class: 'slider-value' }, '');
    const updateTimeLabel = () => {
      const t = resort.render.timeOfDay;
      const hh = Math.floor(t);
      const mm = Math.round((t - hh) * 60);
      timeLabel.textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    };
    updateTimeLabel();

    const sunInfo = h('p', { class: 'hint' }, '');
    const updateSunInfo = () => {
      const sun = sunAtTime(resort.render.timeOfDay);
      sunInfo.textContent = `太阳高度角 ${sun.elevationDeg.toFixed(1)}° · ${sun.dayFactor > 0.5 ? '白昼' : '晨昏/夜间'}`;
    };
    updateSunInfo();

    const hashLine = h(
      'p',
      { class: 'hint' },
      `积雪厚度哈希: ${toHex8(hashFloat32Array(snowResult.depth))}（同输入恒定）`,
    );

    const timeSlider = h('input', {
      type: 'range',
      step: '0.25',
      min: '0',
      max: '24',
      value: String(resort.render.timeOfDay),
    }) as HTMLInputElement;
    timeSlider.addEventListener('input', () => {
      resort.render.timeOfDay = parseFloat(timeSlider.value);
      updateTimeLabel();
      updateSunInfo();
      render();
    });

    let autoTimer: ReturnType<typeof setInterval> | null = null;
    const playBtn = h('button', { class: 'btn btn-block' }, '播放一天变化');
    playBtn.addEventListener('click', () => {
      if (autoTimer) {
        clearInterval(autoTimer);
        autoTimer = null;
        playBtn.textContent = '播放一天变化';
      } else {
        playBtn.textContent = '暂停';
        autoTimer = setInterval(() => {
          resort.render.timeOfDay = (resort.render.timeOfDay + 0.25) % 24;
          timeSlider.value = String(resort.render.timeOfDay);
          updateTimeLabel();
          updateSunInfo();
          render();
        }, 120);
      }
    });

    const panel = h(
      'aside',
      { class: 'side-panel side-panel-wide' },
      h(
        'section',
        { class: 'panel-section' },
        h('h3', {}, '时间与光照'),
        h('label', { class: 'field slider-field' }, h('span', {}, '时刻'), timeSlider, timeLabel),
        sunInfo,
        playBtn,
      ),
      h(
        'section',
        { class: 'panel-section' },
        h('h3', {}, '相机'),
        sliderField('方位角', resort.render.cameraAzimuth, 1, 0, 360, (v) => {
          resort.render.cameraAzimuth = v;
          render();
        }, (v) => `${v.toFixed(0)}°`),
        sliderField('俯仰角', resort.render.cameraElevation, 1, 5, 85, (v) => {
          resort.render.cameraElevation = v;
          render();
        }, (v) => `${v.toFixed(0)}°`),
        sliderField('距离', resort.render.cameraDistance, 0.05, 0.5, 3, (v) => {
          resort.render.cameraDistance = v;
          render();
        }),
      ),
      h(
        'section',
        { class: 'panel-section' },
        h('h3', {}, '雪面材质'),
        sliderField('次表面散射', resort.render.sssStrength, 0.05, 0, 1.5, (v) => {
          resort.render.sssStrength = v;
          render();
        }),
        sliderField('闪光颗粒', resort.render.sparkleStrength, 0.05, 0, 2, (v) => {
          resort.render.sparkleStrength = v;
          render();
        }),
        sliderField('阴影冷蓝', resort.render.shadowBlue, 0.05, 0, 1.5, (v) => {
          resort.render.shadowBlue = v;
          render();
        }),
      ),
      h(
        'section',
        { class: 'panel-section' },
        h('h3', {}, '图层开关'),
        ...(
          [
            ['showSlopeOverlay', '坡度超标标红'],
            ['showTracks', '车辙纹理'],
            ['showGuns', '造雪机标记'],
            ['showRoutes', '压雪路线'],
          ] as const
        ).map(([key, label]) =>
          h(
            'label',
            { class: 'check-row' },
            (() => {
              const c = h('input', { type: 'checkbox', checked: resort.render[key] ? 'true' : undefined }) as HTMLInputElement;
              c.addEventListener('change', () => {
                resort.render[key] = c.checked;
                render();
              });
              return c;
            })(),
            label,
          ),
        ),
        h('p', { class: 'hint' }, `安全坡度阈值: ${resort.render.safeSlopeDeg}°（在设置页修改）`),
        hashLine,
      ),
    );

    // 渲染循环与尺寸管理
    const resize = () => {
      const rect = stage.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(320, Math.round(rect.width * dpr));
      canvas.height = Math.max(320, Math.round(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      render();
    };
    window.addEventListener('resize', resize);

    GpuRenderer.create(canvas, resort.size)
      .then((r) => {
        renderer = r;
        statusEl.remove();
        resize();
        rafHandle = requestAnimationFrame(function loop() {
          if (disposed) return;
          render();
          rafHandle = requestAnimationFrame(loop);
        });
      })
      .catch((e: Error) => {
        statusEl.classList.add('gpu-error');
        statusEl.replaceChildren(
          h('h3', {}, 'WebGPU 不可用'),
          h('p', {}, e.message),
          h('p', { class: 'hint' }, '请使用 Chrome / Edge 113 以上版本，并在浏览器设置中启用 WebGPU。'),
        );
      });

    const layout = pageLayout('渲染预览', h('div', { class: 'editor-layout' }, panel, stage), resort.name);

    previewPage.cleanup = () => {
      disposed = true;
      cancelAnimationFrame(rafHandle);
      if (autoTimer) clearInterval(autoTimer);
      window.removeEventListener('resize', resize);
      renderer?.destroy();
      store.dispose();
    };
    return layout;
  },
  cleanup() {},
};
