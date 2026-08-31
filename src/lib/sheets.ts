import { getSheetsClient } from "./google";

const SHEET_ID = process.env.GOOGLE_SHEET_ID ?? "";

const MENU_RANGE = "Menu!A2:G";
const TODDLER_MENU_RANGE = "ToddlerMenu!A2:F";
const SETTINGS_RANGE = "Settings!A2:D2";
const DEFAULT_TIMEZONE = "America/New_York";

export type MenuStatus =
  | "generated"
  | "eating_out"
  | "meal_prep"
  | "manual_override";

export interface MenuRow {
  date: string; // YYYY-MM-DD
  dayOfWeek: string;
  weekStartDate: string; // YYYY-MM-DD, the Sunday that starts this row's week
  mealName: string;
  status: MenuStatus;
  weatherCode: number | null; // WMO weather interpretation code
  isAdventurous: boolean;
}

export type ToddlerMenuStatus = "generated" | "no_school" | "manual_override";

export interface ToddlerMenuRow {
  date: string; // YYYY-MM-DD
  dayOfWeek: string;
  weekStartDate: string; // YYYY-MM-DD, the Sunday that starts this row's week
  snack: string;
  meal: string;
  status: ToddlerMenuStatus;
}

export interface Settings {
  preferencesPrompt: string;
  lastGeneratedWeekStart: string;
  /** IANA timezone name (e.g. "America/New_York") the household lives in. */
  timezone: string;
  /** Long-lived free text for the toddler school snack/lunch menu (allergies, daycare rules, etc.). */
  toddlerPreferencesPrompt: string;
}

export async function getSettings(): Promise<Settings> {
  const sheets = getSheetsClient();
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: SETTINGS_RANGE,
  });
  const [
    preferencesPrompt = "",
    lastGeneratedWeekStart = "",
    timezone = "",
    toddlerPreferencesPrompt = "",
  ] = data.values?.[0] ?? [];
  return {
    preferencesPrompt,
    lastGeneratedWeekStart,
    timezone: timezone || DEFAULT_TIMEZONE,
    toddlerPreferencesPrompt,
  };
}

export async function saveSettings(
  update: Partial<Settings>
): Promise<void> {
  const current = await getSettings();
  const merged = { ...current, ...update };
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: SETTINGS_RANGE,
    valueInputOption: "RAW",
    requestBody: {
      values: [
        [
          merged.preferencesPrompt,
          merged.lastGeneratedWeekStart,
          merged.timezone,
          merged.toddlerPreferencesPrompt,
        ],
      ],
    },
  });
}

function rowToMenuRow(row: string[]): MenuRow {
  return {
    date: row[0] ?? "",
    dayOfWeek: row[1] ?? "",
    weekStartDate: row[2] ?? "",
    mealName: row[3] ?? "",
    status: (row[4] as MenuStatus) ?? "generated",
    weatherCode: row[5] === "" || row[5] == null ? null : Number(row[5]),
    isAdventurous: row[6] === "TRUE",
  };
}

/** All raw Menu rows alongside their 1-indexed grid row (MENU_RANGE starts at grid row 2). */
async function getAllMenuRowsWithGridRow(): Promise<
  { gridRow: number; row: MenuRow }[]
> {
  const sheets = getSheetsClient();
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: MENU_RANGE,
  });
  const rows = data.values ?? [];
  return rows.map((row, i) => ({ gridRow: i + 2, row: rowToMenuRow(row) }));
}

/** All Menu rows on or after `sinceDate` (inclusive), oldest first. */
export async function getRecentMenuHistory(
  sinceDate: string
): Promise<MenuRow[]> {
  const rows = await getAllMenuRowsWithGridRow();
  return rows.map((r) => r.row).filter((row) => row.date >= sinceDate);
}

/** The 7 Menu rows for the given week (by WeekStartDate), in date order. */
export async function getMenuRowsForWeek(
  weekStartDate: string
): Promise<MenuRow[]> {
  const rows = await getAllMenuRowsWithGridRow();
  return rows
    .map((r) => r.row)
    .filter((row) => row.weekStartDate === weekStartDate)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Overwrites a single day's Menu row in place (same grid row) with a patch
 * of fields — used by day-edits, which touch only the day(s) named rather
 * than the whole week's rows.
 */
export async function updateMenuRow(
  date: string,
  patch: Partial<Pick<MenuRow, "mealName" | "status" | "isAdventurous">>
): Promise<MenuRow> {
  const rows = await getAllMenuRowsWithGridRow();
  const match = rows.find((r) => r.row.date === date);
  if (!match) throw new Error(`No Menu row found for date ${date}`);

  const updated: MenuRow = { ...match.row, ...patch };
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `Menu!A${match.gridRow}:G${match.gridRow}`,
    valueInputOption: "RAW",
    requestBody: {
      values: [
        [
          updated.date,
          updated.dayOfWeek,
          updated.weekStartDate,
          updated.mealName,
          updated.status,
          updated.weatherCode ?? "",
          updated.isAdventurous ? "TRUE" : "FALSE",
        ],
      ],
    },
  });
  return updated;
}

export async function appendMenuRows(rows: MenuRow[]): Promise<void> {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: MENU_RANGE,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: rows.map((r) => [
        r.date,
        r.dayOfWeek,
        r.weekStartDate,
        r.mealName,
        r.status,
        r.weatherCode ?? "",
        r.isAdventurous ? "TRUE" : "FALSE",
      ]),
    },
  });
}

/**
 * Removes any existing rows for the given week (matched on the WeekStartDate
 * column, index 2) from `sheetTitle`/`range`, so a regenerate doesn't
 * duplicate them. Shared by the Menu and ToddlerMenu tabs, which have the
 * same append-only-per-week shape.
 */
async function deleteRowsForWeek(
  sheetTitle: string,
  range: string,
  weekStartDate: string
): Promise<void> {
  const sheets = getSheetsClient();

  const [metaRes, valuesRes] = await Promise.all([
    sheets.spreadsheets.get({ spreadsheetId: SHEET_ID }),
    sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range,
    }),
  ]);

  const sheet = metaRes.data.sheets?.find(
    (s) => s.properties?.title === sheetTitle
  );
  const sheetId = sheet?.properties?.sheetId;
  if (sheetId == null) throw new Error(`Sheet tab "${sheetTitle}" not found`);

  const rows = valuesRes.data.values ?? [];
  // range starts at row 2 (row 1 is the header), so array index i is
  // grid row (0-indexed) i + 1.
  const gridRowsToDelete = rows
    .map((row, i) => (row[2] === weekStartDate ? i + 1 : null))
    .filter((i): i is number => i !== null)
    .sort((a, b) => b - a); // descending so earlier deletes don't shift later ones

  if (gridRowsToDelete.length === 0) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: gridRowsToDelete.map((gridRow) => ({
        deleteDimension: {
          range: {
            sheetId,
            dimension: "ROWS" as const,
            startIndex: gridRow,
            endIndex: gridRow + 1,
          },
        },
      })),
    },
  });
}

/** Removes any existing Menu rows for the given week, so a regenerate doesn't duplicate them. */
export async function deleteMenuRowsForWeek(
  weekStartDate: string
): Promise<void> {
  await deleteRowsForWeek("Menu", MENU_RANGE, weekStartDate);
}

function rowToToddlerMenuRow(row: string[]): ToddlerMenuRow {
  return {
    date: row[0] ?? "",
    dayOfWeek: row[1] ?? "",
    weekStartDate: row[2] ?? "",
    snack: row[3] ?? "",
    meal: row[4] ?? "",
    status: (row[5] as ToddlerMenuStatus) ?? "generated",
  };
}

/** All ToddlerMenu rows on or after `sinceDate` (inclusive), oldest first. */
export async function getRecentToddlerMenuHistory(
  sinceDate: string
): Promise<ToddlerMenuRow[]> {
  const sheets = getSheetsClient();
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: TODDLER_MENU_RANGE,
  });
  const rows = data.values ?? [];
  return rows.map(rowToToddlerMenuRow).filter((row) => row.date >= sinceDate);
}

/** The ToddlerMenu rows (weekdays only) for the given week, in date order. */
export async function getToddlerMenuRowsForWeek(
  weekStartDate: string
): Promise<ToddlerMenuRow[]> {
  const sheets = getSheetsClient();
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: TODDLER_MENU_RANGE,
  });
  const rows = data.values ?? [];
  return rows
    .map(rowToToddlerMenuRow)
    .filter((row) => row.weekStartDate === weekStartDate)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function appendToddlerMenuRows(
  rows: ToddlerMenuRow[]
): Promise<void> {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: TODDLER_MENU_RANGE,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: rows.map((r) => [
        r.date,
        r.dayOfWeek,
        r.weekStartDate,
        r.snack,
        r.meal,
        r.status,
      ]),
    },
  });
}

/** Removes any existing ToddlerMenu rows for the given week, so a regenerate doesn't duplicate them. */
export async function deleteToddlerMenuRowsForWeek(
  weekStartDate: string
): Promise<void> {
  await deleteRowsForWeek("ToddlerMenu", TODDLER_MENU_RANGE, weekStartDate);
}
