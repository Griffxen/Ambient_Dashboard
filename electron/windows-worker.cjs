const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const readline = require('node:readline');

// One hidden PowerShell process per service, shared by display and control clients.
// Separate workers keep slow WMI queries from delaying media updates.
function createWorker(service, { spawnProcess = spawn, timeoutMs = 10000, retryMs = 15000 } = {}) {
  let child = null;
  let pending = null;
  let sequence = 0;
  let retryAt = 0;
  let stopped = false;
  let cache = { until: 0, value: null };
  let inFlight = null;
  const unpacked = process.resourcesPath && path.join(process.resourcesPath, 'app.asar.unpacked', 'electron', 'windows-worker.ps1');
  const script = unpacked && fs.existsSync(unpacked) ? unpacked : path.join(__dirname, 'windows-worker.ps1');
  const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

  function fail(processToStop) {
    if (child !== processToStop) return;
    child = null;
    retryAt = Date.now() + retryMs;
    cache = { until: 0, value: null };
    if (pending) { clearTimeout(pending.timer); pending.resolve(null); pending = null; }
    processToStop.kill();
  }
  function start() {
    const created = spawnProcess(executable, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Service', service], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
    });
    child = created;
    // Idle sampling must not keep a stopped Vite/Node host alive. Pending
    // requests have their own timeout handle; process exit kills both workers.
    created.unref?.();
    for (const stream of [created.stdin, created.stdout, created.stderr]) stream.unref?.();
    // Drain diagnostics, but never let subprocess output grow without bounds.
    created.stderr.resume();
    created.stdin.on('error', () => fail(created));
    created.on('error', () => fail(created));
    created.on('exit', () => fail(created));
    const lines = readline.createInterface({ input: created.stdout });
    lines.on('line', line => {
      if (child !== created || !pending) return;
      try {
        const response = JSON.parse(line.replace(/^\uFEFF/, ''));
        if (response.id !== pending.id) return;
        clearTimeout(pending.timer);
        const resolve = pending.resolve;
        pending = null;
        resolve(response.value ?? null);
      } catch { fail(created); }
    });
    created.once('exit', () => lines.close());
    return created;
  }
  function request() {
    if (stopped || Date.now() < retryAt) return Promise.resolve(null);
    if (inFlight) return inFlight;
    if (Date.now() < cache.until) return Promise.resolve(cache.value);
    inFlight = new Promise(resolve => {
      let active;
      try { active = child || start(); } catch { retryAt = Date.now() + retryMs; resolve(null); return; }
      const id = ++sequence;
      pending = { id, resolve, timer: setTimeout(() => fail(active), timeoutMs) };
      active.stdin.write(`${JSON.stringify({ id })}\n`);
    }).then(value => {
      cache = { until: Date.now() + (service === 'media' ? 750 : 4000), value };
      return value;
    }).finally(() => { inFlight = null; });
    return inFlight;
  }
  function stop() {
    stopped = true;
    if (child) fail(child);
  }
  return { request, stop };
}

const telemetryWorker = createWorker('telemetry');
const mediaWorker = createWorker('media');
function stopWindowsWorkers() { telemetryWorker.stop(); mediaWorker.stop(); }
process.once('exit', stopWindowsWorkers);
module.exports = { createWorker, windowsTelemetry: telemetryWorker.request, windowsMedia: mediaWorker.request, stopWindowsWorkers };
