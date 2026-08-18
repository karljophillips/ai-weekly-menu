import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { generateWeeklyMenu } from "@/lib/generateMenu";

/**
 * Triggered either by Vercel Cron (Authorization: Bearer $CRON_SECRET) on
 * Saturday nights, or manually from /preferences by a signed-in user.
 */
export async function POST(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  const isCron = !!cronSecret && authHeader === `Bearer ${cronSecret}`;

  if (!isCron) {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const menuRows = await generateWeeklyMenu();
    return NextResponse.json({ ok: true, menuRows });
  } catch (error) {
    console.error("generate-menu failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
