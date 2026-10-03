const os = require('node:os');
const { windowsTelemetry } = require('./windows-worker.cjs');
let previousCpu = null;
let cached = null;
let inFlight = null;

function telemetry(nvidia) {
  if (inFlight) return inFlight;
  if (cached && Date.now() - Date.parse(cached.at) < 4000) return Promise.resolve(cached);
  inFlight = (async () => {
    const at = Date.now();
    const cpu = os.cpus();
    const totals = cpu.reduce((acc, core) => {
      acc.total += Object.values(core.times).reduce((sum, value) => sum + value, 0);
      acc.idle += core.times.idle;
      return acc;
    }, { total: 0, idle: 0 });
    const elapsed = previousCpu && totals.total - previousCpu.total;
    const cpuPercent = elapsed > 0 ? Math.max(0, Math.min(100, 100 * (1 - (totals.idle - previousCpu.idle) / elapsed))) : null;
    previousCpu = totals;
    const [counters, discrete] = await Promise.all([windowsTelemetry(), nvidia()]);
    const fallback = counters?.gpu;
    // On hybrid laptops the integrated GPU can be busy while NVIDIA is idle.
    // Do not attach NVIDIA temperature/VRAM to another adapter's utilization.
    const gpu = discrete && (discrete.use != null && discrete.use >= (fallback?.use ?? 0)) ? discrete : fallback || discrete;
    cached = {
      at: new Date(at).toISOString(), cpuPercent,
      ramUsedGB: (os.totalmem() - os.freemem()) / 1073741824, ramTotalGB: os.totalmem() / 1073741824,
      cpuTempC: null, gpu: gpu ?? null, cpuGHz: cpu[0]?.speed ? cpu[0].speed / 1000 : null,
      netBytesPerSecond: counters?.netBytesPerSecond ?? null, diskBytesPerSecond: counters?.diskBytesPerSecond ?? null,
      uptimeSeconds: os.uptime()
    };
    return cached;
  })().finally(() => { inFlight = null; });
  return inFlight;
}
module.exports = { telemetry };
