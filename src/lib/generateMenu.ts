import Anthropic from "@anthropic-ai/sdk";
import { addDays, dayOfWeekFor, getTargetWeekStart } from "./dates";
import {
  appendMenuRows,
  deleteMenuRowsForWeek,
  getRecentMenuHistory,
  getSettings,
  saveSettings,
  type MenuRow,
  type MenuStatus,
} from "./sheets";
import { getWeeklyForecast, type DailyForecast } from "./weather";
import { replaceWeekEvents } from "./calendar";

const MODEL = "claude-sonnet-5";
export const REPEAT_AVOIDANCE_DAYS = 28;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface GeneratedDay {
  date: string;
  dayOfWeek: string;
  mealName: string;
  status: MenuStatus;
  isAdventurous: boolean;
}

function buildSystemPrompt(params: {
  days: { date: string; dayOfWeek: string }[];
  forecast: DailyForecast[];
  preferencesPrompt: string;
  recentMealNames: string[];
}): string {
  const { days, forecast, preferencesPrompt, recentMealNames } = params;

  const forecastSummary = days
    .map(({ date, dayOfWeek }) => {
      const f = forecast.find((f) => f.date === date);
      return f
        ? `${dayOfWeek} ${date}: high ${f.tempMaxC}°C, low ${f.tempMinC}°C, ${f.precipitationProbability}% chance of rain`
        : `${dayOfWeek} ${date}: forecast unavailable`;
    })
    .join("\n");

  return `You are planning a household's dinner menu for one week (Sunday through Saturday).

Household preferences:
${preferencesPrompt || "(none specified)"}

Weather forecast for the week:
${forecastSummary}

Use the weather as a loose guide: warm/dry days suit grilling or lighter meals, cold days suit soups/stews/oven bakes. Don't force it if it conflicts with the household preferences.

Avoid repeating any of these meals served in the last ${REPEAT_AVOIDANCE_DAYS} days:
${recentMealNames.length ? recentMealNames.join(", ") : "(none recorded)"}

For each of the 7 days, decide a status:
- "generated": a normal dinner, with mealName set to a specific dish/recipe name (this should be true for nearly all days). mealName must always be an actual dish, e.g. "Chicken Carnitas Tacos with Pickled Onion" or "Grilled Salmon with Chimichurri" — never a category, cuisine, or rotation label on its own. If the household preferences pin a day to a fixed theme (e.g. "Tuesday: Mexican Tacos" or "Friday: fish"), pick one specific recipe that fits that theme rather than repeating the theme name as the mealName.
- "eating_out": household preferences call for eating out this day
- "meal_prep": household preferences call for a meal-prep/delivery service this day
- "manual_override": household preferences call for something else specific this day; mealName should briefly describe it

The non-"generated" statuses only apply if the household preferences prompt itself specifies something standing for a particular day of the week — otherwise use "generated" for all 7 days. Individual one-off changes (eating out this Thursday, etc.) are handled separately as day-edits after generation, not here.

Also set isAdventurous to true for any "generated" day whose mealName is a fun, unusual pick for this household (a new cuisine, an experimental dish, something out of the ordinary) — otherwise false. Don't describe it as "adventurous" in the mealName itself; the calendar shows an icon for it instead. Always false for non-"generated" days.

Call the record_menu tool with exactly 7 entries, one per day listed above, in order.`;
}

async function callClaudeForMenu(params: {
  weekStartDate: string;
  days: { date: string; dayOfWeek: string }[];
  forecast: DailyForecast[];
  preferencesPrompt: string;
  recentMealNames: string[];
}): Promise<GeneratedDay[]> {
  const { weekStartDate, days } = params;

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: buildSystemPrompt(params),
    messages: [
      {
        role: "user",
        content: `Generate the menu for ${weekStartDate} through ${addDays(
          weekStartDate,
          6
        )}. Days: ${days.map((d) => `${d.dayOfWeek} ${d.date}`).join(", ")}.`,
      },
    ],
    tools: [
      {
        name: "record_menu",
        description: "Records the generated weekly menu.",
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
                  mealName: {
                    type: "string",
                    description:
                      "A specific dish/recipe name, e.g. \"Chicken Carnitas Tacos with Pickled Onion\". Never just a category, cuisine, or rotation label like \"Mexican Tacos\" on its own.",
                  },
                  status: {
                    type: "string",
                    enum: [
                      "generated",
                      "eating_out",
                      "meal_prep",
                      "manual_override",
                    ],
                  },
                  isAdventurous: {
                    type: "boolean",
                    description:
                      "True if mealName is a fun/unusual pick for this household. Always false for non-\"generated\" days.",
                  },
                },
                required: [
                  "date",
                  "dayOfWeek",
                  "mealName",
                  "status",
                  "isAdventurous",
                ],
              },
            },
          },
          required: ["days"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "record_menu" },
  });

  const toolUse = response.content.find(
    (block) => block.type === "tool_use"
  );
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not return the expected record_menu tool call");
  }

  const input = toolUse.input as { days: GeneratedDay[] };
  if (!Array.isArray(input.days) || input.days.length !== 7) {
    throw new Error(`Expected 7 days from Claude, got ${input.days?.length}`);
  }

  return input.days;
}

export async function generateWeeklyMenu(): Promise<MenuRow[]> {
  const weekStartDate = getTargetWeekStart();
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStartDate, i);
    return { date, dayOfWeek: dayOfWeekFor(date) };
  });

  const [forecast, settings, recentHistory] = await Promise.all([
    getWeeklyForecast(weekStartDate),
    getSettings(),
    getRecentMenuHistory(addDays(weekStartDate, -REPEAT_AVOIDANCE_DAYS)),
  ]);

  const recentMealNames = [
    ...new Set(
      recentHistory
        .filter((r) => r.status === "generated" && r.mealName)
        .map((r) => r.mealName)
    ),
  ];

  const generatedDays = await callClaudeForMenu({
    weekStartDate,
    days,
    forecast,
    preferencesPrompt: settings.preferencesPrompt,
    recentMealNames,
  });

  const menuRows: MenuRow[] = generatedDays.map((d) => {
    const dayForecast = forecast.find((f) => f.date === d.date);
    return {
      date: d.date,
      dayOfWeek: d.dayOfWeek,
      weekStartDate,
      mealName: d.mealName,
      status: d.status,
      weatherCode: dayForecast?.weatherCode ?? null,
      isAdventurous: d.isAdventurous,
    };
  });

  await deleteMenuRowsForWeek(weekStartDate);
  await appendMenuRows(menuRows);
  await replaceWeekEvents(weekStartDate, menuRows);
  await saveSettings({ lastGeneratedWeekStart: weekStartDate });

  return menuRows;
}
