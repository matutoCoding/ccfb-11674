import type { GroomerRoute, SnowGun, Vec2 } from '../domain/types';
import { h } from '../ui/dom';

/**
 * 可平移缩放的俯视网格画布。
 * 坐标系：网格 0..size（x 向右、y 向下），画布像素通过 scale/offset 变换。
 * 各页面通过 setLayers 提供底图，通过 on* 回调处理交互，组件本身不碰领域数据。
 */

export interface MapLayer {
  canvas: HTMLCanvasElement;
  /** 叠加透明度 0..1 */
  alpha: number;
}

export interface MapPointer {
  /** 网格坐标 */
  grid: Vec2;
  /** 像素坐标 */
  px: number;
  py: number;
  button: number;
  shift: boolean;
}

export interface MapCanvasHandlers {
  onDown?: (p: MapPointer) => void;
  onMove?: (p: MapPointer) => void;
  onUp?: (p: MapPointer) => void;
  onLeave?: () => void;
  onWheel?: () => void;
}

export class MapCanvas {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private layers: MapLayer[] = [];
  private scale = 1;
  private offset: Vec2 = { x: 0, y: 0 };
  private size: number;
  private handlers: MapCanvasHandlers;
  private rafPending = false;
  private guns: SnowGun[] = [];
  private routes: GroomerRoute[] = [];
  private drawGuns = false;
  private drawRoutes = false;
  private activeRoute: Vec2[] | null = null;
  private hover: Vec2 | null = null;

  constructor(size: number, handlers: MapCanvasHandlers = {}) {
    this.size = size;
    this.handlers = handlers;
    this.canvas = h('canvas', { class: 'map-canvas' }) as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;
    this.fitView();
    this.bind();
  }

  private bind(): void {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      try {
        c.setPointerCapture(e.pointerId);
      } catch {
        // 合成事件或指针已释放时忽略，不影响业务逻辑
      }
      this.handlers.onDown?.(this.toPointer(e));
    });
    c.addEventListener('pointermove', (e) => {
      this.hover = this.toGrid(e);
      this.scheduleDraw();
      this.handlers.onMove?.(this.toPointer(e));
    });
    c.addEventListener('pointerup', (e) => this.handlers.onUp?.(this.toPointer(e)));
    c.addEventListener('pointerleave', () => {
      this.hover = null;
      this.scheduleDraw();
      this.handlers.onLeave?.();
    });
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const before = this.toGrid(e);
        const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        this.scale = Math.max(0.05, Math.min(40, this.scale * factor));
        // 以光标为锚点缩放
        const after = this.toGrid(e);
        this.offset.x += (after.x - before.x) * this.scale;
        this.offset.y += (after.y - before.y) * this.scale;
        this.scheduleDraw();
        this.handlers.onWheel?.();
      },
      { passive: false },
    );
    // 中键/右键平移
    c.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** 空白处中键/右键平移由页面调用；这里提供直接平移接口 */
  panBy(dxPx: number, dyPx: number): void {
    this.offset.x += dxPx;
    this.offset.y += dyPx;
    this.scheduleDraw();
  }

  resize(cssWidth: number, cssHeight: number): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(cssWidth * dpr);
    this.canvas.height = Math.round(cssHeight * dpr);
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.fitView(false);
    this.scheduleDraw();
  }

  fitView(reset = true): void {
    const w = this.canvas.clientWidth || 800;
    const h = this.canvas.clientHeight || 600;
    this.scale = Math.min(w, h) / this.size;
    if (reset) this.offset = { x: (w - this.size * this.scale) / 2, y: (h - this.size * this.scale) / 2 };
    this.scheduleDraw();
  }

  setLayers(layers: MapLayer[]): void {
    this.layers = layers;
    this.scheduleDraw();
  }

  setOverlays(guns: SnowGun[], routes: GroomerRoute[], opts: { guns: boolean; routes: boolean }): void {
    this.guns = guns;
    this.routes = routes;
    this.drawGuns = opts.guns;
    this.drawRoutes = opts.routes;
    this.scheduleDraw();
  }

  setActiveRoute(points: Vec2[] | null): void {
    this.activeRoute = points;
    this.scheduleDraw();
  }

  getGridFromEvent(e: PointerEvent | WheelEvent): Vec2 {
    return this.toGrid(e);
  }

  private toGrid(e: { clientX: number; clientY: number }): Vec2 {
    const rect = this.canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    return { x: (px - this.offset.x) / this.scale, y: (py - this.offset.y) / this.scale };
  }

  private toPointer(e: PointerEvent): MapPointer {
    const rect = this.canvas.getBoundingClientRect();
    return {
      grid: this.toGrid(e),
      px: e.clientX - rect.left,
      py: e.clientY - rect.top,
      button: e.button,
      shift: e.shiftKey,
    };
  }

  private scheduleDraw(): void {
    if (this.rafPending) return;
    this.rafPending = true;
    requestAnimationFrame(() => {
      this.rafPending = false;
      this.draw();
    });
  }

  private draw(): void {
    const ctx = this.ctx;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0d1420';
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(this.offset.x, this.offset.y);
    ctx.scale(this.scale, this.scale);

    // 网格边界
    ctx.strokeStyle = 'rgba(120,160,220,0.5)';
    ctx.lineWidth = 1 / this.scale;
    ctx.strokeRect(0, 0, this.size, this.size);

    for (const layer of this.layers) {
      ctx.globalAlpha = layer.alpha;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(layer.canvas, 0, 0, this.size, this.size);
    }
    ctx.globalAlpha = 1;

    if (this.drawRoutes) this.drawRoutesLayer(ctx);
    if (this.drawGuns) this.drawGunsLayer(ctx);
    if (this.hover) this.drawHover(ctx);
    ctx.restore();
  }

  private drawRoutesLayer(ctx: CanvasRenderingContext2D): void {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const route of this.routes) {
      if (route.points.length === 0) continue;
      ctx.beginPath();
      ctx.moveTo(route.points[0].x, route.points[0].y);
      for (let i = 1; i < route.points.length; i++) ctx.lineTo(route.points[i].x, route.points[i].y);
      ctx.strokeStyle = 'rgba(255,170,40,0.9)';
      ctx.lineWidth = Math.max(1.2 / this.scale, route.width * 0.35);
      ctx.stroke();
      for (const p of route.points) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(2 / this.scale, 1.2), 0, Math.PI * 2);
        ctx.fillStyle = '#ffb020';
        ctx.fill();
      }
    }
    if (this.activeRoute && this.activeRoute.length > 0) {
      ctx.beginPath();
      ctx.moveTo(this.activeRoute[0].x, this.activeRoute[0].y);
      for (let i = 1; i < this.activeRoute.length; i++) ctx.lineTo(this.activeRoute[i].x, this.activeRoute[i].y);
      ctx.strokeStyle = '#40e0ff';
      ctx.lineWidth = 2 / this.scale;
      ctx.setLineDash([6 / this.scale, 4 / this.scale]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  private drawGunsLayer(ctx: CanvasRenderingContext2D): void {
    for (const gun of this.guns) {
      const r = Math.max(3 / this.scale, 2.2);
      ctx.beginPath();
      ctx.arc(gun.x, gun.y, r, 0, Math.PI * 2);
      ctx.fillStyle = '#ff5d73';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1 / this.scale;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(gun.x, gun.y, gun.range, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,93,115,0.25)';
      ctx.stroke();
    }
  }

  private drawHover(ctx: CanvasRenderingContext2D): void {
    if (!this.hover) return;
    ctx.strokeStyle = 'rgba(80,220,255,0.6)';
    ctx.lineWidth = 1 / this.scale;
    ctx.strokeRect(Math.floor(this.hover.x) + 0.5, Math.floor(this.hover.y) + 0.5, 1, 1);
  }

  destroy(): void {
    this.canvas.replaceWith();
  }
}
