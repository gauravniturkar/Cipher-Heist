/**
 * Minimal DOM helpers.
 *
 * Everything the generator produces is player-facing text of unknown shape, so
 * this module never assigns innerHTML for case content: text goes in through
 * `textContent`, which cannot be interpreted as markup. `richText` handles the
 * one formatting affordance the lessons need - `code spans` - by building real
 * elements rather than parsing HTML.
 */

type Attributes = Record<
  string,
  string | number | boolean | undefined | null | ((event: never) => void)
>;
type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') element.className = String(value);
    else if (key === 'text') element.textContent = String(value);
    else if (key.startsWith('data-') || key.startsWith('aria-')) element.setAttribute(key, String(value));
    else if (key in element) (element as unknown as Record<string, unknown>)[key] = value;
    else element.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    element.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return element;
}

export function clear(node: HTMLElement): HTMLElement {
  node.replaceChildren();
  return node;
}

/**
 * Renders text where `backticked` spans become <code>. Written as a small
 * tokeniser rather than a regex replace into innerHTML, so nothing in the
 * generated text can ever become markup.
 */
export function richText(target: HTMLElement, text: string): HTMLElement {
  const parts = text.split('`');
  parts.forEach((part, index) => {
    if (part === '') return;
    target.append(index % 2 === 1 ? h('code', { text: part }) : document.createTextNode(part));
  });
  return target;
}

export function paragraph(text: string, className?: string): HTMLParagraphElement {
  const p = h('p', className ? { class: className } : {});
  return richText(p, text) as HTMLParagraphElement;
}

/** Screen-reader announcements for state changes that are otherwise visual. */
export function announce(message: string): void {
  let region = document.getElementById('sr-live');
  if (!region) {
    region = h('div', { id: 'sr-live', class: 'visually-hidden', 'aria-live': 'polite', 'aria-atomic': 'true' });
    document.body.append(region);
  }
  region.textContent = message;
}

let toastTimer: number | undefined;

export function toast(message: string): void {
  document.getElementById('toast')?.remove();
  const node = h('div', { id: 'toast', class: 'toast', role: 'status', text: message });
  document.body.append(node);
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => node.remove(), 2600);
}
