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
const REPEAT_AVOIDANCE_DAYS = 28;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface GeneratedDay {
  date: string;
  dayOfWeek: string;
  mealName: string;
  status: MenuStatus;
}

function buildSystemPrompt(params: {
  days: { date: string; dayOfWeek: string }[];
  forecast: DailyForecast[];
  preferencesPrompt: string;
  weeklyOverridePrompt: string;
  recentMealNames: string[];
}): string {
  const { days, forecast, preferencesPrompt, weeklyOverridePrompt, recentMealNames } =
    params;

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

This week's overrides (days named here should NOT get a generated meal - use their exact status instead):
${weeklyOverridePrompt || "(none)"}

Weather forecast for the week:
${forecastSummary}

Use the weather as a loose guide: warm/dry days suit grilling or lighter meals, cold days suit soups/stews/oven bakes. Don't force it if it conflicts with the household preferences.

Avoid repeating any of these meals served in the last ${REPEAT_AVOIDANCE_DAYS} days:
${recentMealNames.length ? recentMealNames.join(", ") : "(none recorded)"}

For each of the 7 days, decide a status:
- "generated": a normal dinner, with mealName set to the dish
- "eating_out": the override mentions eating out that day; mealName should be empty
- "meal_prep": the override mentions a meal-prep/delivery service that day; mealName should be empty
- "manual_override": the override specifies something else for that day; mealName should briefly describe what it said

Call the record_menu tool with exactly 7 entries, one per day listed above, in order.`;
}

async function callClaudeForMenu(params: {
  weekStartDate: string;
  days: { date: string; dayOfWeek: string }[];
  forecast: DailyForecast[];
  preferencesPrompt: string;
  weeklyOverridePrompt: string;
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
                  mealName: { type: "string" },
                  status: {
                    type: "string",
                    enum: [
                      "generated",
                      "eating_out",
                      "meal_prep",
                      "manual_override",
                    ],
                  },
                },
                required: ["date", "dayOfWeek", "mealName", "status"],
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
    weeklyOverridePrompt: settings.weeklyOverridePrompt,
    recentMealNames,
  });

  const menuRows: MenuRow[] = generatedDays.map((d) => ({
    date: d.date,
    dayOfWeek: d.dayOfWeek,
    weekStartDate,
    mealName: d.mealName,
    status: d.status,
  }));

  await deleteMenuRowsForWeek(weekStartDate);
  await appendMenuRows(menuRows);
  await replaceWeekEvents(weekStartDate, menuRows);
  await saveSettings({
    weeklyOverridePrompt: "",
    lastGeneratedWeekStart: weekStartDate,
  });

  return menuRows;
}
