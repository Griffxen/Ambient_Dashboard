const HOUR = 3600000;
function weatherEvents(data, now = Date.now()) {
  const offset = (data.utc_offset_seconds || 0) * 1000;
  const parse = value => Date.parse(`${value}Z`) - offset;
  const hourly = data.hourly || {};
  const alerts = [];
  const rules = [
    ['rain', '降雨', i => hourly.precipitation_probability?.[i] >= 60 && (hourly.rain?.[i] || 0) + (hourly.showers?.[i] || 0) >= .2],
    ['snow', '降雪', i => hourly.precipitation_probability?.[i] >= 60 && hourly.snowfall?.[i] >= .1],
    ['wind', '强阵风', i => hourly.wind_gusts_10m?.[i] >= 50]
  ];
  for (const [kind, label, matches] of rules) {
    let event = null;
    for (let i = 0; i < (hourly.time || []).length; i++) {
      const end = parse(hourly.time[i]);
      const start = end - HOUR;
      if (matches(i)) {
        if (event && event.end === start) event.end = end;
        else { event = { kind, label, start, end, at: start, approximate: true }; alerts.push(event); }
      } else event = null;
    }
  }
  const daily = data.daily || {};
  for (const [kind, label] of [['sunrise', '日出'], ['sunset', '日落']]) {
    for (const value of daily[kind] || []) {
      const start = parse(value);
      if (Number.isFinite(start)) alerts.push({ kind, label, start, end: start, at: start, approximate: false });
    }
  }
  return alerts.filter(event => event.end > now).sort((a,b) => a.start - b.start);
}
module.exports = { weatherEvents };
