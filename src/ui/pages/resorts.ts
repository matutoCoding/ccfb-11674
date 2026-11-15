import { cloneResort, createResort } from '../../domain/factory';
import { deleteResort, listResorts, putResort } from '../../storage/idb';
import { downloadJson, readImportFile, exportResortNow } from '../../storage/exportImport';
import { h, toast } from '../dom';
import { navigate, type Page } from '../router';
import { pageLayout } from '../layout';

export const resortsPage: Page = {
  title: '雪场列表',
  async render(_root): Promise<HTMLElement> {
    const content = h('div', { class: 'resorts-page' });
    const grid = h('div', { class: 'card-grid' });
    content.append(
      h(
        'div',
        { class: 'toolbar' },
        h('h2', {}, '我的雪场'),
        h(
          'div',
          { class: 'toolbar-right' },
          (() => {
            const sizeSelect = h(
              'select',
              { class: 'input' },
              h('option', { value: '256' }, '256 × 256（快速测试）'),
              h('option', { value: '512' }, '512 × 512'),
              h('option', { value: '1024', selected: 'true' }, '1024 × 1024（标准）'),
            ) as HTMLSelectElement;
            const nameInput = h('input', {
              class: 'input',
              type: 'text',
              placeholder: '新雪场名称',
              value: `雪场 ${new Date().toLocaleDateString('zh-CN')}`,
            }) as HTMLInputElement;
            const createBtn = h('button', { class: 'btn btn-primary' }, '＋ 新建雪场');
            createBtn.addEventListener('click', async () => {
              const name = nameInput.value.trim() || '未命名雪场';
              const size = parseInt(sizeSelect.value, 10);
              const resort = createResort(name, size);
              await putResort(resort);
              toast(`已创建「${name}」`, 'ok');
              navigate(`/terrain?id=${resort.id}`);
            });
            const importInput = h('input', { type: 'file', accept: '.json,application/json', hidden: 'true' }) as HTMLInputElement;
            importInput.addEventListener('change', async () => {
              const file = importInput.files?.[0];
              if (!file) return;
              try {
                const resort = await readImportFile(file);
                resort.id = crypto.randomUUID();
                resort.name = `${resort.name}（导入）`;
                resort.updatedAt = Date.now();
                await putResort(resort);
                toast('导入成功', 'ok');
                void refresh();
              } catch (e) {
                toast((e as Error).message, 'error');
              }
              importInput.value = '';
            });
            const importBtn = h('button', { class: 'btn' }, '导入 JSON');
            importBtn.addEventListener('click', () => importInput.click());
            return h('div', { class: 'toolbar-right' }, nameInput, sizeSelect, createBtn, importBtn, importInput);
          })(),
        ),
      ),
      grid,
    );

    async function refresh(): Promise<void> {
      const resorts = await listResorts();
      resorts.sort((a, b) => b.updatedAt - a.updatedAt);
      grid.replaceChildren();
      if (resorts.length === 0) {
        grid.append(h('div', { class: 'empty-state' }, '还没有雪场，点击右上角「新建雪场」开始规划。'));
        return;
      }
      for (const resort of resorts) {
        const card = h(
          'div',
          { class: 'card resort-card' },
          h('h3', {}, resort.name),
          h(
            'dl',
            { class: 'meta-list' },
            h('dt', {}, '网格'),
            h('dd', {}, `${resort.size} × ${resort.size}`),
            h('dt', {}, '造雪机'),
            h('dd', {}, String(resort.guns.length)),
            h('dt', {}, '压雪路线'),
            h('dd', {}, String(resort.routes.length)),
            h('dt', {}, '更新时间'),
            h('dd', {}, new Date(resort.updatedAt).toLocaleString('zh-CN')),
          ),
          h(
            'div',
            { class: 'card-actions' },
            h(
              'button',
              {
                class: 'btn btn-primary',
                onclick: () => navigate(`/terrain?id=${resort.id}`),
              },
              '打开',
            ),
            h(
              'button',
              {
                class: 'btn',
                onclick: () => navigate(`/preview?id=${resort.id}`),
              },
              '预览',
            ),
            h(
              'button',
              {
                class: 'btn',
                onclick: async () => {
                  const copy = cloneResort(resort, `${resort.name} 副本`);
                  await putResort(copy);
                  toast('复制完成', 'ok');
                  void refresh();
                },
              },
              '复制',
            ),
            h(
              'button',
              {
                class: 'btn',
                onclick: () => {
                  downloadJson(`${resort.name.replace(/[\\/:*?"<>|]/g, '_')}.json`, exportResortNow(resort));
                  toast('已导出 JSON', 'ok');
                },
              },
              '导出',
            ),
            h(
              'button',
              {
                class: 'btn btn-danger',
                onclick: async () => {
                  if (!window.confirm(`确认删除雪场「${resort.name}」？此操作不可恢复。`)) return;
                  await deleteResort(resort.id);
                  toast('已删除', 'ok');
                  void refresh();
                },
              },
              '删除',
            ),
          ),
        );
        grid.append(card);
      }
    }

    await refresh();
    return pageLayout('雪场列表', content);
  },
};
