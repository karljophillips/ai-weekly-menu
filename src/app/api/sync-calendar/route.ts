import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { syncCalendarWithSheet } from "@/lib/syncCalendar";

/**
 * Rebuilds the current week's calendar events from the Sheet, in case the
 * calendar drifted out of sync (e.g. a day-edit's calendar write failed).
 */
export async function POST() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { menuRows, toddlerMenuRows } = await syncCalendarWithSheet();
    return NextResponse.json({ ok: true, menuRows, toddlerMenuRows });
  } catch (error) {
    console.error("sync-calendar failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
