import { getCalendarClient } from "./google";
import { addDays } from "./dates";
import type { MenuRow } from "./sheets";

const CALENDAR_ID = process.env.GOOGLE_MEALS_CALENDAR_ID ?? "";

function titleForRow(row: MenuRow): string {
  switch (row.status) {
    case "eating_out":
      return "Eating out";
    case "meal_prep":
      return "Meal prep";
    case "manual_override":
      return row.mealName || "Override";
    default:
      return row.mealName;
  }
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
