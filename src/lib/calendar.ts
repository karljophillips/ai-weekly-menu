import { getCalendarClient } from "./google";
import { addDays } from "./dates";
import type { MenuRow, ToddlerMenuRow } from "./sheets";
import { weatherEmoji } from "./weather";

const CALENDAR_ID = process.env.GOOGLE_MEALS_CALENDAR_ID ?? "";

/**
 * Both the dinner and toddler menus write to the same calendar, so every
 * event is tagged with which track it belongs to (via extendedProperties) —
 * otherwise deleting-and-recreating one track's events on regenerate/sync
 * would also wipe the other track's events for that date range. Events
 * created before this tagging existed have no track property; they're
 * treated as "dinner" so old data keeps working.
 */
type Track = "dinner" | "toddler";

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

/** 🧒 distinguishes toddler school snack/lunch events from the household dinner events sharing this calendar. */
export function titleForToddlerRow(row: ToddlerMenuRow): string {
  switch (row.status) {
    case "no_school":
      return "🧒 No school";
    case "manual_override":
      return `🧒 ${row.meal || "Override"}`;
    default:
      return `🧒 Snack: ${row.snack} · Lunch: ${row.meal}`;
  }
}

/**
 * Lists events whose all-day `start.date` falls within [fromDate, toDate]
 * (inclusive, YYYY-MM-DD strings) and belong to `track`. The list window
 * passed to the API is padded a day on each side and re-filtered by the
 * event's own `start.date` rather than trusted as-is — `timeMin`/`timeMax`
 * are instants, and converting a plain date to one is timezone-sensitive
 * (the server may run in UTC while the calendar's all-day events are
 * anchored to America/New_York), so a tight window can silently miss the
 * very event we're trying to delete.
 */
async function listEventsInDateRange(
  fromDate: string,
  toDate: string,
  track: Track
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
        event.start.date <= toDate &&
        (event.extendedProperties?.private?.track ?? "dinner") === track
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

async function insertEvent(
  date: string,
  summary: string,
  track: Track
): Promise<void> {
  const calendar = getCalendarClient();
  await calendar.events.insert({
    calendarId: CALENDAR_ID,
    requestBody: {
      summary,
      start: { date },
      end: { date: addDays(date, 1) },
      extendedProperties: { private: { track } },
    },
  });
}

/** Deletes any existing dinner events in the given week and creates one all-day event per row. */
export async function replaceWeekEvents(
  weekStartDate: string,
  rows: MenuRow[]
): Promise<void> {
  const weekEnd = addDays(weekStartDate, 6);
  await deleteEvents(
    await listEventsInDateRange(weekStartDate, weekEnd, "dinner")
  );
  for (const row of rows) {
    await insertEvent(row.date, titleForRow(row), "dinner");
  }
}

/** Deletes any existing dinner events on `row.date` and creates the one event for it — used by day-edits. */
export async function replaceDayEvent(row: MenuRow): Promise<void> {
  await deleteEvents(await listEventsInDateRange(row.date, row.date, "dinner"));
  await insertEvent(row.date, titleForRow(row), "dinner");
}

/** Deletes any existing toddler events in the given week and creates one all-day event per row. */
export async function replaceToddlerWeekEvents(
  weekStartDate: string,
  rows: ToddlerMenuRow[]
): Promise<void> {
  const weekEnd = addDays(weekStartDate, 6);
  await deleteEvents(
    await listEventsInDateRange(weekStartDate, weekEnd, "toddler")
  );
  for (const row of rows) {
    await insertEvent(row.date, titleForToddlerRow(row), "toddler");
  }
}
