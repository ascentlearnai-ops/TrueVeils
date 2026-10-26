const test = require('node:test');
const assert = require('node:assert/strict');
const { loadMain } = require('./helpers/main-harness');

test('recruiter captions keep updating behind a calling app without relaxing renderer isolation', () => {
  let config;
  const window = { loadFile() {}, once() {}, on() {}, webContents: { setWindowOpenHandler() {}, on() {} } };
  const h = loadMain({ BrowserWindow: function (value) { config = value; return window; } });
  h.run('createWindow()');
  assert.equal(config.webPreferences.backgroundThrottling, false);
  assert.equal(config.webPreferences.sandbox, true);
  assert.equal(config.webPreferences.contextIsolation, true);
  assert.equal(config.webPreferences.nodeIntegration, false);
});
