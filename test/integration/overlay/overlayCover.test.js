const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { execFile } = require('node:child_process');
const { createOverlayCover } = require('../../../src/integration/overlay/overlayCover');
const { OVERLAY_COVER_FILE, PROJECT_ROOT } = require('../../../src/paths');

function fixture() {
  const views = [], areas = [];
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
      contents.loadFile = async (file) => { contents.file = file; };
      contents.close = () => { contents.closed = true; };
      contents.setWindowOpenHandler = (callback) => { contents.openHandler = callback; };
      contents.session = { setPermissionRequestHandler: (callback) => { contents.permission = callback; }, setPermissionCheckHandler: (callback) => { contents.permissionCheck = callback; } };
    }
    setBackgroundColor(color) { this.background = color; }
    setBounds(bounds) { this.bounds = bounds; }
    setVisible(visible) { this.visibility.push(visible); }
  }
  const area = ({ width, height }) => { areas.push([width, height]); return { x: 0, y: 0, width: Math.round(width / 4), height }; };
  const cover = createOverlayCover({ electron: { WebContentsView: FakeView }, area });
  return { cover, parent, views, areas, resize(width, height) { size = [width, height]; parent.emit('resize'); } };
}

test('the cover is an isolated view without scripts that fills the area it is given and starts hidden', async () => {
  const f = fixture();
  await f.cover.open(f.parent);
  const [view] = f.views;
  assert.equal(f.parent.contentView.children[0], view);
  assert.equal(view.webContents.file, OVERLAY_COVER_FILE);
  assert.deepEqual(view.options.webPreferences, { contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, javascript: false, partition: 'ram-overlay-cover' });
  assert.equal(view.background, '#fcfcfc');
  assert.deepEqual(view.visibility, [false]);
  assert.deepEqual(view.bounds, { x: 0, y: 0, width: 384, height: 864 });
  f.resize(1280, 720);
  assert.deepEqual(view.bounds, { x: 0, y: 0, width: 320, height: 720 });
  assert.deepEqual(f.areas, [[1536, 864], [1280, 720]]);
  assert.deepEqual(view.webContents.openHandler(), { action: 'deny' });
  for (const name of ['will-navigate', 'will-attach-webview']) {
    let prevented = false;
    view.webContents.emit(name, { preventDefault() { prevented = true; } });
    assert.equal(prevented, true, name);
  }
  let allowed;
  view.webContents.permission(null, 'media', (value) => { allowed = value; });
  assert.equal(allowed, false);
  assert.equal(view.webContents.permissionCheck(), false);
  await f.cover.open(f.parent);
  assert.equal(f.views.length, 1);
});

test('the cover shows and hides on request, keeps a request made before opening, and stops after dispose', async () => {
  const f = fixture();
  f.cover.setVisible(true);
  await f.cover.open(f.parent);
  const [view] = f.views;
  assert.deepEqual(view.visibility, [true]);
  f.cover.setVisible(false);
  f.cover.setVisible('yes');
  f.cover.setVisible(true);
  assert.deepEqual(view.visibility, [true, false, false, true]);
  f.cover.dispose();
  assert.equal(view.webContents.closed, true);
  assert.equal(f.parent.listenerCount('resize'), 0);
  f.cover.setVisible(false);
  f.resize(800, 600);
  assert.deepEqual(view.visibility, [true, false, false, true]);
  assert.deepEqual(f.areas, [[1536, 864]]);
  await f.cover.open(f.parent);
  assert.equal(f.views.length, 1);
  f.cover.dispose();
});

test('Electron renders the cover as the Riot login panel with one Riot red spinner in the middle, and runs no script', { timeout: 30000, skip: process.platform !== 'win32' }, async (t) => {
  const directory = fs.mkdtempSync(path.join(__dirname, '.electron-cover-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const resultFile = path.join(directory, 'result.json'), entry = path.join(directory, 'main.js');
  const probe = `(()=>{
    const spinner=document.querySelector('.spinner');
    const style=getComputedStyle(spinner), box=spinner.getBoundingClientRect();
    return {
      background:getComputedStyle(document.body).backgroundColor,
      elements:[...document.body.querySelectorAll('*')].map(element=>element.className),
      scripts:document.scripts.length,
      look:[style.width,style.height,style.borderTopWidth,style.borderTopColor,style.borderRightColor,style.borderRadius,style.animationName,style.animationIterationCount].join(' '),
      box:{left:box.left,top:box.top,right:box.right,bottom:box.bottom},
      scroll:document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight,
    };
  })()`;
  const source = `
const fs=require('fs');
const path=require('path');
const {app,BrowserWindow}=require('electron');
const {createOverlayCover}=require(${JSON.stringify(require.resolve('../../../src/integration/overlay/overlayCover'))});
const root=${JSON.stringify(directory)};
app.setPath('userData',path.join(root,'profile'));
app.setPath('sessionData',path.join(root,'profile'));
app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
  let cover;
  try{
    const page=new BrowserWindow({show:false,width:400,height:864,useContentSize:true,frame:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
    await page.loadFile(${JSON.stringify(OVERLAY_COVER_FILE)});
    const result=await page.webContents.executeJavaScript(${JSON.stringify(probe)});
    const window=new BrowserWindow({show:false,width:1536,height:864,frame:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
    cover=createOverlayCover({area:({height})=>({x:0,y:0,width:400,height})});
    await cover.open(window);
    const view=window.contentView.children[0];
    const script=await view.webContents.executeJavaScript('1').then(()=>'ran',()=>'blocked');
    fs.writeFileSync(${JSON.stringify(resultFile)},JSON.stringify({ok:true,...result,script,bounds:view.getBounds()}));
    cover.dispose(); window.destroy(); page.destroy(); app.exit(0);
  }catch(error){
    fs.writeFileSync(${JSON.stringify(resultFile)},JSON.stringify({ok:false,error:String(error&&error.message)}));
    cover?.dispose(); app.exit(1);
  }
});
`;
  new vm.Script(source);
  fs.writeFileSync(entry, source);
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  await new Promise((resolve, reject) => execFile(require('electron'), [entry], { cwd: PROJECT_ROOT, env: environment, windowsHide: true, timeout: 25000 }, (error) => (error ? reject(new Error(fs.existsSync(resultFile) ? fs.readFileSync(resultFile, 'utf8') : String(error.code))) : resolve())));
  const result = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
  const { box } = result;
  delete result.box;
  assert.deepEqual(result, {
    ok: true, background: 'rgb(252, 252, 252)', elements: ['spinner'], scripts: 0,
    look: '36px 36px 3px rgb(213, 50, 53) rgba(126, 126, 126, 0.15) 50% spin infinite',
    scroll: true, script: 'blocked', bounds: { x: 0, y: 0, width: 400, height: 864 },
  });
  assert.ok(Math.abs((box.left + box.right) / 2 - 200) < 1, 'centered in the column');
  assert.ok(Math.abs((box.top + box.bottom) / 2 - 864 / 2) < 1, 'in the middle of the column');
});
