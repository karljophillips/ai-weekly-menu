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
  // Build from local Y/M/D rather than mutating `today` and going through
  // toISOString (which converts to UTC) — in the evening in a UTC-negative
  // timezone that rolls the date forward by one.
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + diff);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
