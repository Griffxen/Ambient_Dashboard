const { app, BrowserWindow, ipcMain, powerSaveBlocker, screen } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { cleanSettings, weather, weatherUsage, telemetry, media } = require('./services.cjs');
const { startMemoEditor, stopMemoEditor } = require('./lan-memo.cjs');
const { startControlServer, stopControlServer } = require('./control-server.cjs');

const nativeWayland = process.platform === 'linux' && process.env.XDG_SESSION_TYPE === 'wayland';
const usingXWayland = process.argv.includes('--ozone-platform=x11');
const hasSingleInstanceLock = app.requestSingleInstanceLock();
const launchControlPanel = process.argv.includes('--control');

const configPath = path.join(os.homedir(), '.config', 'ambient-dashboard', 'config.json');
let storePath;
let window;
let controlWindow;
let controlServerReady = false;
let pendingControlOpen = false;
let activeDisplayId = null;
let displayWanted = true;
let screenAwakeBlockerId = null;
const dev = process.env.DASHBOARD_DEV === '1';
const getSettings = async () => cleanSettings(await readJson(configPath, {}));
let controlState = { mode: 'normal', artTheme: 'auto', connected: false, displayAvailable: false };
const command = action => window?.webContents?.send('control:command', action);
const iso = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
async function readJson(file, fallback) { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; } }
async function writeJson(file, value) { await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 }); await fs.writeFile(file, JSON.stringify(value, null, 2), { mode: 0o600 }); }
function applyScreenAwake(enabled) {
  if (enabled && screenAwakeBlockerId === null) screenAwakeBlockerId = powerSaveBlocker.start('prevent-display-sleep');
  if (!enabled && screenAwakeBlockerId !== null) {
    powerSaveBlocker.stop(screenAwakeBlockerId);
    screenAwakeBlockerId = null;
  }
}
async function applyAutoStart(enabled) {
  if (!app.isPackaged) return;
  if (process.platform === 'win32') { app.setLoginItemSettings({ openAtLogin: enabled, args: ['--autostart'] }); return; }
  if (process.platform !== 'linux') return;
  const file = path.join(os.homedir(), '.config', 'autostart', 'ambient-dashboard.desktop');
  if (!enabled) { await fs.rm(file, { force: true }); return; }
  const executable = process.execPath.replace(/[\\"]/g, '\\$&');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `[Desktop Entry]\nType=Application\nName=Ambient Dashboard\nExec="${executable}"${nativeWayland ? ' --ozone-platform=x11' : ''} --autostart\nTerminal=false\nX-GNOME-Autostart-enabled=true\n`, { mode: 0o644 });
}
async function saveMemo(lines) {
  if (!Array.isArray(lines) || lines.length > 30) throw Error('Invalid memo');
  const normalized = lines.map((line, index) => ({
    id: typeof line.id === 'string' ? line.id : crypto.randomUUID(),
    text: String(line.text ?? '').slice(0, 500), order: index,
    createdAt: typeof line.createdAt === 'string' ? line.createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    expiresAt: typeof line.expiresAt === 'string' ? line.expiresAt : null
  }));
  await writeJson(storePath, normalized); command('memo'); return normalized;
}
let settingsSaveQueue = Promise.resolve();
function saveSettings(value) {
  const saved = settingsSaveQueue.then(() => persistSettings(value));
  settingsSaveQueue = saved.catch(() => {});
  return saved;
}
async function persistSettings(value) {
  const old = await readJson(configPath, {});
  const next = cleanSettings({ ...old, ...value, weather: { ...old.weather, ...value.weather } });
  applyScreenAwake(next.preventDisplaySleep);
  await writeJson(configPath, { ...old, ...next });
  await applyAutoStart(next.autoStart);
  if (old.targetDisplayId !== next.targetDisplayId) {
    const previousWindow = window;
    window = null;
    activeDisplayId = null;
    if (previousWindow && !previousWindow.isDestroyed()) previousWindow.close();
    displayWanted = true;
    await openDisplayWindow(next);
  }
  command('settings');
  return next;
}
async function getAgenda() {
  const cfg = await getSettings();
  const cachePath = path.join(app.getPath('userData'), 'agenda-cache.json');
  const tokenPaths = [cfg.plannerTokenFile, path.join(os.homedir(), '.config', 'ambient-dashboard', 'planner_token.txt')].filter(Boolean);
  let token = '';
  for (const tokenPath of tokenPaths) {
    token = (await fs.readFile(tokenPath, 'utf8').catch(() => '')).trim();
    if (token) break;
  }
  const plannerUrl = cfg.plannerUrl || '';
  const sourceId = crypto.createHash('sha256').update(`${plannerUrl}\n${token}`).digest('hex');
  const stored = await readJson(cachePath, null);
  const cached = stored?.sourceId === sourceId ? stored : null;
  if (!token || !plannerUrl) return { data: null, updatedAt: null, state: 'unconfigured' };
  try {
    const base = new URL(plannerUrl);
    if (!['http:', 'https:'].includes(base.protocol)) throw Error('Invalid protocol');
    const headers = { Authorization: `Bearer ${token}` };
    const metaResponse = await fetch(new URL('/api/v1/agenda/meta', base), { headers, signal: AbortSignal.timeout(5000) });
    if (metaResponse.status === 401) { await fs.rm(cachePath, { force: true }); return { data: null, updatedAt: null, state: 'unconfigured' }; }
    if (!metaResponse.ok) throw Error(`Planner meta: ${metaResponse.status}`);
    const meta = await metaResponse.json();
    const today = new Date();
    const from = iso(new Date(today.getTime() - 7 * 86400000));
    const to = iso(new Date(today.getTime() + 23 * 86400000));
    const url = new URL('/api/v1/agenda', base);
    url.searchParams.set('from', from); url.searchParams.set('to', to);
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
    if (response.status === 401) { await fs.rm(cachePath, { force: true }); return { data: null, updatedAt: null, state: 'unconfigured' }; }
    if (!response.ok) throw Error(`Planner agenda: ${response.status}`);
    const data = { meta, agenda: await response.json() };
    const updatedAt = new Date().toISOString();
    await writeJson(cachePath, { data, updatedAt, sourceId });
    return { data, updatedAt, state: 'fresh' };
  } catch (error) {
    return { data: cached?.data ?? null, updatedAt: cached?.updatedAt ?? null, state: 'stale', error: String(error) };
  }
}
function findTargetDisplay(settings, displays = screen.getAllDisplays()) {
  const portrait = d => d.bounds.width < d.bounds.height && d.bounds.height >= 950 && d.bounds.width >= 500;
  return settings.targetDisplayId != null
    ? displays.find(d => d.id === settings.targetDisplayId)
    : displays.find(d => d.id !== screen.getPrimaryDisplay().id && portrait(d))
      || displays.find(d => d.id !== screen.getPrimaryDisplay().id && d.bounds.width < d.bounds.height);
}
function placeDisplayWindow(created, displayId) {
  // Mutter can override the initial position while mapping an XWayland window.
  // Move only after mapping, then allow the move to settle before fullscreen.
  let timer;
  let attempts = 0;
  const schedule = (callback, delay) => { timer = setTimeout(callback, delay); };
  created.once('closed', () => clearTimeout(timer));
  const place = () => {
    if (created.isDestroyed()) return;
    const target = screen.getAllDisplays().find(d => d.id === displayId);
    if (!target) return;
    attempts += 1;
    created.setFullScreen(false);
    schedule(() => {
      if (created.isDestroyed()) return;
      created.setBounds(target.bounds);
      schedule(() => {
        if (created.isDestroyed()) return;
        created.setFullScreen(true);
        schedule(() => {
          if (created.isDestroyed()) return;
          if (screen.getDisplayMatching(created.getBounds()).id !== displayId) {
            if (attempts < 3) place();
            else console.error('Display window placement failed:', displayId, created.getBounds());
          }
        }, 500);
      }, 300);
    }, 200);
  };
  schedule(place, 500);
}
async function openDisplayWindow(settingsOverride) {
  if (window && !window.isDestroyed()) { window.show(); return true; }
  const target = findTargetDisplay(settingsOverride || await getSettings());
  controlState = { ...controlState, connected: false, displayAvailable: Boolean(target) };
  if (!target && !dev) return false;
  activeDisplayId = target?.id ?? null;
  const bounds = target?.bounds;
  window = new BrowserWindow({
    width: bounds?.width ?? 700, height: bounds?.height ?? 1120,
    icon: path.join(__dirname, 'assets', 'ambient-dashboard.png'),
    x: bounds?.x, y: bounds?.y, backgroundColor: '#eeece5',
    autoHideMenuBar: true, fullscreen: false, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false }
  });
  const created = window;
  created.on('closed', () => {
    if (window === created) {
      window = null; activeDisplayId = null;
      controlState = { ...controlState, connected: false };
    }
  });
  if (dev) await created.loadURL('http://127.0.0.1:5173');
  else await created.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  if (created.isDestroyed()) return false;
  created.show();
  if (target && !dev && (!nativeWayland || usingXWayland) && !created.isDestroyed()) {
    placeDisplayWindow(created, target.id);
  }
  return true;
}
function closeDisplayWindow() {
  displayWanted = false;
  controlState = { ...controlState, connected: false };
  if (window && !window.isDestroyed()) window.close();
}
async function openControlPanel() {
  if (controlWindow && !controlWindow.isDestroyed()) {
    if (controlWindow.isMinimized()) controlWindow.restore();
    controlWindow.show();
    controlWindow.focus();
    return;
  }
  const created = new BrowserWindow({
    width: 1180, height: 820, minWidth: 780, minHeight: 600,
    icon: path.join(__dirname, 'assets', 'ambient-dashboard.png'),
    show: true, autoHideMenuBar: true, title: 'Ambient Dashboard 控制面板',
    backgroundColor: '#eeece5',
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  controlWindow = created;
  created.on('closed', () => { if (controlWindow === created) controlWindow = null; });
  created.loadURL('http://127.0.0.1:3988/control').catch(error => {
    console.error('Control panel failed to load:', error);
  });
}

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    if (argv.includes('--autostart')) return;
    if (controlServerReady) openControlPanel().catch(console.error);
    else pendingControlOpen = true;
  });
}

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;
  storePath = path.join(app.getPath('userData'), 'memo.json');
  startMemoEditor(() => readJson(storePath, []), saveMemo).catch(() => {});
  ipcMain.handle('settings:get', getSettings);
  ipcMain.handle('settings:save', (_event, value) => saveSettings(value));
  ipcMain.handle('control:state', (_event, state) => { controlState = { ...controlState, ...state, connected: true }; });
  ipcMain.handle('weather:get', async () => weather(await getSettings()));
  ipcMain.handle('telemetry:get', telemetry);
  ipcMain.handle('media:get', media);
  ipcMain.handle('agenda:get', getAgenda);
  ipcMain.handle('memo:get', () => readJson(storePath, []));
  ipcMain.handle('memo:save', (_event, lines) => saveMemo(lines));
  ipcMain.handle('memo:lan', () => startMemoEditor(() => readJson(storePath, []), saveMemo));
  ipcMain.handle('app:quit', () => app.quit());
  const startupSettings = await getSettings();
  applyScreenAwake(startupSettings.preventDisplaySleep);
  await applyAutoStart(startupSettings.autoStart);
  controlState = { ...controlState, displayAvailable: Boolean(findTargetDisplay(await getSettings())) };
  await startControlServer({
    settings: getSettings, saveSettings, memo: () => readJson(storePath, []), saveMemo,
    weather: async () => weather(await getSettings()), media, telemetry, agenda: getAgenda,
    weatherUsage: async () => weatherUsage(await getSettings()),
    presence: input => {
      const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
      const title = text(input?.title, 80);
      const summary = text(input?.summary, 180);
      if (!title || !summary) throw Error('title and summary are required');
      const presence = {
        id: text(input?.id, 80) || crypto.randomUUID(), title, summary,
        detail: text(input?.detail, 1200), icon: text(input?.icon, 4) || '•',
        durationMs: Math.max(3000, Math.min(60000, Number(input?.durationMs) || 12000))
      };
      presence.expiresAt = Date.now() + presence.durationMs;
      window?.webContents?.send('presence:show', presence);
      return { accepted: true, id: presence.id };
    },
    clearPresence: id => { window?.webContents?.send('presence:clear', id || null); return { cleared: true, id: id || null }; },
    status: () => ({ ...controlState, screenAwakeActive: screenAwakeBlockerId !== null && powerSaveBlocker.isStarted(screenAwakeBlockerId) }),
    command: async action => {
      if (action === 'close-display') { closeDisplayWindow(); return; }
      if (action === 'open-display') { displayWanted = true; await openDisplayWindow(); return; }
      if (action === 'refresh-weather') await weather(await getSettings(), true);
      if (action === 'normal' || action === 'performance') controlState.mode = action;
      command(action);
    },
    quit: () => setTimeout(() => app.quit(), 200)
  }).catch(error => { console.error('Control panel unavailable:', error.message); });
  controlServerReady = true;
  screen.on('display-added', async () => {
    controlState = { ...controlState, displayAvailable: Boolean(findTargetDisplay(await getSettings())) };
    if (displayWanted && !window) openDisplayWindow().catch(console.error);
  });
  screen.on('display-removed', async (_event, removed) => {
    const available = Boolean(findTargetDisplay(await getSettings(), screen.getAllDisplays().filter(d => d.id !== removed.id)));
    controlState = { ...controlState, displayAvailable: available };
    if (window && activeDisplayId === removed.id) {
      const removedWindow = window;
      if (!removedWindow.isDestroyed()) removedWindow.close();
      if (displayWanted) setTimeout(() => openDisplayWindow().catch(console.error), 100);
    }
  });
  if (launchControlPanel || pendingControlOpen) await openControlPanel();
  openDisplayWindow().catch(console.error);
});
app.on('window-all-closed', () => {});
app.on('before-quit', stopMemoEditor);
app.on('before-quit', stopControlServer);
app.on('before-quit', () => applyScreenAwake(false));
