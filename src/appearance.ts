export type SolarDay = { sunrise: number; sunset: number; moonrise?: number | null; moonset?: number | null; moonPhase?: string | null };
export function nightLevel(appearance: string | undefined, now: Date, solar?: SolarDay[]) {
  if (appearance === 'dark') return 1;
  if (appearance === 'light') return 0;
  const time = now.getTime();
  if (appearance === 'solar') {
    const span = 90 * 60000;
    const today = solar?.find(day => Number.isFinite(day.sunrise) && Number.isFinite(day.sunset) && time >= day.sunrise - 12 * 3600000 && time < day.sunset + 6 * 3600000);
    if (today) {
      if (time < today.sunrise - span || time >= today.sunset + span) return 1;
      if (time < today.sunrise + span) return 1 - (time - today.sunrise + span) / (2 * span);
      if (time < today.sunset - span) return 0;
      return (time - today.sunset + span) / (2 * span);
    }
  }
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now).split(':').map(Number);
  const hour = parts[0] + parts[1] / 60;
  return hour < 5 ? 1 : hour < 8 ? (8 - hour) / 3 : hour < 18 ? 0 : hour < 22 ? (hour - 18) / 4 : 1;
}
