import { replaceWeekEvents, replaceToddlerWeekEvents } from "./calendar";
import {
  getMenuRowsForWeek,
  getSettings,
  getToddlerMenuRowsForWeek,
  type MenuRow,
  type ToddlerMenuRow,
} from "./sheets";

/**
 * Rebuilds the current live week's calendar events (both dinner and toddler
 * tracks) from the Sheet (the source of truth) — a manual escape hatch for
 * when the calendar drifts out of sync with the Sheet (e.g. a day-edit's
 * calendar write failed or someone edited an event by hand).
 */
export async function syncCalendarWithSheet(): Promise<{
  menuRows: MenuRow[];
  toddlerMenuRows: ToddlerMenuRow[];
}> {
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

  const currentToddlerWeek = await getToddlerMenuRowsForWeek(
    settings.lastGeneratedWeekStart
  );
  if (currentToddlerWeek.length > 0) {
    await replaceToddlerWeekEvents(
      settings.lastGeneratedWeekStart,
      currentToddlerWeek
    );
  }

  return { menuRows: currentWeek, toddlerMenuRows: currentToddlerWeek };
}
