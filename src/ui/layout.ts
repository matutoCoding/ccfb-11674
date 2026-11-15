import { h } from './dom';
import { currentResortId, navigate } from './router';

const NAV = [
  { path: '/resorts', label: '雪场列表', icon: '🏔' },
  { path: '/terrain', label: '地形编辑', icon: '⛰' },
  { path: '/guns', label: '造雪布点', icon: '❄' },
  { path: '/grooming', label: '压雪路线', icon: '🚜' },
  { path: '/preview', label: '渲染预览', icon: '🎿' },
  { path: '/settings', label: '设置导出', icon: '⚙' },
];

export function pageLayout(title: string, content: HTMLElement, resortName?: string): HTMLElement {
  const id = currentResortId();
  const nav = h(
    'nav',
    { class: 'side-nav' },
    h('div', { class: 'brand' }, h('strong', {}, '雪场规划系统'), h('small', {}, 'WebGPU Terrain Studio')),
    ...NAV.map((item) => {
      const hash = item.path === '/resorts' ? '#/resorts' : `#${item.path}?id=${id ?? ''}`;
      const active = `#${window.location.hash.replace(/^#/, '').split('?')[0]}` === `#${item.path}`;
      const disabled = item.path !== '/resorts' && !id;
      const link = h(
        'a',
        {
          class: `nav-item${active ? ' active' : ''}${disabled ? ' disabled' : ''}`,
          href: disabled ? undefined : hash,
          title: disabled ? '请先在雪场列表中选择一个雪场' : item.label,
        },
        h('span', { class: 'nav-icon' }, item.icon),
        h('span', {}, item.label),
      );
      if (disabled) {
        link.addEventListener('click', (e) => e.preventDefault());
      }
      return link;
    }),
  );

  return h(
    'div',
    { class: 'app-shell' },
    nav,
    h(
      'main',
      { class: 'main-area' },
      h(
        'header',
        { class: 'page-header' },
        h('div', {}, h('h1', {}, title), resortName ? h('p', { class: 'subtitle' }, `当前雪场：${resortName}`) : null),
        id
          ? h(
              'div',
              { class: 'header-actions' },
              h(
                'button',
                {
                  class: 'btn btn-ghost',
                  onclick: () => navigate('/resorts'),
                },
                '返回列表',
              ),
            )
          : null,
      ),
      h('div', { class: 'page-body' }, content),
    ),
  );
}
