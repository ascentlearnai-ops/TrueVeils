// Test-process isolation only. This file is not included in either installer.
const { app, shell, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const profile = process.env.TRUVEIL_QA_PROFILE;
if (!profile || !path.isAbsolute(profile)) throw new Error('An isolated QA profile is required.');
fs.mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
globalThis.__qa = { opened: [], errors: [], blockedNetwork: 0, blockedProcesses: 0, registrations: 0 };
globalThis.__qaApp = app;
app.setAsDefaultProtocolClient = () => { globalThis.__qa.registrations++; return false; };
shell.openPath = async target => { globalThis.__qa.opened.push(target); return ''; };
shell.openExternal = async () => { throw new Error('External navigation is forbidden in local QA.'); };
dialog.showErrorBox = (title, content) => globalThis.__qa.errors.push({ title, content });
globalThis.fetch = async () => { globalThis.__qa.blockedNetwork++; throw new Error('External fetch is forbidden in local QA.'); };
for (const name of ['node:http', 'node:https']) {
  const module = require(name);
  const original = module.request;
  module.request = function (options, ...args) {
    const hostname = typeof options === 'string' ? new URL(options).hostname : options.hostname || options.host;
    if (hostname !== '127.0.0.1') {
      globalThis.__qa.blockedNetwork++;
      throw new Error('Only the loopback relay is allowed in local QA.');
    }
    return original.call(this, options, ...args);
  };
}
for (const method of ['exec', 'execFile', 'spawn', 'execSync', 'execFileSync', 'spawnSync']) {
  require('node:child_process')[method] = () => {
    globalThis.__qa.blockedProcesses++;
    throw new Error('External process or foreground monitoring is forbidden in local QA.');
  };
}
app.whenReady().then(() => {
  require('electron').session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const allowed = /^(file:|devtools:|data:)/.test(details.url) || /^wss?:\/\/127\.0\.0\.1(?::|\/)/.test(details.url);
    if (!allowed) globalThis.__qa.blockedNetwork++;
    callback({ cancel: !allowed });
  });
});
