import { replaceWeekEvents } from "./calendar";
import { getMenuRowsForWeek, getSettings, type MenuRow } from "./sheets";

/**
 * Rebuilds the current live week's calendar events from the Sheet (the
 * source of truth) — a manual escape hatch for when the calendar drifts
 * out of sync with the Sheet (e.g. a day-edit's calendar write failed or
 * someone edited an event by hand).
 */
export async function syncCalendarWithSheet(): Promise<MenuRow[]> {
  const settings = await getSettings();
  if (!settings.lastGeneratedWeekStart) {
    throw new Error("No week has been generated yet — nothing to sync.");
  }

  const currentWeek = await getMenuRowsForWeek(settings.lastGeneratedWeekStart);
  if (currentWeek.length === 0) {
    throw new Error(
      `No Menu rows found for week ${settings.lastGeneratedWeekStart}.`
    );
  }

  await replaceWeekEvents(settings.lastGeneratedWeekStart, currentWeek);
  return currentWeek;
}
