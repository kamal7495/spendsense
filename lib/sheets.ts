import { google, sheets_v4 } from "googleapis";
import {
  BudgetRow,
  Category,
  InvoiceLineItem,
  InvoiceRow,
  isCategory,
} from "./types";

const INVOICES_SHEET = "Invoices_Raw";
const BUDGETS_SHEET = "Budgets";

function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

let cachedClient: sheets_v4.Sheets | null = null;

function getSheetsClient(): sheets_v4.Sheets {
  if (cachedClient) return cachedClient;

  const email = getEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  // Vercel/most env UIs store the key with literal \n sequences; normalize them
  // to real newlines. If the key already contains real newlines, this is a no-op.
  const privateKey = getEnv("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n");

  const auth = new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  cachedClient = google.sheets({ version: "v4", auth });
  return cachedClient;
}

function getSheetId(): string {
  return getEnv("GOOGLE_SHEET_ID");
}

function toNumber(value: unknown): number {
  const n = typeof value === "number" ? value : parseFloat(String(value ?? ""));
  return Number.isFinite(n) ? n : 0;
}

/** Reads every data row (excluding the header) from Invoices_Raw. */
export async function getInvoices(): Promise<InvoiceRow[]> {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: getSheetId(),
    range: `${INVOICES_SHEET}!A2:H`,
  });

  const rows = res.data.values ?? [];

  return rows
    .filter((row) => row.length > 0 && row[0])
    .map((row): InvoiceRow => {
      const [date, vendor, orderId, item, category, amount, fee, quantity] = row;
      return {
        date: String(date ?? ""),
        vendor: String(vendor ?? ""),
        orderId: String(orderId ?? ""),
        item: String(item ?? ""),
        category: isCategory(String(category)) ? (category as Category) : "household",
        amount: toNumber(amount),
        fee: toNumber(fee),
        // Older rows predate the Quantity column; treat missing as 1 unit.
        quantity: quantity !== undefined && quantity !== "" ? toNumber(quantity) : 1,
      };
    });
}

/** Appends one row per line item to Invoices_Raw. */
export async function appendInvoiceItems(items: InvoiceLineItem[]): Promise<void> {
  if (items.length === 0) return;

  const sheets = getSheetsClient();
  const values = items.map((item) => [
    item.date,
    item.vendor,
    item.orderId,
    item.item,
    item.category,
    item.amount,
    item.fee ?? 0,
    item.quantity ?? 1,
  ]);

  await sheets.spreadsheets.values.append({
    spreadsheetId: getSheetId(),
    range: `${INVOICES_SHEET}!A:H`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values },
  });
}

/** Reads every data row (excluding the header) from Budgets. */
export async function getBudgets(): Promise<BudgetRow[]> {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: getSheetId(),
    range: `${BUDGETS_SHEET}!A2:B`,
  });

  const rows = res.data.values ?? [];

  return rows
    .filter((row) => row.length > 0 && row[0])
    .map((row): BudgetRow => ({
      category: isCategory(String(row[0])) ? (row[0] as Category) : "household",
      monthlyTarget: toNumber(row[1]),
    }));
}

/**
 * Sets the monthly target for a category, updating the existing row if one
 * exists for that category, or appending a new row otherwise.
 */
export async function upsertBudget(category: Category, monthlyTarget: number): Promise<void> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSheetId();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${BUDGETS_SHEET}!A2:B`,
  });
  const rows = res.data.values ?? [];
  const existingIndex = rows.findIndex((row) => row[0] === category);

  if (existingIndex >= 0) {
    const sheetRow = existingIndex + 2; // account for header row
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${BUDGETS_SHEET}!A${sheetRow}:B${sheetRow}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[category, monthlyTarget]] },
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${BUDGETS_SHEET}!A:B`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [[category, monthlyTarget]] },
    });
  }
}
