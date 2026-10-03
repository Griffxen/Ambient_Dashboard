const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const path = require('node:path');

function loadMain(platform, displays) {
  const app = new EventEmitter();
  let ready;
  Object.assign(app, { requestSingleInstanceLock: () => true, setAppUserModelId: () => {},
    whenReady: () => ({ then(callback) { ready = callback; } }),
    getPath: () => '.', isPackaged: false, quit: () => {} });
  const screen = new EventEmitter();
  Object.assign(screen, { getAllDisplays: () => displays, getPrimaryDisplay: () => displays[0] });
  const windows = [];
  class BrowserWindow extends EventEmitter {
    constructor(options) { super(); this.options = options; this.webContents = { send() {} }; windows.push(this); }
    isDestroyed() { return this.closed || false; }
    show() {}
    async loadFile() { await Promise.resolve(); }
    setBounds(bounds) { this.bounds = { ...bounds }; }
    getBounds() { return this.bounds; }
    setFullScreen(value) { this.fullscreen = value; }
    close() { this.closed = true; this.emit('closed'); }
  }
  let handlers;
  let workersLoaded = false;
  const timers = [];
  const context = vm.createContext({ console, Buffer, URL, Intl, AbortSignal,
    __dirname: path.join(__dirname, '..', 'electron'),
    process: { platform, env: {}, argv: [], execPath: 'dashboard' },
    setTimeout: callback => { timers.push(callback); return callback; }, clearTimeout: () => {},
    require(name) {
      if (name === 'electron') return { app, BrowserWindow, screen, ipcMain: { handle() {} }, powerSaveBlocker: {} };
      if (name === 'node:fs/promises') return { readFile: async () => '{}' };
      if (name === './services.cjs') return { cleanSettings: input => input };
      if (name === './lan-memo.cjs') return { startMemoEditor: async () => {}, stopMemoEditor() {} };
      if (name === './control-server.cjs') return { startControlServer: async value => { handlers = value; }, stopControlServer() {} };
      if (name === './windows-worker.cjs') { workersLoaded = true; return { stopWindowsWorkers() {} }; }
      return require(name);
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8'), context);
  return { ready: () => ready(), context, screen, windows, timers, handlers: () => handlers, workersLoaded: () => workersLoaded };
}
const primary = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } };
const portrait = { id: 2, bounds: { x: -720, y: 0, width: 720, height: 1280 } };

test('Linux keeps portrait selection, placement timing and platform services', async () => {
  const fixture = loadMain('linux', [primary, portrait]);
  await fixture.ready();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fixture.windows.length, 1);
  assert.equal(fixture.windows[0].options.x, -720);
  assert.equal(fixture.windows[0].fullscreen, undefined);
  assert.equal(fixture.timers.length, 1); // Existing Linux placement is still delayed.
  assert.equal(fixture.screen.listenerCount('display-metrics-changed'), 0);
  assert.equal(fixture.workersLoaded(), false);
});

test('Windows fullscreen placement uses DIP bounds and concurrent opens create one window', async () => {
  const fixture = loadMain('win32', [primary, portrait]);
  await fixture.ready();
  await Promise.all([fixture.handlers().command('open-display'), fixture.handlers().command('open-display')]);
  assert.equal(fixture.windows.length, 1);
  assert.deepEqual(fixture.windows[0].bounds, portrait.bounds);
  assert.equal(fixture.windows[0].fullscreen, true);
  assert.equal(fixture.screen.listenerCount('display-metrics-changed'), 1);
});

test('Windows without portrait screen stays available in background', async () => {
  const fixture = loadMain('win32', [primary]);
  await fixture.ready();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fixture.windows.length, 0);
  assert.equal(fixture.handlers().status().displayAvailable, false);
});

test('Windows metrics changes reposition the same display and close a rotated landscape display', async () => {
  const secondary = { id: portrait.id, bounds: { ...portrait.bounds } };
  const fixture = loadMain('win32', [primary, secondary]);
  await fixture.ready();
  await new Promise(resolve => setImmediate(resolve));
  secondary.bounds = { x: -800, y: -100, width: 800, height: 1300 };
  fixture.screen.emit('display-metrics-changed');
  fixture.timers.pop()();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fixture.windows.length, 1);
  assert.deepEqual(fixture.windows[0].getBounds(), secondary.bounds);
  secondary.bounds = { x: -1300, y: 0, width: 1300, height: 800 };
  fixture.screen.emit('display-metrics-changed');
  fixture.timers.pop()();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(fixture.windows[0].isDestroyed());
  assert.equal(fixture.handlers().status().displayAvailable, false);
});

test('Windows autostart registers the exact executable and preserves login arguments', async () => {
  const fixture = loadMain('win32', [primary]);
  const app = vm.runInContext("require('electron').app", fixture.context);
  app.isPackaged = true;
  let registration;
  app.setLoginItemSettings = settings => { registration = settings; };
  await vm.runInContext('applyAutoStart(true)', fixture.context);
  assert.equal(registration.path, 'dashboard');
  assert.equal(registration.openAtLogin, true);
  assert.equal(registration.args.join(' '), '--autostart');
  await vm.runInContext('applyAutoStart(false)', fixture.context);
  assert.equal(registration.openAtLogin, false);
});
