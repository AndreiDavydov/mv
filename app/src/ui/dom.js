/**
 * A hundred lines of DOM helper instead of a framework. The app has to be
 * interactive before a phone finishes a cold radio handshake, and nothing here
 * needs reconciliation — views are small and rebuilt whole.
 */

/**
 * @param {string} tag  `div`, `button.primary`, `span#id.a.b`
 * @param {object|null} [props]  attributes; `on*` are listeners, `style` takes
 *   an object, `class` may be a string, array or {name: boolean} map
 */
export function h(tag, props = null, ...children) {
  const [, name = 'div', rest = ''] = /^([a-z0-9-]*)(.*)$/i.exec(tag) ?? [];
  const node = document.createElement(name);

  for (const token of rest.match(/[.#][^.#]+/g) ?? []) {
    if (token[0] === '#') node.id = token.slice(1);
    else node.classList.add(token.slice(1));
  }

  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (key === 'class') node.classList.add(...classNames(value));
    else if (key === 'style' && typeof value === 'object') applyStyle(node, value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key in node && key !== 'list' && typeof value !== 'boolean') node[key] = value;
    else node.setAttribute(key, value === true ? '' : value);
  }

  append(node, children);
  return node;
}

export function append(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  node.replaceChildren();
  return node;
}

/**
 * `Object.assign(node.style, …)` silently drops custom properties — assigning
 * `--depth` sets an expando on the CSSStyleDeclaration and nothing reaches CSS.
 * Anything starting with `--` has to go through setProperty.
 */
function applyStyle(node, style) {
  for (const [key, value] of Object.entries(style)) {
    if (value == null) continue;
    if (key.startsWith('--')) node.style.setProperty(key, String(value));
    else node.style[key] = value;
  }
}

function classNames(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'object') return Object.entries(value).filter(([, on]) => on).map(([k]) => k);
  return String(value).split(/\s+/).filter(Boolean);
}

/** `2 items` / `1 item` without an if-statement at every call site. */
export function plural(count, one, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

const RELATIVE = [
  [60_000, 'just now', null],
  [3_600_000, 'm ago', 60_000],
  [86_400_000, 'h ago', 3_600_000],
  [2_592_000_000, 'd ago', 86_400_000],
];

export function timeAgo(ts, now = Date.now()) {
  const delta = Math.max(0, now - ts);
  for (const [limit, suffix, unit] of RELATIVE) {
    if (delta < limit) return unit ? `${Math.floor(delta / unit)}${suffix}` : suffix;
  }
  return new Date(ts).toLocaleDateString();
}
