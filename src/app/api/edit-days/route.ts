import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { applyDayEdits } from "@/lib/editDays";

/**
 * Applies a free-text instruction to specific day(s) of the current,
 * already-generated week (e.g. "Thursday eating out"). Only the day(s) the
 * instruction refers to are touched — see SPEC.md's "Day-edit flow".
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const instruction = typeof body.instruction === "string" ? body.instruction.trim() : "";
  if (!instruction) {
    return NextResponse.json({ error: "Missing instruction" }, { status: 400 });
  }

  try {
    const updatedRows = await applyDayEdits(instruction);
    return NextResponse.json({ ok: true, updatedRows });
  } catch (error) {
    console.error("edit-days failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
