import { NextRequest, NextResponse } from "next/server";
import { getAccountBalances, upsertAccountBalance } from "@/lib/sheets";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const balances = await getAccountBalances();
    return NextResponse.json({ balances });
  } catch (error) {
    console.error("GET /api/balances failed", error);
    return NextResponse.json(
      { error: "Failed to read account balances from Google Sheet" },
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

  const { account, openingBalance, asOfDate } = (body ?? {}) as Record<string, unknown>;

  if (typeof account !== "string" || !account.trim()) {
    return NextResponse.json({ error: "account is required" }, { status: 400 });
  }
  if (typeof openingBalance !== "number" || !Number.isFinite(openingBalance) || openingBalance < 0) {
    return NextResponse.json({ error: "openingBalance must be a non-negative number" }, { status: 400 });
  }
  if (typeof asOfDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) {
    return NextResponse.json({ error: "asOfDate must be an ISO date string (YYYY-MM-DD)" }, { status: 400 });
  }

  try {
    await upsertAccountBalance(account.trim(), openingBalance, asOfDate);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("POST /api/balances failed", error);
    return NextResponse.json(
      { error: "Failed to save account balance to Google Sheet" },
      { status: 500 }
    );
  }
}
