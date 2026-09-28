import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const services = require('./electron/services.cjs'); // Shared preview services.
const lanMemo = require('./electron/lan-memo.cjs');

const iso = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
export default defineConfig({
  base: './',
  plugins: [react(), {
    name: 'local-planner-preview',
    configureServer(server) {
      let controlState = { mode: 'normal', artTheme: 'auto', connected: false, lastSeen: 0 };
      server.middlewares.use('/api/dashboard/control', async (req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        if (req.url === '/state' && req.method === 'POST') {
          let raw = ''; for await (const chunk of req) raw += chunk;
          const input = JSON.parse(raw || '{}');
          controlState = { ...controlState, mode: input.mode === 'performance' ? 'performance' : 'normal', artTheme: String(input.artTheme || 'auto'), connected: true, lastSeen: Date.now() };
          res.end(JSON.stringify(controlState)); return;
        }
        if (req.method === 'GET') { res.end(JSON.stringify({ ...controlState, connected: Date.now() - controlState.lastSeen < 15000 })); return; }
        if (req.method === 'POST') {
          let raw = ''; for await (const chunk of req) raw += chunk;
          const action = JSON.parse(raw || '{}').action;
          if (['quit', 'open-display', 'close-display'].includes(action)) {
            const response = await fetch('http://127.0.0.1:3988/api/dashboard/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }), signal: AbortSignal.timeout(1500) }).catch(() => null);
            res.statusCode = response?.ok ? 200 : 503; res.end(JSON.stringify(await response?.json().catch(() => ({})) || {})); return;
          }
          if (!['normal', 'performance', 'next-art', 'refresh-agenda', 'scroll-top', 'weather-demo'].includes(action)) { res.statusCode = 400; res.end('{}'); return; }
          if (action === 'normal' || action === 'performance') controlState = { ...controlState, mode: action };
          res.end(JSON.stringify(controlState)); return;
        }
        res.statusCode = 405; res.end('{}');
      });
      const configPath = path.join(os.homedir(), '.config', 'ambient-dashboard', 'config.json');
      const previewMemoPath = process.platform === 'win32' && process.env.APPDATA
        ? path.join(process.env.APPDATA, 'ambient-dashboard', 'memo.json')
        : path.join(os.homedir(), '.config', 'ambient-dashboard', 'memo.json');
      const readMemo = async () => JSON.parse(await fs.readFile(previewMemoPath, 'utf8').catch(() => '[]'));
      const saveMemo = async (lines: unknown[]) => {
        if (!Array.isArray(lines) || lines.length > 30) throw Error('Invalid memo');
        const normalized = lines.map((raw, order) => {
          const line = raw as Record<string, unknown>;
          return {
            id: typeof line.id === 'string' ? line.id : randomUUID(),
            text: String(line.text || '').slice(0, 500), order,
            createdAt: typeof line.createdAt === 'string' ? line.createdAt : new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            expiresAt: typeof line.expiresAt === 'string' ? line.expiresAt : null
          };
        });
        await fs.mkdir(path.dirname(previewMemoPath), { recursive: true, mode: 0o700 });
        await fs.writeFile(previewMemoPath, JSON.stringify(normalized), { mode: 0o600 });
        return normalized;
      };
      server.middlewares.use('/api/dashboard/system', async (req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        try {
          const saved = JSON.parse(await fs.readFile(configPath, 'utf8').catch(() => '{}'));
          const settings = services.cleanSettings(saved);
          const route = req.url?.split('?')[0];
          if (route === '/memo' && req.method === 'GET') { res.end(JSON.stringify(await readMemo())); return; }
          if (route === '/memo' && req.method === 'POST') {
            const parts: Buffer[] = []; for await (const part of req) parts.push(part as Buffer);
            res.end(JSON.stringify(await saveMemo(JSON.parse(Buffer.concat(parts).toString('utf8'))))); return;
          }
          if (route === '/memo/lan' && req.method === 'GET') { res.end(JSON.stringify(await lanMemo.startMemoEditor(readMemo, saveMemo))); return; }
          if (route === '/settings' && req.method === 'GET') res.end(JSON.stringify(settings));
          else if (route === '/settings' && req.method === 'POST') {
            const parts: Buffer[] = [];
            for await (const part of req) parts.push(part as Buffer);
            const input = JSON.parse(Buffer.concat(parts).toString('utf8'));
            const next = services.cleanSettings({ ...saved, ...input, weather: { ...saved.weather, ...input.weather } });
            await fs.mkdir(path.dirname(configPath), { recursive: true, mode: 0o700 });
            await fs.writeFile(configPath, JSON.stringify({ ...saved, ...next }, null, 2), { mode: 0o600 });
            res.end(JSON.stringify(next));
          } else if (route === '/weather') res.end(JSON.stringify(await services.weather(settings)));
          else if (route === '/telemetry') res.end(JSON.stringify(await services.telemetry()));
          else if (route === '/media') res.end(JSON.stringify(await services.media()));
          else { res.statusCode = 404; res.end('{}'); }
        } catch { res.statusCode = 500; res.end('{}'); }
      });
      server.middlewares.use('/api/dashboard/agenda', async (req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        if (req.method !== 'GET') { res.statusCode = 405; res.end('{}'); return; }
        const cfg = await fs.readFile(configPath, 'utf8').then(JSON.parse).catch(() => ({}));
        const privatePath = cfg.plannerTokenFile || path.join(os.homedir(), '.config', 'ambient-dashboard', 'planner_token.txt');
        const token = (await fs.readFile(privatePath, 'utf8').catch(() => '')).trim();
        if (!token || !cfg.plannerUrl) { res.end(JSON.stringify({ data: null, updatedAt: null, state: 'unconfigured' })); return; }
        try {
          const base = cfg.plannerUrl;
          const headers = { Authorization: `Bearer ${token}` };
          const metaResponse = await fetch(`${base}/api/v1/agenda/meta`, { headers, signal: AbortSignal.timeout(5000) });
          if (!metaResponse.ok) throw Error('Planner unavailable');
          const from = iso(new Date(Date.now() - 7 * 86400000)), to = iso(new Date(Date.now() + 23 * 86400000));
          const url = new URL(`${base}/api/v1/agenda`);
          url.searchParams.set('from', from); url.searchParams.set('to', to);
          const agendaResponse = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
          if (!agendaResponse.ok) throw Error('Planner unavailable');
          const data = { meta: await metaResponse.json(), agenda: await agendaResponse.json() };
          res.end(JSON.stringify({ data, updatedAt: new Date().toISOString(), state: 'fresh' }));
        } catch { res.statusCode = 502; res.end(JSON.stringify({ data: null, updatedAt: null, state: 'stale' })); }
      });
    }
  }],
  server: { host: '127.0.0.1', port: 5173, strictPort: true }
});
