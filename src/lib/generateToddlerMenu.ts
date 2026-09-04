import Anthropic from "@anthropic-ai/sdk";
import { addDays, dayOfWeekFor } from "./dates";
import {
  appendToddlerMenuRows,
  deleteToddlerMenuRowsForWeek,
  getRecentToddlerMenuHistory,
  getSettings,
  type ToddlerMenuRow,
  type ToddlerMenuStatus,
} from "./sheets";
import { replaceToddlerWeekEvents } from "./calendar";

const MODEL = "claude-sonnet-5";

/**
 * The toddler menu is less strict about variety than dinner — a week of
 * recent items is enough inspiration/context, not a repeat-avoidance list.
 */
const INSPIRATION_LOOKBACK_DAYS = 7;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface GeneratedToddlerDay {
  date: string;
  dayOfWeek: string;
  snack: string;
  meal: string;
  status: ToddlerMenuStatus;
}

function buildSystemPrompt(params: {
  days: { date: string; dayOfWeek: string }[];
  preferencesPrompt: string;
  recentItemNames: string[];
}): string {
  const { days, preferencesPrompt, recentItemNames } = params;

  const dayList = days
    .map(({ date, dayOfWeek }) => `${dayOfWeek} ${date}`)
    .join(", ");

  return `You are planning a toddler's school snack and lunch for one school week (Monday through Friday).

Toddler/school preferences:
${preferencesPrompt || "(none specified)"}

Snacks/meals served in the last ${INSPIRATION_LOOKBACK_DAYS} days, for inspiration/context — this menu doesn't need much variety, repeats are fine:
${recentItemNames.length ? recentItemNames.join(", ") : "(none recorded)"}

For each of the 5 school days (${dayList}), decide a status:
- "generated": a normal school day, with snack and meal each set to a specific, toddler-friendly, easy-to-pack item (this should be true for nearly all days), e.g. snack "Apple slices with peanut butter", meal "Turkey and cheese roll-ups with crackers". Keep items simple, nut-allergy-safe unless preferences say otherwise, and easy for a toddler to eat independently.
- "no_school": the preferences note this day as a recurring school closure (e.g. a standing no-school Friday); snack and meal should be empty.
- "manual_override": the preferences call for something specific on this day; put a short description in meal and leave snack empty.

The non-"generated" statuses only apply if the preferences prompt itself specifies something standing for a particular day of the week — otherwise use "generated" for all 5 days.

Call the record_toddler_menu tool with exactly 5 entries, one per school day listed above, in order.`;
}

async function callClaudeForToddlerMenu(params: {
  weekStartDate: string;
  days: { date: string; dayOfWeek: string }[];
  preferencesPrompt: string;
  recentItemNames: string[];
}): Promise<GeneratedToddlerDay[]> {
  const { days } = params;

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: buildSystemPrompt(params),
    messages: [
      {
        role: "user",
        content: `Generate the toddler school snack/lunch menu for: ${days
          .map((d) => `${d.dayOfWeek} ${d.date}`)
          .join(", ")}.`,
      },
    ],
    tools: [
      {
        name: "record_toddler_menu",
        description: "Records the generated toddler school snack/lunch menu.",
        input_schema: {
          type: "object",
          properties: {
            days: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  date: { type: "string" },
                  dayOfWeek: { type: "string" },
                  snack: {
                    type: "string",
                    description:
                      "A specific, toddler-friendly snack item. Empty unless status is \"generated\".",
                  },
                  meal: {
                    type: "string",
                    description:
                      "A specific, toddler-friendly lunch item, or a short override description.",
                  },
                  status: {
                    type: "string",
                    enum: ["generated", "no_school", "manual_override"],
                  },
                },
                required: ["date", "dayOfWeek", "snack", "meal", "status"],
              },
            },
          },
          required: ["days"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "record_toddler_menu" },
  });

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error(
      "Claude did not return the expected record_toddler_menu tool call"
    );
  }

  const input = toolUse.input as { days: GeneratedToddlerDay[] };
  if (!Array.isArray(input.days) || input.days.length !== 5) {
    throw new Error(`Expected 5 school days from Claude, got ${input.days?.length}`);
  }

  return input.days;
}

/**
 * Generates the toddler school snack/lunch menu for the Mon–Fri of
 * `weekStartDate`'s week (the same Sunday-starting week the dinner menu
 * generates for). Defaults to the currently live week (Settings) so the
 * manual "regenerate toddler week" action can call this on its own,
 * independent of dinner generation.
 */
export async function generateToddlerWeeklyMenu(
  weekStartDate?: string
): Promise<ToddlerMenuRow[]> {
  const settings = await getSettings();
  const targetWeekStart = weekStartDate ?? settings.lastGeneratedWeekStart;
  if (!targetWeekStart) {
    throw new Error("No week has been generated yet — nothing to target.");
  }

  const days = Array.from({ length: 5 }, (_, i) => {
    const date = addDays(targetWeekStart, i + 1); // Monday..Friday
    return { date, dayOfWeek: dayOfWeekFor(date) };
  });

  const recentHistory = await getRecentToddlerMenuHistory(
    addDays(targetWeekStart, -INSPIRATION_LOOKBACK_DAYS)
  );

  const recentItemNames = [
    ...new Set(
      recentHistory
        .filter((r) => r.status === "generated")
        .flatMap((r) => [r.snack, r.meal])
        .filter(Boolean)
    ),
  ];

  const generatedDays = await callClaudeForToddlerMenu({
    weekStartDate: targetWeekStart,
    days,
    preferencesPrompt: settings.toddlerPreferencesPrompt,
    recentItemNames,
  });

  const menuRows: ToddlerMenuRow[] = generatedDays.map((d) => ({
    date: d.date,
    dayOfWeek: d.dayOfWeek,
    weekStartDate: targetWeekStart,
    snack: d.snack,
    meal: d.meal,
    status: d.status,
  }));

  await deleteToddlerMenuRowsForWeek(targetWeekStart);
  await appendToddlerMenuRows(menuRows);
  await replaceToddlerWeekEvents(targetWeekStart, menuRows);

  return menuRows;
}
