const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function loadMain(options = {}) {
  const root = path.resolve(__dirname, '../..');
  const localRequire = createRequire(path.join(root, 'main.js'));
  const handlers = new Map();
  const broadcasts = new Map();
  const calls = [];
  const captionTimers = new Set();
  const state = {
    user: { id: 'test-recruiter', email: 'recruiter@example.test', is_anonymous: false },
    createError: null, databaseError: null, channelStatus: 'SUBSCRIBED',
    sendResult: 'ok', reportError: null, ...options
  };
  const session = {
    id: 'TRV-ABC234', join_code: 'TRV-ABC234', internal_id: 'test-session',
    organization_id: 'test-organization', recruiter_id: 'test-recruiter',
    candidate_link: 'https://truveil-client.vercel.app/?code=TRV-ABC234&open=1'
  };
  function query(table) {
    const builder = {};
    for (const method of ['select', 'eq', 'in', 'limit', 'order', 'single', 'maybeSingle', 'insert', 'update', 'upsert', 'delete']) {
      builder[method] = (...args) => { calls.push({ table, method, args }); return builder; };
    }
    builder.then = (resolve, reject) => Promise.resolve({ data: { ...session }, error: table === 'reports' ? state.reportSaveError : state.databaseError }).then(resolve, reject);
    return builder;
  }
  const channel = {
    on(type, filter, callback) { broadcasts.set(filter.event || type, callback); return this; },
    subscribe(callback) { state.subscription = callback; queueMicrotask(() => callback(state.channelStatus)); return this; },
    async track() { return 'ok'; },
    async send(message) { calls.push({ message }); return state.send ? state.send(message) : state.sendGate || state.sendResult; }
  };
  const client = {
    storage: options.storage,
    auth: {
      async getSession() { return { data: { session: state.user ? { user: state.user } : null } }; },
      async getUser() { return { data: { user: state.user }, error: state.user ? null : new Error('Not signed in') }; },
      async signInWithPassword(credentials) { calls.push({ passwordSignIn: credentials }); return { data: { user: state.user }, error: state.authError }; },
      async signInWithOtp(options) { calls.push({ otpOptions: options }); return { error: null }; },
      async signOut() { calls.push({ signedOut: true }); state.user = null; return { error: null }; }
    },
    functions: { async invoke(name, body) { calls.push({ function: name, body }); return { data: state.createError ? null : { session: { ...session } }, error: state.createError }; } },
    from: query,
    channel(name, config) { calls.push({ channel: name, config }); return channel; },
    async removeChannel() { calls.push({ removedChannel: true }); return 'ok'; }
  };
  const electron = {
    BrowserWindow: options.BrowserWindow,
    app: { getPath: () => root, requestSingleInstanceLock: () => true, whenReady: () => ({ then() {} }), on() {}, quit() {} },
    ipcMain: { handle: (name, callback) => handlers.set(name, callback) },
    shell: { async openExternal(url) { calls.push({ openedUrl: url }); }, async openPath() {} },
    dialog: { showErrorBox() {} }, safeStorage: {}, clipboard: { writeText() {} }
  };
  const sandbox = {
    __dirname: root, Buffer, URL, URLSearchParams, queueMicrotask,
    setTimeout(callback, delay, ...args) {
      if (options.deferCaptionAnalysis && delay === 0) {
        const timer = () => callback(...args);
        captionTimers.add(timer);
        return timer;
      }
      return setTimeout(callback, delay, ...args);
    },
    clearTimeout(timer) { if (!captionTimers.delete(timer)) clearTimeout(timer); },
    process: { env: { TRUVEIL_APP_MODE: 'cloud', ...options.env }, platform: process.platform, argv: [] },
    console: { log() {}, warn() {}, error() {} },
    require(name) {
      if (options.modules && Object.hasOwn(options.modules, name)) return options.modules[name];
      if (name === 'fs' && options.fs) return options.fs;
      if (name === 'electron') return electron;
      if (name === 'dotenv') return { config() {} };
      if (name === '@supabase/supabase-js') return { createClient: () => client };
      if (name === './src/config/runtime-config.json') return { supabaseUrl: 'https://test.supabase.co', supabaseAnonKey: 'public-test-key', candidateAppUrl: 'https://truveil-client.vercel.app' };
      if (name === './src/report/generator') return { behavioralEvidence: () => ({}), async generate(data) { if (state.reportError) throw state.reportError; calls.push({ generatedReport: data.session.sessionId }); return 'report.html'; } };
      if (name === './src/settings/store') return { getAll: () => ({}), save: data => data };
      if (name === './src/ai/local-risk' && options.analyzeTranscript) return { ...localRequire(name), analyzeTranscript: options.analyzeTranscript };
      if (name.startsWith('./src/audio/')) return {};
      return localRequire(name);
    }
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, 'main.js'), 'utf8'), context);
  return {
    state, calls, broadcasts,
    flushCaptionAnalysis() {
      let count = 0;
      while (captionTimers.size) {
        if (++count > 10000) throw new Error('Caption analysis did not drain');
        const timer = captionTimers.values().next().value;
        captionTimers.delete(timer);
        timer();
      }
    },
    attachRenderer(send) {
      context.sendToTestRenderer = send;
      vm.runInContext('mainWindow = { isDestroyed: () => false, webContents: { send: sendToTestRenderer } }', context);
    },
    invoke: (name, data) => handlers.get(name)(null, data),
    inspect: () => vm.runInContext('({ activeSession, sessionData, realtimeChannel })', context),
    run: code => vm.runInContext(code, context),
    event: payload => broadcasts.get('candidate_event')?.({ payload })
  };
}

module.exports = { loadMain };
