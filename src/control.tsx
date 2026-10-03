import { nightLevel, type SolarDay } from './appearance';
import React, { useEffect, useRef, useState } from 'react';
import './control.css';

type Weather = { solar?: SolarDay[]; alerts?: { kind: string; label: string; shortLabel?: string; start: number; end: number }[]; alert: { text: string } | null; summary: { temperatureC: number; condition: string } | null; location: string; updatedAt: string | null };
type Settings = { appearance: 'auto' | 'solar' | 'light' | 'dark'; autoPerformance: boolean; alwaysPerformance: boolean; autoStart: boolean; preventDisplaySleep: boolean; displayBrightness: number; artTheme: string; artThemes: string[]; animation: string; scheduleDensity: string; scheduleScrollSpeed: number; weather: { name: string; latitude: number; longitude: number }; weatherIntervals: Record<string, number>; plannerUrl: string; plannerTokenFile?: string; weatherUsageFile?: string; agendaRefreshSeconds: number; highLoadCpu: number; highLoadGpu: number; highLoadSeconds: number; targetDisplayId: number | null };
type WeatherUsage = { sharing?: { enabled: boolean; available: boolean; path: string; error: string | null }; requestsLast24h: number; localSuccessLast24h: number; localFailedLast24h: number; localRecordedFrom: string | null; limit: number; provider: string; configured: boolean; officialStats?: { available: boolean; asOf: string | null; totalSuccess24h: number | null; byApi: { api: string; count: number }[] } | null; endpoints: { key: string; label: string; count: number; success: number; failed: number; intervalMinutes: number | null }[] };
type Memo = { id: string; text: string; order: number; createdAt: string; updatedAt: string; expiresAt: string | null };
type Status = { mode: string; artTheme: string; artThemes: string[]; connected: boolean; displayAvailable?: boolean; screenAwakeActive?: boolean };
type Agenda = { state: string; updatedAt: string | null; data: { agenda: { tasks: unknown[]; courses: unknown[] } } | null };
type Telemetry = { cpuPercent: number | null; ramUsedGB: number; ramTotalGB: number; gpu?: { use: number | null; tempC: number | null } | null; cpuTempC: number | null };
const api = '/api/dashboard';
async function request<T>(route: string, value?: unknown): Promise<T> {
  const response = await fetch(`${api}/${route}`, value === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  if (!response.ok) throw Error(`HTTP ${response.status}`);
  return response.json();
}
const dateInput = (iso: string | null) => iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
const pct = (value: number | null | undefined) => value == null ? '—' : `${Math.round(value)}%`;
const dataLag = (asOf: string | null) => {
  if (!asOf) return '等待官方统计时间';
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(asOf)) / 60000));
  const hours = Math.floor(minutes / 60), remainder = minutes % 60;
  return `数据延迟约 ${hours ? `${hours}小时` : ''}${remainder}分`;
};
function TemperatureDisplay({ value }: { value: number }) { const [whole, fraction] = Number(value).toFixed(2).split('.'); return <span className="temperature-value"><span>{whole}</span><small>.{fraction}</small><sup>°</sup></span>; }
export default function Control() {
  const [now, setNow] = useState(() => new Date());
  const [settings, setSettings] = useState<Settings | null>(null);
  const [memos, setMemos] = useState<Memo[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [agenda, setAgenda] = useState<Agenda | null>(null);
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [weather, setWeather] = useState<Weather | null>(null);
  const [weatherUsage, setWeatherUsage] = useState<WeatherUsage | null>(null);
  const [media, setMedia] = useState<{ title: string; artist: string } | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [screenAwakeBusy, setScreenAwakeBusy] = useState(false);
  const [demoMenuOpen, setDemoMenuOpen] = useState(false);
  const brightnessTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const brightnessPending = useRef<number | null>(null);
  const livePending = useRef<Partial<Settings>>({});
  const liveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveQueue = useRef(Promise.resolve());
  const [confirmQuit, setConfirmQuit] = useState(false);
  const loadStatus = () => Promise.all([
    request<Status>('control').then(setStatus),
    request<Agenda>('agenda').then(setAgenda),
    request<Telemetry>('system/telemetry').then(setTelemetry),
    request<Weather>('system/weather').then(setWeather),
    request<WeatherUsage>('system/weather-usage').then(setWeatherUsage),
    request<{ title: string; artist: string } | null>('system/media').then(setMedia)
  ].map(p => p.catch(() => {})));
  useEffect(() => {
    const clock = setInterval(() => setNow(new Date()), 30000);
    request<Settings>('system/settings').then(value => setSettings({ ...value, scheduleScrollSpeed: value.scheduleScrollSpeed ?? 24 })).catch(() => setMessage('设置读取失败'));
    request<Memo[]>('system/memo').then(setMemos).catch(() => setMessage('Memo 读取失败'));
    loadStatus();
    const timer = setInterval(() => {
      request<Status>('control').then(setStatus).catch(() => {});
      request<Telemetry>('system/telemetry').then(setTelemetry).catch(() => {});
    }, 5000);
    const channel = new BroadcastChannel('ambient-dashboard-control');
    channel.onmessage = event => { if (event.data?.state) setStatus({ ...event.data.state, connected: true }); };
    const mediaTimer = setInterval(() => request<typeof media>('system/media').then(setMedia).catch(() => {}), 2000);
    const weatherTimer = setInterval(() => request<typeof weather>('system/weather').then(setWeather).catch(() => {}), 120000);
    const weatherUsageTimer = setInterval(() => request<WeatherUsage>('system/weather-usage').then(setWeatherUsage).catch(() => {}), 60000);
    return () => { clearInterval(clock); clearInterval(timer); clearInterval(mediaTimer); clearInterval(weatherTimer); clearInterval(weatherUsageTimer); if (brightnessTimer.current) clearTimeout(brightnessTimer.current); channel.close(); };
  }, []);
  const notify = (text: string) => { setMessage(text); setTimeout(() => setMessage(''), 4000); };
  const command = async (action: string) => {
    try {
      const next = await request<Status>('control', { action });
      setStatus(next);
      if (action === 'refresh-weather') request<typeof weather>('system/weather').then(setWeather).catch(() => {});
      if (action === 'refresh-media') request<typeof media>('system/media').then(setMedia).catch(() => {});
      const channel = new BroadcastChannel('ambient-dashboard-control');
      channel.postMessage({ action }); channel.close();
      if (action === 'refresh-agenda') setTimeout(() => request<Agenda>('agenda').then(setAgenda).catch(() => {}), 800);
      notify('指令已发送');
    } catch { notify('控制指令发送失败'); }
  };
  const saveSettings = async () => {
    if (!settings) return;
    setBusy(true);
    try {
      const manual = { weather: settings.weather, targetDisplayId: settings.targetDisplayId, plannerUrl: settings.plannerUrl, plannerTokenFile: settings.plannerTokenFile, weatherUsageFile: settings.weatherUsageFile, agendaRefreshSeconds: settings.agendaRefreshSeconds, highLoadCpu: settings.highLoadCpu, highLoadGpu: settings.highLoadGpu, highLoadSeconds: settings.highLoadSeconds };
      const saved = await request<Settings>('system/settings', manual);
      setSettings(old => old ? { ...old, ...Object.fromEntries(Object.keys(manual).map(key => [key, saved[key as keyof Settings]])) } : saved);
      const channel = new BroadcastChannel('ambient-dashboard-control'); channel.postMessage({ action: 'settings' }); channel.close();
      notify('设置已保存，副屏将同步更新');
    } catch { notify('设置保存失败'); }
    finally { setBusy(false); }
  };
  const quit = async () => {
    try {
      await request<{ closing: boolean }>('control', { action: 'quit' });
      setConfirmQuit(false); setStatus(old => old ? { ...old, connected: false } : old);
      notify('桌面程序已退出');
    } catch { notify('关闭失败：桌面程序可能未运行'); }
  };
  const patch = (key: keyof Settings, value: unknown) => {
    setSettings(old => old ? { ...old, [key]: value } : old);
    if (!['appearance', 'artTheme', 'artThemes', 'animation', 'scheduleScrollSpeed', 'scheduleDensity', 'autoPerformance', 'alwaysPerformance', 'autoStart', 'weatherIntervals'].includes(key)) return;
    livePending.current = { ...livePending.current, [key]: value };
    if (liveTimer.current) clearTimeout(liveTimer.current);
    liveTimer.current = setTimeout(() => {
      const update = livePending.current;
      livePending.current = {};
      liveQueue.current = liveQueue.current.then(async () => {
        try {
          await request<Settings>('system/settings', update);
          const channel = new BroadcastChannel('ambient-dashboard-control');
          channel.postMessage({ action: 'settings' }); channel.close();
        } catch { notify('即时设置保存失败，请重试'); }
      });
    }, key === 'scheduleScrollSpeed' ? 100 : 0);
  };
  const persistBrightness = (value: number) => {
    brightnessPending.current = null;
    request<Settings>('system/settings', { displayBrightness: value }).catch(() => {
      if (brightnessPending.current === null) {
        request<Settings>('system/settings').then(saved => {
          setSettings(old => old ? { ...old, displayBrightness: saved.displayBrightness } : saved);
          const channel = new BroadcastChannel('ambient-dashboard-control');
          channel.postMessage({ action: 'brightness-preview', value: saved.displayBrightness });
          channel.close();
        }).catch(() => {});
      }
      notify('亮度保存失败');
    });
  };
  const adjustBrightness = (value: number) => {
    brightnessPending.current = value;
    setSettings(old => old ? { ...old, displayBrightness: value } : old);
    const channel = new BroadcastChannel('ambient-dashboard-control');
    channel.postMessage({ action: 'brightness-preview', value });
    channel.close();
    if (brightnessTimer.current) clearTimeout(brightnessTimer.current);
    brightnessTimer.current = setTimeout(() => persistBrightness(value), 220);
  };
  const flushBrightness = () => {
    if (brightnessPending.current === null) return;
    if (brightnessTimer.current) clearTimeout(brightnessTimer.current);
    persistBrightness(brightnessPending.current);
  };
  const toggleScreenAwake = async (enabled: boolean) => {
    if (screenAwakeBusy) return;
    setScreenAwakeBusy(true);
    setSettings(old => old ? { ...old, preventDisplaySleep: enabled } : old);
    try {
      const saved = await request<Settings>('system/settings', { preventDisplaySleep: enabled });
      setSettings(old => old ? { ...old, preventDisplaySleep: saved.preventDisplaySleep } : saved);
      setStatus(old => old ? { ...old, screenAwakeActive: saved.preventDisplaySleep } : old);
    } catch {
      setSettings(old => old ? { ...old, preventDisplaySleep: !enabled } : old);
      notify('屏幕休眠设置失败');
    } finally { setScreenAwakeBusy(false); }
  };
  const weatherPatch = (key: keyof Settings['weather'], value: string | number) => setSettings(old => old ? { ...old, weather: { ...old.weather, [key]: value } } : old);
  const updateMemo = (index: number, patch: Partial<Memo>) => setMemos(old => old.map((m, i) => i === index ? { ...m, ...patch } : m));
  const saveMemo = async () => {
    setBusy(true);
    try {
      const clean = memos.filter(m => m.text.trim()).map((m, i) => ({ ...m, text: m.text.trim(), order: i }));
      setMemos(await request<Memo[]>('system/memo', clean));
      const channel = new BroadcastChannel('ambient-dashboard-control'); channel.postMessage({ action: 'memo' }); channel.close();
      notify('Memo 已保存');
    } catch { notify('Memo 保存失败'); }
    finally { setBusy(false); }
  };
  const displayUrl = location.port === '5173' ? '/' : '/display';
  const clockParts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now).split(':').map(Number);
  const hour = clockParts[0] + clockParts[1] / 60;
  const night = nightLevel(settings?.appearance, now, weather?.solar);
  const contrastInk = (threshold: number, inverted = false) => (night >= threshold) !== inverted ? '#ffffff' : '#000000';
  return <main className={`control-page ${night >= .635 ? 'is-dark' : 'is-light'}`} style={{ '--control-night': `${(night * 100).toFixed(2)}%`, '--control-root-ink': contrastInk(.58), '--control-card-ink': contrastInk(.635), '--control-primary-ink': contrastInk(.41, true), '--control-root-inverse': contrastInk(.58, true) } as React.CSSProperties}>
    <header className="control-header"><div><small>AMBIENT DASHBOARD</small><h1>控制面板</h1><p>副屏展示与本机设置</p></div><div className="control-header-right"><span className={`control-connection ${status?.connected ? 'connected' : ''}`}>{status?.connected ? '副屏已连接' : '未连接'}</span><a href={displayUrl} target="_blank" rel="noreferrer">打开展示画面 ↗</a>{confirmQuit ? <span className="control-quit-confirm"><button onClick={quit}>确认关闭</button><button onClick={() => setConfirmQuit(false)}>取消</button></span> : <button className="control-quit" onClick={() => setConfirmQuit(true)}>关闭软件</button>}</div></header>
    {message && <div className="control-message" role="status">{message}</div>}
    <div className="control-grid">
      <section className="control-section control-live"><div className="control-section-head"><span>01 / DISPLAY</span><h2>展示控制</h2></div><div className="control-mode"><span>当前模式</span><strong>{status?.mode === 'performance' ? 'Performance' : 'Normal'}</strong><small>图案：{status?.artTheme || '—'}</small></div><div className="control-actions"><button aria-pressed={status?.mode !== 'performance'} className={status?.mode !== 'performance' ? 'primary' : ''} onClick={() => command('normal')}>Normal</button><button aria-pressed={status?.mode === 'performance'} className={status?.mode === 'performance' ? 'primary' : ''} onClick={() => command('performance')}>Performance</button><button onClick={() => command('next-art')}>切换图案</button><button onClick={() => command('scroll-top')}>日程回到顶部</button><button onClick={() => command('refresh-agenda')}>刷新日程</button><button onClick={() => command('refresh-weather')}>刷新天气</button><button onClick={() => command('refresh-media')}>刷新音乐</button><div className="simulator-menu" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDemoMenuOpen(false); }}><button aria-haspopup="true" aria-expanded={demoMenuOpen} onClick={() => setDemoMenuOpen(open => !open)}>模拟提醒⌄</button>{demoMenuOpen && <div className="simulator-menu-options" role="group" aria-label="选择模拟提醒"><button onClick={() => { void command('windrain-demo'); setDemoMenuOpen(false); }}>风雨提醒（8秒）</button><button onClick={() => { void command('warning-demo'); setDemoMenuOpen(false); }}>天气预警（8秒）</button><button onClick={() => { void command('solar-demo'); setDemoMenuOpen(false); }}>日月提醒（8秒）</button></div>}</div><button onClick={() => command(status?.connected ? 'close-display' : 'open-display')}>{status?.connected ? '关闭副屏展示' : '打开副屏展示'}</button><button className={settings?.preventDisplaySleep ? 'primary' : ''} aria-pressed={settings?.preventDisplaySleep || false} disabled={!settings || screenAwakeBusy || busy} onClick={() => toggleScreenAwake(!settings?.preventDisplaySleep)}>{settings?.preventDisplaySleep ? '关闭屏幕常亮' : '保持屏幕常亮'}</button></div><div className="control-brightness"><label htmlFor="display-brightness">模拟亮度</label><input id="display-brightness" type="range" min="10" max="100" step="5" value={settings?.displayBrightness ?? 100} disabled={!settings} onChange={e => adjustBrightness(Number(e.target.value))} onPointerUp={flushBrightness} onKeyUp={flushBrightness} onBlur={flushBrightness}/><strong>{settings?.displayBrightness ?? 100}%</strong></div><div className="control-facts"><div><span>规划器</span><strong>{agenda?.state === 'fresh' ? '已同步' : agenda?.state === 'stale' ? '使用缓存' : '待连接'}</strong><small>{agenda?.updatedAt ? new Date(agenda.updatedAt).toLocaleString() : '暂无同步时间'}</small></div><div><span>待展示数据</span><strong>{(agenda?.data?.agenda?.courses.length || 0) + (agenda?.data?.agenda?.tasks.length || 0)}</strong><small>课程与事项总数</small></div><div><span>天气</span><strong>{weather?.summary ? <>{weather.summary.condition} <TemperatureDisplay value={weather.summary.temperatureC}/></> : '暂无天气'}</strong>{weather?.alerts?.filter(event => event.end > now.getTime() && event.start - now.getTime() <= (['sunrise','sunset','moonrise','moonset'].includes(event.kind) ? 30 * 60000 : 6 * 3600000)).slice(0, 1).map(event => { const target = new Date(now.getTime() < event.start ? event.start : event.end); const localDay = (date: Date) => date.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }); const delta = Math.round((Date.parse(`${localDay(target)}T00:00:00Z`) - Date.parse(`${localDay(now)}T00:00:00Z`)) / 86400000); return <small key={`${event.kind}-${event.start}`}>{event.shortLabel || event.label} · {target.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}{delta !== 0 && <sup className="day-offset">{delta > 0 ? `+${delta}` : delta}</sup>}</small>; })}<small>{weather?.location || '—'}{weather?.updatedAt && ` · ${new Date(weather.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 更新`}</small></div><div><span>当前播放</span><strong>{media?.title || '未播放'}</strong><small>{media?.artist || '—'}</small></div></div><div className="control-metrics"><span>CPU <b>{pct(telemetry?.cpuPercent)}</b></span><span>GPU <b>{pct(telemetry?.gpu?.use)}</b></span><span>RAM <b>{telemetry ? `${telemetry.ramUsedGB.toFixed(1)} GB` : '—'}</b></span><span>CPU 温度 <b>{telemetry?.cpuTempC == null ? '—' : `${Math.round(telemetry.cpuTempC)}°`}</b></span></div></section>
      <section className="control-section control-memo"><div className="control-section-head"><span>02 / MEMO</span><h2>备忘</h2></div><p className="control-hint">逐条编辑；留空后保存即删除。有效期留空表示长期保留。</p><div className="control-memo-list">{memos.map((memo, index) => <div className="control-memo-row" key={memo.id}><div className="control-memo-row-head"><span>{String(index + 1).padStart(2, '0')}</span><button onClick={() => setMemos(old => old.filter((_, i) => i !== index))}>删除</button></div><textarea aria-label={`备忘 ${index + 1}`} value={memo.text} onChange={e => updateMemo(index, { text: e.target.value })}/><label>有效期至 <input type="datetime-local" value={dateInput(memo.expiresAt)} onChange={e => updateMemo(index, { expiresAt: e.target.value ? new Date(e.target.value).toISOString() : null })}/></label></div>)}</div><div className="control-actions"><button onClick={() => setMemos(old => [...old, { id: crypto.randomUUID(), text: '', order: old.length, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), expiresAt: null }])}>添加一条</button><button className="primary" disabled={busy} onClick={saveMemo}>保存 Memo</button></div></section>
      <section className="control-section control-settings"><div className="control-section-head"><span>03 / SETTINGS</span><h2>详细设置</h2></div>{settings ? <><div className="settings-instant"><div className="settings-group-heading"><h3>即时调整</h3><span>即时生效 · 自动保存</span></div><div className="control-form-grid live-form"><fieldset><legend>画面与行为</legend><div className="setting-choice"><span>明暗模式</span><div className="setting-options" role="group" aria-label="明暗模式"><button type="button" aria-pressed={settings.appearance === 'auto'} onClick={() => patch('appearance', 'auto')}>自动</button><button type="button" aria-pressed={settings.appearance === 'solar'} onClick={() => patch('appearance', 'solar')}>日出日落</button><button type="button" aria-pressed={settings.appearance === 'light'} onClick={() => patch('appearance', 'light')}>浅色</button><button type="button" aria-pressed={settings.appearance === 'dark'} onClick={() => patch('appearance', 'dark')}>深色</button></div></div><div className="setting-choice setting-art"><span>生成艺术</span><div className="setting-options art-options" role="group" aria-label="参与轮换的图案">{[['orbit','圆弧'],['grid','交汇'],['curve','分叉'],['bands','花瓣'],['offset','螺旋'],['fan','发散'],['diagonal','回环']].map(([value,label]) => <button key={value} type="button" aria-pressed={settings.artThemes?.includes(value)} onClick={() => { const selected = settings.artThemes || [settings.artTheme]; const next = selected.includes(value) ? selected.filter(item => item !== value) : [...selected,value]; if (!next.length) return; patch('artThemes',next); patch('artTheme','auto'); }}>{label}</button>)}</div></div><div className="setting-choice"><span>动画强度</span><div className="setting-options" role="group" aria-label="动画强度"><button type="button" aria-pressed={settings.animation === 'normal'} onClick={() => patch('animation', 'normal')}>正常</button><button type="button" aria-pressed={settings.animation === 'low'} onClick={() => patch('animation', 'low')}>减弱</button><button type="button" aria-pressed={settings.animation === 'off'} onClick={() => patch('animation', 'off')}>关闭</button></div></div><label>自动滚动速度（{settings.scheduleScrollSpeed === 0 ? '关闭' : `${settings.scheduleScrollSpeed} px/s`}） <input type="range" min="0" max="48" step="4" value={settings.scheduleScrollSpeed} onChange={e => patch('scheduleScrollSpeed', Number(e.target.value))}/></label><div className="setting-choice"><span>日程密度</span><div className="setting-options" role="group" aria-label="日程密度"><button type="button" aria-pressed={settings.scheduleDensity === 'compact'} onClick={() => patch('scheduleDensity', 'compact')}>紧凑</button><button type="button" aria-pressed={settings.scheduleDensity === 'relaxed'} onClick={() => patch('scheduleDensity', 'relaxed')}>宽松</button></div></div><div className="setting-choice"><span>自动切换 Performance</span><div className="setting-options"><button type="button" aria-pressed={settings.autoPerformance} onClick={() => patch('autoPerformance', !settings.autoPerformance)}>{settings.autoPerformance ? '已开启' : '已关闭'}</button></div></div><div className="setting-choice"><span>常驻 Performance</span><div className="setting-options"><button type="button" aria-pressed={settings.alwaysPerformance} onClick={() => patch("alwaysPerformance", !settings.alwaysPerformance)}>{settings.alwaysPerformance ? "已开启" : "已关闭"}</button></div></div><div className="setting-choice"><span>登录后自动启动</span><div className="setting-options"><button type="button" aria-pressed={settings.autoStart} onClick={() => patch('autoStart', !settings.autoStart)}>{settings.autoStart ? '已开启' : '已关闭'}</button></div></div></fieldset></div></div><div className="settings-manual"><div className="settings-group-heading"><h3>基础配置</h3><span>修改后点击保存</span></div><div className="control-form-grid manual-form"><fieldset><legend>天气与屏幕</legend><label>位置名称 <input value={settings.weather.name} onChange={e => weatherPatch('name', e.target.value)}/></label><label>纬度 <input type="number" step=".01" value={settings.weather.latitude} onChange={e => weatherPatch('latitude', Number(e.target.value))}/></label><label>经度 <input type="number" step=".01" value={settings.weather.longitude} onChange={e => weatherPatch('longitude', Number(e.target.value))}/></label><label>目标屏幕 ID <input type="number" placeholder="自动选择非主竖屏" value={settings.targetDisplayId ?? ''} onChange={e => patch('targetDisplayId', e.target.value === '' ? null : Number(e.target.value))}/></label></fieldset><fieldset><legend>日程与性能</legend><label>跨系统天气统计文件 <input value={settings.weatherUsageFile || ''} placeholder="留空使用本机统计；两端选择同一个共享文件" onChange={e => patch('weatherUsageFile', e.target.value)}/></label><label>规划器地址 <input value={settings.plannerUrl} onChange={e => patch('plannerUrl', e.target.value)}/></label><label>Token 文件路径 <input value={settings.plannerTokenFile || ''} placeholder="使用默认路径" onChange={e => patch('plannerTokenFile', e.target.value)}/></label><label>日程刷新间隔（秒） <input type="number" min="30" value={settings.agendaRefreshSeconds} onChange={e => patch('agendaRefreshSeconds', Number(e.target.value))}/></label><label>高负载 CPU 阈值（%） <input type="number" min="50" max="100" value={settings.highLoadCpu} onChange={e => patch('highLoadCpu', Number(e.target.value))}/></label><label>高负载 GPU 阈值（%） <input type="number" min="20" max="100" value={settings.highLoadGpu} onChange={e => patch("highLoadGpu", Number(e.target.value))}/></label><label>高负载持续时间（秒） <input type="number" min="10" value={settings.highLoadSeconds} onChange={e => patch('highLoadSeconds', Number(e.target.value))}/></label></fieldset></div><div className="control-actions"><button className="primary" disabled={busy || screenAwakeBusy} onClick={saveSettings}>保存基础配置</button></div></div><div className="weather-usage-panel"><div className="settings-group-heading"><h3>天气请求</h3><span>{weatherUsage?.configured ? '和风天气' : '待配置凭据'} · 间隔即时保存</span></div><div className="weather-usage-summary"><strong>{weatherUsage?.officialStats?.available ? weatherUsage.officialStats.totalSuccess24h?.toLocaleString() : weatherUsage?.requestsLast24h?.toLocaleString() || '—'}</strong><span>{weatherUsage?.officialStats?.available ? '/ 24 小时官方账户成功请求（所有项目/凭据）' : weatherUsage?.sharing?.enabled ? '/ 跨系统请求尝试 · 滚动24小时' : '/ 本机请求尝试 · 滚动24小时'}</span><div className="weather-usage-meter"><i style={{ width: `${Math.min(100, ((weatherUsage?.officialStats?.available ? weatherUsage.officialStats.totalSuccess24h || 0 : weatherUsage?.requestsLast24h || 0) / (weatherUsage?.limit || 1000)) * 100)}%` }}/></div><small>{weatherUsage?.officialStats?.available ? `统计截至 ${weatherUsage.officialStats.asOf ? new Date(weatherUsage.officialStats.asOf).toLocaleString() : '—'}，${dataLag(weatherUsage.officialStats.asOf)}` : `本机估算上限 ${weatherUsage?.limit || 1000} 次/24h`}</small><small>{weatherUsage?.sharing?.enabled ? '本软件跨系统' : '本软件本机'}滚动24小时：成功 {weatherUsage?.localSuccessLast24h ?? 0} · 失败 {weatherUsage?.localFailedLast24h ?? 0}（跨重启保存）</small>{weatherUsage?.sharing?.enabled && <small>{weatherUsage.sharing.available ? '共享统计已同步' : '共享统计暂不可用，本机记录已保留'}{weatherUsage.sharing.error && `：${weatherUsage.sharing.error}`}</small>}<small>接口数字是实际尝试；选项表示计划间隔</small></div><div className="weather-interval-grid">{(weatherUsage?.endpoints || []).map(item => <label key={item.key}><span>{item.label} <small>近24h {item.count} · 成{item.success}/败{item.failed}</small></span><select value={settings.weatherIntervals?.[`${item.key}Minutes`] || item.intervalMinutes || 15} onChange={e => patch('weatherIntervals', { ...settings.weatherIntervals, [`${item.key}Minutes`]: Number(e.target.value) })}>{[5,10,15,30,60,120,180,360].map(minutes => <option key={minutes} value={minutes}>{minutes < 60 ? `${minutes} 分钟` : `${minutes / 60} 小时`}</option>)}</select></label>)}</div>{weatherUsage?.officialStats?.available && <div className="weather-api-counts">{weatherUsage.officialStats.byApi.map(item => <span key={item.api}>{item.api} <b>{item.count}</b></span>)}</div>}</div></> : <p>设置载入中…</p>}</section>
    </div><footer>本机地址：{location.origin}/control · 仅在这台电脑上访问</footer>
  </main>;
}
