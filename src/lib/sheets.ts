import { getSheetsClient } from "./google";

const SHEET_ID = process.env.GOOGLE_SHEET_ID ?? "";

const MENU_RANGE = "Menu!A2:G";
const SETTINGS_RANGE = "Settings!A2:C2";

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

export interface Settings {
  preferencesPrompt: string;
  weeklyOverridePrompt: string;
  lastGeneratedWeekStart: string;
}

export async function getSettings(): Promise<Settings> {
  const sheets = getSheetsClient();
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: SETTINGS_RANGE,
  });
  const [
    preferencesPrompt = "",
    weeklyOverridePrompt = "",
    lastGeneratedWeekStart = "",
  ] = data.values?.[0] ?? [];
  return { preferencesPrompt, weeklyOverridePrompt, lastGeneratedWeekStart };
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
          merged.weeklyOverridePrompt,
          merged.lastGeneratedWeekStart,
        ],
      ],
    },
  });
}

/** All Menu rows on or after `sinceDate` (inclusive), oldest first. */
export async function getRecentMenuHistory(
  sinceDate: string
): Promise<MenuRow[]> {
  const sheets = getSheetsClient();
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: MENU_RANGE,
  });
  const rows = data.values ?? [];
  return rows
    .map(
      (row): MenuRow => ({
        date: row[0] ?? "",
        dayOfWeek: row[1] ?? "",
        weekStartDate: row[2] ?? "",
        mealName: row[3] ?? "",
        status: (row[4] as MenuStatus) ?? "generated",
        weatherCode: row[5] === "" || row[5] == null ? null : Number(row[5]),
        isAdventurous: row[6] === "TRUE",
      })
    )
    .filter((row) => row.date >= sinceDate);
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

/** Removes any existing Menu rows for the given week, so a regenerate doesn't duplicate them. */
export async function deleteMenuRowsForWeek(
  weekStartDate: string
): Promise<void> {
  const sheets = getSheetsClient();

  const [metaRes, valuesRes] = await Promise.all([
    sheets.spreadsheets.get({ spreadsheetId: SHEET_ID }),
    sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: MENU_RANGE,
    }),
  ]);

  const menuSheet = metaRes.data.sheets?.find(
    (s) => s.properties?.title === "Menu"
  );
  const sheetId = menuSheet?.properties?.sheetId;
  if (sheetId == null) throw new Error('Sheet tab "Menu" not found');

  const rows = valuesRes.data.values ?? [];
  // MENU_RANGE starts at row 2 (row 1 is the header), so array index i is
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
