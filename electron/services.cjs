const { weatherEvents } = require('./weather-events.cjs');
const { WeatherUsageStore } = require('./weather-usage.cjs');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
async function externalScript(name) {
  if (process.resourcesPath) {
    const unpacked = path.join(process.resourcesPath, 'app.asar.unpacked', 'electron', name);
    try { await fs.access(unpacked); return unpacked; } catch {}
  }
  return path.join(__dirname, name);
}

const DEFAULTS = {
  appearance: 'auto', autoPerformance: true, alwaysPerformance: false, artTheme: 'auto',
  animation: 'normal', scheduleDensity: 'compact', scheduleScrollSpeed: 24, displayBrightness: 100,
  weather: { latitude: 39.99, longitude: 116.31, name: '北京' },
  weatherIntervals: { currentMinutes: 5, hourlyMinutes: 15, minutelyMinutes: 5, dailyMinutes: 360, warningsMinutes: 15, airCurrentMinutes: 30, airHourlyMinutes: 180 },
  plannerUrl: '', agendaRefreshSeconds: 60,
  highLoadCpu: 85, highLoadGpu: 60, highLoadSeconds: 30, autoStart: false, preventDisplaySleep: false, targetDisplayId: null
};
function cleanSettings(input = {}) {
  const artChoices = ['orbit', 'grid', 'curve', 'bands', 'offset', 'fan', 'diagonal'];
  const selectedArt = Array.isArray(input.artThemes) ? [...new Set(input.artThemes.filter(value => artChoices.includes(value)))] : artChoices.includes(input.artTheme) ? [input.artTheme] : artChoices;
  const choice = (key, valid) => valid.includes(input[key]) ? input[key] : DEFAULTS[key];
  const number = (value, fallback, min, max) => Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Number(value))) : fallback;
  const w = input.weather || {};
  return {
    appearance: choice('appearance', ['auto', 'solar', 'light', 'dark']),
    autoPerformance: input.autoPerformance !== false,
    alwaysPerformance: input.alwaysPerformance === true,
    artTheme: choice('artTheme', ['auto', 'orbit', 'grid', 'curve', 'bands', 'offset', 'fan', 'diagonal']),
    artThemes: selectedArt.length ? selectedArt : artChoices,
    animation: choice('animation', ['normal', 'low', 'off']),
    scheduleDensity: choice('scheduleDensity', ['compact', 'relaxed']),
    scheduleScrollSpeed: number(input.scheduleScrollSpeed, DEFAULTS.scheduleScrollSpeed, 0, 48),
    displayBrightness: number(input.displayBrightness, DEFAULTS.displayBrightness, 10, 100),
    weather: {
      latitude: number(w.latitude, DEFAULTS.weather.latitude, -90, 90),
      longitude: number(w.longitude, DEFAULTS.weather.longitude, -180, 180),
      name: String(w.name || DEFAULTS.weather.name).slice(0, 40)
    },
    weatherIntervals: Object.fromEntries(Object.entries(DEFAULTS.weatherIntervals).map(([key, fallback]) => [key, number(input.weatherIntervals?.[key], fallback, 5, 1440)])),
    plannerUrl: /^https?:\/\//.test(input.plannerUrl || '') ? input.plannerUrl : DEFAULTS.plannerUrl,
    plannerTokenFile: typeof input.plannerTokenFile === 'string' ? input.plannerTokenFile : undefined,
    weatherUsageFile: typeof input.weatherUsageFile === 'string' && path.isAbsolute(input.weatherUsageFile) ? input.weatherUsageFile : '',
    agendaRefreshSeconds: number(input.agendaRefreshSeconds, 60, 30, 3600),
    highLoadCpu: number(input.highLoadCpu, 85, 50, 100),
    highLoadGpu: number(input.highLoadGpu, 60, 20, 100),
    highLoadSeconds: number(input.highLoadSeconds, 30, 10, 300),
    autoStart: input.autoStart === true,
    preventDisplaySleep: input.preventDisplaySleep === true,
    targetDisplayId: Number.isInteger(Number(input.targetDisplayId)) && input.targetDisplayId != null ? Number(input.targetDisplayId) : null
  };
}

let weatherCache = { key: '', until: 0, value: null };
const weatherConfigDir = path.join(os.homedir(), '.config', 'ambient-dashboard');
const weatherUsagePath = path.join(weatherConfigDir, 'weather-usage.json');
const qweatherCredentialsPath = path.join(weatherConfigDir, 'qweather.json');
const usageStore = new WeatherUsageStore(weatherUsagePath);
let usageEntries = [];
let activeWeatherUsageFile = '';
const endpointState = new Map();
let officialStatsCache = { until: 0, value: null, promise: null };
const endpointNames = { current: '实时天气', hourly: '逐小时天气', minutely: '分钟降水', daily: '日月预报', warnings: '天气预警', airCurrent: '实时空气质量', airHourly: '逐小时空气质量' };
async function recordRequest(endpoint, ok) {
  await usageStore.sync(activeWeatherUsageFile, { endpoint, ok: !!ok }).catch(() => {});
  usageEntries = usageStore.entries;
}
async function weatherUsage(settings) {
  activeWeatherUsageFile = settings.weatherUsageFile || '';
  await usageStore.sync(activeWeatherUsageFile).catch(error => { usageStore.sharing.error = error.message; });
  usageEntries = usageStore.entries;
  const cutoff = Date.now() - 24 * 3600000;
  usageEntries.sort((a, b) => a.at - b.at);
  while (usageEntries.length && usageEntries[0].at < cutoff) usageEntries.shift();
  const endpointCounts = Object.fromEntries(Object.keys(endpointNames).map(key => [key, { count: 0, success: 0, failed: 0 }]));
  for (const row of usageEntries) {
    const count = endpointCounts[row.endpoint];
    if (!count) continue;
    count.count++;
    if (row.ok) count.success++; else count.failed++;
  }
  const credentials = await loadQWeatherCredentials();
  const intervals = settings.weatherIntervals || DEFAULTS.weatherIntervals;
  let officialStats = null;
  if (credentials) {
    const now = Date.now();
    if (officialStatsCache.value && now < officialStatsCache.until) officialStats = officialStatsCache.value;
    else if (officialStatsCache.promise) officialStats = await officialStatsCache.promise;
    else {
      officialStatsCache.promise = (async () => {
        try {
          const response = await fetch(`https://${credentials.apiHost}/metrics/v1/stats`, { headers: { 'X-QW-Api-Key': credentials.apiKey }, signal: AbortSignal.timeout(5000) });
          if (!response.ok) throw Error('stats unavailable');
          const data = await response.json();
          if (data.code && data.code !== '200') throw Error('stats unavailable');
          const byApi = (data.success || []).map(item => ({ api: item.api, count: (item.hours || []).reduce((sum, value) => sum + (Number(value) || 0), 0) }));
          const value = { available: true, asOf: data.asOf || null, totalSuccess24h: byApi.reduce((sum, item) => sum + item.count, 0), byApi };
          officialStatsCache = { value, until: Date.now() + 60 * 60000, promise: null };
          return value;
        } catch {
          const value = { available: false, asOf: null, totalSuccess24h: null, byApi: [] };
          officialStatsCache = { value, until: Date.now() + 15 * 60000, promise: null };
          return value;
        }
      })();
      officialStats = await officialStatsCache.promise;
    }
  }
  const localSuccessLast24h = usageEntries.reduce((sum, row) => sum + (row.ok ? 1 : 0), 0);
  const localFailedLast24h = usageEntries.length - localSuccessLast24h;
  return {
    requestsLast24h: usageEntries.length, localSuccessLast24h, localFailedLast24h,
    sharing: usageStore.sharing,
    localRecordedFrom: usageEntries.length ? new Date(usageEntries[0].at).toISOString() : null,
    limit: 1000, provider: credentials ? 'qweather' : 'open-meteo', configured: !!credentials, officialStats,
    endpoints: Object.entries(endpointNames).map(([key, label]) => ({ key, label, ...(endpointCounts[key] || { count: 0, success: 0, failed: 0 }), intervalMinutes: intervals[`${key}Minutes`] ?? null }))
  };
}
async function loadQWeatherCredentials() {
  try {
    const raw = JSON.parse(await fs.readFile(qweatherCredentialsPath, 'utf8'));
    const apiHost = String(raw.apiHost || '').trim().replace(/^https?:\/\//i, '').replace(/\/$/, '');
    const apiKey = String(raw.apiKey || '').trim();
    if (!apiHost || !apiKey || !/^[a-z0-9.-]+$/i.test(apiHost)) return null;
    return { apiHost, apiKey };
  } catch { return null; }
}
async function scheduledQWeatherFetch(key, intervalMinutes, url, credentials, force = false) {
  const now = Date.now();
  const old = endpointState.get(key) || { value: null, nextAt: 0, promise: null };
  if (old.promise) return old.promise;
  if (!force && old.value && now < old.nextAt) return old.value;
  old.promise = (async () => {
    let ok = false;
    try {
      const response = await fetch(url, { headers: { 'X-QW-Api-Key': credentials.apiKey }, signal: AbortSignal.timeout(7000) });
      if (!response.ok) throw Error(`weather ${response.status}`);
      const data = await response.json();
      if (data.code && data.code !== '200') throw Error('weather unavailable');
      old.value = data;
      old.nextAt = Date.now() + intervalMinutes * 60000;
      ok = true;
      return data;
    } finally {
      if (!ok) old.nextAt = Date.now() + intervalMinutes * 60000;
      old.promise = null;
      endpointState.set(key, old);
      await recordRequest(key, ok);
    }
  })();
  endpointState.set(key, old);
  try { return await old.promise; } catch { return old.value; }
}
const qUrl = (host, endpoint, params = {}) => `https://${host}/weather/${endpoint}?${new URLSearchParams(params)}`;
const timeValue = value => { const time = Date.parse(value); return Number.isFinite(time) ? time : null; };
async function qweather(settings, credentials, force = false) {
  activeWeatherUsageFile = settings.weatherUsageFile || '';
  const loc = settings.weather, interval = settings.weatherIntervals || DEFAULTS.weatherIntervals;
  const coords = `${loc.latitude}/${loc.longitude}`;
  const endpoints = await Promise.all([
    scheduledQWeatherFetch('current', interval.currentMinutes, qUrl(credentials.apiHost, `v1/current/${coords}`, { lang: 'zh' }), credentials, force),
    scheduledQWeatherFetch('hourly', interval.hourlyMinutes, qUrl(credentials.apiHost, `v1/hourly/${coords}`, { hours: '48', lang: 'zh' }), credentials, force),
    scheduledQWeatherFetch('minutely', interval.minutelyMinutes, `https://${credentials.apiHost}/v7/minutely/5m?${new URLSearchParams({ location: `${loc.longitude},${loc.latitude}`, lang: 'zh' })}`, credentials, force),
    scheduledQWeatherFetch('daily', interval.dailyMinutes, qUrl(credentials.apiHost, `v1/daily/${coords}`, { days: '7', lang: 'zh' }), credentials, force),
    scheduledQWeatherFetch('warnings', interval.warningsMinutes, `https://${credentials.apiHost}/weatheralert/v1/current/${coords}?lang=zh`, credentials, force),
    scheduledQWeatherFetch('airCurrent', interval.airCurrentMinutes, `https://${credentials.apiHost}/airquality/v1/current/${coords}?lang=zh&pollutantCode=cn-mee`, credentials, force),
    scheduledQWeatherFetch('airHourly', interval.airHourlyMinutes, `https://${credentials.apiHost}/airquality/v1/hourly/${coords}?lang=zh&pollutantCode=cn-mee-1h`, credentials, force)
  ]);
  const [current, hourly, minutely, daily, warnings, airCurrent, airHourly] = endpoints;
  const now = Date.now(), events = [];
  const push = (kind, label, start, end, approximate = false, extra = {}) => { if (Number.isFinite(start) && Number.isFinite(end) && end > now - 3600000) events.push({ kind, label, start, end, at: start, approximate, ...extra }); };
  for (const day of daily?.days || []) {
    const astro = day.astro || {};
    for (const [kind, label, field] of [['sunrise','日出','sunrise'],['sunset','日落','sunset'],['moonrise','月升','moonrise'],['moonset','月落','moonset']]) {
      const at = timeValue(astro[field]); if (at) push(kind, label, at, at + 3600000, false);
    }
  }
  for (const warning of warnings?.alerts || []) {
    const start = timeValue(warning.onsetTime || warning.effectiveTime), end = timeValue(warning.expireTime) || (start && start + 6 * 3600000);
    if (start && end) {
      const tone = ({ blue: '蓝', yellow: '黄', orange: '橙', red: '红' })[warning.color?.code] || '';
      const type = warning.eventType?.name || '天气';
      push('warning', warning.headline || `${type}${tone}色预警`, start, end, false, { shortLabel: `${type}${tone}色预警`, headline: warning.headline || `${type}${tone}色预警`, description: warning.description || '', instruction: warning.instruction || '', senderName: warning.senderName || '', severity: warning.severity || '' });
    }
  }
  const runs = new Map();
  for (const point of hourly?.hours || []) {
    const at = timeValue(point.forecastTime), end = at && at + 3600000;
    if (!at || end < now || at > now + 30 * 3600000) continue;
    const precipitation = point.precipitation || {};
    const probability = Number(precipitation.probability || 0);
    const amount = Number(precipitation.amount?.value || 0);
    const condition = point.condition?.text || '';
    const precipType = precipitation.type || (/雪/.test(condition) ? 'snow' : 'rain');
    const kinds = [];
    if ((probability >= .3 || amount > 0) && ['rain','snow','sleet','freezing-rain'].includes(precipType)) kinds.push(precipType === 'snow' ? 'snow' : 'rain');
    if (Number(point.windGust?.value || 0) * 3.6 >= 50) kinds.push('gust');
    for (const kind of kinds) {
      const run = runs.get(kind);
      if (run && at <= run.end + 60000) run.end = end;
      else runs.set(kind, { start: Math.max(now, at), end });
    }
  }
  for (const [kind, run] of runs) push(kind, kind === 'snow' ? '降雪' : kind === 'gust' ? '强阵风' : '降雨', run.start, run.end, true);
  const minutelyData = minutely?.minutely || [];
  const wet = minutelyData.filter(row => Number(row.precip || 0) > 0);
  if (wet.length) {
    const start = timeValue(wet[0].fxTime), end = timeValue(wet[wet.length - 1].fxTime);
    if (start && end) push('rain', '降雨', start, end + 5 * 60000, false);
  }
  const indexes = airCurrent?.indexes || [];
  const aqi = indexes.find(item => item.code === 'cn-mee') || indexes[0];
  if (Number(aqi?.aqi) >= 101) push('air', `空气污染 · ${aqi.category || 'AQI'} ${aqi.aqiDisplay || aqi.aqi}`, now, now + 4 * 3600000, false);
  events.sort((a,b) => a.start-b.start);
  const wx = current || {};
  const pollutants = airCurrent?.pollutants || [];
  const aqiHourlyPoints = (airHourly?.hours || []).map(item => ({ at: timeValue(item.forecastTime), index: (item.indexes || []).find(index => index.code === 'cn-mee') || item.indexes?.[0] })).filter(item => item.at);
  const astro = (daily?.days || []).map(row => ({ sunrise: timeValue(row.astro?.sunrise), sunset: timeValue(row.astro?.sunset), moonrise: timeValue(row.astro?.moonrise), moonset: timeValue(row.astro?.moonset), moonPhase: row.astro?.moonPhase || null }));
  const numberOrNull = value => Number.isFinite(Number(value)) ? Number(value) : null;
  const currentWind = Number(wx.wind?.speed?.value), currentGust = Number(wx.windGust?.value);
  const tomorrow = daily?.days?.[1];
  return { alert: null, alerts: events, solar: astro, summary: { temperatureC: numberOrNull(wx.temperature?.value), condition: wx.condition?.text || '', highC: numberOrNull(daily?.days?.[0]?.temperatureMax?.value), lowC: numberOrNull(daily?.days?.[0]?.temperatureMin?.value) }, tomorrow: tomorrow ? { condition: tomorrow.daytime?.condition?.text || tomorrow.nighttime?.condition?.text || '', highC: numberOrNull(tomorrow.temperatureMax?.value), lowC: numberOrNull(tomorrow.temperatureMin?.value) } : null, details: { feelsLikeC: numberOrNull(wx.feelsLike?.value), humidityPercent: numberOrNull(wx.humidity) == null ? null : Math.round(Number(wx.humidity) * 100), windDirectionDegrees: numberOrNull(wx.wind?.direction?.degree), windKmh: Number.isFinite(currentWind) ? currentWind * 3.6 : null, gustKmh: Number.isFinite(currentGust) ? currentGust * 3.6 : null, aqi: aqi ? { value: aqi.aqiDisplay || aqi.aqi, category: aqi.category || '', primaryPollutant: aqi.primaryPollutant?.name || null, advice: aqi.health?.advice?.generalPopulation || null, pollutants: pollutants.map(item => ({ name: item.name, value: item.concentration?.value, unit: item.concentration?.unit })) } : null, hourlyAqi: aqiHourlyPoints.map(item => ({ at: item.at, aqi: item.index?.aqiDisplay || item.index?.aqi, category: item.index?.category })) }, location: loc.name, updatedAt: new Date().toISOString(), source: '和风天气' };
}
function weatherCondition(code) {
  if (code === 0) return '晴';
  if (code === 1 || code === 2) return '少云';
  if (code === 3) return '阴';
  if (code === 45 || code === 48) return '雾';
  if ([51, 53, 55, 56, 57].includes(code)) return '小雨';
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return '雨';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return '雪';
  if ([95, 96, 99].includes(code)) return '雷雨';
  return '';
}
async function weather(settings, force = false) {
  const loc = settings.weather;
  const credentials = await loadQWeatherCredentials();
  const key = `${loc.latitude},${loc.longitude}:${credentials?.apiHost || 'open-meteo'}`;
  if (!force && weatherCache.key === key && Date.now() < weatherCache.until) return weatherCache.value;
  if (credentials) {
    const value = await qweather(settings, credentials, force).catch(() => weatherCache.key === key ? weatherCache.value : null);
    if (value) { weatherCache = { key, until: Date.now() + 60000, value }; return value; }
    if (weatherCache.key === key) return weatherCache.value;
  }
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.search = new URLSearchParams({
    latitude: String(loc.latitude), longitude: String(loc.longitude),
    current: 'temperature_2m,weather_code,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,wind_direction_10m',
    hourly: 'temperature_2m,precipitation_probability,rain,showers,snowfall,wind_gusts_10m',
    daily: 'temperature_2m_max,temperature_2m_min,sunrise,sunset,weather_code',
    forecast_days: '2', timezone: 'auto'
  }).toString();
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!response.ok) throw Error('weather unavailable');
    const data = await response.json();
    const alerts = weatherEvents(data);
    const temperatureC = Number(data.current?.temperature_2m);
    const summary = Number.isFinite(temperatureC) ? { temperatureC: Math.round(temperatureC), condition: weatherCondition(Number(data.current?.weather_code)), highC: data.daily?.temperature_2m_max?.[0] == null ? null : Math.round(data.daily.temperature_2m_max[0]), lowC: data.daily?.temperature_2m_min?.[0] == null ? null : Math.round(data.daily.temperature_2m_min[0]) } : null;
    const parseSolar = value => Date.parse(`${value}Z`) - (data.utc_offset_seconds || 0) * 1000;
    const solar = (data.daily?.sunrise || []).map((value, i) => ({ sunrise: parseSolar(value), sunset: parseSolar(data.daily.sunset[i]) }));
    const details = { feelsLikeC: data.current?.apparent_temperature, humidityPercent: data.current?.relative_humidity_2m, windDirectionDegrees: data.current?.wind_direction_10m, windKmh: data.current?.wind_speed_10m, gustKmh: data.current?.wind_gusts_10m };
    const tomorrow = data.daily?.temperature_2m_max?.[1] == null ? null : { condition: weatherCondition(Number(data.daily.weather_code?.[1])), highC: Math.round(data.daily.temperature_2m_max[1]), lowC: Math.round(data.daily.temperature_2m_min?.[1]) };
    const value = { alert: null, alerts, solar, summary, tomorrow, details, location: loc.name, updatedAt: new Date().toISOString() };
    weatherCache = { key, until: Date.now() + 2 * 60000, value };
    return value;
  } catch {
    return weatherCache.key === key ? weatherCache.value : { alert: null, summary: null, location: loc.name, updatedAt: null };
  }
}

let lastCpu = null;
let lastNet = null;
let lastDisk = null;
const delta = (next, previous, seconds) => previous == null || seconds <= 0 ? null : Math.max(0, (next - previous) / seconds);
async function linuxCounters() {
  const [netText, diskText] = await Promise.all([
    fs.readFile('/proc/net/dev', 'utf8').catch(() => ''),
    fs.readFile('/proc/diskstats', 'utf8').catch(() => '')
  ]);
  const net = netText.split('\n').slice(2).reduce((sum, line) => {
    const [name, values] = line.split(':'); if (!values || name.trim() === 'lo') return sum;
    const fields = values.trim().split(/\s+/).map(Number);
    return sum + (fields[0] || 0) + (fields[8] || 0);
  }, 0);
  const disk = diskText.split('\n').reduce((sum, line) => {
    const fields = line.trim().split(/\s+/);
    const name = fields[2] || '';
    if (!/^(nvme\d+n\d+|sd[a-z]+|vd[a-z]+)$/.test(name)) return sum;
    return sum + ((Number(fields[5]) || 0) + (Number(fields[9]) || 0)) * 512;
  }, 0);
  return { net, disk };
}
async function linuxSensors() {
  const paths = await fs.readdir('/sys/class/thermal').catch(() => []);
  const readings = await Promise.all(paths.filter(name => name.startsWith('thermal_zone')).map(async name => {
    const base = `/sys/class/thermal/${name}`;
    const [type, temp] = await Promise.all([fs.readFile(`${base}/type`, 'utf8').catch(() => ''), fs.readFile(`${base}/temp`, 'utf8').catch(() => '')]);
    return { type: type.trim(), value: Number(temp) / 1000 };
  }));
  return readings.find(r => /x86_pkg_temp|cpu_thermal|k10temp/i.test(r.type) && r.value > 0 && r.value < 120)?.value
    ?? readings.find(r => r.value > 20 && r.value < 120)?.value ?? null;
}
let gpuCache = { at: 0, value: null };
async function nvidia() {
  if (Date.now() - gpuCache.at < 15000) return gpuCache.value;
  if (process.platform === 'linux') {
    const devices = await fs.readdir('/sys/bus/pci/devices').catch(() => []);
    const nvidiaStates = await Promise.all(devices.map(async device => {
      const base = `/sys/bus/pci/devices/${device}`;
      const [vendor, deviceClass] = await Promise.all([
        fs.readFile(`${base}/vendor`, 'utf8').catch(() => ''),
        fs.readFile(`${base}/class`, 'utf8').catch(() => '')
      ]);
      return vendor.trim() === '0x10de' && deviceClass.trim().startsWith('0x03') ? (await fs.readFile(`${base}/power/runtime_status`, 'utf8').catch(() => '')).trim() : null;
    }));
    if (nvidiaStates.includes('suspended') && !nvidiaStates.includes('active')) {
      gpuCache = { at: Date.now(), value: null }; return null;
    }
  }
  try {
    const { stdout } = await run('nvidia-smi', ['--query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,fan.speed,clocks.current.graphics', '--format=csv,noheader,nounits'], { timeout: 2500, ...(process.platform === 'win32' ? { windowsHide: true } : {}) });
    const fields = stdout.trim().split('\n')[0].split(',').map(x => Number(x.trim()));
    const val = i => Number.isFinite(fields[i]) ? fields[i] : null;
    const value = { use: val(0), vramUsedMB: val(1), vramTotalMB: val(2), tempC: val(3), powerW: val(4), fanPercent: val(5), clockMHz: val(6) };
    gpuCache = { at: Date.now(), value }; return value;
  } catch { gpuCache = { at: Date.now(), value: null }; return null; }
}
async function telemetry() {
  if (process.platform === 'win32') return require('./windows-telemetry.cjs').telemetry(nvidia);
  const at = Date.now();
  const cpu = os.cpus();
  const totals = cpu.reduce((acc, core) => {
    Object.values(core.times).forEach(value => acc.total += value);
    acc.idle += core.times.idle;
    return acc;
  }, { idle: 0, total: 0 });
  const cpuPercent = lastCpu ? Math.max(0, Math.min(100, 100 * (1 - (totals.idle - lastCpu.idle) / Math.max(1, totals.total - lastCpu.total)))) : null;
  lastCpu = totals;
  const [gpu, tempC, counters] = await Promise.all([
    nvidia(), process.platform === 'linux' ? linuxSensors() : Promise.resolve(null),
    process.platform === 'linux' ? linuxCounters() : Promise.resolve(null)
  ]);
  const seconds = lastNet ? (at - lastNet.at) / 1000 : 0;
  const netBytesPerSecond = counters ? delta(counters.net, lastNet?.value, seconds) : null;
  const diskBytesPerSecond = counters ? delta(counters.disk, lastDisk?.value, seconds) : null;
  if (counters) { lastNet = { at, value: counters.net }; lastDisk = { at, value: counters.disk }; }
  return {
    at: new Date(at).toISOString(), cpuPercent, ramUsedGB: (os.totalmem() - os.freemem()) / 1073741824,
    ramTotalGB: os.totalmem() / 1073741824, cpuTempC: tempC, gpu,
    netBytesPerSecond, diskBytesPerSecond, uptimeSeconds: os.uptime(),
    cpuGHz: cpu[0]?.speed ? cpu[0].speed / 1000 : null
  };
}
async function media() {
  if (process.platform === 'linux') {
    try {
      const script = await externalScript('linux-media.py');
      const { stdout } = await run('python3', [script], { timeout: 3000 });
      const result = JSON.parse(stdout);
      if (result?.artUrl?.startsWith('file://')) {
        const file = require('node:url').fileURLToPath(result.artUrl);
        const stat = await fs.stat(file).catch(() => null);
        if (stat && stat.size < 1000000) {
          const ext = require('node:path').extname(file).toLowerCase();
          const mime = ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' })[ext];
          if (mime) result.artData = `data:${mime};base64,${(await fs.readFile(file)).toString('base64')}`;
        }
      }
      return result;
    } catch { return null; }
  }
  if (process.platform === 'win32') {
    return require('./windows-worker.cjs').windowsMedia();
  }
  return null;
}
module.exports = { DEFAULTS, cleanSettings, weather, weatherUsage, telemetry, media };
