# AI Weekly Menu — Spec

## Overview

A weekly dinner-menu generator with no custom display: each Saturday
night/Sunday morning it generates the coming week's dinners (Sun–Sat) using
an LLM — taking into account household preferences, a rolling
repeat-avoidance window, and the week's weather forecast — then writes them
as events to a dedicated Google Calendar. That calendar is viewed via the
wall tablet's existing calendar widget, so there's nothing to build for
display. All data (the source of truth, and generation history) lives in a
single Google Sheet.

After a week is generated, plans change — you review it Sunday morning, or a
day gets swapped mid-week (friends invite themselves for dinner, you decide
to eat out). Rather than queueing a note for the *next* generation, you tell
the app in free text which day(s) changed (e.g. "Thursday eating out" or
"Saturday friends for dinner, we're getting pizza") and it edits just those
day(s) — updating that Menu row and that day's calendar event in place —
leaving the rest of the week, which you've already planned and shopped
around, untouched.

## Architecture

- **Framework:** Next.js, deployed on Vercel (a settings page + API routes +
  cron, all in one codebase/deploy). Vercel's GitHub integration
  auto-deploys to production on every push to `main` — no manual deploy
  step.
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
| `/preferences` | sign-in required | Edit the persistent preferences prompt; apply a free-text edit to one or more days of the current, already-generated week; button to fully regenerate the current week from scratch; button to re-sync the calendar from the Sheet. |

That's the entire frontend for v1 — no widget, no week view, no
favourite/dislike UI (dropped from MVP, see below).

## Google Sheet schema

**`Menu`** (append-only historical log — one row per day, every week; also
the source the repeat-avoidance check reads from)
| Date | DayOfWeek | WeekStartDate | MealName | Status | WeatherCode | IsAdventurous |
|---|---|---|---|---|---|---|
| 2026-08-16 | Sunday | 2026-08-16 | Grilled chicken & salad | generated | 0 | FALSE |
| 2026-08-20 | Thursday | 2026-08-16 | — | eating_out | 61 | FALSE |

`Status` ∈ `generated`, `eating_out`, `meal_prep`, `manual_override`.

Rows aren't strictly append-only in practice: a day-edit overwrites its one
row in place (same grid row, new values), and a full regenerate deletes and
re-appends all 7 rows for the week. Both keep one row per date — history
accumulates week-over-week, not edit-over-edit.

`WeatherCode` is the day's WMO weather code from the forecast, recorded for
every day regardless of status; `IsAdventurous` is set by Claude when the
meal is a fun, unusual pick. Both drive an emoji shown on the calendar event
instead of being spelled out in `MealName` — e.g. ☀️/⛅/🌧️/⛈️ for the day's
weather (kept even on `eating_out`/`meal_prep` days — useful for deciding
*where*, e.g. by the lake on a nice day), 🎲 for an adventurous pick, 🍴 for
`eating_out`, 🧑‍🍳 for `meal_prep`.

**`Settings`** (single row, key columns)
| PreferencesPrompt | LastGeneratedWeekStart | Timezone |
|---|---|---|
| free text you maintain | 2026-08-16 | America/New_York |

`PreferencesPrompt` is long-lived free text you write/edit yourself (dietary
notes, cuisine leanings, allergies, anything else) and gets folded directly
into the system prompt. `LastGeneratedWeekStart` doubles as "which week is
currently live" — it's what day-edits (below) target, since it's exactly
the week sitting on the calendar right now. `Timezone` is the household's
IANA timezone name, editable from `/preferences`; it's what "today"/
"tomorrow" in day-edits, which week a generation run targets, and the
weather forecast's day-bucketing are all computed against — the app server
itself runs in UTC (Vercel), so this can't be inferred from the server's own
clock. Defaults to `America/New_York` if left blank.

## Generation flow (Saturday night / Sunday morning)

1. Cron hits `/api/generate-menu` (protected by a shared secret header so
   it can't be triggered publicly). Vercel Cron always sends a **GET**
   request — the route handles both GET and POST (POST is what the manual
   "Regenerate this week" button uses) so a cron invocation doesn't 405.
2. Fetch 7-day forecast (Open-Meteo, Huntersville NC) for the upcoming
   Sun–Sat week.
3. Read the last ~4–5 weeks of `Menu` rows (repeat-avoidance window = 1
   month) and `Settings.PreferencesPrompt`.
4. Build a system prompt combining: base instructions, the preferences
   prompt, weather→meal-style guidance (warm/dry → grill, cold → soup/stew,
   etc.), and meals served in the last month to avoid repeating.
5. Call Claude, requesting structured output: 7 entries
   `{date, dayOfWeek, mealName, status}`.
6. Append the 7 rows to `Menu`.
7. Delete any existing "Meals" calendar events in that Sun–Sat date range
   (relevant on regenerate — no-op on a fresh week), then create one
   all-day event per day titled with the meal name.
8. Update `LastGeneratedWeekStart` in `Settings`.

Manual "Regenerate this week" (from `/preferences`) re-runs the same flow
on demand — e.g. after editing preferences — overwriting that week's Sheet
rows and calendar events rather than duplicating them. This is a blunt,
whole-week reset: it also **discards any day-edits** made since the week
was generated, since it regenerates all 7 days from scratch. The UI should
say so before running it.

## Day-edit flow (any time after a week is generated)

This is the everyday way plans change: Sunday-morning review, or a
mid-week "actually, Saturday's pizza now." It never touches Claude's
per-week generation — it edits the already-written Menu rows and calendar
events for specific days only.

1. On `/preferences`, you type free text naming one or more days and what
   changed, e.g. "Thursday eating out" or "Saturday friends for dinner,
   we're getting pizza". This posts to `/api/edit-days`.
2. The route reads `Settings.LastGeneratedWeekStart` to find the currently
   live week, then reads that week's 7 `Menu` rows (date, dayOfWeek,
   status, mealName).
3. It sends Claude the current week's 7 rows plus the instruction, and asks
   for **only the day(s) the instruction refers to** — each as
   `{date, status, mealName, isAdventurous}` — explicitly not the full
   week. (Same `Status` enum as generation: `eating_out` / `meal_prep` for
   those services, `manual_override` with a short `mealName` for anything
   else named outright, like "pizza".) If the instruction just reverts a
   day to a normal dinner, or asks for a new/different recipe suggestion
   without naming a dish (e.g. "give Monday a new recipe", "surprise me for
   Friday"), Claude returns `status: "generated"` with `mealName` left
   empty rather than guessing a dish itself.
4. For any returned day with `status: "generated"` and an empty `mealName`,
   a second Claude call picks one specific dish for just that day —
   honoring the household preferences prompt and avoiding meals served in
   the last 28 days or already planned elsewhere in the current week (the
   same repeat-avoidance window used by weekly generation).
5. For each returned day: overwrite that single `Menu` row in place (same
   grid row — no delete/re-append), then replace just that day's calendar
   event (list events on that date, delete them, insert the new one).
   Every other day's row and event is untouched.
6. The response lists what changed (e.g. "Saturday → 🍕 Pizza") so you get
   confirmation without needing to check the calendar.

If the instruction is ambiguous or names a day outside the current week,
the route should return an error/clarification rather than guessing —
silently mis-editing a day is worse than making you retype it.

**Finding the existing event to replace, correctly:** looking up "the
event on this date" via a `timeMin`/`timeMax` window is timezone-sensitive
— converting a plain date to an instant depends on the server's runtime
timezone (e.g. UTC on Vercel vs. local when run on a dev machine), which
can shift a tight one-day window enough to miss the event entirely,
leaving a stale duplicate after the new one is inserted. To avoid this,
the lookup pads the query window by a day on each side and then filters
strictly by the event's own `start.date` field (an exact string match, not
a time comparison) before deleting — see `listEventsInDateRange` in
`calendar.ts`. `replaceWeekEvents` (full generation) uses the same
padded-and-filtered lookup.

## Sync calendar (manual recovery)

A "Sync calendar" button on `/preferences` rebuilds the current week's
calendar events from the Sheet — the Sheet is always the source of truth,
so this is a one-way Sheet → Calendar repair for when they've drifted
(e.g. a calendar write failed partway through, or someone edited an event
by hand on the calendar itself). It reads the live week's 7 `Menu` rows
and calls the same `replaceWeekEvents` used by generation — delete
everything currently on the calendar for that week's date range, re-insert
one event per row. It never modifies the Sheet.

## Auth details

- NextAuth Google provider. Sign-in succeeds only if the account's email is
  in an `ALLOWED_EMAILS` allowlist (env var).
- `/preferences` and its POST actions (save preferences, day-edit, manual
  regenerate, sync calendar) require a valid session. Nothing else in the
  app is user-facing.

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
- How to identify "our" calendar events for deletion on regenerate/day-edit
  (date range within the dedicated calendar is sufficient since nothing
  else is on it, but consider tagging via `extendedProperties` for safety).
- How strictly to validate the day-edit Claude call: it must reliably map
  "Thursday"/"Saturday" to the right date in the live week and return only
  the day(s) named, not the whole week. Worth testing with a handful of
  real phrasings before trusting it unsupervised; consider rejecting (not
  guessing) if it returns a day not present in the week it was given.
