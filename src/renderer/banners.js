export const BANNER_SIZE = Object.freeze({ width: 280, height: 714 });
export const SHRINK_TIMEOUT = 15000;

function loadImage(url, cors) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    if (cors) image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.onerror = () => { image.onload = null; image.onerror = null; reject(new Error('load')); };
    image.onload = () => { image.onload = null; image.onerror = null; resolve(image); };
    image.src = url;
  });
}

function toBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('blob'))), 'image/png');
  });
}

export async function shrinkImage(url, size = BANNER_SIZE) {
  const image = await loadImage(url, true);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  try {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('canvas');
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, size.width, size.height);
    const small = URL.createObjectURL(await toBlob(canvas));
    try {
      await loadImage(small, false);
    } catch (error) {
      URL.revokeObjectURL(small);
      throw error;
    }
    return small;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

const isBlob = value => typeof value === 'string' && value.startsWith('blob:');

function withTimeout(promise, { wait, clear, revoke, timeout }) {
  return new Promise((resolve, reject) => {
    let late = false;
    const timer = wait(() => { late = true; reject(new Error('timeout')); }, timeout);
    promise.then(value => {
      if (late) { if (isBlob(value)) revoke(value); return; }
      clear(timer);
      resolve(value);
    }, error => {
      if (late) return;
      clear(timer);
      reject(error);
    });
  });
}

export function createBanners(shrink = shrinkImage, { wait = setTimeout, clear = clearTimeout, revoke = url => URL.revokeObjectURL(url), timeout = SHRINK_TIMEOUT } = {}) {
  const ready = new Map();
  const pending = new Map();
  const request = url => {
    if (ready.has(url)) return Promise.resolve(ready.get(url));
    if (!pending.has(url)) {
      pending.set(url, withTimeout(Promise.resolve().then(() => shrink(url)), { wait, clear, revoke, timeout })
        .then(small => (isBlob(small) ? small : url), () => url)
        .then(result => { ready.set(url, result); pending.delete(url); return result; }));
    }
    return pending.get(url);
  };
  return {
    get: url => ready.get(url) || null,
    request,
    fill(root) {
      const waiting = [];
      for (const image of root.querySelectorAll('img[data-banner]')) {
        if (image.getAttribute('src')) continue;
        const known = ready.get(image.dataset.banner);
        if (known) { image.src = known; continue; }
        waiting.push(request(image.dataset.banner).then(src => { if (image.isConnected) image.src = src; }));
      }
      return Promise.all(waiting);
    },
  };
}
