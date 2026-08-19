# Setup To-Do

One-time account/console setup required from you before parts of this can be
built and tested. Grouped by when each item is actually needed — earlier
groups unblock later ones, so working top to bottom is the easiest order.

## 1. Needed before local testing can start

Nothing here blocks writing code — I can scaffold the app without any of
this. But these unblock actually *running* it locally, so worth doing early,
in parallel with implementation.

- [x] Create/choose a Google Cloud project. (`ai-menu-505903`, under
      karladidas@gmail.com)
- [x] Enable the **Google Sheets API** and **Google Calendar API** on it.
- [x] Create a **service account** in that project; generate and download
      its JSON key. Keep it out of git.
      (`ai-weekly-menu@ai-menu-505903.iam.gserviceaccount.com`, key
      contents are in `.env.local`, the JSON file itself was deleted after
      use)
- [x] Get an **Anthropic API key** (console.anthropic.com).
- [x] Create an **OAuth 2.0 Client ID** (Web application) in the same GCP
      project, for Google sign-in. Configure the OAuth consent screen —
      "External" + testing mode with karladidas@gmail.com as a test user
      (personal Gmail accounts can't use "Internal").
  - [x] Add `http://localhost:3000/api/auth/callback/google` as an
        authorized redirect URI.

## 2. Needed before testing Sheets/Calendar integration specifically

- [x] Create the **dev Google Sheet** with `Menu` and `Settings` tabs.
- [x] Share the dev Sheet with the service account's email (Editor access).
- [x] Create a dedicated **dev "Meals (dev)" Google Calendar**; note its
      Calendar ID (Settings → *Integrate calendar*).
- [x] Share the dev calendar with the service account's email ("Make
      changes to events").

## 3. Needed before deploying to production

- [x] Create the **production Google Sheet** (same schema as dev) and
      share it with the service account.
      (`1UHDC3gI-CaAaANJ6EWfNv_hP3Oe3wYqFK9LDFttzDkw`)
- [x] Create the **production "Meals" Google Calendar**, share it with the
      service account, note its Calendar ID.
      (`ea76d94b9aea864e863543c86d4d493e105223903df97e592e4eaf4d8e893966@group.calendar.google.com`)
- [ ] Add the production Meals calendar as a visible layer wherever the
      Cozyla's calendar widget points. (Should show automatically since
      it's under the same karladidas@gmail.com account — worth confirming
      on the tablet itself.)
- [x] Add the production redirect URI (your real domain) to the same
      OAuth Client ID.
      (`https://ai-weekly-menu.vercel.app/api/auth/callback/google`)
- [x] Create a **Vercel account** and connect the `ai-weekly-menu` GitHub
      repo. (Team `phillips7`, project `ai-weekly-menu`, deployed at
      https://ai-weekly-menu.vercel.app)
      (Confirmed 2026-08-18: this connection auto-deploys to production
      on every push to `main` — no manual "Deploy" step needed. If that
      ever stops happening, check Project Settings → Git → Production
      Branch / Ignored Build Step.)
- [x] Set all env vars in Vercel (list is in `SPEC.md`).
      (Note: Vercel's env var UI does not strip surrounding quotes the
      way `.env.local`/dotenv parsing does — paste
      `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` *without* the wrapping `"..."`
      or JWT signing fails with `DECODER routines::unsupported`.)
- [x] Configure the Vercel Cron job for Saturday-night generation.
      (Already defined in `vercel.json`, picked up automatically on
      deploy — no separate console step needed.)

## 4. Needed after the day-edit redesign (see `SPEC.md`)

The `Settings` tab shrank from 3 columns to 2 — `WeeklyOverridePrompt` is
gone, so `LastGeneratedWeekStart` is now column B instead of C. The code
reads/writes `Settings!A2:B2`, so until you edit the actual sheets, the old
column B (override text) will be misread as the week-start date.

- [ ] In the **dev** Google Sheet's `Settings` tab, delete column B
      (`WeeklyOverridePrompt`) so `LastGeneratedWeekStart` shifts into B.
- [ ] Do the same in the **production** Google Sheet
      (`1UHDC3gI-CaAaANJ6EWfNv_hP3Oe3wYqFK9LDFttzDkw`).

## Not needed from you at all

- Nothing to install locally beyond Node.js — no Docker (see `SPEC.md` →
  *Local development*).
- No IFTTT/Gemini/Google Assistant setup — that idea was explored and
  dropped.
