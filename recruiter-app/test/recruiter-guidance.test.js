const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { parseHTML } = require('linkedom');
const { loadMain } = require('./helpers/main-harness');

async function fixture() {
  const root=path.resolve(__dirname,'..');
  const {window,document}=parseHTML(fs.readFileSync(path.join(root,'src/renderer/index.html'),'utf8'));
  for(const select of document.querySelectorAll('select'))Object.defineProperty(select,'value',{value:select.querySelector('option')?.value||'',writable:true});
  const events=new EventEmitter(),app=loadMain({deferCaptionAnalysis:true});
  app.attachRenderer((channel,data)=>events.emit(channel,{},data));
  vm.runInNewContext(fs.readFileSync(path.join(root,'preload.js'),'utf8'),{require:()=>({contextBridge:{exposeInMainWorld:(name,api)=>window[name]=api},ipcRenderer:{invoke:app.invoke,on:events.on.bind(events)}})});
  const context=vm.createContext({window,document,URL,console:{warn(){},log(){},error(){}},setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){}});
  vm.runInContext(fs.readFileSync(path.join(root,'src/session/presentation.js'),'utf8')+'\n'+fs.readFileSync(path.join(root,'src/renderer/dashboard.js'),'utf8'),context);
  for(let i=0;i<10;i++)await new Promise(resolve=>setImmediate(resolve));
  return {window,document,events,run:code=>vm.runInContext(code,context),text:()=>document.getElementById('recruiterGuideBody')?.textContent||''};
}

test('Tavi gives one relevant next step for access, invite, approval, start and report screens',async()=>{
  const h=await fixture();
  h.run("showScreen('access')");assert.match(h.text(),/private.*code/i);
  h.run("showScreen('idle')");assert.match(h.text(),/New interview/i);
  h.run("currentSession={sessionId:'DEMO-ABCDEFGHIJ234567',demo:true,relayUrl:'wss://relay.example/demo'};showScreen('setup')");
  assert.match(h.text(),/Copy invitation/i);
  h.run("pendingDemoJoin={name:'Synthetic'};updateRecruiterGuide()");assert.match(h.text(),/name.*Approve/i);
  h.run('pendingDemoJoin=null;candidateReady=true;updateRecruiterGuide()');assert.match(h.text(),/checks.*Start interview/i);
  h.run("showScreen('dashboard')");assert.match(h.text(),/call|captions/i);
  h.run("showScreen('reports')");assert.match(h.text(),/report/i);
  assert.equal(h.document.querySelectorAll('#recruiterGuide').length,1);
});

test('guide never echoes the private host code or changes consent and does not rewrite unchanged speech',async()=>{
  const h=await fixture();
  h.document.getElementById('demoHostCodeInput').value='private-do-not-echo';
  h.run("showScreen('access')");assert.doesNotMatch(h.text(),/private-do-not-echo/);
  const bubble=h.document.getElementById('recruiterGuideBody'),node=bubble.firstChild;
  for(let i=0;i<100;i++)h.run('updateRecruiterGuide()');
  assert.equal(bubble.firstChild===node,true);
  assert.equal(h.run('recruiterConfirmationInputs.every(input=>!input.checked)'),true);
  assert.equal(h.document.getElementById('recruiterGuide').querySelector('img').alt,'');
});

test('connection and report failures produce truthful guidance rather than a successful-status claim',async()=>{
  const h=await fixture();
  h.run("showDemoAccess('Could not connect to the interview service.')");
  assert.match(h.text(),/connection|address/i);
  h.run("currentSession={sessionId:'test'};reportNeedsRetry=true;showScreen('dashboard')");
  assert.match(h.text(),/report.*retry|retry.*report/i);
  assert.doesNotMatch(h.text(),/report is saved|everything is working/i);
});

test('the copied account-free invitation includes the real app link and no private access credential',async()=>{
  const h=await fixture();
  h.run("currentSession={sessionId:'DEMO-ABCDEFGHIJ234567',demo:true,relayUrl:'wss://relay.example/demo',candidateLink:sessionPresentation.invitation('DEMO-ABCDEFGHIJ234567','wss://relay.example/demo')}");
  h.document.getElementById('demoHostCodeInput').value='private-do-not-share';
  const invite=h.run('buildCandidateInviteMessage()');
  assert.ok(invite.body.includes(invite.link));
  assert.match(invite.body,/truveil:\/\/session\?/);
  assert.match(invite.body,/TRV-ABCDEFGHIJ234567/);
  assert.match(invite.body,/wss:\/\/relay.example/);
  assert.doesNotMatch(invite.body,/private-do-not-share|\bdemo\b/i);
});

test('confirmed reconnection clears the guide warning without erasing the evidence gap',async()=>{
  const h=await fixture();
  h.run("currentSession={sessionId:'test'};showScreen('dashboard')");
  h.events.emit('realtime:status',{}, {candidateReady:false,text:'Candidate disconnected'});
  assert.match(h.text(),/connection needs attention/);
  h.events.emit('realtime:status',{}, {candidateReady:true,text:'Candidate reconnected'});
  assert.match(h.text(),/calling app/);
  assert.doesNotMatch(h.text(),/connection needs attention/);
  assert.equal(h.run('telemetryState.connected'),false,'an earlier evidence gap is still recorded');
});

test('failed clipboard writes never claim an invitation was copied or sent',async()=>{
  const h=await fixture();
  h.run("currentSession={sessionId:'DEMO-ABCDEFGHIJ234567',demo:true,relayUrl:'wss://relay.example/demo',candidateLink:sessionPresentation.invitation('DEMO-ABCDEFGHIJ234567','wss://relay.example/demo')};showScreen('setup')");
  h.window.truveil.copyLink=async()=>{throw new Error('Synthetic clipboard unavailable');};
  h.document.getElementById('copyInviteMessageBtn').dispatchEvent(new h.window.Event('click'));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.run('invitationCopied'),false);
  assert.match(h.document.getElementById('toast').textContent,/Could not copy/);
  assert.doesNotMatch(h.text(),/you copied|invitation sent/i);
});
