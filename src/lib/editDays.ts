import Anthropic from "@anthropic-ai/sdk";
import { replaceDayEvent } from "./calendar";
import {
  getMenuRowsForWeek,
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

function buildSystemPrompt(currentWeek: MenuRow[]): string {
  const weekSummary = currentWeek
    .map(
      (row) =>
        `${row.dayOfWeek} ${row.date}: status=${row.status}, mealName=${
          row.mealName || "(none)"
        }`
    )
    .join("\n");

  return `You are editing a household's already-generated dinner menu for one week, in response to a short instruction about specific day(s) that changed (plans changed, they're eating out, friends are coming over, etc.).

This week's current menu:
${weekSummary}

Given the instruction, decide which day(s) it refers to — by day name and/or date — and their new status and mealName. Only include days the instruction actually refers to; do NOT include or change any other day.

Status values:
- "eating_out": eating out that day; mealName should be empty
- "meal_prep": a meal-prep/delivery service that day; mealName should be empty
- "manual_override": anything else specific named for that day (e.g. "pizza with friends"); mealName should briefly describe it
- "generated": only use this if the instruction explicitly reverts a day back to a normal generated dinner without naming a specific dish

Set isAdventurous to false in all cases — this field doesn't apply to day-edits.

Every date you return MUST exactly match one of the dates listed above. Call the record_edits tool with one entry per day the instruction refers to (at least one, at most ${currentWeek.length}).`;
}

async function callClaudeForEdit(
  currentWeek: MenuRow[],
  instruction: string
): Promise<EditedDay[]> {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: buildSystemPrompt(currentWeek),
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

  const edits = await callClaudeForEdit(currentWeek, instruction);

  const validDates = new Set(currentWeek.map((row) => row.date));
  const invalid = edits.filter((edit) => !validDates.has(edit.date));
  if (invalid.length > 0) {
    throw new Error(
      `Claude returned date(s) outside the current week: ${invalid
        .map((e) => e.date)
        .join(", ")}. Try rephrasing the instruction.`
    );
  }

  const updatedRows: MenuRow[] = [];
  for (const edit of edits) {
    const updated = await updateMenuRow(edit.date, {
      status: edit.status,
      mealName: edit.mealName,
      isAdventurous: edit.isAdventurous,
    });
    await replaceDayEvent(updated);
    updatedRows.push(updated);
  }

  return updatedRows;
}
