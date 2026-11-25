const memory = new WeakMap();

export function patchList(container, items, create, reset = false) {
  const previous = reset ? new Map() : memory.get(container) || new Map();
  const next = new Map();
  const fresh = [];
  const nodes = items.map(({ key, html }) => {
    const known = previous.get(key);
    const node = known && known.html === html ? known.node : create(html);
    if (node !== known?.node) fresh.push(node);
    next.set(key, { html, node });
    return node;
  });
  memory.set(container, next);
  let cursor = container.firstChild;
  for (const node of nodes) {
    if (node === cursor) cursor = cursor.nextSibling;
    else container.insertBefore(node, cursor);
  }
  while (cursor) {
    const after = cursor.nextSibling;
    container.removeChild(cursor);
    cursor = after;
  }
  return fresh;
}

export function within(node, selector) {
  return [...(node.matches?.(selector) ? [node] : []), ...(node.querySelectorAll?.(selector) || [])];
}
