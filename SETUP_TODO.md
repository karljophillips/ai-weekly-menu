# Setup To-Do

One-time account/console setup required from you before parts of this can be
built and tested. Grouped by when each item is actually needed — earlier
groups unblock later ones, so working top to bottom is the easiest order.

## 1. Needed before local testing can start

Nothing here blocks writing code — I can scaffold the app without any of
this. But these unblock actually *running* it locally, so worth doing early,
in parallel with implementation.

- [ ] Create/choose a Google Cloud project.
- [ ] Enable the **Google Sheets API** and **Google Calendar API** on it.
- [ ] Create a **service account** in that project; generate and download
      its JSON key. Keep it out of git.
- [ ] Get an **Anthropic API key** (console.anthropic.com).
- [ ] Create an **OAuth 2.0 Client ID** (Web application) in the same GCP
      project, for Google sign-in. Configure the OAuth consent screen —
      "Internal"/testing mode with just your email as a test user is fine.
  - [ ] Add `http://localhost:3000/api/auth/callback/google` as an
        authorized redirect URI.

## 2. Needed before testing Sheets/Calendar integration specifically

- [ ] Create the **dev Google Sheet** with `Menu` and `Settings` tabs
      (exact column headers TBD when we build this part — I can write a
      setup script instead if you'd prefer not to do this by hand).
- [ ] Share the dev Sheet with the service account's email (Editor access).
- [ ] Create a dedicated **dev "Meals (dev)" Google Calendar**; note its
      Calendar ID (Settings → *Integrate calendar*).
- [ ] Share the dev calendar with the service account's email ("Make
      changes to events").

## 3. Needed before deploying to production

- [ ] Create the **production Google Sheet** (same schema as dev) and
      share it with the service account.
- [ ] Create the **production "Meals" Google Calendar**, share it with the
      service account, note its Calendar ID.
- [ ] Add the production Meals calendar as a visible layer wherever the
      Cozyla's calendar widget points.
- [ ] Add the production redirect URI (your real domain) to the same
      OAuth Client ID.
- [ ] Create a **Vercel account** and connect the `ai-weekly-menu` GitHub
      repo.
- [ ] Set all env vars in Vercel (list is in `SPEC.md`).
- [ ] Configure the Vercel Cron job for Saturday-night generation.

## Not needed from you at all

- Nothing to install locally beyond Node.js — no Docker (see `SPEC.md` →
  *Local development*).
- No IFTTT/Gemini/Google Assistant setup — that idea was explored and
  dropped.
