import Anthropic from "@anthropic-ai/sdk";
import { replaceDayEvent } from "./calendar";
import { addDays, dayOfWeekFor, todayString } from "./dates";
import { REPEAT_AVOIDANCE_DAYS } from "./generateMenu";
import {
  getMenuRowsForWeek,
  getRecentMenuHistory,
  getSettings,
  updateMenuRow,
  type MenuRow,
  type MenuStatus,
} from "./sheets";

const MODEL = "claude-sonnet-5";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface EditedDay {
  date: string;
  status: MenuStatus;
  mealName: string;
  isAdventurous: boolean;
}

function buildSystemPrompt(currentWeek: MenuRow[], timezone: string): string {
  const weekSummary = currentWeek
    .map(
      (row) =>
        `${row.dayOfWeek} ${row.date}: status=${row.status}, mealName=${
          row.mealName || "(none)"
        }`
    )
    .join("\n");

  const today = todayString(timezone);

  return `You are editing a household's already-generated dinner menu for one week, in response to a short instruction about specific day(s) that changed (plans changed, they're eating out, friends are coming over, etc.).

Today's date is ${today} (${dayOfWeekFor(today)}). Use this to resolve relative references like "today", "tomorrow", or "this weekend" to the correct date(s) below.

This week's current menu:
${weekSummary}

Given the instruction, decide which day(s) it refers to — by day name and/or date — and their new status and mealName. Only include days the instruction actually refers to; do NOT include or change any other day.

Status values:
- "eating_out": eating out that day; mealName should be empty
- "meal_prep": a meal-prep/delivery service that day; mealName should be empty
- "manual_override": anything else specific named for that day (e.g. "pizza with friends"); mealName should briefly describe it
- "generated": use this if the instruction reverts a day back to a normal dinner, OR asks for a new/different recipe suggestion for that day (e.g. "give Monday a new recipe", "I don't like Thursday's dinner, pick something else", "surprise me for Friday") — in both cases leave mealName empty; a fresh dish will be picked automatically afterward. Only fill in mealName here if the instruction itself names the specific dish to use.

Set isAdventurous to false in all cases — this field doesn't apply to day-edits.

Every date you return MUST exactly match one of the dates listed above. Call the record_edits tool with one entry per day the instruction refers to (at least one, at most ${currentWeek.length}).`;
}

async function callClaudeForEdit(
  currentWeek: MenuRow[],
  instruction: string,
  timezone: string
): Promise<EditedDay[]> {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: buildSystemPrompt(currentWeek, timezone),
    messages: [{ role: "user", content: instruction }],
    tools: [
      {
        name: "record_edits",
        description:
          "Records which day(s) of the current week changed and their new status/mealName.",
        input_schema: {
          type: "object",
          properties: {
            days: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  date: { type: "string" },
                  status: {
                    type: "string",
                    enum: [
                      "generated",
                      "eating_out",
                      "meal_prep",
                      "manual_override",
                    ],
                  },
                  mealName: { type: "string" },
                  isAdventurous: { type: "boolean" },
                },
                required: ["date", "status", "mealName", "isAdventurous"],
              },
            },
          },
          required: ["days"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "record_edits" },
  });

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not return the expected record_edits tool call");
  }

  const input = toolUse.input as { days: EditedDay[] };
  if (!Array.isArray(input.days) || input.days.length === 0) {
    throw new Error(
      "Couldn't tell which day(s) that instruction refers to — try naming the day explicitly."
    );
  }

  return input.days;
}

interface NewMeal {
  mealName: string;
  isAdventurous: boolean;
}

/**
 * Picks a fresh, specific dish for a single day whose day-edit asked for a
 * new/different suggestion rather than naming one — mirrors the per-day
 * decision made during weekly generation (lib/generateMenu.ts), scoped to
 * just this one day.
 */
async function callClaudeForNewMeal(params: {
  date: string;
  dayOfWeek: string;
  preferencesPrompt: string;
  recentMealNames: string[];
}): Promise<NewMeal> {
  const { date, dayOfWeek, preferencesPrompt, recentMealNames } = params;

  const systemPrompt = `You are picking a new dinner for a household, replacing what was previously planned for one day because they asked for a different suggestion.

Household preferences:
${preferencesPrompt || "(none specified)"}

Avoid repeating any of these meals (already served recently, or already planned elsewhere this week):
${recentMealNames.length ? recentMealNames.join(", ") : "(none recorded)"}

Pick one specific dish/recipe name for ${dayOfWeek} ${date}, e.g. "Chicken Carnitas Tacos with Pickled Onion" or "Grilled Salmon with Chimichurri" — never a category, cuisine, or rotation label on its own.

Set isAdventurous to true if this is a fun, unusual pick for this household (a new cuisine, an experimental dish, something out of the ordinary), otherwise false. Don't describe it as "adventurous" in the mealName itself.

Call the record_meal tool with the chosen mealName and isAdventurous.`;

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 512,
    system: systemPrompt,
    messages: [
      { role: "user", content: `Pick a new dinner for ${dayOfWeek} ${date}.` },
    ],
    tools: [
      {
        name: "record_meal",
        description: "Records the newly picked dish for this day.",
        input_schema: {
          type: "object",
          properties: {
            mealName: {
              type: "string",
              description:
                'A specific dish/recipe name, e.g. "Chicken Carnitas Tacos with Pickled Onion". Never just a category, cuisine, or rotation label.',
            },
            isAdventurous: { type: "boolean" },
          },
          required: ["mealName", "isAdventurous"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "record_meal" },
  });

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not return the expected record_meal tool call");
  }

  return toolUse.input as NewMeal;
}

/**
 * Applies a free-text instruction to one or more days of the current live
 * week (Settings.LastGeneratedWeekStart) — updating only the Menu row(s)
 * and calendar event(s) for the day(s) named, leaving the rest of the week
 * untouched.
 */
export async function applyDayEdits(instruction: string): Promise<MenuRow[]> {
  const settings = await getSettings();
  if (!settings.lastGeneratedWeekStart) {
    throw new Error("No week has been generated yet — nothing to edit.");
  }

  const currentWeek = await getMenuRowsForWeek(settings.lastGeneratedWeekStart);
  if (currentWeek.length === 0) {
    throw new Error(
      `No Menu rows found for week ${settings.lastGeneratedWeekStart}.`
    );
  }

  const edits = await callClaudeForEdit(currentWeek, instruction, settings.timezone);

  const validDates = new Set(currentWeek.map((row) => row.date));
  const invalid = edits.filter((edit) => !validDates.has(edit.date));
  if (invalid.length > 0) {
    throw new Error(
      `Claude returned date(s) outside the current week: ${invalid
        .map((e) => e.date)
        .join(", ")}. Try rephrasing the instruction.`
    );
  }

  const editedDates = new Set(edits.map((edit) => edit.date));
  const needsNewMeal = edits.some(
    (edit) => edit.status === "generated" && !edit.mealName.trim()
  );

  // Only fetched when at least one edit needs a fresh dish picked.
  let recentMealNames: string[] = [];
  if (needsNewMeal) {
    const weekStart = currentWeek[0].weekStartDate;
    const recentHistory = await getRecentMenuHistory(
      addDays(weekStart, -REPEAT_AVOIDANCE_DAYS)
    );
    const plannedThisWeek = currentWeek.filter(
      (row) => row.status === "generated" && row.mealName && !editedDates.has(row.date)
    );
    recentMealNames = [
      ...new Set(
        [...recentHistory, ...plannedThisWeek]
          .filter((r) => r.status === "generated" && r.mealName)
          .map((r) => r.mealName)
      ),
    ];
  }

  const updatedRows: MenuRow[] = [];
  for (const edit of edits) {
    let { mealName, isAdventurous } = edit;
    if (edit.status === "generated" && !mealName.trim()) {
      const dayOfWeek =
        currentWeek.find((row) => row.date === edit.date)?.dayOfWeek ?? "";
      const newMeal = await callClaudeForNewMeal({
        date: edit.date,
        dayOfWeek,
        preferencesPrompt: settings.preferencesPrompt,
        recentMealNames,
      });
      mealName = newMeal.mealName;
      isAdventurous = newMeal.isAdventurous;
    }

    const updated = await updateMenuRow(edit.date, {
      status: edit.status,
      mealName,
      isAdventurous,
    });
    await replaceDayEvent(updated);
    updatedRows.push(updated);
  }

  return updatedRows;
}
