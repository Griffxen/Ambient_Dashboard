import { nightLevel, type SolarDay } from './appearance';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import Control from './control';
import { createRoot } from 'react-dom/client';
import './style.css';

type Task = { id: string; title: string; category: string; date: string; end_date: string; start_time?: string; end_time?: string; due?: string | null; done?: boolean; notes?: string };
type Course = { date: string; name: string; time: string; room?: string };
type AgendaData = { meta: { semester?: { start: string }; categories?: { name: string; color: string }[] }; agenda: { tasks: Task[]; courses: Course[]; date_counts?: { date: string; count: number }[] } };
type AgendaResult = { data: AgendaData | null; updatedAt: string | null; state: 'fresh' | 'stale' | 'unconfigured' };
type Memo = { id: string; text: string; order: number; createdAt: string; updatedAt: string; expiresAt: string | null };
type ArtVariant = 'orbit' | 'grid' | 'curve' | 'bands' | 'offset' | 'fan' | 'diagonal';
const artChoices: ArtVariant[] = ['orbit', 'grid', 'curve', 'bands', 'offset', 'fan', 'diagonal'];
function WeatherIcon({ kind }: { kind: string }) {
  return <svg className="weather-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === 'wind' ? <><path d="M3 8h12c5 0 5-6 1-6M2 12h17c4 0 4 6 0 6M4 16h7c4 0 4 5 1 5"/></> : kind === 'warning' || kind === 'air' ? <><path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v5M12 18h.01"/></> : kind === 'sunrise' || kind === 'sunset' ? <><path d="M2 17h20M6 17a6 6 0 0 1 12 0M12 3v3M3 8l2 2M21 8l-2 2"/><path d={kind === 'sunrise' ? 'M8 21h8' : 'M10 21h4'}/></> : kind === 'moonrise' || kind === 'moonset' ? <><path d="M2 18h20M12 3a7 7 0 0 0 8 10A8 8 0 1 1 12 3Z"/><path d={kind === 'moonrise' ? 'M7 22l2-2 2 2' : 'M7 20l2 2 2-2'}/></> : <><path d="M5 13a4 4 0 0 1 1-8 6 6 0 0 1 11 1 3.5 3.5 0 0 1 2 7"/>{kind === 'snow' ? <><path d="M12 14v8M8.5 16l7 4M8.5 20l7-4"/></> : <path d="M6 16l-1 4M12 16l-1 4M18 16l-1 4"/>}</>}
  </svg>;
}
function FadingMusic({ title, artist }: { title: string; artist: string }) {
  const [shown, setShown] = useState({ title, artist });
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    if (shown.title === title && shown.artist === artist) return;
    setVisible(false);
    const timer = setTimeout(() => { setShown({ title, artist }); setVisible(true); }, 650);
    return () => clearTimeout(timer);
  }, [title, artist, shown]);
  return <span className="music-track-text" style={{ opacity: visible ? 1 : 0 }}>{shown.title}{shown.artist && <small> / {shown.artist}</small>}</span>;
}
type HoverDetail = { id: string; content: React.ReactNode };
function HoverDetailRegion({ detail }: { detail: HoverDetail | null }) {
  const [shown, setShown] = useState<HoverDetail | null>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    setVisible(false);
    const timer = setTimeout(() => { setShown(detail); setVisible(!!detail); }, shown ? 450 : 0);
    return () => clearTimeout(timer);
  }, [detail]);
  return <aside className={`hover-detail-region${visible ? ' visible' : ''}`} aria-hidden={!visible}>{shown?.content}</aside>;
}
function WeatherNotice({ text, dayOffset = 0 }: { text: string; dayOffset?: number }) {
  const [shown, setShown] = useState({ text, dayOffset });
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    if (text === shown.text && dayOffset === shown.dayOffset) return;
    setVisible(false);
    const timer = setTimeout(() => { setShown({ text, dayOffset }); setVisible(true); }, 450);
    return () => clearTimeout(timer);
  }, [text, dayOffset, shown]);
  const timeLabel = shown.text.match(/^(.*?)(\d{2}:\d{2})(\s*(?:始|止))$/);
  return <span className="weather-notice-text" style={{ opacity: visible ? 1 : 0 }}>{timeLabel ? <>{timeLabel[1]}{timeLabel[2]}{shown.dayOffset !== 0 && <sup className="day-offset">{shown.dayOffset > 0 ? `+${shown.dayOffset}` : shown.dayOffset}</sup>}{timeLabel[3]}</> : <>{shown.text}{shown.dayOffset !== 0 && <sup className="day-offset">{shown.dayOffset > 0 ? `+${shown.dayOffset}` : shown.dayOffset}</sup>}</>}</span>;
}
type Settings = { appearance: 'auto' | 'solar' | 'light' | 'dark'; autoPerformance: boolean; alwaysPerformance: boolean; artTheme: 'auto' | ArtVariant; artThemes?: ArtVariant[]; animation: 'normal' | 'low' | 'off'; scheduleDensity: 'compact' | 'relaxed'; scheduleScrollSpeed: number; displayBrightness: number; weather: { latitude: number; longitude: number; name: string }; highLoadCpu: number; highLoadGpu: number; highLoadSeconds: number; autoStart: boolean; agendaRefreshSeconds: number };
type WeatherEvent = { kind: string; label: string; shortLabel?: string; headline?: string; description?: string; instruction?: string; senderName?: string; start: number; end: number; at: number; approximate: boolean };
type Weather = { source?: string; details?: { feelsLikeC?: number; humidityPercent?: number; windDirectionDegrees?: number; windKmh?: number; gustKmh?: number; aqi?: { value?: string | number; category?: string; primaryPollutant?: string | null; advice?: string | null; pollutants?: { name: string; value: number; unit: string }[] } | null; hourlyAqi?: { at: number; aqi: string | number; category: string }[] }; solar?: SolarDay[]; alerts?: WeatherEvent[]; alert: { kind: string; text: string; at: number } | null; summary: { temperatureC: number; condition: string; highC?: number | null; lowC?: number | null } | null; tomorrow?: { condition: string; highC?: number | null; lowC?: number | null } | null; location: string; updatedAt: string | null };
type Telemetry = { at: string; cpuPercent: number | null; ramUsedGB: number; ramTotalGB: number; cpuTempC: number | null; gpu: { use: number | null; vramUsedMB: number | null; vramTotalMB: number | null; tempC: number | null; powerW: number | null; fanPercent: number | null; clockMHz: number | null } | null; netBytesPerSecond: number | null; diskBytesPerSecond: number | null; uptimeSeconds: number; cpuGHz: number | null };
type Media = { title: string; artist: string; album: string; artUrl: string; artData?: string; durationUs: number; positionUs: number; status: string } | null;
const defaultSettings: Settings = { appearance: 'auto', autoPerformance: true, alwaysPerformance: false, artTheme: 'auto', animation: 'normal', scheduleDensity: 'compact', scheduleScrollSpeed: 24, displayBrightness: 100, weather: { latitude: 39.99, longitude: 116.31, name: '北京' }, highLoadCpu: 85, highLoadGpu: 60, highLoadSeconds: 30, autoStart: false, agendaRefreshSeconds: 60 };
const normalizeSettings = (value: Partial<Settings>): Settings => ({ ...defaultSettings, ...value, scheduleScrollSpeed: value.scheduleScrollSpeed ?? defaultSettings.scheduleScrollSpeed, weather: { ...defaultSettings.weather, ...value.weather } });
declare global { interface Window { dashboard?: { agenda(): Promise<AgendaResult>; memo(): Promise<Memo[]>; saveMemo(lines: Memo[]): Promise<Memo[]>; lanMemo(): Promise<{ available: boolean; url?: string; qr?: string; expiresAt?: string }>; quit(): Promise<void>; settings(): Promise<Settings>; saveSettings(settings: Partial<Settings>): Promise<Settings>; weather(): Promise<Weather>; telemetry(): Promise<Telemetry>; media(): Promise<Media>; onCommand(callback: (action: string) => void): () => void; publishState(state: { mode: string; artTheme: string }): Promise<void> } } }
async function systemRequest<T>(route: string, body?: unknown): Promise<T> {
  if (window.dashboard) {
    if (route === 'settings' && body) return window.dashboard.saveSettings(body as Partial<Settings>) as Promise<T>;
    return ({ settings: window.dashboard.settings, weather: window.dashboard.weather, telemetry: window.dashboard.telemetry, media: window.dashboard.media }[route] as () => Promise<T>)();
  }
  const response = await fetch(`/api/dashboard/system/${route}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  if (!response.ok) throw Error(route);
  return response.json();
}
async function memoRequest<T>(method: 'get' | 'save' | 'lan', lines?: Memo[]): Promise<T> {
  if (window.dashboard) return (method === 'get' ? window.dashboard.memo() : method === 'save' ? window.dashboard.saveMemo(lines || []) : window.dashboard.lanMemo()) as Promise<T>;
  const route = method === 'lan' ? 'memo/lan' : 'memo';
  const response = await fetch(`/api/dashboard/system/${route}`, method === 'save' ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(lines) } : undefined);
  if (!response.ok) throw Error(route);
  return response.json();
}
const fmt = (d: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
const day = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const dayDelta = (date: Date, relative: Date) => Math.round((Date.parse(`${day(date)}T00:00:00Z`) - Date.parse(`${day(relative)}T00:00:00Z`)) / 86400000);
function TimeWithOffset({ value, relative }: { value: Date; relative: Date }) { const offset = dayDelta(value, relative); return <time>{fmt(value)}{offset !== 0 && <sup className="day-offset">{offset > 0 ? `+${offset}` : offset}</sup>}</time>; }
function TemperatureValue({ value }: { value: number }) { const [whole, fraction] = Number(value).toFixed(2).split('.'); return <span className="temperature-value"><span>{whole}</span><small>.{fraction}</small><sup>°</sup></span>; }
function WeatherSummaryCarousel({ summary, tomorrow, showTomorrow }: { summary: NonNullable<Weather['summary']>; tomorrow?: Weather['tomorrow']; showTomorrow: boolean }) {
  const [showingTomorrow, setShowingTomorrow] = useState(showTomorrow);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    if (showingTomorrow === showTomorrow) return;
    setVisible(false);
    const timer = setTimeout(() => { setShowingTomorrow(showTomorrow); setVisible(true); }, 520);
    return () => clearTimeout(timer);
  }, [showTomorrow, showingTomorrow]);
  return <span className={`weather-carousel-content${visible ? '' : ' fading'}`}>
    {showingTomorrow && tomorrow ? <><small className="tomorrow-label">明日</small>{tomorrow.condition && <span>{tomorrow.condition}</span>}{tomorrow.lowC != null && tomorrow.highC != null && <span>{Math.round(tomorrow.lowC)}–{Math.round(tomorrow.highC)}°</span>}</> : <>{summary.condition && <span>{summary.condition}</span>}<TemperatureValue value={summary.temperatureC}/>{summary.highC != null && summary.lowC != null && <span className="weather-range"><small aria-label="最高温度">{Math.round(summary.highC)}°</small><small aria-label="最低温度">{Math.round(summary.lowC)}°</small></span>}</>}
  </span>;
}
const weekday = (d: Date) => new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', weekday: 'short' }).format(d).toUpperCase();
const parseTime = (date: string, time: string) => new Date(`${date}T${time}:00+08:00`).getTime();
const parseDue = (value?: string | null) => !value ? NaN : /^\d{4}-\d{2}-\d{2}$/.test(value) ? parseTime(value, '23:59') : new Date(/[Zz]|[+-]\d\d:\d\d$/.test(value) ? value : `${value}+08:00`).getTime();
type AgendaItem = { id: string; title: string; at: number; endAt: number; dueAt: number | null; kind: 'course' | 'task'; category: string; notes: string; marker: '开始' | '结束' | '截止'; overdue: boolean };
function items(data: AgendaData | null, now: Date): AgendaItem[] {
  if (!data) return [];
  const tasks = data.agenda.tasks.filter(t => !t.done).map(t => {
    const plannedStart = parseTime(t.date, t.start_time || '00:00');
    const plannedEnd = parseTime(t.end_date || t.date, t.end_time || '23:59');
    const deadline = parseDue(t.due);
    const overdue = Number.isFinite(deadline) && deadline < now.getTime();
    const candidates: { at: number; marker: '开始' | '结束' | '截止' }[] = [
      ...(Number.isFinite(deadline) ? [{ at: deadline, marker: '截止' as const }] : []),
      { at: plannedStart, marker: '开始' }, { at: plannedEnd, marker: '结束' }
    ];
    const selected = overdue ? { at: deadline, marker: '截止' as const } : candidates.filter(c => c.at >= now.getTime()).sort((a, b) => a.at - b.at)[0] || { at: plannedEnd, marker: '结束' as const };
    return { id: `task-${t.id}`, title: t.title, at: selected.at, endAt: selected.at, dueAt: Number.isFinite(deadline) ? deadline : null, kind: 'task' as const, category: t.category, notes: t.notes || '', marker: selected.marker, overdue };
  }).filter(i => Number.isFinite(i.at));
  const courses = data.agenda.courses.map((c, i) => {
    const times = c.time.match(/\d{2}:\d{2}/g) || [];
    const at = parseTime(c.date, times[0] || '00:00');
    return { id: `course-${c.date}-${i}`, title: c.name, at, endAt: parseTime(c.date, times[1] || times[0] || '00:00'), dueAt: null, kind: 'course' as const, category: '课程', notes: c.room || '', marker: '开始' as const, overdue: false };
  }).filter(i => Number.isFinite(i.at) && i.endAt >= now.getTime());
  const recentPast = tasks.filter(i => i.at < now.getTime()).sort((a, b) => b.at - a.at).slice(0, 3);
  const upcoming = [...tasks.filter(i => i.at >= now.getTime()), ...courses].sort((a, b) => a.at - b.at).slice(0, 10);
  return [...recentPast, ...upcoming].sort((a, b) => a.at - b.at);
}
function Art({ now, variant, onDetail }: { now: Date; variant: ArtVariant; onDetail: (detail: HoverDetail | null) => void }) {
  const date = day(now);
  const seed = [...date].reduce((a, c) => a * 31 + c.charCodeAt(0), 17) >>> 0;
  const shanghaiDate = day(now);
  const [year, month, dateNumber] = shanghaiDate.split('-').map(Number);
  const [hour, minute] = fmt(now).split(':').map(Number);
  const daily = (hour * 60 + minute) / 1440;
  const monthDays = new Date(year, month, 0).getDate();
  const monthly = ((dateNumber - 1) + daily) / monthDays;
  const shift = (seed % 45) - 22;
  return <div className="art" onMouseEnter={() => onDetail({ id: 'progress', content: <div className="progress-detail"><span>今日 {Math.round(daily * 100)}%</span><span>本月 {Math.round(monthly * 100)}%</span></div> })} onMouseLeave={() => onDetail(null)}>
    <svg viewBox="0 0 700 640" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <g className={`art-variant art-orbit ${variant === 'orbit' ? 'active' : ''}`}>
        <path d={`M ${390 + shift} -95 C 710 -35, 790 340, 535 545 C 345 695, 45 545, 45 300`} fill="none" stroke="currentColor" opacity=".48"/>
        <path d={`M ${390 + shift} -95 C 555 -65, 675 75, 700 230`} fill="none" stroke="var(--accent)" opacity=".7"/>
        <circle cx="110" cy="302" r="19" fill="none" stroke="currentColor" opacity=".32"/>
        <circle cx={110 + daily * 480} cy="510" r="5" fill="var(--accent)" opacity=".72"/>
      </g>
      <g className={`art-variant art-grid ${variant === 'grid' ? 'active' : ''}`}>
        <path d="M -70 450 C 115 10, 365 625, 770 115" fill="none" stroke="currentColor" opacity=".55"/>
        <path d="M -70 160 C 185 575, 430 -45, 770 480" fill="none" stroke="var(--accent)" opacity=".58"/>
        <circle cx="360" cy="302" r="31" fill="currentColor" opacity=".045"/>
        <circle cx={75 + daily * 520} cy="540" r="5" fill="var(--accent)" opacity=".7"/>
      </g>
      <g className={`art-variant art-curve ${variant === 'curve' ? 'active' : ''}`}>
        <path className="art-drift" d={`M -70 555 C ${170 + shift} 540, 260 145, 770 75`} fill="none" stroke="currentColor" opacity=".56"/>
        <path d="M 270 340 C 410 380, 490 565, 770 515" fill="none" stroke="var(--accent)" opacity=".62"/>
        <path d="M 270 340 C 320 230, 455 155, 555 145" fill="none" stroke="currentColor" opacity=".27"/>
        <circle cx="270" cy="340" r="7" fill="var(--accent)" opacity=".57"/>
        <circle cx={120 + daily * 420} cy="530" r="3" fill="var(--accent)" opacity=".65"/>
      </g>
      <g className={`art-variant art-bands ${variant === 'bands' ? 'active' : ''}`}>
        <path d="M 80 645 C -70 475, 210 155, 330 -30 C 420 205, 265 500, 80 645 Z" fill="currentColor" opacity=".05"/>
        <path d="M 80 645 C -70 475, 210 155, 330 -30" fill="none" stroke="currentColor" opacity=".55"/>
        <path d="M 80 645 C 420 495, 665 245, 470 -55" fill="none" stroke="var(--accent)" opacity=".57"/>
        <path d="M 330 -30 C 575 175, 685 405, 810 650" fill="none" stroke="currentColor" opacity=".31"/>
        <circle cx={130 + daily * 420} cy="480" r="4" fill="var(--accent)" opacity=".72"/>
      </g>
      <g className={`art-variant art-offset ${variant === 'offset' ? 'active' : ''}`}>
        <path d="M -90 470 C -45 70, 610 -95, 760 285 C 875 570, 380 730, 205 480 C 65 275, 405 110, 545 290 C 630 405, 430 535, 335 435 C 270 365, 385 275, 455 325" fill="none" stroke="currentColor" opacity=".5"/>
        <path d="M 545 290 C 630 405, 430 535, 335 435" fill="none" stroke="var(--accent)" opacity=".72"/>
        <circle cx="455" cy="325" r="6" fill="var(--accent)" opacity=".65"/>
        <circle cx={95 + daily * 430} cy="555" r="3" fill="currentColor" opacity=".6"/>
      </g>
      <g className={`art-variant art-fan ${variant === 'fan' ? 'active' : ''}`}>
        <path d="M 55 580 C 165 390, 85 95, 205 -50" fill="none" stroke="currentColor" opacity=".38"/>
        <path d="M 55 580 C 295 420, 350 105, 510 -65" fill="none" stroke="var(--accent)" opacity=".59"/>
        <path d="M 55 580 C 365 550, 585 355, 765 260" fill="none" stroke="currentColor" opacity=".49"/>
        <path d="M 55 580 C 290 630, 540 640, 770 535" fill="none" stroke="currentColor" opacity=".25"/>
        <circle cx="55" cy="580" r="10" fill="none" stroke="var(--accent)" opacity=".65"/>
        <circle cx={90 + daily * 455} cy="545" r="4" fill="var(--accent)" opacity=".7"/>
      </g>
      <g className={`art-variant art-diagonal ${variant === 'diagonal' ? 'active' : ''}`}>
        <path d="M -90 400 C 110 50, 335 80, 430 320 C 555 615, 25 660, 160 350 C 285 55, 615 50, 770 435" fill="none" stroke="currentColor" opacity=".52"/>
        <path d="M 160 350 C 285 55, 615 50, 770 435" fill="none" stroke="var(--accent)" opacity=".57"/>
        <path d="M 430 320 C 530 225, 630 160, 785 180" fill="none" stroke="currentColor" opacity=".25"/>
        <circle cx="430" cy="320" r="7" fill="var(--accent)" opacity=".56"/>
        <circle cx={85 + daily * 450} cy="535" r="3" fill="var(--accent)" opacity=".65"/>
      </g>
      <path d="M 72 565 Q 140 532 208 565" fill="none" stroke="var(--accent)" opacity=".32"/>
      <circle cx={72 + monthly * 136} cy={565 - 33 * 4 * monthly * (1 - monthly)} r="3" fill="var(--accent)" opacity=".58"/>
    </svg>

  </div>;
}
function Performance({ current, history }: { current: Telemetry | null; history: Telemetry[] }) {
  const pct = (value: number | null | undefined) => value == null ? '—' : `${Math.round(value)}%`;
  const num = (value: number | null | undefined, unit: string) => value == null ? '—' : `${Math.round(value)}${unit}`;
  const line = (values: (number | null)[], max: number) => values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * 600},${100 - Math.min(max, Math.max(0, v || 0)) / max * 85}`).join(' ');
  const detail = [
    ['CPU 温度', num(current?.cpuTempC, '°')],
    ['GPU 温度', num(current?.gpu?.tempC, '°')],
    ['GPU 功耗', num(current?.gpu?.powerW, 'W')],
    ['VRAM', current?.gpu?.vramUsedMB == null ? '—' : `${(current.gpu.vramUsedMB / 1024).toFixed(1)} / ${((current.gpu.vramTotalMB || 0) / 1024).toFixed(1)} GB`],
    ['CPU 频率', current?.cpuGHz == null ? '—' : `${current.cpuGHz.toFixed(1)} GHz`],
    ['风扇', num(current?.gpu?.fanPercent, '%')],
    ['网络', current?.netBytesPerSecond == null ? '—' : `${(current.netBytesPerSecond / 1048576).toFixed(1)} MB/s`],
    ['磁盘', current?.diskBytesPerSecond == null ? '—' : `${(current.diskBytesPerSecond / 1048576).toFixed(1)} MB/s`]
  ];
  return <div className="performance">
    <div className="performance-head"><span>PERFORMANCE</span></div>
    <div className="performance-main">
      <div><small>CPU</small><strong>{pct(current?.cpuPercent)}</strong></div>
      <div><small>GPU</small><strong>{pct(current?.gpu?.use)}</strong></div>
      <div><small>RAM</small><strong>{current ? `${current.ramUsedGB.toFixed(1)}` : '—'}<em> / {current?.ramTotalGB.toFixed(1) || '—'} GB</em></strong></div>
    </div>
    <svg className="performance-chart" viewBox="0 0 600 100" preserveAspectRatio="none" aria-label="最近十五分钟 CPU 和 GPU 趋势">
      <path d="M0 99H600 M0 50H600" className="chart-grid"/>
      <polyline points={line(history.map(h => h.cpuPercent), 100)} className="chart-cpu"/>
      <polyline points={line(history.map(h => h.gpu?.use ?? null), 100)} className="chart-gpu"/>
    </svg>
    <div className="performance-scale"><span>15 MIN</span><span>CPU ─ &nbsp; GPU ─</span><span>NOW</span></div>
    <div className="performance-detail">{detail.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
  </div>;
}
function Cursor() {
  const cursor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (matchMedia('(pointer: coarse)').matches) return;
    let idle: ReturnType<typeof setTimeout>;
    const move = (event: PointerEvent) => {
      const node = cursor.current;
      if (!node) return;
      node.style.transform = `translate3d(${event.clientX}px,${event.clientY}px,0)`;
      node.classList.add('visible');
      node.classList.remove('idle');
      node.classList.toggle('interactive', Boolean((event.target as Element)?.closest?.('button,select,textarea,input,[role=button]')));
      document.documentElement.classList.add('cursor-ready');
      clearTimeout(idle);
      idle = setTimeout(() => node.classList.add('idle'), 1800);
      const art = document.querySelector<SVGSVGElement>('.art svg');
      if (art && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const x = (event.clientX / window.innerWidth - .5) * 4;
        const y = (event.clientY / window.innerHeight - .5) * 4;
        art.style.transform = `translate(${x}px,${y}px)`;
      }
    };
    document.addEventListener('pointermove', move);
    return () => { document.removeEventListener('pointermove', move); clearTimeout(idle); document.documentElement.classList.remove('cursor-ready'); };
  }, []);
  return <div className="custom-cursor" ref={cursor} aria-hidden="true"><i/><b/></div>;
}
function App() {
  const [now, setNow] = useState(new Date());
  const [agenda, setAgenda] = useState<AgendaResult>({ data: null, updatedAt: null, state: 'unconfigured' });
  const [memos, setMemos] = useState<Memo[]>([]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [expiry, setExpiry] = useState('never');
  const [expiryAt, setExpiryAt] = useState('');
  const [lanMemo, setLanMemo] = useState<{ available: boolean; url?: string; qr?: string } | null>(null);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [sessionArt] = useState<ArtVariant>(() => artChoices[Math.floor(Math.random() * artChoices.length)]);
  const [artOffset, setArtOffset] = useState(0);
  const sessionStarted = useRef(Date.now());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mode, setMode] = useState<'normal' | 'performance'>('normal');
  const [hoverDetail, setHoverDetail] = useState<HoverDetail | null>(null);
  const [weather, setWeather] = useState<Weather | null>(null);
  const solarKinds = ['sunrise','sunset','moonrise','moonset'];
  const activeWeatherEvents = (weather?.alerts || []).filter(event => event.end > now.getTime() && (solarKinds.includes(event.kind) ? Math.abs(event.start - now.getTime()) <= 30 * 60000 : event.start - now.getTime() <= 6 * 3600000));
  const localHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', hour12: false }).format(now));
  const weatherCycleSecond = Math.floor(now.getTime() / 1000) % 20;
  const showTomorrowCarousel = !!weather?.tomorrow && localHour >= 20 && localHour < 24 && weatherCycleSecond >= 16;
  const windRainEvents = activeWeatherEvents.filter(event => !solarKinds.includes(event.kind));
  const [demoSolar, setDemoSolar] = useState<WeatherEvent[]>([]);
  const demoSolarTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const solarEvents = demoSolar.length ? demoSolar : activeWeatherEvents.filter(event => solarKinds.includes(event.kind));
  const selectedWeatherEvent = windRainEvents[Math.floor(now.getTime() / 10000) % Math.max(1, windRainEvents.length)];
  const weatherTargetTime = selectedWeatherEvent ? new Date(now.getTime() < selectedWeatherEvent.start ? selectedWeatherEvent.start : selectedWeatherEvent.end) : null;
  const weatherEventOffset = weatherTargetTime ? dayDelta(weatherTargetTime, now) : 0;
  const weatherEventText = selectedWeatherEvent && weatherTargetTime ? `${selectedWeatherEvent.shortLabel || selectedWeatherEvent.label} · ${selectedWeatherEvent.approximate ? '约 ' : ''}${fmt(weatherTargetTime)} ${now.getTime() < selectedWeatherEvent.start ? '始' : '止'}` : '';
  const [demoWeather, setDemoWeather] = useState<Weather['alert']>(null);
  const showWeatherDetail = () => {
    if (demoWeather || !windRainEvents.length) return;
    setHoverDetail({ id: 'weather', content: <div className="weather-detail-list">{windRainEvents.map(event => <article key={`${event.kind}-${event.at}`}><div className="weather-detail-heading"><WeatherIcon kind={event.kind}/><strong>{event.shortLabel || event.label}</strong><span><TimeWithOffset value={new Date(event.start)} relative={now}/> 始 · <TimeWithOffset value={new Date(event.end)} relative={now}/> 止</span></div></article>)}</div> });
  };
  const showSolarDetail = () => {
    const upcoming = (weather?.alerts || []).filter(event => solarKinds.includes(event.kind) && event.start > now.getTime() - 30 * 60000 && event.start <= now.getTime() + 36 * 3600000);
    if (!upcoming.length) return;
    setHoverDetail({ id: 'solar', content: <div className="solar-detail-list">{upcoming.map(event => {
      const date = new Date(event.start);
      const phase = weather?.solar?.find(item => item.moonrise && day(new Date(item.moonrise)) === day(date))?.moonPhase;
      return <div key={`${event.kind}-${event.at}`}><WeatherIcon kind={event.kind}/><span>{event.label}</span><TimeWithOffset value={date} relative={now}/>{event.kind.startsWith('moon') && phase && <small>{phase}</small>}</div>;
    })}</div> });
  };
  const showCurrentWeatherDetail = () => {
    if (!weather) return;
    const info = weather.details;
    setHoverDetail({ id: 'current-weather', content: <div className="current-weather-detail">
      {weather.summary && <div>{weather.summary.condition} <TemperatureValue value={weather.summary.temperatureC}/> · {weather.summary.lowC != null && weather.summary.highC != null ? `${Math.round(weather.summary.lowC)}–${Math.round(weather.summary.highC)}°` : ''}</div>}
      {weather.tomorrow && <div>明日 {weather.tomorrow.condition}{weather.tomorrow.lowC != null && weather.tomorrow.highC != null ? ` · ${Math.round(weather.tomorrow.lowC)}–${Math.round(weather.tomorrow.highC)}°` : ''}</div>}
      {(info?.feelsLikeC != null || info?.humidityPercent != null || info?.windKmh != null) && <div>{[
        info?.feelsLikeC != null ? `体感 ${Math.round(info.feelsLikeC)}°` : '',
        info?.humidityPercent != null ? `湿度 ${info.humidityPercent}%` : '',
        info?.windKmh != null ? `${info.windDirectionDegrees != null ? `${['北','东北','东','东南','南','西南','西','西北'][Math.round(info.windDirectionDegrees / 45) % 8]}风 ` : '风速 '}${Math.round(info.windKmh)}${info.gustKmh != null ? ` · 阵风 ${Math.round(info.gustKmh)}` : ''} km/h` : ''
      ].filter(Boolean).join(' · ')}</div>}
      {(info?.aqi || weather.solar?.[0]?.moonPhase) && <div>{[
        info?.aqi ? `空气质量 ${info.aqi.value} · ${info.aqi.category}${info.aqi.primaryPollutant ? ` · ${info.aqi.primaryPollutant}` : ''}` : '',
        weather.solar?.[0]?.moonPhase ? `月相 ${({ 'new-moon':'新月','waxing-crescent':'娥眉月','first-quarter':'上弦月','waxing-gibbous':'盈凸月','full-moon':'满月','waning-gibbous':'亏凸月','last-quarter':'下弦月','waning-crescent':'残月' } as Record<string,string>)[weather.solar[0].moonPhase.toLowerCase()] || weather.solar[0].moonPhase}` : ''
      ].filter(Boolean).join(' · ')}</div>}
      {weather.updatedAt && <small>{fmt(new Date(weather.updatedAt))} 更新{weather.location ? ` · ${weather.location}` : ''}{weather.source ? ` · ${weather.source}` : ''}</small>}
    </div> });
  };
  const [media, setMedia] = useState<Media>(null);
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [history, setHistory] = useState<Telemetry[]>([]);
  const settingsRef = useRef(settings);
  const highSince = useRef<number | null>(null);
  const lowSince = useRef<number | null>(null);
  const suppressAutoUntil = useRef(0);
  const eventsRef = useRef<HTMLDivElement>(null);
  const refreshAgendaRef = useRef<() => void>(() => {});
  const refreshWeatherRef = useRef<() => void>(() => {});
  const refreshMediaRef = useRef<() => void>(() => {});
  const scrollPauseUntil = useRef(Date.now() + 4000);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => { if (settings.alwaysPerformance) setMode('performance'); }, [settings.alwaysPerformance]);
  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 1000);
    const refresh = () => (window.dashboard ? window.dashboard.agenda() : fetch('/api/dashboard/agenda').then(r => r.json())).then(next => setAgenda(previous => next.data ? next : { ...previous, state: next.state })).catch(() => setAgenda(previous => ({ ...previous, state: 'stale' })));
    refreshAgendaRef.current = refresh;
    refresh();
    let lastRefresh = Date.now();
    const poll = setInterval(() => {
      if (Date.now() - lastRefresh >= settingsRef.current.agendaRefreshSeconds * 1000) {
        lastRefresh = Date.now(); refresh();
      }
    }, 10000);
    memoRequest<Memo[]>('get').then(setMemos).catch(() => {});
    const memoPoll = setInterval(() => memoRequest<Memo[]>('get').then(setMemos).catch(() => {}), 5000);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setEditing(false); setSettingsOpen(false); }
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'q') window.dashboard?.quit();
      if (e.ctrlKey && e.key === ',') { e.preventDefault(); setSettingsOpen(true); }
      if (e.altKey && e.key.toLowerCase() === 'p') { e.preventDefault(); setMode(m => m === 'normal' ? 'performance' : 'normal'); suppressAutoUntil.current = Date.now() + 600000; }
    };
    window.addEventListener('keydown', onKey);
    return () => { clearInterval(tick); clearInterval(poll); clearInterval(memoPoll); window.removeEventListener('keydown', onKey); };
  }, []);
  useEffect(() => {
    const apply = (action: string) => {
      if (action === 'normal' || action === 'performance') { setMode(action); if (action === 'normal') suppressAutoUntil.current = Date.now() + 600000; }
      if (action === 'next-art') setArtOffset(old => old + 1);
      if (action === 'refresh-agenda') refreshAgendaRef.current();
      if (action === 'refresh-weather') refreshWeatherRef.current();
      if (action === 'refresh-media') refreshMediaRef.current();
      if (['reminder-demo', 'windrain-demo', 'warning-demo', 'solar-demo'].includes(action)) {
        setMode('normal');
        suppressAutoUntil.current = Date.now() + 600000;
        if (demoSolarTimer.current) clearTimeout(demoSolarTimer.current);
        const at = Date.now() + 60000;
        const includeSolar = action === 'reminder-demo' || action === 'solar-demo';
        setDemoSolar(includeSolar ? [
          { kind: 'sunset', label: '日落', start: at, end: at + 3600000, at, approximate: false },
          { kind: 'moonrise', label: '月升', start: at + 120000, end: at + 3720000, at: at + 120000, approximate: false }
        ] : []);
        setDemoWeather(action === 'windrain-demo' ? { kind: 'rain', text: '降雨 · 20:00 始', at } : action === 'warning-demo' || action === 'reminder-demo' ? { kind: 'warning', text: '雷电黄色预警 · 06:00 止', at } : null);
        demoSolarTimer.current = setTimeout(() => { setDemoSolar([]); setDemoWeather(null); }, 8000);
      }
      if (action === 'scroll-top') { if (eventsRef.current) eventsRef.current.scrollTo({ top: 0, behavior: settingsRef.current.animation === 'off' ? 'instant' : 'smooth' }); scrollPauseUntil.current = Date.now() + 5000; }
      if (action === 'memo') memoRequest<Memo[]>('get').then(setMemos).catch(() => {});
      if (action === 'settings') systemRequest<Settings>('settings').then(value => setSettings(normalizeSettings(value))).catch(() => {});
    };
    const unsubscribe = window.dashboard?.onCommand(apply);
    const channel = new BroadcastChannel('ambient-dashboard-control');
    channel.onmessage = event => {
      if (event.data?.action === 'brightness-preview') {
        const value = Number(event.data.value);
        if (Number.isFinite(value)) setSettings(old => ({ ...old, displayBrightness: Math.min(100, Math.max(10, value)) }));
      } else if (typeof event.data?.action === 'string') apply(event.data.action);
    };
    return () => { unsubscribe?.(); channel.close(); if (demoSolarTimer.current) clearTimeout(demoSolarTimer.current); };
  }, []);
  useEffect(() => {
    systemRequest<Settings>('settings').then(value => setSettings(normalizeSettings(value))).catch(() => {});
    const readWeather = () => systemRequest<Weather>('weather').then(value => {
      setWeather(value);
    }).catch(() => {});
    const readMedia = () => systemRequest<Media>('media').then(setMedia).catch(() => setMedia(null));
    refreshWeatherRef.current = readWeather;
    refreshMediaRef.current = readMedia;
    const readTelemetry = () => systemRequest<Telemetry>('telemetry').then(value => {
      setTelemetry(value);
      setHistory(old => [...old, value].filter(item => Date.now() - Date.parse(item.at) <= 900000));
      const cfg = settingsRef.current;
      const highLoad = (value.cpuPercent != null && value.cpuPercent >= cfg.highLoadCpu)
        || (value.gpu?.use != null && value.gpu.use >= cfg.highLoadGpu);
      if (cfg.alwaysPerformance) {
        highSince.current = null;
        lowSince.current = null;
        setMode('performance');
      } else if (cfg.autoPerformance && highLoad && Date.now() >= suppressAutoUntil.current) {
        lowSince.current = null;
        highSince.current ||= Date.now();
        if (Date.now() - highSince.current >= cfg.highLoadSeconds * 1000) setMode('performance');
      } else if (cfg.autoPerformance && !highLoad && Date.now() >= suppressAutoUntil.current) {
        highSince.current = null;
        lowSince.current ||= Date.now();
        if (Date.now() - lowSince.current >= 90000) setMode('normal');
      } else {
        highSince.current = null;
        lowSince.current = null;
      }
    }).catch(() => {});
    readWeather(); readMedia(); readTelemetry();
    const timers = [setInterval(readWeather, 120000), setInterval(readMedia, 2000), setInterval(readTelemetry, 5000)];
    return () => timers.forEach(clearInterval);
  }, []);
  useEffect(() => {
    let direction = 1;
    let frame = 0;
    let last = 0;
    let boundaryPauseUntil = Date.now() + 4000;
    const move = (time: number) => {
      const box = eventsRef.current;
      const elapsed = last ? Math.min(100, time - last) : 0;
      last = time;
      const speed = settingsRef.current.scheduleScrollSpeed;
      if (box && !document.hidden && speed > 0 && Date.now() > Math.max(scrollPauseUntil.current, boundaryPauseUntil)) {
        const max = box.scrollHeight - box.clientHeight;
        if (max > 2) {
          const next = Math.min(max, Math.max(0, box.scrollTop + direction * speed * elapsed / 1000));
          box.scrollTop = next;
          if (next >= max - .5 && direction > 0) { direction = -1; boundaryPauseUntil = Date.now() + 7000; }
          if (next <= .5 && direction < 0) { direction = 1; boundaryPauseUntil = Date.now() + 7000; }
        }
      }
      frame = requestAnimationFrame(move);
    };
    frame = requestAnimationFrame(move);
    return () => cancelAnimationFrame(frame);
  }, []);
  const visibleMemos = memos.filter(m => !m.expiresAt || new Date(m.expiresAt).getTime() > now.getTime()).sort((a,b) => a.order - b.order);
  const events = useMemo(() => items(agenda.data, now), [agenda.data, Math.floor(now.getTime() / 60000)]);
  const semesterStart = agenda.data?.meta.semester?.start;
  const lastAgendaSync = agenda.updatedAt ? new Date(agenda.updatedAt) : null;
  const syncDay = lastAgendaSync ? day(lastAgendaSync) : '';
  const syncLabel = lastAgendaSync && Number.isFinite(lastAgendaSync.getTime()) ? `${syncDay === day(now) ? '' : `${syncDay.slice(5).replace('-', '.')} `}${fmt(lastAgendaSync)}` : '';
  const week = semesterStart ? Math.max(1, Math.floor((Date.parse(day(now)) - Date.parse(semesterStart)) / 604800000) + 1) : null;
  const colors = Object.fromEntries((agenda.data?.meta.categories || []).map(c => [c.name, c.color]));
  const pastEvents = events.filter(e => e.at < now.getTime());
  const futureEvents = events.filter(e => e.at >= now.getTime());
  const hour = Number(fmt(now).slice(0, 2)) + now.getMinutes() / 60;
  const selectedArtChoices = settings.artThemes?.length ? settings.artThemes : artChoices;
  const artVariant = settings.artTheme === 'auto' ? selectedArtChoices[(Math.max(0, selectedArtChoices.indexOf(sessionArt)) + artOffset + Math.floor((now.getTime() - sessionStarted.current) / 1200000)) % selectedArtChoices.length] : settings.artTheme;
  useEffect(() => {
    const publish = () => {
      window.dashboard?.publishState({ mode, artTheme: artVariant }).catch(() => {});
      if (location.protocol === 'http:' && location.port === '5173') fetch('/api/dashboard/control/state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode, artTheme: artVariant }) }).catch(() => {});
    };
    publish();
    const timer = setInterval(publish, 5000);
    const channel = new BroadcastChannel('ambient-dashboard-control');
    channel.postMessage({ state: { mode, artTheme: artVariant } });
    channel.close();
    return () => clearInterval(timer);
  }, [mode, artVariant]);
  const night = nightLevel(settings.appearance, now, weather?.solar);
  const ink = (threshold: number) => night < threshold ? '#000000' : '#ffffff';
  const saveSettings = async (patch: Partial<Settings>) => {
    const next = await systemRequest<Settings>('settings', patch);
    setSettings(normalizeSettings({ ...next, scheduleScrollSpeed: next.scheduleScrollSpeed ?? patch.scheduleScrollSpeed }));
  };
  const renderEvent = (e: AgendaItem, gapHours = 0) => {
    const date = new Date(e.at);
    const color = e.kind === 'course' ? '#657f8f' : colors[e.category] || '#987565';
    const dueHours = e.dueAt == null ? null : (e.dueAt - now.getTime()) / 3600000;
    const dueClass = dueHours != null && dueHours >= 0 ? dueHours <= 6 ? 'due-urgent' : dueHours <= 24 ? 'due-near' : dueHours <= 72 ? 'due-coming' : '' : '';
    return <React.Fragment key={e.id}>
      {gapHours > .5 && <div className={`gap ${gapHours <= 5 ? 'quiet' : ''}`} style={{ height: gapHours > 5 ? 30 : Math.max(5, Math.round(gapHours * 7)) }}>{gapHours > 5 && <span>+{Math.round(gapHours)}H</span>}</div>}
      <div className={`event ${e.kind} ${e.kind === 'task' && e.notes ? 'has-notes' : ''} ${e.marker === '截止' ? 'due-mode' : ''} ${e.overdue ? 'overdue' : ''} ${dueClass}`} style={{ '--tag-color': color } as React.CSSProperties}>
        <time >
          <em>{e.marker === '开始' ? '始' : e.marker === '结束' ? '止' : '限'}</em><small>{Number(day(date).slice(8, 10))}</small><span>{fmt(date)}</span>
        </time>
        <i/>
        <div className="event-body">
          <div className="event-line"><strong >{e.title}{e.kind === 'course' && e.notes && ` @ ${e.notes}`}</strong><div className="event-tags"><span className="type-tag">{e.kind === 'course' ? '课程' : e.category || '未分类'}</span>{e.overdue && <span className="due-tag">逾期</span>}{dueHours != null && dueHours >= 0 && dueHours <= 6 && <span className="remaining-tag">剩{Math.max(1, Math.ceil(dueHours))}h</span>}</div>{e.kind === 'task' && e.notes && <span className="hover-notes">{e.notes}</span>}</div>
        </div>
      </div>
    </React.Fragment>;
  };
  const save = async () => {
    const expiresAt = expiry === 'never' ? null : expiry === 'custom' ? (expiryAt ? new Date(expiryAt).toISOString() : null) : new Date(Date.now() + Number(expiry) * 3600000).toISOString();
    const lines = draft.split('\n').map(s => s.trim()).filter(Boolean).map((text, i) => ({ id: memos[i]?.id || crypto.randomUUID(), text, order: i, createdAt: memos[i]?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(), expiresAt }));
    setMemos(await memoRequest<Memo[]>('save', lines)); setEditing(false);
  };
  const openEditor = () => { setDraft(visibleMemos.map(m => m.text).join('\n')); setEditing(true); setLanMemo(null); memoRequest<{ available: boolean; url?: string; qr?: string }>('lan').then(setLanMemo).catch(() => setLanMemo({ available: false })); };
  return <main className={`dashboard theme-${settings.artTheme} motion-${settings.animation} density-${settings.scheduleDensity} mode-${mode}`} style={{ '--night': `${(night * 100).toFixed(2)}%`, '--ink': ink(.594), '--media-ink': ink(.6), '--modal-ink': ink(.625), '--input-ink': ink(.615), '--alert-surface': night < .594 ? '#f0d8ce' : '#704033', colorScheme: night >= .625 ? 'dark' : 'light', '--art-stroke': `${1.65 + night * .5}px`, '--art-accent-stroke': `${2.05 + night * .6}px` } as React.CSSProperties}><Cursor/>
    <header><div className="clock"><span className="hours">{fmt(now).split(':')[0]}</span><span className="clock-dot">·</span><span className="minutes">{fmt(now).split(':')[1]}</span><span className="seconds-ring" aria-label={`${now.getSeconds()} 秒`}><svg viewBox="0 0 44 44" aria-hidden="true"><circle className="seconds-track" cx="22" cy="22" r="16"/><circle className="seconds-progress" cx="22" cy="22" r="16" style={{ strokeDasharray: `${now.getSeconds() / 60 * 100.53} 100.53` }}/></svg></span></div><div className="date"><div className="date-top">{weather?.summary && <span className="date-weather" tabIndex={0} onMouseEnter={showCurrentWeatherDetail} onMouseLeave={() => setHoverDetail(old => old?.id === 'current-weather' ? null : old)} onFocus={showCurrentWeatherDetail} onBlur={() => setHoverDetail(old => old?.id === 'current-weather' ? null : old)}><WeatherSummaryCarousel summary={weather.summary} tomorrow={weather.tomorrow} showTomorrow={showTomorrowCarousel}/></span>}<strong>{weekday(now)}</strong></div><span>{day(now).replaceAll('-', '.')}</span>{week && <span>WEEK {week}</span>}<button className="settings-trigger" aria-label="设置" onClick={() => setSettingsOpen(true)}><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4"/></svg></button></div></header>
    <div className="middle-stage"><div className={`visual${solarEvents.length ? ' has-solar' : ''}`} aria-hidden={mode === 'performance'}>{media?.artData && <img className="media-texture" src={media.artData} alt="" aria-hidden="true"/>}<Art now={now} variant={artVariant} onDetail={setHoverDetail}/><div className="presence-stack">
      <div className={`presence-slot media-slot${media?.title ? ' active' : ''}`}><div className="presence-slot-inner">{media?.title && <div className="media-presence"><span className="media-lines"><i/><i/><i/></span><FadingMusic title={media.title} artist={media.artist}/></div>}</div></div>
      <div className={`presence-slot solar-slot${solarEvents.length ? ' active' : ''}`}><div className="presence-slot-inner">{solarEvents.length > 0 && <div className="weather-presence solar-presence" tabIndex={0} onMouseEnter={showSolarDetail} onMouseLeave={() => setHoverDetail(old => old?.id === 'solar' ? null : old)} onFocus={showSolarDetail} onBlur={() => setHoverDetail(old => old?.id === 'solar' ? null : old)} key={solarEvents.map(event => `${event.kind}-${event.at}`).join(',')}><div className="solar-event-list">{solarEvents.map(event => <span className="solar-event" key={`${event.kind}-${event.at}`}><WeatherIcon kind={event.kind}/><span>{event.label} · <TimeWithOffset value={new Date(event.start)} relative={now}/></span></span>)}</div></div>}</div></div>
      <div className={`presence-slot wind-slot${demoWeather || selectedWeatherEvent ? ' active' : ''}`}><div className="presence-slot-inner">{(demoWeather || selectedWeatherEvent) && <div className={`weather-presence${demoWeather ? ' weather-demo' : ''}`} tabIndex={windRainEvents.length ? 0 : undefined} onMouseEnter={() => showWeatherDetail()} onMouseLeave={() => setHoverDetail(old => old?.id === 'weather' ? null : old)} onFocus={() => showWeatherDetail()} onBlur={() => setHoverDetail(old => old?.id === 'weather' ? null : old)}><div className="weather-brief"><WeatherIcon kind={demoWeather?.kind || selectedWeatherEvent?.kind || 'rain'}/><WeatherNotice text={demoWeather?.text || weatherEventText} dayOffset={demoWeather ? 0 : weatherEventOffset}/>{!demoWeather && windRainEvents.length > 1 && <span className="weather-pagination" aria-label={`共${windRainEvents.length}条提醒，当前第${windRainEvents.indexOf(selectedWeatherEvent) + 1}条`}>{windRainEvents.indexOf(selectedWeatherEvent) + 1}/{windRainEvents.length}</span>}</div></div>}</div></div>
    </div><HoverDetailRegion detail={hoverDetail}/></div><div className="performance-layer" aria-hidden={mode !== 'performance'}><Performance current={telemetry} history={history}/></div><button className="mode-trigger" data-label={mode === 'normal' ? 'PERFORMANCE' : 'NORMAL'} aria-label={mode === 'normal' ? '切换到性能模式' : '返回普通模式'} onClick={() => { if (mode === 'performance') { setMode('normal'); suppressAutoUntil.current = Date.now() + 600000; } else setMode('performance'); }}><svg viewBox="0 0 30 30" aria-hidden="true"><path d="M3 23V17M10 23V10M17 23V14M24 23V4"/></svg></button></div>
    <section className="lower"><div className="schedule"><div className="section-heading"><span>SCHEDULE</span><small aria-label={lastAgendaSync ? `最近成功获取：${syncDay} ${fmt(lastAgendaSync)}` : '尚未成功获取日程'}>{agenda.state === 'fresh' ? (syncLabel ? `${syncLabel} 获取` : '同步中') : agenda.state === 'stale' ? `${syncLabel || '—'} · 未更新` : '待连接'}</small></div>
      <div className="events" ref={eventsRef} onMouseMove={() => { scrollPauseUntil.current = Date.now() + 12000; }} onWheel={() => { scrollPauseUntil.current = Date.now() + 20000; }} onTouchStart={() => { scrollPauseUntil.current = Date.now() + 20000; }}>
        {pastEvents.map((e, idx) => renderEvent(e, idx ? (e.at - pastEvents[idx-1].at) / 3600000 : 0))}
        <div className="now-marker"><div className="now-left"><span>NOW</span><time>{fmt(now)}</time></div><i/><div className="now-rule"/></div>
        {futureEvents.length ? futureEvents.map((e, idx) => renderEvent(e, (e.at - (idx ? futureEvents[idx-1].at : now.getTime())) / 3600000)) : !pastEvents.length && <p className="empty-schedule">{agenda.state === 'unconfigured' ? '配置规划器后，近期事项会出现在这里。' : '接下来暂时没有日程。'}</p>}
      </div></div><div className="memo"><div className="section-heading"><span>MEMO</span><button onClick={openEditor}>EDIT ↗</button></div>{visibleMemos.length ? <><svg className="memo-ornament" viewBox="0 0 220 290" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><path d="M-30 205 C55 110 100 330 175 175 C215 100 180 35 245 5"/><path d="M-15 268 C70 205 105 255 150 232"/><circle cx="175" cy="175" r="3"/></svg><div className="memo-paper">{visibleMemos.map(m => <p key={m.id}>{m.text}</p>)}</div></> : <div className="memo-empty" aria-label="Memo 为空"><span className="memo-shape">◯</span><span className="memo-empty-line"/><span className="memo-empty-dot"/></div>}</div></section>
    <div className={`modal-backdrop ${editing ? 'open' : ''}`} aria-hidden={!editing} onClick={() => setEditing(false)}><div className="modal memo-modal" onClick={e => e.stopPropagation()}><h2>Memo</h2>{lanMemo?.available && lanMemo.qr && <div className="lan-memo"><img src={lanMemo.qr} alt="手机编辑二维码"/><span>扫码在手机编辑</span><small>{lanMemo.url}</small></div>}<textarea value={draft} onChange={e => setDraft(e.target.value)} placeholder="写点需要记住的事…"/><label>有效期 <select value={expiry} onChange={e => setExpiry(e.target.value)}><option value="never">长期</option><option value="6">6 小时</option><option value="24">1 天</option><option value="72">3 天</option><option value="168">7 天</option><option value="custom">指定时间</option></select></label>{expiry === 'custom' && <input type="datetime-local" className="custom-expiry" value={expiryAt} onChange={e => setExpiryAt(e.target.value)} />}<div className="modal-actions"><button onClick={() => setDraft('')}>清空</button><button onClick={() => setEditing(false)}>取消</button><button onClick={save}>保存</button></div></div></div>
    <div className={`modal-backdrop ${settingsOpen ? 'open' : ''}`} aria-hidden={!settingsOpen} onClick={() => setSettingsOpen(false)}><div className="modal settings-modal" onClick={e => e.stopPropagation()}><h2>设置</h2>
      <label>外观 <select value={settings.appearance} onChange={e => saveSettings({ appearance: e.target.value as Settings['appearance'] })}><option value="auto">自动</option><option value="solar">随日出日落</option><option value="light">浅色</option><option value="dark">深色</option></select></label>
      <label>性能自动切换 <input type="checkbox" checked={settings.autoPerformance} onChange={e => saveSettings({ autoPerformance: e.target.checked })}/></label>
      <label>登录后自动启动 <input type="checkbox" checked={settings.autoStart} onChange={e => saveSettings({ autoStart: e.target.checked })}/></label>
      <label>视觉主题 <select value={settings.artTheme} onChange={e => saveSettings({ artTheme: e.target.value as Settings['artTheme'] })}><option value="auto">自动</option><option value="solar">随日出日落</option><option value="orbit">圆弧</option><option value="grid">交汇</option><option value="curve">分叉</option><option value="bands">花瓣</option><option value="offset">螺旋</option><option value="fan">发散</option><option value="diagonal">回环</option></select></label>
      <label>动画 <select value={settings.animation} onChange={e => saveSettings({ animation: e.target.value as Settings['animation'] })}><option value="normal">正常</option><option value="low">减弱</option><option value="off">关闭</option></select></label>
      <label>日程密度 <select value={settings.scheduleDensity} onChange={e => saveSettings({ scheduleDensity: e.target.value as Settings['scheduleDensity'] })}><option value="compact">紧凑</option><option value="relaxed">宽松</option></select></label>
      <label>天气位置 <input value={settings.weather.name} onChange={e => setSettings(old => ({ ...old, weather: { ...old.weather, name: e.target.value } }))} onBlur={() => saveSettings({ weather: settings.weather })}/></label>
      <div className="coordinate"><label>纬度 <input type="number" step=".01" value={settings.weather.latitude} onChange={e => setSettings(old => ({ ...old, weather: { ...old.weather, latitude: Number(e.target.value) } }))} onBlur={() => saveSettings({ weather: settings.weather })}/></label><label>经度 <input type="number" step=".01" value={settings.weather.longitude} onChange={e => setSettings(old => ({ ...old, weather: { ...old.weather, longitude: Number(e.target.value) } }))} onBlur={() => saveSettings({ weather: settings.weather })}/></label></div>
      <div className="modal-actions"><button onClick={() => setSettingsOpen(false)}>完成</button></div>
    </div></div>
    <div className="screen-dimmer" aria-hidden="true" style={{ opacity: 1 - settings.displayBrightness / 100 }}/>
  </main>;
}
createRoot(document.getElementById('root')!).render(window.location.pathname === '/control' ? <Control/> : <App/>);
