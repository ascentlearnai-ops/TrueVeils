const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const presentation = require('../src/session/presentation');

test('session display aliases preserve every room-code bit and distinguish legacy short codes', () => {
  for (const suffix of ['ABCDEFGHIJKLMNOP', 'QRSTUVWXYZ234567', 'A234567BCDEFGHIJ']) {
    const wire = 'DEMO-' + suffix;
    assert.equal(presentation.displayCode(wire), 'TRV-' + suffix);
    assert.equal(presentation.wireCode(presentation.displayCode(wire)), wire);
  }
  assert.equal(presentation.wireCode('trv-abc089'), 'TRV-ABC089');
  for (const code of ['TRV-ABCDE', 'TRV-ABCDEFG', 'TRV-ABCDEFGHIJ234568', 'TRV-ABCDEFGHIJ234569']) assert.equal(presentation.wireCode(code), code);
});

test('session invitation uses neutral visible labels without changing the relay endpoint', () => {
  const url = presentation.invitation('DEMO-ABCDEFGHIJ234567', 'wss://relay.example/demo');
  assert.equal(url, 'truveil://session?code=TRV-ABCDEFGHIJ234567&relay=wss%3A%2F%2Frelay.example');
  assert.doesNotMatch(url, /demo/i);
  assert.equal(presentation.serverAddress('ws://127.0.0.1:1234/demo'), 'ws://127.0.0.1:1234');
  for (const url of ['wss://secret@relay.example/demo', 'ws://remote.example/demo', 'wss://relay.example/demo?key=secret', 'wss://relay.example/demo#key']) assert.throws(() => presentation.serverAddress(url));
  for (const code of ['DEMO-ABCDEFGHIJ234568', 'DEMO-ABCDEFGHIJ234569', 'TRV-ABC123']) assert.throws(() => presentation.invitation(code, 'wss://relay.example'));
});

test('both apps and browser runtimes use the same compatibility presentation rules', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/session/presentation.js'), 'utf8');
  assert.equal(source, fs.readFileSync(path.resolve(__dirname, '../../../Truveil-Client/src/session/presentation.js'), 'utf8'));
  const window = {};
  vm.runInNewContext(source, { window, URL });
  assert.equal(window.TruveilSession.wireCode('TRV-ABCDEFGHIJ234567'), 'DEMO-ABCDEFGHIJ234567');
  assert.equal(window.TruveilSession.message('Demo connection ended.'), 'Session connection ended.');
  assert.equal(window.TruveilSession.message('Shared tab: demo.com'), 'Shared tab: demo.com');
});
