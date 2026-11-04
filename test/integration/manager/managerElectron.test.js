const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const vm = require('node:vm');
const { PROJECT_ROOT, MANAGER_RENDERER_FILE, MANAGER_PRELOAD_FILE, ACCOUNT_CARDS_FILE } = require('../../../src/paths');

for (const compact of [false, true]) test(`Electron renders ${compact ? 'Riot account cards' : 'the legacy interface'} sandboxed without Riot or real data`, { timeout: 30000 }, async (t) => {
  const directory = fs.mkdtempSync(path.join(__dirname, '.electron-manager-'));
  t.after(() => {
    assert.equal(path.dirname(directory), __dirname);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const resultFile = path.join(directory, 'result.json');
  const rendererFile = compact ? ACCOUNT_CARDS_FILE : MANAGER_RENDERER_FILE;
  const entry = path.join(directory, 'entry.js');
  const hostFile = path.join(PROJECT_ROOT, 'src', 'integration', 'manager', 'managerHost.js');
  const browserProbe = compact ? `window.api.init().then(async value=>{
    for(let count=0;count<100&&!document.querySelector('.account');count++)await new Promise(resolve=>setTimeout(resolve,50));
    const card=document.querySelector('.account');
    const queueNames=Array.from(card.querySelectorAll('.queue-name'),node=>node.textContent).join('|');
    const bothQueues=queueNames==='Solo/Duo|Flex'&&!card.querySelector('.avatar')&&card.querySelector('.account-head').firstElementChild.matches('.name')&&card.querySelectorAll('.queue')[1].textContent.includes('Sem classificação')&&!document.querySelector('#queue');
    document.querySelector('[data-account="fixture-second"]').click();
    const lolPlay=getComputedStyle(document.querySelector('#play')).backgroundColor;
    document.querySelector('[data-game="val"]').click();
    const themed=document.body.dataset.theme==='val'&&getComputedStyle(document.querySelector('#play')).backgroundColor!==lolPlay&&getComputedStyle(document.querySelector('.launch-bar')).borderTopColor===getComputedStyle(document.querySelector('[data-game="val"]')).borderBottomColor;
    const selectedCorrect=document.querySelector('#selected-name').textContent.includes('Second');
    document.querySelector('#play').click();
    for(let count=0;count<100&&document.querySelector('#play').disabled;count++)await new Promise(resolve=>setTimeout(resolve,50));
    const launchComplete=!document.querySelector('#play').disabled;
    const list=document.querySelector('#cards').getBoundingClientRect(),footer=document.querySelector('.launch-bar').getBoundingClientRect();
    const gutter=Math.min(Math.max(96,Math.ceil(innerWidth*104/1136)),innerWidth-1);
    if(list.top<2||list.right>innerWidth-gutter+0.1||footer.right!==innerWidth||footer.bottom!==innerHeight||footer.height!==104)throw new Error('panel exceeds client bounds or covers native controls');
    const gameIcons=Array.from(document.querySelectorAll('button[data-game]'));
    const selection=document.querySelector('.selection').getBoundingClientRect();
    const footerGames=!document.querySelector('.toolbar')&&gameIcons.length===2&&gameIcons.every(button=>button.closest('.launch-bar')&&button.getBoundingClientRect().right<=selection.left&&button.getAttribute('aria-label')&&button.querySelector('img').complete&&button.querySelector('img').naturalWidth>0&&!button.textContent.trim());
    const footerActions=Boolean(document.querySelector('.launch-bar #settings')&&document.querySelector('.launch-bar #refresh'))&&document.querySelector('#refresh').textContent.includes('2 contas');
    const addCard=document.querySelector('#cards > .add-card:last-child');
    addCard.click();
    const addOpens=document.querySelector('#account-dialog').open&&document.querySelector('#account-title').textContent==='Adicionar conta';
    document.querySelector('#account-dialog').close();
    document.querySelector('#settings').click();
    const staySignedIn=document.querySelector('#settings-dialog').open&&document.querySelector('#settings-form').elements.staySignedIn.checked===true&&!document.querySelector('#cancel')&&document.querySelector('#status').hidden;
    document.querySelector('#settings-dialog').close();
    return {embedded:value.embedded,accounts:value.accounts.length,hasGenericIPC:typeof window.api.invoke!=='undefined',cards:document.querySelectorAll('.account').length,footerGames,footerActions,addOpens,bothQueues,themed,staySignedIn,hasLevel:card.textContent.includes('247'),hasWins:card.textContent.includes('68'),hasWinrate:card.textContent.includes('62%'),transparent:getComputedStyle(document.body).backgroundColor==='rgba(0, 0, 0, 0)'&&getComputedStyle(document.body).backgroundImage==='none'&&getComputedStyle(document.querySelector('.launch-bar')).backgroundColor==='rgb(252, 252, 252)',singlePlay:document.querySelectorAll('#play').length===1,noTft:!document.querySelector('[data-game=tft]'),selectedCorrect,launchComplete};
  })` : `window.api.init().then(async value=>{
    for(let count=0;count<100&&!document.querySelector('.card');count++)await new Promise(resolve=>setTimeout(resolve,50));
    const back=document.querySelector('#return-to-riot');
    return {embedded:value.embedded,accounts:value.accounts.length,canClose:typeof window.api.closeManager==='function',hasGenericIPC:typeof window.api.invoke!=='undefined',cards:document.querySelectorAll('.card').length,canReturn:Boolean(back&&!back.hidden),windowSettingsHidden:document.querySelector('#window-behaviour').hidden};
  })`;
  const entrySource = `
const fs=require('fs');
const path=require('path');
const {app,BrowserWindow}=require('electron');
const {createManagerHost}=require(${JSON.stringify(hostFile)});
const root=${JSON.stringify(directory)};
fs.mkdirSync(path.join(root,'profile'),{recursive:true});
fs.mkdirSync(path.join(root,'logs'),{recursive:true});
app.setPath('userData',path.join(root,'profile'));
app.setPath('sessionData',path.join(root,'profile'));
app.setPath('logs',path.join(root,'logs'));
app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
  let host;
  let stage='window';
  try{
    const window=new BrowserWindow({show:false,width:1000,height:760,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
    const data={accounts:[{id:'fixture-account',gameName:'Example',tagLine:'BR1',username:'fixture-user',region:'br1',hasPassword:true,stats:{lol:{level:247,solo:{tier:'DIAMOND',division:'II',wins:68,losses:42,lp:62}}}}],settings:{refreshMinutes:0},regions:{br1:{label:'BR'}},valRegions:['br'],version:'fixture',clientFound:true,nativeIntegration:{active:true},embedded:true,eventCursor:0};
    if(${compact})data.accounts.push({...data.accounts[0],id:'fixture-second',gameName:'Second'});
    let launch=null;
    host=createManagerHost({rendererFile:${JSON.stringify(rendererFile)},preloadFile:${JSON.stringify(MANAGER_PRELOAD_FILE)},request:async(method,args)=>{
      if(method==='signIn'){launch=args;return {ok:true,value:{ok:true,operationId:'fixture-launch'}};}
      return {ok:true,value:method==='init'?data:method==='events'?{events:[],cursor:0}:method==='operation'?{id:'fixture-launch',status:'succeeded'}:method==='runningGames'?{}:null};
    }});
    stage='open';
    await host.open(window);
    const view=window.contentView.children.find(child=>child.webContents&&child.webContents!==window.webContents);
    if(!view)throw new Error('missing embedded view');
    view.webContents.setBackgroundThrottling(false);
    stage='preload-api';
    const value=await view.webContents.executeJavaScript(${JSON.stringify(browserProbe)});
    fs.writeFileSync(${JSON.stringify(resultFile)},JSON.stringify({ok:true,...value,...(${compact}?{launch}:{}),windows:BrowserWindow.getAllWindows().length}));
    host.dispose();
    window.destroy();
    app.exit(0);
  }catch{
    fs.writeFileSync(${JSON.stringify(resultFile)},JSON.stringify({ok:false,stage}));
    host?.dispose();
    app.exit(1);
  }
});
`;
  new vm.Script(entrySource);
  fs.writeFileSync(entry, entrySource);
  const electronPath = require('electron');
  await new Promise((resolve, reject) => {
    const environment = { ...process.env };
    delete environment.ELECTRON_RUN_AS_NODE;
    execFile(electronPath, [entry], { cwd: PROJECT_ROOT, env: environment, windowsHide: true, timeout: 25000, maxBuffer: 65536 }, (error) => {
      if (!error) { resolve(); return; }
      const stage = fs.existsSync(resultFile) ? JSON.parse(fs.readFileSync(resultFile)).stage : String(error.code || error.signal || 'startup');
      reject(new Error(`The isolated Electron view smoke test failed (${stage})`));
    });
  });
  assert.deepEqual(JSON.parse(fs.readFileSync(resultFile, 'utf8')), compact
    ? { ok: true, embedded: true, accounts: 2, hasGenericIPC: false, cards: 2, footerGames: true, footerActions: true, addOpens: true, bothQueues: true, themed: true, staySignedIn: true, hasLevel: true, hasWins: true, hasWinrate: true, transparent: true, singlePlay: true, noTft: true, selectedCorrect: true, launchComplete: true, launch: ['fixture-second', 'val'], windows: 1 }
    : { ok: true, embedded: true, accounts: 1, canClose: true, hasGenericIPC: false, cards: 1, canReturn: true, windowSettingsHidden: true, windows: 1 });
});
