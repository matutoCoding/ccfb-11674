/** 极简 DOM 构建辅助，避免引入框架 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | undefined | EventListenerOrEventListenerObject> = {},
  ...children: (Node | string | undefined | null | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === 'class') {
      el.className = String(v);
    } else if (k === 'value') {
      (el as HTMLInputElement).value = String(v);
    } else {
      el.setAttribute(k, String(v));
    }
  }
  for (const child of children) {
    if (child === undefined || child === null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function clear(el: HTMLElement): void {
  el.replaceChildren();
}

export function mount(root: HTMLElement, node: Node): () => void {
  root.replaceChildren(node);
  return () => root.replaceChildren();
}

/** 数字输入框，返回 label+input 行 */
export function numberField(
  label: string,
  value: number,
  step: number,
  min: number,
  max: number,
  onChange: (v: number) => void,
): HTMLLabelElement {
  const input = h('input', {
    type: 'number',
    step: String(step),
    min: String(min),
    max: String(max),
    value: String(value),
  });
  input.addEventListener('change', () => {
    const v = parseFloat(input.value);
    if (Number.isFinite(v)) onChange(Math.max(min, Math.min(max, v)));
  });
  return h('label', { class: 'field' }, h('span', {}, label), input);
}

export function sliderField(
  label: string,
  value: number,
  step: number,
  min: number,
  max: number,
  onChange: (v: number) => void,
  format: (v: number) => string = (v) => v.toFixed(2),
): HTMLLabelElement {
  const valueEl = h('span', { class: 'slider-value' }, format(value));
  const input = h('input', { type: 'range', step: String(step), min: String(min), max: String(max), value: String(value) });
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    valueEl.textContent = format(v);
    onChange(v);
  });
  return h('label', { class: 'field slider-field' }, h('span', {}, label), input, valueEl);
}

export function toast(message: string, kind: 'info' | 'error' | 'ok' = 'info'): void {
  const el = h('div', { class: `toast toast-${kind}` }, message);
  document.body.append(el);
  setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, 2600);
}
