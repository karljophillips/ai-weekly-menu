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

/** Deletes any existing events in the given week and creates one all-day event per row. */
export async function replaceWeekEvents(
  weekStartDate: string,
  rows: MenuRow[]
): Promise<void> {
  const calendar = getCalendarClient();
  const weekEnd = addDays(weekStartDate, 6);

  const { data } = await calendar.events.list({
    calendarId: CALENDAR_ID,
    timeMin: new Date(`${weekStartDate}T00:00:00`).toISOString(),
    timeMax: new Date(`${weekEnd}T23:59:59`).toISOString(),
    singleEvents: true,
  });

  await Promise.all(
    (data.items ?? [])
      .filter((event) => event.id)
      .map((event) =>
        calendar.events.delete({ calendarId: CALENDAR_ID, eventId: event.id! })
      )
  );

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
  const calendar = getCalendarClient();

  const { data } = await calendar.events.list({
    calendarId: CALENDAR_ID,
    timeMin: new Date(`${row.date}T00:00:00`).toISOString(),
    timeMax: new Date(`${row.date}T23:59:59`).toISOString(),
    singleEvents: true,
  });

  await Promise.all(
    (data.items ?? [])
      .filter((event) => event.id)
      .map((event) =>
        calendar.events.delete({ calendarId: CALENDAR_ID, eventId: event.id! })
      )
  );

  await calendar.events.insert({
    calendarId: CALENDAR_ID,
    requestBody: {
      summary: titleForRow(row),
      start: { date: row.date },
      end: { date: addDays(row.date, 1) },
    },
  });
}
