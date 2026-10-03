const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

let active = null;
const json = (res, value, code = 200) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(value));
};
async function body(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 65536) throw Error('Request too large');
  }
  return JSON.parse(raw || '{}');
}
async function startControlServer(handlers) {
  if (active) return active.url;
  const dist = path.join(__dirname, '..', 'dist');
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1:3988');
    if (req.method === 'POST') {
      const origin = req.headers.origin;
      if (origin && origin !== 'http://127.0.0.1:3988') return json(res, { error: 'Invalid origin' }, 403);
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) return json(res, { error: 'JSON required' }, 415);
    }
    try {
      const route = url.pathname;
      if (route === '/api/dashboard/control' && req.method === 'GET') return json(res, handlers.status());
      if (route === '/api/dashboard/control' && req.method === 'POST') {
        const input = await body(req);
        if (input.action === 'quit') { handlers.quit(); return json(res, { closing: true }); }
        if (!['normal', 'performance', 'next-art', 'refresh-agenda', 'scroll-top', 'reminder-demo', 'windrain-demo', 'warning-demo', 'solar-demo', 'refresh-weather', 'refresh-media', 'open-display', 'close-display'].includes(input.action)) return json(res, { error: 'Unknown action' }, 400);
        await handlers.command(input.action);
        return json(res, handlers.status());
      }
      if (route === '/api/dashboard/system/settings' && req.method === 'GET') return json(res, await handlers.settings());
      if (route === '/api/dashboard/system/settings' && req.method === 'POST') return json(res, await handlers.saveSettings(await body(req)));
      if (route === '/api/dashboard/system/memo' && req.method === 'GET') return json(res, await handlers.memo());
      if (route === '/api/dashboard/system/memo' && req.method === 'POST') return json(res, await handlers.saveMemo(await body(req)));
      if (route === '/api/dashboard/system/weather' && req.method === 'GET') return json(res, await handlers.weather());
      if (route === '/api/dashboard/system/weather-usage' && req.method === 'GET') return json(res, await handlers.weatherUsage());
      if (route === '/api/dashboard/system/media' && req.method === 'GET') return json(res, await handlers.media());
      if (route === '/api/dashboard/system/presence' && req.method === 'POST') return json(res, await handlers.presence(await body(req)), 202);
      if (route === '/api/dashboard/system/presence' && req.method === 'DELETE') return json(res, handlers.clearPresence());
      if (route.startsWith('/api/dashboard/system/presence/') && req.method === 'DELETE') return json(res, handlers.clearPresence(decodeURIComponent(route.slice('/api/dashboard/system/presence/'.length))));
      if (route === '/api/dashboard/system/telemetry' && req.method === 'GET') return json(res, await handlers.telemetry());
      if (route === '/api/dashboard/agenda' && req.method === 'GET') return json(res, await handlers.agenda());
      if (req.method !== 'GET') return json(res, { error: 'Method not allowed' }, 405);
      const file = route === '/' || route === '/control' || route === '/display' ? path.join(dist, 'index.html')
        : /^\/assets\/[\w.-]+$/.test(route) ? path.join(dist, route.slice(1)) : null;
      if (!file) return json(res, { error: 'Not found' }, 404);
      const data = await fs.readFile(file);
      const type = file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.js') ? 'text/javascript; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : file.endsWith('.woff2') ? 'font/woff2' : file.endsWith('.woff') ? 'font/woff' : 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
      res.end(data);
    } catch (error) { json(res, { error: String(error) }, 500); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(3988, '127.0.0.1', resolve); });
  active = { server, url: 'http://127.0.0.1:3988/control' };
  return active.url;
}
function stopControlServer() { if (active) { active.server.close(); active = null; } }
module.exports = { startControlServer, stopControlServer };
