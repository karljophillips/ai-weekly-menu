import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSettings, saveSettings, type Settings } from "@/lib/sheets";

export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settings = await getSettings();
  return NextResponse.json(settings);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const update: Partial<Settings> = {};
  if (typeof body.preferencesPrompt === "string") {
    update.preferencesPrompt = body.preferencesPrompt;
  }
  if (typeof body.timezone === "string" && body.timezone.trim()) {
    update.timezone = body.timezone.trim();
  }
  if (typeof body.toddlerPreferencesPrompt === "string") {
    update.toddlerPreferencesPrompt = body.toddlerPreferencesPrompt;
  }
  await saveSettings(update);
  return NextResponse.json({ ok: true });
}
