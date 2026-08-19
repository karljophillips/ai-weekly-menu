import { getCalendarClient } from "./google";
import { addDays } from "./dates";
import type { MenuRow } from "./sheets";
import { weatherEmoji } from "./weather";

const CALENDAR_ID = process.env.GOOGLE_MEALS_CALENDAR_ID ?? "";

export function titleForRow(row: MenuRow): string {
  const base = (() => {
    switch (row.status) {
      case "eating_out":
        return "🍴 Eating out";
      case "meal_prep":
        return "🧑‍🍳 Meal prep";
      case "manual_override":
        return row.mealName || "Override";
      default:
        return row.isAdventurous ? `🎲 ${row.mealName}` : row.mealName;
    }
  })();

  const weather = row.weatherCode != null ? weatherEmoji(row.weatherCode) : "";
  return weather ? `${weather} ${base}` : base;
}

/**
 * Lists events whose all-day `start.date` falls within [fromDate, toDate]
 * (inclusive, YYYY-MM-DD strings). The list window passed to the API is
 * padded a day on each side and re-filtered by the event's own `start.date`
 * rather than trusted as-is — `timeMin`/`timeMax` are instants, and
 * converting a plain date to one is timezone-sensitive (the server may run
 * in UTC while the calendar's all-day events are anchored to America/New_York),
 * so a tight window can silently miss the very event we're trying to delete.
 */
async function listEventsInDateRange(
  fromDate: string,
  toDate: string
): Promise<{ id: string }[]> {
  const calendar = getCalendarClient();
  const { data } = await calendar.events.list({
    calendarId: CALENDAR_ID,
    timeMin: new Date(`${addDays(fromDate, -1)}T00:00:00Z`).toISOString(),
    timeMax: new Date(`${addDays(toDate, 1)}T23:59:59Z`).toISOString(),
    singleEvents: true,
  });

  return (data.items ?? [])
    .filter(
      (event) =>
        event.id &&
        event.start?.date &&
        event.start.date >= fromDate &&
        event.start.date <= toDate
    )
    .map((event) => ({ id: event.id! }));
}

async function deleteEvents(events: { id: string }[]): Promise<void> {
  const calendar = getCalendarClient();
  await Promise.all(
    events.map((event) =>
      calendar.events.delete({ calendarId: CALENDAR_ID, eventId: event.id })
    )
  );
}

/** Deletes any existing events in the given week and creates one all-day event per row. */
export async function replaceWeekEvents(
  weekStartDate: string,
  rows: MenuRow[]
): Promise<void> {
  const weekEnd = addDays(weekStartDate, 6);
  await deleteEvents(await listEventsInDateRange(weekStartDate, weekEnd));

  const calendar = getCalendarClient();
  for (const row of rows) {
    await calendar.events.insert({
      calendarId: CALENDAR_ID,
      requestBody: {
        summary: titleForRow(row),
        start: { date: row.date },
        end: { date: addDays(row.date, 1) },
      },
    });
  }
}

/** Deletes any existing events on `row.date` and creates the one event for it — used by day-edits. */
export async function replaceDayEvent(row: MenuRow): Promise<void> {
  await deleteEvents(await listEventsInDateRange(row.date, row.date));

  const calendar = getCalendarClient();
  await calendar.events.insert({
    calendarId: CALENDAR_ID,
    requestBody: {
      summary: titleForRow(row),
      start: { date: row.date },
      end: { date: addDays(row.date, 1) },
    },
  });
}
