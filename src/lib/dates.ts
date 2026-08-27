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
 * The household's timezone (matches the location used for weather.ts).
 * The server itself runs in UTC (Vercel), so "today"/"the current week"
 * must be computed against this, not the server's own clock — otherwise
 * anything run in the evening Eastern time reads as the next UTC day.
 */
const HOUSEHOLD_TIMEZONE = "America/New_York";

function localDateParts(now: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: HOUSEHOLD_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

/** Today's date as YYYY-MM-DD, in the household's timezone. */
export function todayString(now = new Date()): string {
  const { year, month, day } = localDateParts(now);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * The week this generation run should target: the upcoming Sunday if run on
 * a Saturday (the normal cron case), otherwise the most recent Sunday
 * (so a mid-week manual regenerate updates the week already in progress).
 */
export function getTargetWeekStart(now = new Date()): string {
  const { year, month, day } = localDateParts(now);
  // Noon avoids any DST-transition edge cases when shifting by a day.
  const localToday = new Date(year, month - 1, day, 12);
  const dow = localToday.getDay(); // 0 = Sunday ... 6 = Saturday
  const diff = dow === 6 ? 1 : -dow;
  const d = new Date(year, month - 1, day + diff, 12);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
