const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { WeatherUsageStore } = require('../electron/weather-usage.cjs');

test('dual boot merges legacy records, preserves failed requests and deduplicates repeated imports', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dashboard-usage-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const shared = path.join(directory, 'shared.json');
  const linuxFile = path.join(directory, 'linux.json');
  const winFile = path.join(directory, 'win.json');
  const row = { at: Date.now(), endpoint: 'current', ok: true };
  await fs.writeFile(linuxFile, JSON.stringify([row, row, { at: Date.now() - 90000000, endpoint: 'current', ok: false }]));
  const linux = new WeatherUsageStore(linuxFile);
  await linux.sync(shared);
  const windows = new WeatherUsageStore(winFile);
  await windows.sync(shared, { endpoint: 'warnings', ok: false });
  assert.equal(windows.entries.length, 3);
  assert.equal(windows.entries.filter(row => !row.ok).length, 1);
  await linux.sync(shared);
  await linux.sync(shared);
  assert.equal(linux.entries.length, 3);
  await Promise.all(Array.from({ length: 7 }, () => linux.sync(shared, { endpoint: 'current', ok: true })));
  const restarted = new WeatherUsageStore(winFile);
  await restarted.sync(shared);
  assert.equal(restarted.entries.length, 10);
  assert.equal(restarted.sharing.available, true);
});

test('invalid shared ledger is preserved and requests survive locally until repaired', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dashboard-usage-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const shared = path.join(directory, 'shared.json');
  const store = new WeatherUsageStore(path.join(directory, 'local.json'));
  await fs.writeFile(shared, '{bad json');
  await store.sync(shared, { endpoint: 'current', ok: true });
  assert.equal(store.entries.length, 1);
  assert.equal(store.sharing.available, false);
  assert.equal(await fs.readFile(shared, 'utf8'), '{bad json');
  await fs.writeFile(shared, '[]');
  await store.sync(shared);
  assert.equal(store.entries.length, 1);
  assert.equal(store.sharing.available, true);
});
