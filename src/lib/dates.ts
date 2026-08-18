export const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function dayOfWeekFor(dateStr: string): string {
  return DAY_NAMES[new Date(`${dateStr}T00:00:00`).getDay()];
}

/**
 * The week this generation run should target: the upcoming Sunday if run on
 * a Saturday (the normal cron case), otherwise the most recent Sunday
 * (so a mid-week manual regenerate updates the week already in progress).
 */
export function getTargetWeekStart(today = new Date()): string {
  const day = today.getDay(); // 0 = Sunday ... 6 = Saturday
  const diff = day === 6 ? 1 : -day;
  const d = new Date(today);
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}
