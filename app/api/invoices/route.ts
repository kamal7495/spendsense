import { NextRequest, NextResponse } from "next/server";
import { appendInvoiceItems, getInvoices } from "@/lib/sheets";
import { InvoiceLineItem, isCategory } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const invoices = await getInvoices();
    return NextResponse.json({ invoices });
  } catch (error) {
    console.error("GET /api/invoices failed", error);
    return NextResponse.json(
      { error: "Failed to read invoices from Google Sheet" },
      { status: 500 }
    );
  }
}

function validateLineItem(raw: unknown, index: number): InvoiceLineItem {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`Line item ${index} must be an object`);
  }
  const item = raw as Record<string, unknown>;

  const { date, vendor, orderId, item: itemName, category, amount, fee, quantity } = item;

  if (typeof date !== "string" || !date) {
    throw new Error(`Line item ${index} is missing a valid "date"`);
  }
  if (typeof vendor !== "string" || !vendor) {
    throw new Error(`Line item ${index} is missing a valid "vendor"`);
  }
  if (typeof orderId !== "string" || !orderId) {
    throw new Error(`Line item ${index} is missing a valid "orderId"`);
  }
  if (typeof itemName !== "string" || !itemName) {
    throw new Error(`Line item ${index} is missing a valid "item"`);
  }
  if (typeof category !== "string" || !isCategory(category)) {
    throw new Error(`Line item ${index} has an invalid "category": ${String(category)}`);
  }
  if (typeof amount !== "number" || !Number.isFinite(amount)) {
    throw new Error(`Line item ${index} is missing a valid "amount"`);
  }
  if (fee !== undefined && (typeof fee !== "number" || !Number.isFinite(fee))) {
    throw new Error(`Line item ${index} has an invalid "fee"`);
  }
  if (quantity !== undefined && (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity <= 0)) {
    throw new Error(`Line item ${index} has an invalid "quantity"`);
  }

  return {
    date,
    vendor,
    orderId,
    item: itemName,
    category,
    amount,
    fee: typeof fee === "number" ? fee : 0,
    quantity: typeof quantity === "number" ? quantity : 1,
  };
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }

  const rawItems = Array.isArray(body) ? body : (body as { items?: unknown })?.items;

  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return NextResponse.json(
      { error: "Request body must be a non-empty array of line items (or { items: [...] })" },
      { status: 400 }
    );
  }

  let lineItems: InvoiceLineItem[];
  try {
    lineItems = rawItems.map((raw, i) => validateLineItem(raw, i));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid line item" },
      { status: 400 }
    );
  }

  try {
    await appendInvoiceItems(lineItems);
    return NextResponse.json({ success: true, count: lineItems.length }, { status: 201 });
  } catch (error) {
    console.error("POST /api/invoices failed", error);
    return NextResponse.json(
      { error: "Failed to append invoice to Google Sheet" },
      { status: 500 }
    );
  }
}
