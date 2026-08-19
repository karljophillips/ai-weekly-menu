"use client";

import { useState } from "react";

interface Settings {
  preferencesPrompt: string;
  lastGeneratedWeekStart: string;
}

interface UpdatedRow {
  date: string;
  dayOfWeek: string;
  mealName: string;
  status: string;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";
type EditStatus = "idle" | "applying" | "applied" | "error";
type RegenStatus = "idle" | "regenerating" | "regenerated" | "error";

function summarizeRow(row: UpdatedRow): string {
  const label =
    row.status === "eating_out"
      ? "Eating out"
      : row.status === "meal_prep"
      ? "Meal prep"
      : row.mealName || row.status;
  return `${row.dayOfWeek} → ${label}`;
}

export function PreferencesForm({
  initialSettings,
}: {
  initialSettings: Settings;
}) {
  const [preferencesPrompt, setPreferencesPrompt] = useState(
    initialSettings.preferencesPrompt
  );
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");

  const [editInstruction, setEditInstruction] = useState("");
  const [editStatus, setEditStatus] = useState<EditStatus>("idle");
  const [editError, setEditError] = useState<string | null>(null);
  const [updatedRows, setUpdatedRows] = useState<UpdatedRow[]>([]);

  const [regenStatus, setRegenStatus] = useState<RegenStatus>("idle");

  async function savePreferences() {
    setSaveStatus("saving");
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preferencesPrompt }),
    });
    setSaveStatus(res.ok ? "saved" : "error");
  }

  async function applyEdit() {
    if (!editInstruction.trim()) return;
    setEditStatus("applying");
    setEditError(null);
    const res = await fetch("/api/edit-days", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instruction: editInstruction }),
    });
    const data = await res.json();
    if (res.ok) {
      setUpdatedRows(data.updatedRows);
      setEditStatus("applied");
      setEditInstruction("");
    } else {
      setEditError(data.error ?? "Something went wrong.");
      setEditStatus("error");
    }
  }

  async function regenerate() {
    if (
      !confirm(
        "This regenerates all 7 days from scratch and discards any day-edits made this week. Continue?"
      )
    ) {
      return;
    }
    setRegenStatus("regenerating");
    const res = await fetch("/api/generate-menu", { method: "POST" });
    setRegenStatus(res.ok ? "regenerated" : "error");
  }

  return (
    <div className="flex flex-col gap-10">
      <label className="flex flex-col gap-2">
        <span className="font-medium">Household preferences</span>
        <textarea
          className="min-h-32 rounded border p-2"
          value={preferencesPrompt}
          onChange={(e) => setPreferencesPrompt(e.target.value)}
          placeholder="e.g. no seafood, love Mexican and Italian food, keep it under 45 mins to cook"
        />
        <div>
          <button
            onClick={savePreferences}
            className="rounded bg-black px-4 py-2 text-white"
          >
            Save
          </button>
        </div>
        <p className="text-sm text-gray-500">
          {saveStatus === "saving" && "Saving..."}
          {saveStatus === "saved" && "Saved."}
          {saveStatus === "error" && "Something went wrong."}
        </p>
      </label>

      <div className="flex flex-col gap-2 border-t pt-6">
        <span className="font-medium">Edit this week</span>
        <p className="text-sm text-gray-500">
          Tell it what changed on specific day(s) — only those day(s) update,
          the rest of the week is left alone. e.g. &quot;Thursday eating
          out&quot; or &quot;Saturday friends for dinner, we&apos;re getting
          pizza&quot;.
        </p>
        <textarea
          className="min-h-20 rounded border p-2"
          value={editInstruction}
          onChange={(e) => setEditInstruction(e.target.value)}
          placeholder="e.g. Saturday friends for dinner, we're getting pizza"
        />
        <div>
          <button
            onClick={applyEdit}
            disabled={editStatus === "applying" || !editInstruction.trim()}
            className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
          >
            Apply edit
          </button>
        </div>
        <p className="text-sm text-gray-500">
          {editStatus === "applying" && "Applying..."}
          {editStatus === "applied" &&
            `Updated: ${updatedRows.map(summarizeRow).join(", ")}`}
          {editStatus === "error" && (editError ?? "Something went wrong.")}
        </p>
      </div>

      <div className="flex flex-col gap-2 border-t pt-6">
        <span className="font-medium">Regenerate entire week</span>
        <p className="text-sm text-gray-500">
          Redoes all 7 days from scratch (e.g. after changing preferences
          above). Discards any day-edits made since this week was generated.
        </p>
        <div>
          <button onClick={regenerate} className="rounded border px-4 py-2">
            Regenerate this week
          </button>
        </div>
        <p className="text-sm text-gray-500">
          {regenStatus === "regenerating" && "Regenerating this week's menu..."}
          {regenStatus === "regenerated" && "Done — check the Meals calendar."}
          {regenStatus === "error" && "Something went wrong."}
          {initialSettings.lastGeneratedWeekStart &&
            ` Last generated for week of ${initialSettings.lastGeneratedWeekStart}.`}
        </p>
      </div>
    </div>
  );
}
