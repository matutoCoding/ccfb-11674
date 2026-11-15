import { h, mount } from './dom';

/**
 * hash 路由：#/resorts、#/terrain?id=... 等。
 * 页面模块实现 Page 接口，切换时调用 cleanup 释放画布与事件。
 */
export interface Page {
  title: string;
  render(root: HTMLElement, params: URLSearchParams): Promise<HTMLElement> | HTMLElement;
  cleanup?(): void;
}

const pages = new Map<string, Page>();
let currentCleanup: (() => void) | null = null;

export function registerRoute(path: string, page: Page): void {
  pages.set(path, page);
}

export function navigate(hash: string): void {
  window.location.hash = hash;
}

export function currentResortId(): string | null {
  return new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('id');
}

export async function startRouter(app: HTMLElement): Promise<void> {
  const onRoute = async (): Promise<void> => {
    currentCleanup?.();
    currentCleanup = null;
    const raw = window.location.hash.replace(/^#/, '') || '/resorts';
    const [path, query] = raw.split('?');
    const page = pages.get(path) ?? pages.get('/resorts')!;
    const params = new URLSearchParams(query ?? '');
    document.title = `${page.title} · 雪场规划系统`;
    try {
      const node = await page.render(app, params);
      const unmount = mount(app, node);
      currentCleanup = () => {
        page.cleanup?.();
        unmount();
      };
    } catch (e) {
      mount(
        app,
        h('div', { class: 'page-error' }, h('h2', {}, '页面加载失败'), h('pre', {}, (e as Error).message)),
      );
    }
  };
  window.addEventListener('hashchange', onRoute);
  await onRoute();
}
