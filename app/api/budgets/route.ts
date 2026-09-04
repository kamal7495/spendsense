import { NextRequest, NextResponse } from "next/server";
import { getBudgets, upsertBudget } from "@/lib/sheets";
import { isCategory } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const budgets = await getBudgets();
    return NextResponse.json({ budgets });
  } catch (error) {
    console.error("GET /api/budgets failed", error);
    return NextResponse.json(
      { error: "Failed to read budgets from Google Sheet" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }

  const { category, monthlyTarget } = (body ?? {}) as Record<string, unknown>;

  if (typeof category !== "string" || !isCategory(category)) {
    return NextResponse.json({ error: `Invalid category: ${String(category)}` }, { status: 400 });
  }
  if (typeof monthlyTarget !== "number" || !Number.isFinite(monthlyTarget) || monthlyTarget < 0) {
    return NextResponse.json({ error: "monthlyTarget must be a non-negative number" }, { status: 400 });
  }

  try {
    await upsertBudget(category, monthlyTarget);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("POST /api/budgets failed", error);
    return NextResponse.json(
      { error: "Failed to save budget to Google Sheet" },
      { status: 500 }
    );
  }
}
