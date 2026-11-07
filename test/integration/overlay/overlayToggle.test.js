const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { execFile } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { createOverlayToggle, toggleRect, CHANNEL, LANGUAGE_CHANNEL, HIDDEN_CHANNEL } = require('../../../src/integration/overlay/overlayToggle');
const { OVERLAY_TOGGLE_FILE, OVERLAY_TOGGLE_PRELOAD_FILE, PROJECT_ROOT } = require('../../../src/paths');

function fixture(options = {}) {
  const handlers = new Map(), changes = [], views = [], sent = [];
  const parent = new EventEmitter();
  let size = [1536, 864];
  parent.isDestroyed = () => false;
  parent.getContentSize = () => size;
  parent.contentView = { children: [], addChildView(view) { this.children.push(view); } };
  class FakeView {
    constructor(options) {
      this.options = options; this.visibility = []; views.push(this);
      const contents = this.webContents = new EventEmitter();
      contents.isDestroyed = () => Boolean(contents.closed);
      contents.getURL = () => contents.url || '';
      contents.loadFile = async (file) => { contents.file = file; contents.url = pathToFileURL(file).href; contents.mainFrame = { url: contents.url }; };
      contents.close = () => { contents.closed = true; };
      contents.send = (channel, value) => sent.push([channel, value]);
      contents.setWindowOpenHandler = (callback) => { contents.openHandler = callback; };
      contents.session = { setPermissionRequestHandler: (callback) => { contents.permission = callback; }, setPermissionCheckHandler: (callback) => { contents.permissionCheck = callback; } };
    }
    setBackgroundColor(color) { this.background = color; }
    setBounds(bounds) { this.bounds = bounds; }
    setVisible(visible) { this.visibility.push(visible); }
  }
  const electron = { WebContentsView: FakeView, ipcMain: { handle: (name, fn) => handlers.set(name, fn), removeHandler: (name) => handlers.delete(name) } };
  const toggle = createOverlayToggle({ electron, onChange: (value) => changes.push(value), ...options });
  const event = () => ({ sender: views[0].webContents, senderFrame: views[0].webContents.mainFrame });
  return { toggle, parent, views, handlers, changes, sent, event, resize(width, height) { size = [width, height]; parent.emit('resize'); } };
}

test('the toggle area sits right of the Stay signed in label and scales with the Riot window', () => {
  assert.deepEqual(toggleRect({ width: 1536, height: 864 }), { x: 200, y: 418, width: 144, height: 32 });
  assert.deepEqual(toggleRect({ width: 768, height: 432 }), { x: 100, y: 209, width: 72, height: 16 });
  const small = toggleRect({ width: 1, height: 1 });
  assert.ok(small.width >= 1 && small.height >= 1);
});

test('the toggle is an isolated view over the login column that only reports a boolean from its own page', async () => {
  const f = fixture();
  await f.toggle.open(f.parent);
  const [view] = f.views;
  assert.equal(f.parent.contentView.children[0], view);
  assert.equal(view.webContents.file, OVERLAY_TOGGLE_FILE);
  assert.deepEqual(view.options.webPreferences, { preload: OVERLAY_TOGGLE_PRELOAD_FILE, contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, partition: 'ram-overlay-toggle' });
  assert.equal(view.background, '#00000000');
  assert.deepEqual(view.bounds, { x: 200, y: 418, width: 144, height: 32 });
  f.resize(1280, 720);
  assert.deepEqual(view.bounds, toggleRect({ width: 1280, height: 720 }));
  assert.deepEqual(view.webContents.openHandler(), { action: 'deny' });
  let prevented = false;
  view.webContents.emit('will-navigate', { preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  let allowed;
  view.webContents.permission(null, 'media', (value) => { allowed = value; });
  assert.equal(allowed, false);
  const handler = f.handlers.get(CHANNEL);
  assert.equal(await handler(f.event(), true), true);
  assert.equal(await handler(f.event(), false), false);
  for (const value of ['true', 1, null, undefined]) assert.throws(() => handler(f.event(), value), /Invalid toggle command/);
  assert.throws(() => handler({ sender: {}, senderFrame: {} }, true), /Invalid toggle command/);
  assert.deepEqual(f.changes, [true, false]);
  await f.toggle.open(f.parent);
  assert.equal(f.views.length, 1);
  f.toggle.dispose();
  assert.equal(f.handlers.has(CHANNEL), false);
  assert.equal(view.webContents.closed, true);
});

test('the toggle page gets its language only after loading and follows later changes', async () => {
  const f = fixture({ language: 'en' });
  f.toggle.setLanguage('pt');
  assert.deepEqual(f.sent, []);
  await f.toggle.open(f.parent);
  assert.deepEqual(f.sent, [[LANGUAGE_CHANNEL, 'pt']]);
  f.toggle.setLanguage('en');
  f.toggle.setLanguage('fr');
  assert.deepEqual(f.sent.slice(1), [[LANGUAGE_CHANNEL, 'en'], [LANGUAGE_CHANNEL, 'pt']]);
  f.toggle.dispose();
  f.toggle.setLanguage('en');
  assert.equal(f.sent.length, 3);
  const english = fixture({ language: 'en' });
  await english.toggle.open(english.parent);
  assert.deepEqual(english.sent, [[LANGUAGE_CHANNEL, 'en']]);
  english.toggle.dispose();
});

test('the main process can check the box without calling onChange, only after the page loads', async () => {
  const f = fixture();
  f.toggle.setHidden(true);
  assert.deepEqual(f.sent, []);
  await f.toggle.open(f.parent);
  assert.deepEqual(f.sent, [[LANGUAGE_CHANNEL, 'pt'], [HIDDEN_CHANNEL, true]]);
  f.toggle.setHidden('yes');
  assert.deepEqual(f.sent.at(-1), [HIDDEN_CHANNEL, false]);
  assert.equal(await f.handlers.get(CHANNEL)(f.event(), true), true);
  f.toggle.setHidden(true);
  assert.deepEqual(f.sent.at(-1), [HIDDEN_CHANNEL, true]);
  assert.deepEqual(f.changes, [true]);
  f.toggle.dispose();
  f.toggle.setHidden(false);
  assert.equal(f.sent.length, 4);
});

test('the main process can hide the toggle view before or after it opens, and nothing changes after dispose', async () => {
  const f = fixture();
  f.toggle.setVisible(false);
  await f.toggle.open(f.parent);
  const [view] = f.views;
  assert.deepEqual(view.visibility, [false]);
  f.toggle.setVisible(true);
  f.toggle.setVisible('yes');
  assert.deepEqual(view.visibility, [false, true, false]);
  f.toggle.dispose();
  f.toggle.setVisible(true);
  assert.deepEqual(view.visibility, [false, true, false]);
  const shown = fixture();
  await shown.toggle.open(shown.parent);
  assert.deepEqual(shown.views[0].visibility, [true]);
  shown.toggle.dispose();
});

test('Electron renders the toggle unchecked; a click reports hidden and a second click shows again', { timeout: 30000, skip: process.platform !== 'win32' }, async (t) => {
  const directory = fs.mkdtempSync(path.join(__dirname, '.electron-toggle-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const resultFile = path.join(directory, 'result.json'), entry = path.join(directory, 'main.js');
  const probe = `(async()=>{
    const box=document.querySelector('#hide');
    await document.fonts.ready;
    const font=document.fonts.check('400 14px Inter')&&[...document.fonts].some(face=>face.family.includes('Inter')&&face.status==='loaded');
    const style=getComputedStyle(box);
    const look=style.width+' '+style.height+' '+style.borderRadius+' '+style.backgroundColor;
    const initial=box.checked;
    const label=document.querySelector('label').textContent;
    const settle=()=>new Promise(resolve=>setTimeout(resolve,80));
    document.querySelector('label span').click(); await settle();
    const afterFirst=box.checked;
    const checkedLook=getComputedStyle(box).backgroundColor+' '+getComputedStyle(box).backgroundImage.includes('toggle-check.svg');
    box.click(); await settle();
    return {font,look,checkedLook,initial,label,lang:document.documentElement.lang,afterFirst,afterSecond:box.checked,api:Object.keys(window.toggle),node:typeof require};
  })()`;
  const englishProbe = `(async()=>{
    for(let count=0;count<40&&document.documentElement.lang!=='en';count++)await new Promise(resolve=>setTimeout(resolve,25));
    const label=document.querySelector('label');
    return document.documentElement.lang+' '+document.title+' '+label.textContent+' '+(label.getBoundingClientRect().right<=innerWidth);
  })()`;
  const revealProbe = `(async()=>{
    const box=document.querySelector('#hide');
    for(let count=0;count<40&&!box.checked;count++)await new Promise(resolve=>setTimeout(resolve,25));
    return box.checked&&!box.disabled;
  })()`;
  const source = `
const fs=require('fs');
const path=require('path');
const {app,BrowserWindow}=require('electron');
const {createOverlayToggle}=require(${JSON.stringify(require.resolve('../../../src/integration/overlay/overlayToggle'))});
const root=${JSON.stringify(directory)};
app.setPath('userData',path.join(root,'profile'));
app.setPath('sessionData',path.join(root,'profile'));
app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
  const changes=[];
  let toggle;
  try{
    const window=new BrowserWindow({show:false,width:1536,height:864,frame:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
    toggle=createOverlayToggle({onChange:value=>changes.push(value)});
    await toggle.open(window);
    const view=window.contentView.children[0];
    view.webContents.setBackgroundThrottling(false);
    const result=await view.webContents.executeJavaScript(${JSON.stringify(probe)});
    toggle.setLanguage('en');
    const english=await view.webContents.executeJavaScript(${JSON.stringify(englishProbe)});
    toggle.setHidden(true);
    const revealed=await view.webContents.executeJavaScript(${JSON.stringify(revealProbe)});
    fs.writeFileSync(${JSON.stringify(resultFile)},JSON.stringify({ok:true,...result,english,revealed,changes,bounds:view.getBounds()}));
    toggle.dispose(); window.destroy(); app.exit(0);
  }catch(error){
    fs.writeFileSync(${JSON.stringify(resultFile)},JSON.stringify({ok:false,error:String(error&&error.message)}));
    toggle?.dispose(); app.exit(1);
  }
});
`;
  new vm.Script(source);
  fs.writeFileSync(entry, source);
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  await new Promise((resolve, reject) => execFile(require('electron'), [entry], { cwd: PROJECT_ROOT, env: environment, windowsHide: true, timeout: 25000 }, (error) => (error ? reject(new Error(fs.existsSync(resultFile) ? fs.readFileSync(resultFile, 'utf8') : String(error.code))) : resolve())));
  assert.deepEqual(JSON.parse(fs.readFileSync(resultFile, 'utf8')), {
    ok: true, font: true, look: '16px 16px 20% rgba(126, 126, 126, 0.15)', checkedLook: 'rgb(213, 50, 53) true', initial: false, label: 'Ocultar contas', lang: 'pt-BR', english: 'en Hide accounts Hide accounts true', revealed: true, afterFirst: true, afterSecond: false, api: ['setHidden', 'onLanguage', 'onHidden'], node: 'undefined',
    changes: [true, false], bounds: { x: 200, y: 418, width: 144, height: 32 },
  });
});
