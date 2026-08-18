# AI Weekly Menu — Spec

## Overview

A weekly dinner-menu generator with no custom display: each Saturday
night/Sunday morning it generates the coming week's dinners (Sun–Sat) using
an LLM — taking into account household preferences, a rolling
repeat-avoidance window, the week's weather forecast, and an optional weekly
override prompt (e.g. "eating out Thursday, meal prep service Mon/Wed") —
then writes them as events to a dedicated Google Calendar. That calendar is
viewed via the wall tablet's existing calendar widget, so there's nothing to
build for display. All data (the source of truth, and generation history)
lives in a single Google Sheet.

## Architecture

- **Framework:** Next.js, deployed on Vercel (a settings page + API routes +
  cron, all in one codebase/deploy).
- **Scheduling:** Vercel Cron triggers an API route Saturday night (hardcoded
  for MVP — exact cron expression TBD at implementation time, targeting
  evening in America/New_York so it lands before the Sunday shop).
- **LLM:** Claude API (Anthropic) generates the week's meals from a
  constructed prompt.
- **Weather:** Open-Meteo (no API key), queried for Huntersville, NC
  (lat/lon hardcoded).
- **Data store:** A single Google Sheet, read/written by the backend via a
  Google Cloud **service account** — the source of truth and generation
  history.
- **Display:** A dedicated Google Calendar ("Meals"), written to by the same
  service account (Calendar API, same credentials as Sheets). Shown via the
  Cozyla's existing calendar widget — no app-side display to build.
- **Auth:** NextAuth with Google sign-in, restricted to an allowlist of
  specific household email address(es). Gates the settings page and manual
  regenerate.

## Pages

| Route | Auth | Purpose |
|---|---|---|
| `/preferences` | sign-in required | Edit the persistent preferences prompt and the current week's override prompt; button to manually regenerate the current week. |

That's the entire frontend for v1 — no widget, no week view, no
favourite/dislike UI (dropped from MVP, see below).

## Google Sheet schema

**`Menu`** (append-only historical log — one row per day, every week; also
the source the repeat-avoidance check reads from)
| Date | DayOfWeek | WeekStartDate | MealName | Status |
|---|---|---|---|---|
| 2026-08-16 | Sunday | 2026-08-16 | Grilled chicken & salad | generated |
| 2026-08-20 | Thursday | 2026-08-16 | — | eating_out |

`Status` ∈ `generated`, `eating_out`, `meal_prep`, `manual_override`.

**`Settings`** (single row, key columns)
| PreferencesPrompt | WeeklyOverridePrompt | LastGeneratedWeekStart |
|---|---|---|
| free text you maintain | free text, edited weekly before generation | 2026-08-16 |

`PreferencesPrompt` is long-lived free text you write/edit yourself (dietary
notes, cuisine leanings, allergies, anything else) and gets folded directly
into the system prompt. `WeeklyOverridePrompt` is the same idea but scoped
to the current week only; it's read at generation time and then cleared.

## Generation flow (Saturday night / Sunday morning)

1. Cron hits `/api/generate-menu` (protected by a shared secret header so
   it can't be triggered publicly).
2. Fetch 7-day forecast (Open-Meteo, Huntersville NC) for the upcoming
   Sun–Sat week.
3. Read the last ~4–5 weeks of `Menu` rows (repeat-avoidance window = 1
   month) and `Settings` (`PreferencesPrompt` + `WeeklyOverridePrompt`).
4. Build a system prompt combining: base instructions, the preferences
   prompt, weather→meal-style guidance (warm/dry → grill, cold → soup/stew,
   etc.), meals served in the last month to avoid repeating, and handling
   for the weekly override (days it names get `eating_out` / `meal_prep` /
   whatever it specifies instead of a generated meal).
5. Call Claude, requesting structured output: 7 entries
   `{date, dayOfWeek, mealName, status}`.
6. Append the 7 rows to `Menu`.
7. Delete any existing "Meals" calendar events in that Sun–Sat date range
   (relevant on regenerate — no-op on a fresh week), then create one
   all-day event per day titled with the meal name (or "Eating out" /
   "Meal prep" for override days).
8. Clear `WeeklyOverridePrompt` and update `LastGeneratedWeekStart` in
   `Settings`.

Manual "Regenerate this week" (from `/preferences`) re-runs the same flow
on demand — e.g. after editing preferences — overwriting that week's Sheet
rows and calendar events rather than duplicating them.

## Auth details

- NextAuth Google provider. Sign-in succeeds only if the account's email is
  in an `ALLOWED_EMAILS` allowlist (env var).
- `/preferences` and its POST actions (save preferences/override, manual
  regenerate) require a valid session. Nothing else in the app is
  user-facing.

## Environment variables (Vercel)

- `ANTHROPIC_API_KEY`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` — Sheets + Calendar read/write
- `GOOGLE_SHEET_ID`
- `GOOGLE_MEALS_CALENDAR_ID` — the dedicated "Meals" calendar, shared with the service account
- `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` — NextAuth login
- `ALLOWED_EMAILS`
- `NEXTAUTH_SECRET`, `NEXTAUTH_URL`
- `CRON_SECRET` — shared secret Vercel Cron sends to `/api/generate-menu`
- `LOCATION_LAT`, `LOCATION_LON` — Huntersville, NC (~35.4107, -80.8428)

## One-time setup (not code, but required before build)

1. Create the Google Sheet with the two tabs above.
2. Create a dedicated Google Calendar ("Meals"); note its Calendar ID.
3. Create a Google Cloud project → service account → JSON key → share both
   the Sheet and the Meals calendar with the service account's email
   (Editor / "make changes to events" access). Enable the Sheets API and
   Calendar API on the project.
4. Add the Meals calendar as a visible layer on whatever Google account
   drives the Cozyla's calendar widget.
5. In the same Google Cloud project, create an OAuth 2.0 Client ID (Web
   application) for NextAuth sign-in.
6. Get an Anthropic API key.
7. Create the Vercel project, connect this repo, set the env vars above,
   configure the cron job.

## Local development

No Docker — this stack is plain Next.js hitting external HTTP APIs
(Anthropic, Google Sheets, Google Calendar, Open-Meteo), and Vercel itself
runs it uncontainerized, so `npm run dev` matches production behaviour
closely enough. Docker would only add friction (native module rebuilds,
hot-reload quirks) for no real isolation benefit at this scale.

To develop safely without touching real data:

- **Separate dev Sheet + dev Calendar.** Duplicate the Sheet and create a
  second "Meals (dev)" calendar, both shared with the same service account.
  Point `GOOGLE_SHEET_ID` / `GOOGLE_MEALS_CALENDAR_ID` in `.env.local` at
  the dev copies so local runs never write into the real week.
- **`.env.local`** holds all the env vars from the list above
  (gitignored by default in a Next.js project) — real API keys work
  locally the same as in production; there's no local emulator for
  Anthropic or Google Sheets/Calendar worth setting up at this scale.
- **OAuth redirect URI:** add `http://localhost:3000/api/auth/callback/google`
  as a second authorized redirect URI on the same OAuth client used in
  production, so Google sign-in works locally too.
- **No local cron.** Vercel Cron only exists once deployed. Locally, just
  call the generation route directly, e.g.
  `curl -X POST localhost:3000/api/generate-menu -H "Authorization: Bearer $CRON_SECRET"`,
  instead of waiting for a schedule.

## Out of scope for v1 (possible future additions)

- Favourites/dislikes tracking (dropped for MVP — steering relies solely on
  the free-text preferences prompt; revisit if the LLM's picks drift).
- Recipes/ingredients/steps (meal is name-only for v1).
- Auto-generated shopping list.
- Per-person preference profiles (v1 is one shared household profile).
- Breakfast/lunch (v1 is dinner only).
- Notifications/reminders (e.g. "defrost tonight").
- Nutrition info, meal photos.
- Any custom widget/display (superseded by the calendar approach).

## Open implementation details (not blocking, decide while building)

- Exact cron expression/time for Saturday-night generation. Note: on Vercel's
  free Hobby tier, cron jobs aren't minute-precise — a job scheduled for
  `0 2 * * 0` fires sometime within that UTC hour, not at the exact minute.
  Fine for this use case (Hobby also comfortably covers a once-a-week job —
  its limit is 2 cron jobs/project, each up to once/day).
- Exact output-parsing/retry strategy if Claude's structured output is
  malformed.
- How to identify "our" calendar events for deletion on regenerate (date
  range within the dedicated calendar is sufficient since nothing else is
  on it, but consider tagging via `extendedProperties` for safety).
