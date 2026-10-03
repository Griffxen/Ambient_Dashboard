// Run with Electron on Windows after `npm run build`.
const { app, BrowserWindow, screen } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const smokeDirectory = path.join(__dirname, '..', 'release', 'windows-smoke');
require('node:fs').mkdirSync(smokeDirectory, { recursive: true });
const log = (...values) => require('node:fs').appendFileSync(path.join(smokeDirectory, 'result.log'), values.map(value => typeof value === 'string' ? value : JSON.stringify(value)).join(' ') + '\n');
log('START');
process.on('uncaughtException', error => { log('UNCAUGHT', String(error)); app.exit(1); });
process.on('unhandledRejection', error => { log('REJECTED', String(error)); app.exit(1); });
app.setPath('userData', smokeDirectory);
process.argv.push('--control');
require('../electron/main.cjs');

app.whenReady().then(async () => {
  try {
    log('READY');
    const base = 'http://127.0.0.1:3988';
    async function get(route) {
      const response = await fetch(base + route, { signal: AbortSignal.timeout(15000) });
      assert.ok(response.ok, `${route}: ${response.status}`);
      return response;
    }
    for (let attempt = 0; attempt < 30; attempt++) {
      if (await fetch(base + '/api/dashboard/control').then(response => response.ok).catch(() => false)) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    log('DISPLAYS', screen.getAllDisplays().map(({ id, bounds, scaleFactor, rotation }) => ({ id, bounds, scaleFactor, rotation })));
    const status = await (await get('/api/dashboard/control')).json();
    log('STATUS', status);
    assert.ok((await (await get('/control')).text()).includes('<div id="root">'));
    await new Promise(resolve => setTimeout(resolve, 2000));
    const windows = BrowserWindow.getAllWindows();
    const control = windows.find(window => window.webContents.getURL().endsWith('/control'));
    assert.ok(control, 'Control window opened');
    const fontCheck = `Promise.all([
      ['DM Sans Variable', '0123456789'], ['IBM Plex Mono', 'SCHEDULE'],
      ['Noto Serif SC Variable', '中文日程'], ['Noto Sans SC Variable', '控制面板'], ['LXGW WenKai', '中文备忘']
    ].map(async ([family, text]) => ({ family, count: (await document.fonts.load('400 16px "' + family + '"', text)).length })))`;
    for (const font of await control.webContents.executeJavaScript(fontCheck)) {
      assert.ok(font.count > 0, `Control font missing: ${font.family}`);
      log('FONT', font);
    }
    const text = await control.webContents.executeJavaScript('document.body.innerText');
    assert.ok(text.includes('控制'), 'React control page rendered');
    const telemetry = await (await get('/api/dashboard/system/telemetry')).json();
    assert.ok(telemetry.ramTotalGB > 0);
    assert.ok(Number.isFinite(telemetry.netBytesPerSecond));
    assert.ok(Number.isFinite(telemetry.diskBytesPerSecond));
    assert.ok(telemetry.gpu && Number.isFinite(telemetry.gpu.use));
    log('TELEMETRY', telemetry);
    log('MEDIA', await (await get('/api/dashboard/system/media')).json());
    const display = windows.find(window => window !== control);
    if (display) {
      for (const font of await display.webContents.executeJavaScript(fontCheck)) assert.ok(font.count > 0, `Display font missing: ${font.family}`);
      assert.ok(display.isFullScreen());
      const target = screen.getDisplayMatching(display.getBounds());
      assert.ok(target.bounds.width < target.bounds.height);
      const displayText = await display.webContents.executeJavaScript('document.body.innerText');
      assert.ok(displayText.includes('SCHEDULE'), 'Dashboard rendered');
      display.webContents.debugger.attach('1.3');
      await display.webContents.debugger.sendCommand('DOM.enable');
      await display.webContents.debugger.sendCommand('CSS.enable');
      const { root } = await display.webContents.debugger.sendCommand('DOM.getDocument');
      for (const selector of ['.clock', '.section-heading']) {
        const { nodeId } = await display.webContents.debugger.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector });
        const { fonts } = await display.webContents.debugger.sendCommand('CSS.getPlatformFontsForNode', { nodeId });
        log('RENDERED FONT', selector, fonts);
        assert.ok(fonts.some(font => font.familyName.includes(selector === '.clock' ? 'DM Sans' : 'IBM Plex Mono')), `${selector} font fell back`);
      }
      display.webContents.debugger.detach();
      const liveStatus = await (await get('/api/dashboard/control')).json();
      assert.equal(liveStatus.connected, true, 'Renderer publishes state over IPC');
      log('CONNECTED', liveStatus);
      await fs.mkdir(smokeDirectory, { recursive: true });
      await fs.writeFile(path.join(smokeDirectory, 'display.png'), (await display.webContents.capturePage()).toPNG());
      log('DISPLAY', { bounds: display.getBounds(), fullScreen: display.isFullScreen() });
    }
    // Wait for the control page's next status poll before capturing it.
    await new Promise(resolve => setTimeout(resolve, 5500));
    await fs.mkdir(smokeDirectory, { recursive: true });
    await fs.writeFile(path.join(smokeDirectory, 'control.png'), (await control.webContents.capturePage()).toPNG());
    log('SMOKE PASSED');
    app.quit();
  } catch (error) {
    log('FAILED', String(error));
    app.exit(1);
  }
});
