const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

// Dual boot uses one shared ledger; keep a local mirror when the volume is absent.
class WeatherUsageStore {
  constructor(localPath) {
    this.localPath = localPath;
    this.entries = [];
    this.queue = Promise.resolve();
    this.sharing = { enabled: false, available: false, path: '', error: null };
  }
  async read(file) {
    const rows = JSON.parse(await fs.readFile(file, 'utf8'));
    if (!Array.isArray(rows)) throw Error('天气统计文件格式不正确');
    const duplicates = new Map();
    return rows.filter(row => row && Number.isFinite(row.at) && typeof row.endpoint === 'string').map(row => {
      const key = JSON.stringify([row.at, row.endpoint, !!row.ok]);
      const index = duplicates.get(key) || 0;
      duplicates.set(key, index + 1);
      const id = typeof row.id === 'string' && row.id ? row.id : crypto.createHash('sha256').update(`${key}:${index}`).digest('hex');
      return { id, at: row.at, endpoint: row.endpoint, ok: !!row.ok };
    });
  }
  merge(rows) {
    const cutoff = Date.now() - 86400000;
    this.entries = [...new Map([...this.entries, ...rows].filter(row => row.at >= cutoff).map(row => [row.id, row])).values()].sort((a, b) => a.at - b.at);
  }
  async write(file) {
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify(this.entries), { mode: 0o600 });
      await fs.rename(temporary, file);
    } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
  }
  sync(sharedPath = '', entry) {
    const shared = sharedPath && path.resolve(sharedPath) !== path.resolve(this.localPath) ? sharedPath : '';
    const work = this.queue.then(async () => {
      try { this.merge(await this.read(this.localPath)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      this.sharing = { enabled: !!shared, available: false, path: shared, error: null };
      if (shared) {
        try { this.merge(await this.read(shared)); }
        catch (error) { if (error.code !== 'ENOENT') this.sharing.error = error.message; }
      }
      if (entry) this.merge([{ id: crypto.randomUUID(), at: Date.now(), ...entry }]);
      else this.merge([]);
      await this.write(this.localPath);
      if (shared && !this.sharing.error) {
        try { await this.write(shared); this.sharing.available = true; }
        catch (error) { this.sharing.error = error.message; }
      }
      return this.entries;
    });
    this.queue = work.catch(() => {});
    return work;
  }
}
module.exports = { WeatherUsageStore };
