'use strict';

// Operator-started temporary hosting only; no automatic startup or paid calls.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { createDemoRelay } = require('./relay-server');
const { createDeepgramTokenProvider } = require('./token-provider');
const root = path.resolve(__dirname, '../..');
const folder = path.join(root, '.readiness/temporary-relay');
const privateFile = path.join(folder, 'private.json');
const stateFile = path.join(folder, 'status.json');

function prepare() {
  if (!fs.existsSync(folder)) throw new Error('Create the private operator directory with restricted permissions first.');
  if (!fs.existsSync(privateFile)) {
    const speech = require('dotenv').parse(fs.readFileSync(path.join(root, '.readiness/microphone-test.env')));
    if (!speech.DEEPGRAM_API_KEY) throw new Error('The private local speech key is missing.');
    fs.writeFileSync(privateFile, JSON.stringify({ hostKey: crypto.randomBytes(32).toString('base64url'),
      deepgramKey: speech.DEEPGRAM_API_KEY }, null, 2), { flag: 'wx' });
  }
  const credentials = JSON.parse(fs.readFileSync(privateFile));
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(credentials.hostKey) || !credentials.deepgramKey) throw new Error('Private configuration is incomplete.');
  fs.writeFileSync(path.join(folder, 'host-access.txt'),
    'PRIVATE: paste only the following code into Truveil\'s Host access code field.\nDo not share it with candidates, publish it, or include it in the demo recording.\n\n' + credentials.hostKey + '\n');
  console.log('Private host configuration prepared. No credentials were printed.');
}

async function run() {
  const credentials = JSON.parse(fs.readFileSync(privateFile));
  const cloudflared = process.env.TRUVEIL_CLOUDFLARED;
  if (!cloudflared || !path.isAbsolute(cloudflared) || !fs.existsSync(cloudflared)) throw new Error('Cloudflare Tunnel executable is unavailable.');
  const stopFile = path.join(folder, 'stop-request');
  fs.rmSync(stopFile, { force: true });
  const relay = createDemoRelay({ hostKey: credentials.hostKey,
    tokenProvider: createDeepgramTokenProvider({ apiKey: credentials.deepgramKey }) });
  const { port } = await relay.listen(0, '127.0.0.1');
  const state = { schema: 1, mode: 'temporary-this-pc', pid: process.pid, startedAt: new Date().toISOString(),
    status: 'starting', localPort: port, relayUrl: '', speechConfigured: true,
    shutdownAt: null, machineMustStayAwake: true, noAutomaticRestart: true };
  let stopped = false, stopTimer, startupTimer;
  const save = () => fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
  const child = spawn(cloudflared, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`, '--metrics', '127.0.0.1:0'],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  state.tunnelPid = child.pid;
  save();
  const shutdown = async reason => {
    if (stopped) return;
    stopped = true;
    clearInterval(stopTimer); clearTimeout(startupTimer);
    state.status = reason; state.shutdownAt = new Date().toISOString(); save();
    child.kill();
    await relay.close();
    console.log(`Temporary relay stopped: ${reason}.`);
  };
  let pending = '';
  const line = data => {
    pending = (pending + data.toString()).slice(-32768);
    const match = pending.match(/https:\/\/([a-z0-9-]+\.trycloudflare\.com)(?=\s|\||$)/i);
    if (match && !state.relayUrl) {
      state.relayUrl = `wss://${match[1].toLowerCase()}/demo`;
      state.status = 'connecting'; save();
    }
    if (state.relayUrl && /Registered tunnel connection/.test(pending)) {
      state.status = 'running'; clearTimeout(startupTimer); save();
    }
  };
  child.stderr.on('data', line); child.stdout.on('data', line);
  child.on('error', () => { process.exitCode = 1; void shutdown('tunnel_failed'); });
  child.on('exit', () => { if (!stopped) { process.exitCode = 1; void shutdown('tunnel_exited'); } });
  startupTimer = setTimeout(() => { process.exitCode = 1; void shutdown('startup_timeout'); }, 90000);
  stopTimer = setInterval(() => { if (fs.existsSync(stopFile)) void shutdown('operator_stopped'); }, 1000);
  process.once('SIGINT', () => void shutdown('operator_stopped'));
  process.once('SIGTERM', () => void shutdown('operator_stopped'));
}

if (require.main === module) {
  Promise.resolve().then(() => {
    if (process.argv[2] === 'prepare') return prepare();
    if (process.argv[2] === 'run') return run();
    throw new Error('Expected prepare or run.');
  }).catch(() => { console.error('Temporary relay could not start. Check private configuration and the tunnel installation.'); process.exitCode = 1; });
}
