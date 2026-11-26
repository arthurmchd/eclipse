const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { RENDERER_DIR } = require('../../src/paths');

const load = (file) => import(pathToFileURL(path.join(RENDERER_DIR, file)).href);

function container() {
  const children = [];
  const box = {
    children,
    get firstChild() { return children[0] || null; },
    insertBefore(node, before) {
      const at = children.indexOf(node);
      if (at >= 0) children.splice(at, 1);
      const index = before ? children.indexOf(before) : children.length;
      children.splice(index, 0, node);
      node.parent = box;
    },
    removeChild(node) { children.splice(children.indexOf(node), 1); node.parent = null; },
  };
  return box;
}

function factory() {
  const made = [];
  const create = html => {
    const node = { html, parent: null, get nextSibling() { const list = this.parent?.children || []; return list[list.indexOf(this) + 1] || null; } };
    made.push(node);
    return node;
  };
  return { made, create };
}

const htmls = box => box.children.map(node => node.html);

test('only the cards whose markup changed are created again; the others keep their element', async () => {
  const { patchList } = await load('cardPatch.js');
  const box = container();
  const { made, create } = factory();
  const first = patchList(box, [{ key: 'a', html: 'A1' }, { key: 'b', html: 'B1' }, { key: 'c', html: 'C1' }], create);
  assert.equal(first.length, 3);
  const [a, b, c] = box.children;
  const second = patchList(box, [{ key: 'a', html: 'A1' }, { key: 'b', html: 'B2' }, { key: 'c', html: 'C1' }], create);
  assert.equal(made.length, 4);
  assert.deepEqual(second.map(node => node.html), ['B2']);
  assert.equal(box.children[0], a);
  assert.notEqual(box.children[1], b);
  assert.equal(box.children[2], c);
  assert.deepEqual(htmls(box), ['A1', 'B2', 'C1']);
});

test('reordering and filtering move or drop the existing elements without creating new ones', async () => {
  const { patchList } = await load('cardPatch.js');
  const box = container();
  const { made, create } = factory();
  patchList(box, [{ key: 'a', html: 'A' }, { key: 'b', html: 'B' }, { key: 'c', html: 'C' }], create);
  const [a, b, c] = box.children;
  assert.deepEqual(patchList(box, [{ key: 'c', html: 'C' }, { key: 'a', html: 'A' }, { key: 'b', html: 'B' }], create), []);
  assert.deepEqual(box.children, [c, a, b]);
  assert.deepEqual(patchList(box, [{ key: 'b', html: 'B' }], create), []);
  assert.deepEqual(box.children, [b]);
  assert.equal(made.length, 3);
  patchList(box, [{ key: 'b', html: 'B' }, { key: 'a', html: 'A' }], create);
  assert.equal(made.length, 4);
  assert.notEqual(box.children[1], a);
});

test('a reset, used when the game tab or the layout changes, creates every card again', async () => {
  const { patchList } = await load('cardPatch.js');
  const box = container();
  const { made, create } = factory();
  patchList(box, [{ key: 'a', html: 'A' }, { key: 'b', html: 'B' }], create);
  const fresh = patchList(box, [{ key: 'a', html: 'A' }, { key: 'b', html: 'B' }], create, true);
  assert.equal(fresh.length, 2);
  assert.equal(made.length, 4);
  assert.deepEqual(htmls(box), ['A', 'B']);
  assert.equal(box.children.length, 2);
});

test('within finds the element itself and its descendants that match', async () => {
  const { within } = await load('cardPatch.js');
  const child = { id: 'child' };
  const node = { matches: selector => selector === '[data-tier]', querySelectorAll: () => [child] };
  assert.deepEqual(within(node, '[data-tier]'), [node, child]);
  assert.deepEqual(within({ matches: () => false, querySelectorAll: () => [] }, '[data-tier]'), []);
  assert.deepEqual(within({}, '[data-tier]'), []);
});
