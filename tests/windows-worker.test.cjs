const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const { createWorker } = require('../electron/windows-worker.cjs');

function fakeProcess(reply) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.requests = 0;
  child.killed = false;
  child.stdin = new Writable({ write(chunk, _encoding, callback) {
    child.requests++;
    reply?.(child, JSON.parse(chunk.toString('utf8')));
    callback();
  } });
  child.kill = () => { child.killed = true; child.stdout.end(); };
  return child;
}

test('concurrent clients share one hidden worker, preserve Unicode and cache results', async () => {
  let child;
  let launches = 0;
  const worker = createWorker('media', { spawnProcess(_exe, args, options) {
    launches++;
    assert.equal(options.windowsHide, true);
    assert.ok(args.includes('-NonInteractive'));
    child = fakeProcess((process, request) => setImmediate(() => process.stdout.write(`${JSON.stringify({ id: request.id, value: { title: '音乐 · 秋日 🎵' } })}\n`)));
    return child;
  } });
  try {
    const values = await Promise.all([worker.request(), worker.request(), worker.request()]);
    assert.equal(values[0].title, '音乐 · 秋日 🎵');
    assert.deepEqual(values[0], values[1]);
    assert.deepEqual(await worker.request(), values[0]);
    assert.equal(launches, 1);
    assert.equal(child.requests, 1);
  } finally { worker.stop(); }
  assert.ok(child.killed);
  assert.equal(await worker.request(), null);
});

test('timeouts terminate the worker and retry after backoff', async () => {
  const children = [];
  const worker = createWorker('media', { timeoutMs: 15, retryMs: 10, spawnProcess() {
    const child = fakeProcess(children.length ? (process, request) => setImmediate(() => process.stdout.write(JSON.stringify({ id: request.id, value: 'recovered' }) + '\n')) : null);
    children.push(child);
    return child;
  } });
  try {
    assert.equal(await worker.request(), null);
    assert.ok(children[0].killed);
    assert.equal(await worker.request(), null);
    assert.equal(children.length, 1);
    await new Promise(resolve => setTimeout(resolve, 800));
    assert.equal(await worker.request(), 'recovered');
    assert.equal(children.length, 2);
  } finally { worker.stop(); }
});

test('exit, malformed replies, spawn errors and shutdown settle pending requests', async () => {
  for (const scenario of ['exit', 'malformed', 'spawn', 'stop']) {
    const worker = createWorker('telemetry', { spawnProcess() {
      if (scenario === 'spawn') throw Error('unavailable');
      return fakeProcess(child => setImmediate(() => {
        if (scenario === 'exit') child.emit('exit', 1);
        if (scenario === 'malformed') child.stdout.write('broken JSON\n');
      }));
    } });
    const result = worker.request();
    if (scenario === 'stop') worker.stop();
    assert.equal(await result, null);
    worker.stop();
  }
});
