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
    const outerShadows=value=>value.split(/,(?![^(]*\\))/).filter(part=>part.trim()!=='none'&&!part.includes('inset')).length;
    const flat=card.matches('.lol-card')&&outerShadows(getComputedStyle(card.querySelector('.face')).boxShadow)===0&&getComputedStyle(card.querySelector('.banner')).filter==='none';
    const queueNames=Array.from(card.querySelectorAll('.queue-name'),node=>node.textContent).join('|');
    const bothQueues=queueNames==='Solo/Duo|Flex'&&!card.querySelector('.avatar')&&card.querySelector('.account-head').firstElementChild.matches('.name')&&card.querySelectorAll('.queue')[1].textContent.includes('Sem classificação')&&!document.querySelector('#queue');
    const climb=document.querySelector('[data-id="fixture-second"] .climb');
    const apexClimb=Boolean(climb)&&climb.textContent==='faltam 85 PdL'&&climb.querySelector('img').alt==='Grão-Mestre'&&climb.title.includes('300 PdL')&&!card.querySelector('.climb')&&document.querySelectorAll('[data-id="fixture-second"] .climb').length===1;
    document.querySelector('[data-account="fixture-second"]').click();
    const lolPlay=getComputedStyle(document.querySelector('#play')).backgroundColor;
    const iconSpots=()=>Array.from(document.querySelectorAll('button[data-game]'),button=>Math.round(button.getBoundingClientRect().left)).join(',');
    const lolSpots=iconSpots();
    document.querySelector('[data-game="val"]').click();
    const fixedIcons=iconSpots()===lolSpots;
    document.querySelector('[data-account="fixture-account"]').click();
    const fixedAcrossAccounts=iconSpots()===lolSpots;
    document.querySelector('[data-account="fixture-second"]').click();
    document.querySelector('[data-game="riot"]').click();
    const riotMode=document.querySelector('#games').firstElementChild.dataset.game==='riot'&&document.body.dataset.theme==='riot'&&document.querySelector('#play').textContent.trim().startsWith('Entrar')&&document.querySelector('#selected-game').textContent.startsWith('Riot Client')&&document.querySelector('.account .queue-name').textContent==='Competitivo'&&iconSpots()===lolSpots&&getComputedStyle(document.querySelector('#play')).backgroundColor==='rgb(213, 50, 53)';
    document.querySelector('[data-game="val"]').click();
    const themed=document.body.dataset.theme==='val'&&getComputedStyle(document.querySelector('#play')).backgroundColor!==lolPlay&&getComputedStyle(document.querySelector('.launch-bar')).borderTopColor===getComputedStyle(document.querySelector('[data-game="val"]')).borderBottomColor;
    const selectedCorrect=document.querySelector('#selected-name').textContent.includes('Second');
    document.querySelector('#play').click();
    for(let count=0;count<100&&document.querySelector('#play').disabled;count++)await new Promise(resolve=>setTimeout(resolve,50));
    const launchComplete=!document.querySelector('#play').disabled;
    const list=document.querySelector('#cards').getBoundingClientRect(),footer=document.querySelector('.launch-bar').getBoundingClientRect();
    if(list.top<2||list.right>innerWidth+0.1||footer.right!==innerWidth||footer.bottom!==innerHeight||footer.height!==104)throw new Error('panel exceeds client bounds');
    const u=innerWidth/1136,near=(a,b)=>Math.abs(a-b)<0.6,box=selector=>document.querySelector(selector).getBoundingClientRect();
    const hit=(selector,b)=>Boolean(document.elementFromPoint(b.left+b.width/2,b.top+b.height/2)?.closest(selector));
    const minimizeBox=box('#riot-minimize'),closeBox=box('#riot-close');
    const riotControls=near(closeBox.right,innerWidth)&&near(closeBox.top,0)&&near(closeBox.width,32*u)&&near(closeBox.height,24*u)&&near(minimizeBox.right,innerWidth-32*u)&&near(minimizeBox.top,0)&&near(minimizeBox.width,32*u)&&hit('#riot-minimize',minimizeBox)&&hit('#riot-close',closeBox)&&document.querySelector('#riot-minimize').getAttribute('aria-label')==='Minimizar'&&document.querySelector('#riot-close').getAttribute('aria-label')==='Fechar'&&!document.querySelector('#riot-profile');
    document.querySelector('#riot-minimize').click();
    document.querySelector('#riot-close').click();
    const gameIcons=Array.from(document.querySelectorAll('button[data-game]'));
    const selection=document.querySelector('.selection').getBoundingClientRect();
    const footerGames=!document.querySelector('.toolbar')&&gameIcons.length===3&&gameIcons.every(button=>button.closest('.launch-bar')&&button.getBoundingClientRect().right<=selection.left&&button.getAttribute('aria-label')&&button.querySelector('img').complete&&button.querySelector('img').naturalWidth>0&&!button.textContent.trim())&&gameIcons.map(button=>button.querySelector('img').getBoundingClientRect().width).join(',')==='28,24,28';
    const footerActions=Boolean(document.querySelector('.launch-bar #settings')&&document.querySelector('.launch-bar #refresh'))&&document.querySelector('#refresh').textContent.trim()==='↻'&&!document.querySelector('#refresh').contains(document.querySelector('#count'))&&document.querySelector('.footer-tools .refresh-info').textContent.includes('2 contas')&&fixedIcons&&fixedAcrossAccounts;
    const addButton=document.querySelector('.launch-bar .footer-tools > #add-account:first-child');
    const settle=()=>new Promise(resolve=>setTimeout(resolve,80));
    addButton.click();
    const addOpens=!document.querySelector('#cards .add-card')&&addButton.getAttribute('aria-label')==='Adicionar conta'&&document.querySelector('#account-dialog').open&&document.querySelector('#account-title').textContent==='Adicionar conta';
    await settle();
    document.querySelector('#account-dialog').close();
    await settle();
    document.querySelector('#settings').click();
    await settle();
    const staySignedIn=document.querySelector('#settings-dialog').open&&document.querySelector('#settings-form').elements.staySignedIn.checked===true&&!document.querySelector('#cancel')&&document.querySelector('#status').hidden;
    document.querySelector('#settings-dialog').close();
    await settle();
    document.querySelector('#settings').click();
    await settle();
    const settingsForm=document.querySelector('#settings-form');
    const portugueseDefault=document.documentElement.lang==='pt-BR'&&settingsForm.elements.language.value==='pt'&&document.querySelector('#settings-dialog h2').textContent==='Configurações';
    settingsForm.elements.language.value='en';
    settingsForm.requestSubmit();
    for(let count=0;count<40&&document.documentElement.lang!=='en';count++)await settle();
    await settle();
    const english=portugueseDefault&&document.documentElement.lang==='en'&&document.title==='Accounts'&&!document.querySelector('#settings-dialog').open&&document.querySelector('#count').textContent==='2 accounts'&&document.querySelector('#play').textContent.trim().startsWith('Play')&&document.querySelector('.account .queue-name').textContent==='Competitive'&&document.querySelector('#settings').title==='Settings'&&document.querySelector('#settings-dialog h2').textContent==='Settings'&&document.querySelector('#account-dialog [data-t=riotId]').textContent==='Account name (Riot ID)'&&document.querySelector('#account-dialog input[name=riotId]').placeholder==='Name#BR1'&&document.querySelector('#riot-minimize').getAttribute('aria-label')==='Minimize'&&document.querySelector('#riot-close').getAttribute('aria-label')==='Close'&&document.querySelector('#add-account').title==='Add account';
    return {english,riotControls,embedded:value.embedded,accounts:value.accounts.length,hasGenericIPC:typeof window.api.invoke!=='undefined',cards:document.querySelectorAll('.account').length,footerGames,riotMode,footerActions,addOpens,flat,bothQueues,apexClimb,themed,staySignedIn,hasLevel:card.textContent.includes('247'),hasWins:card.textContent.includes('68'),hasWinrate:card.textContent.includes('62%'),backdrop:getComputedStyle(document.documentElement).backgroundColor==='rgb(242, 242, 242)'&&getComputedStyle(document.body).backgroundColor==='rgb(242, 242, 242)'&&getComputedStyle(document.body).backgroundImage==='none'&&getComputedStyle(document.querySelector('.launch-bar')).backgroundColor==='rgb(252, 252, 252)',singlePlay:document.querySelectorAll('#play').length===1,noTft:!document.querySelector('[data-game=tft]'),selectedCorrect,launchComplete};
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
    if(${compact})data.accounts.push({...data.accounts[0],id:'fixture-second',gameName:'Second',stats:{lol:{level:247,solo:{tier:'MASTER',division:'',wins:80,losses:60,lp:215,cutoffs:{grandmaster:300,challenger:900}}}}});
    let launch=null;
    const actions=[],saved=[];
    host=createManagerHost({onWindowAction:async action=>{actions.push(action);return true;},rendererFile:${JSON.stringify(rendererFile)},preloadFile:${JSON.stringify(MANAGER_PRELOAD_FILE)},request:async(method,args)=>{
      if(method==='signIn'){launch=args;return {ok:true,value:{ok:true,operationId:'fixture-launch'}};}
      if(method==='saveSettings'){saved.push(args[0]);data.settings={...data.settings,...args[0]};return {ok:true,value:data.settings};}
      return {ok:true,value:method==='init'?data:method==='events'?{events:[],cursor:0}:method==='operation'?{id:'fixture-launch',status:'succeeded'}:method==='runningGames'?{}:null};
    }});
    stage='open';
    await host.open(window);
    const view=window.contentView.children.find(child=>child.webContents&&child.webContents!==window.webContents);
    if(!view)throw new Error('missing embedded view');
    view.webContents.setBackgroundThrottling(false);
    stage='preload-api';
    const value=await view.webContents.executeJavaScript(${JSON.stringify(browserProbe)});
    fs.writeFileSync(${JSON.stringify(resultFile)},JSON.stringify({ok:true,...value,...(${compact}?{launch,actions,saved}:{}),windows:BrowserWindow.getAllWindows().length}));
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
    ? { ok: true, english: true, riotControls: true, embedded: true, accounts: 2, hasGenericIPC: false, cards: 2, footerGames: true, riotMode: true, footerActions: true, addOpens: true, flat: true, bothQueues: true, apexClimb: true, themed: true, staySignedIn: true, hasLevel: true, hasWins: true, hasWinrate: true, backdrop: true, singlePlay: true, noTft: true, selectedCorrect: true, launchComplete: true, launch: ['fixture-second', 'val'], actions: ['minimize', 'close'], saved: [{ refreshMinutes: 0, staySignedIn: true, language: 'en' }], windows: 1 }
    : { ok: true, embedded: true, accounts: 1, canClose: true, hasGenericIPC: false, cards: 1, canReturn: true, windowSettingsHidden: true, windows: 1 });
});
