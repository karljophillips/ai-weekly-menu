import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSettings, saveSettings } from "@/lib/sheets";

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
  await saveSettings({
    preferencesPrompt: body.preferencesPrompt,
    weeklyOverridePrompt: body.weeklyOverridePrompt,
  });
  return NextResponse.json({ ok: true });
}
