export const NOT_DRAGGABLE = 'button, input, select, textarea, label, a, dialog, summary, [role=button], [contenteditable], [data-account], .account, .riot-controls, .status, #notice';

export const TOP_STRIP = 30;

export function onScrollbar(element, x, y) {
  if (!element || typeof element.clientWidth !== 'number') return false;
  const vertical = element.offsetWidth > element.clientWidth && x >= element.clientWidth;
  const horizontal = element.offsetHeight > element.clientHeight && y >= element.clientHeight;
  return vertical || horizontal;
}

export function dragSpot(event, { modal = false } = {}) {
  if (!event || modal || event.button !== 0 || event.isPrimary === false) return false;
  if (event.pointerType && event.pointerType !== 'mouse') return false;
  if (!(event.clientY >= 0 && event.clientY < TOP_STRIP)) return false;
  const target = event.target;
  if (!target || typeof target.closest !== 'function' || target.closest(NOT_DRAGGABLE)) return false;
  return !onScrollbar(target, event.offsetX, event.offsetY);
}
