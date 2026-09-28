const http = require('node:http');
const os = require('node:os');
const crypto = require('node:crypto');
const QRCode = require('qrcode');

const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const address = () => Object.values(os.networkInterfaces()).flat().find(info => info?.family === 'IPv4' && !info.internal)?.address;
let active = null;

async function startMemoEditor(readMemo, saveMemo) {
  if (active) return active.result;
  const ip = address();
  if (!ip) return { available: false };
  const prefix = '/memo';
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Ambient-Dashboard', 'memo');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (req.url !== prefix || !['GET', 'POST'].includes(req.method)) { res.writeHead(404).end(); return; }
    try {
      let message = '';
      if (req.method === 'POST') {
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 20000) { res.writeHead(413).end(); return; }
        }
        const params = new URLSearchParams(body);
        const previous = await readMemo();
        const expiry = params.get('expiry') || 'never';
        const duration = expiry === 'never' ? null : Number(expiry);
        const lines = params.get('action') === 'clear' ? [] : String(params.get('memo') || '').split('\n').map(s => s.trim()).filter(Boolean).slice(0, 30).map((text, i) => ({
          id: previous[i]?.id || crypto.randomUUID(), text, order: i,
          createdAt: previous[i]?.createdAt || new Date().toISOString(),
          expiresAt: duration && Number.isFinite(duration) ? new Date(Date.now() + Math.min(duration, 24 * 365) * 3600000).toISOString() : null
        }));
        await saveMemo(lines);
        message = '已保存';
      }
      const current = await readMemo();
      const text = current.map(item => item.text).join('\n');
      const nonce = crypto.randomBytes(12).toString('base64');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Security-Policy', `default-src 'none'; style-src 'nonce-${nonce}'; form-action 'self'; base-uri 'none'`);
      res.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Memo</title><style nonce="${nonce}">body{margin:0;background:#f1efe9;color:#303330;font:18px/1.6 Georgia,'Noto Serif CJK SC',serif}main{max-width:550px;margin:9vh auto;padding:24px}h1{font-size:28px;font-weight:400}textarea{box-sizing:border-box;width:100%;height:45vh;padding:15px;background:#faf9f4;border:1px solid #bdb9ad;color:inherit;font:inherit;resize:vertical}label{display:block;margin:18px 0}select,button{font:inherit;padding:8px 14px;border:1px solid #8b897f;background:transparent;color:inherit}button{margin-right:10px}.saved{color:#658074}</style><main><h1>Memo</h1>${message ? `<p class="saved">${message}</p>` : ''}<form method="post"><textarea name="memo" aria-label="Memo">${escapeHtml(text)}</textarea><label>有效期 <select name="expiry"><option value="never">长期</option><option value="6">6 小时</option><option value="24">1 天</option><option value="72">3 天</option><option value="168">7 天</option></select></label><button name="action" value="save">保存</button><button name="action" value="clear">清空</button></form></main></html>`);
    } catch { res.writeHead(500).end(); }
  });
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(3987, '0.0.0.0', resolve); });
  } catch (error) {
    if (error.code !== 'EADDRINUSE') throw error;
    const existing = await fetch('http://127.0.0.1:3987/memo', { signal: AbortSignal.timeout(2000) }).catch(() => null);
    if (existing?.headers.get('X-Ambient-Dashboard') !== 'memo') return { available: false };
  }
  const url = `http://${ip}:3987${prefix}`;
  const qr = await QRCode.toDataURL(url, { width: 220, margin: 1, color: { dark: '#313633', light: '#f7f6f0' } });
  const result = { available: true, url, qr };
  if (server.listening) active = { server, result };
  return result;
}
function stopMemoEditor() {
  if (!active) return;
  active.server.close(); active = null;
}
module.exports = { startMemoEditor, stopMemoEditor };
