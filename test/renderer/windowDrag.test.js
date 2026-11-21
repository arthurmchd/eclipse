const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { RENDERER_DIR } = require('../../src/paths');

const load = () => import(pathToFileURL(path.join(RENDERER_DIR, 'windowDrag.js')).href);

function element(matches = [], size = {}) {
  return { closest: (selector) => (matches.some((name) => selector.split(', ').includes(name)) ? {} : null), clientWidth: 600, offsetWidth: 600, clientHeight: 400, offsetHeight: 400, ...size };
}
const press = (target, extra = {}) => ({ button: 0, isPrimary: true, pointerType: 'mouse', target, offsetX: 10, offsetY: 10, ...extra });

test('a press on empty space of the cards page starts the Riot drag', async () => {
  const { dragSpot } = await load();
  assert.equal(dragSpot(press(element())), true);
});

test('controls, cards, the Riot control copies and dialogs keep their own press', async () => {
  const { dragSpot } = await load();
  for (const name of ['button', 'input', 'select', 'textarea', 'label', 'a', 'dialog', '[role=button]', '[data-account]', '.account', '.riot-controls']) {
    assert.equal(dragSpot(press(element([name]))), false, name);
  }
  assert.equal(dragSpot(press(element()), { modal: true }), false);
});

test('only the primary mouse button starts it', async () => {
  const { dragSpot } = await load();
  assert.equal(dragSpot(press(element(), { button: 2 })), false);
  assert.equal(dragSpot(press(element(), { isPrimary: false })), false);
  assert.equal(dragSpot(press(element(), { pointerType: 'touch' })), false);
  assert.equal(dragSpot(press(element(), { pointerType: 'pen' })), false);
  assert.equal(dragSpot(press(null)), false);
  assert.equal(dragSpot(press({})), false);
  assert.equal(dragSpot(null), false);
});

test('a press on a scroll bar scrolls instead of dragging', async () => {
  const { dragSpot, onScrollbar } = await load();
  const list = element([], { clientWidth: 590, offsetWidth: 600 });
  assert.equal(dragSpot(press(list, { offsetX: 595 })), false);
  assert.equal(dragSpot(press(list, { offsetX: 100 })), true);
  const wide = element([], { clientHeight: 390, offsetHeight: 400 });
  assert.equal(onScrollbar(wide, 10, 395), true);
  assert.equal(onScrollbar(wide, 10, 100), false);
  assert.equal(onScrollbar(null, 0, 0), false);
});
