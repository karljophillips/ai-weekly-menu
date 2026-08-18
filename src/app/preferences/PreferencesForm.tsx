"use client";

import { useState } from "react";

interface Settings {
  preferencesPrompt: string;
  weeklyOverridePrompt: string;
  lastGeneratedWeekStart: string;
}

type Status =
  | "idle"
  | "saving"
  | "saved"
  | "regenerating"
  | "regenerated"
  | "error";

export function PreferencesForm({
  initialSettings,
}: {
  initialSettings: Settings;
}) {
  const [preferencesPrompt, setPreferencesPrompt] = useState(
    initialSettings.preferencesPrompt
  );
  const [weeklyOverridePrompt, setWeeklyOverridePrompt] = useState(
    initialSettings.weeklyOverridePrompt
  );
  const [status, setStatus] = useState<Status>("idle");

  async function save() {
    setStatus("saving");
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preferencesPrompt, weeklyOverridePrompt }),
    });
    setStatus(res.ok ? "saved" : "error");
  }

  async function regenerate() {
    setStatus("regenerating");
    const res = await fetch("/api/generate-menu", { method: "POST" });
    setStatus(res.ok ? "regenerated" : "error");
  }

  return (
    <div className="flex flex-col gap-6">
      <label className="flex flex-col gap-2">
        <span className="font-medium">Household preferences</span>
        <textarea
          className="min-h-32 rounded border p-2"
          value={preferencesPrompt}
          onChange={(e) => setPreferencesPrompt(e.target.value)}
          placeholder="e.g. no seafood, love Mexican and Italian food, keep it under 45 mins to cook"
        />
      </label>

      <label className="flex flex-col gap-2">
        <span className="font-medium">This week&apos;s override</span>
        <textarea
          className="min-h-24 rounded border p-2"
          value={weeklyOverridePrompt}
          onChange={(e) => setWeeklyOverridePrompt(e.target.value)}
          placeholder="e.g. eating out Thursday, meal prep service Mon/Wed"
        />
      </label>

      <div className="flex gap-3">
        <button
          onClick={save}
          className="rounded bg-black px-4 py-2 text-white"
        >
          Save
        </button>
        <button onClick={regenerate} className="rounded border px-4 py-2">
          Regenerate this week
        </button>
      </div>

      <p className="text-sm text-gray-500">
        {status === "saving" && "Saving..."}
        {status === "saved" && "Saved."}
        {status === "regenerating" && "Regenerating this week's menu..."}
        {status === "regenerated" && "Done — check the Meals calendar."}
        {status === "error" && "Something went wrong."}
        {initialSettings.lastGeneratedWeekStart &&
          ` Last generated for week of ${initialSettings.lastGeneratedWeekStart}.`}
      </p>
    </div>
  );
}
