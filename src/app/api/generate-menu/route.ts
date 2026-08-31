import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { generateWeeklyMenu } from "@/lib/generateMenu";
import { generateToddlerWeeklyMenu } from "@/lib/generateToddlerMenu";

/**
 * Triggered either by Vercel Cron (Authorization: Bearer $CRON_SECRET) on
 * Saturday nights, or manually from /preferences by a signed-in user.
 *
 * Vercel Cron always sends a GET request (it has no way to send POST), so
 * this needs a GET handler — a POST-only route 405s every cron invocation.
 * POST is kept too, for the manual "Regenerate this week" button.
 */
async function handleGenerate(request: Request): Promise<Response> {
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
    const toddlerMenuRows = await generateToddlerWeeklyMenu(
      menuRows[0]?.weekStartDate
    );
    return NextResponse.json({ ok: true, menuRows, toddlerMenuRows });
  } catch (error) {
    console.error("generate-menu failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export const GET = handleGenerate;
export const POST = handleGenerate;
