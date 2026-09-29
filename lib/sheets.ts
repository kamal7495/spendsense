import { google, sheets_v4 } from "googleapis";
import {
  AccountBalanceRow,
  BudgetRow,
  Category,
  IncomeRow,
  InvoiceLineItem,
  InvoiceRow,
  isCategory,
} from "./types";

const INVOICES_SHEET = "Invoices_Raw";
const BUDGETS_SHEET = "Budgets";
const ACCOUNT_BALANCES_SHEET = "Account_Balances";
const INCOME_SHEET = "Income_Raw";

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

/**
 * A partner's own, independently-owned SpendSense Sheet (their own Apps
 * Script pipeline, their own Gmail) - optional. When set, the same service
 * account must be shared as an Editor on that Sheet too. Returns null (not
 * an error) when unset, so a single-user setup is unaffected.
 */
function getPartnerSheetId(): string | null {
  return process.env.PARTNER_GOOGLE_SHEET_ID || null;
}

function toNumber(value: unknown): number {
  const n = typeof value === "number" ? value : parseFloat(String(value ?? ""));
  return Number.isFinite(n) ? n : 0;
}

/** Reads every data row (excluding the header) from Invoices_Raw. */
export async function getInvoices(spreadsheetId: string = getSheetId()): Promise<InvoiceRow[]> {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
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
export async function getBudgets(spreadsheetId: string = getSheetId()): Promise<BudgetRow[]> {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
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

/** Reads every data row (excluding the header) from Account_Balances. */
export async function getAccountBalances(
  spreadsheetId: string = getSheetId()
): Promise<AccountBalanceRow[]> {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${ACCOUNT_BALANCES_SHEET}!A2:C`,
  });

  const rows = res.data.values ?? [];

  return rows
    .filter((row) => row.length > 0 && row[0])
    .map((row): AccountBalanceRow => ({
      account: String(row[0] ?? ""),
      openingBalance: toNumber(row[1]),
      asOfDate: String(row[2] ?? ""),
    }));
}

/**
 * Reads every data row (excluding the header) from Income_Raw. Populated by
 * the Apps Script salary-credit source, not by this app — there's no upsert
 * counterpart here. Returns [] if the tab doesn't exist yet (the Apps Script
 * creates it lazily on the first matched salary credit), so the Dashboard
 * doesn't break for a user who hasn't run the updated script yet.
 */
export async function getIncome(spreadsheetId: string = getSheetId()): Promise<IncomeRow[]> {
  const sheets = getSheetsClient();
  let rows: string[][];
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${INCOME_SHEET}!A2:D`,
    });
    rows = (res.data.values as string[][]) ?? [];
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes("Unable to parse range")) return [];
    throw e;
  }

  return rows
    .filter((row) => row.length > 0 && row[0])
    .map((row): IncomeRow => ({
      date: String(row[0] ?? ""),
      source: String(row[1] ?? ""),
      description: String(row[2] ?? ""),
      amount: toNumber(row[3]),
    }));
}

/**
 * Sets the opening-balance reference point for an account, updating the
 * existing row if one exists for that account, or appending a new row
 * otherwise.
 */
export async function upsertAccountBalance(
  account: string,
  openingBalance: number,
  asOfDate: string
): Promise<void> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSheetId();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${ACCOUNT_BALANCES_SHEET}!A2:C`,
  });
  const rows = res.data.values ?? [];
  const existingIndex = rows.findIndex((row) => row[0] === account);

  if (existingIndex >= 0) {
    const sheetRow = existingIndex + 2; // account for header row
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${ACCOUNT_BALANCES_SHEET}!A${sheetRow}:C${sheetRow}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[account, openingBalance, asOfDate]] },
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${ACCOUNT_BALANCES_SHEET}!A:C`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [[account, openingBalance, asOfDate]] },
    });
  }
}

/**
 * Combined invoices from your own Sheet and (when PARTNER_GOOGLE_SHEET_ID is
 * set) a partner's independently-owned Sheet, each row tagged with `owner`
 * ("you" / "partner") - each person's own Apps Script pipeline keeps writing
 * to their own Sheet; this only reads and merges for a joint view. Returns
 * just your own invoices, untagged, when no partner Sheet is configured, so
 * a single-user setup is completely unaffected. If the partner Sheet read
 * fails (not shared with the service account yet, wrong ID, tab renamed),
 * that failure is logged and swallowed rather than breaking the whole
 * dashboard - your own data still loads.
 */
export async function getHouseholdInvoices(): Promise<InvoiceRow[]> {
  const mine = (await getInvoices()).map((r) => ({ ...r, owner: "you" }));
  const partnerSheetId = getPartnerSheetId();
  if (!partnerSheetId) return mine;

  try {
    const theirs = (await getInvoices(partnerSheetId)).map((r) => ({ ...r, owner: "partner" }));
    return [...mine, ...theirs];
  } catch (e) {
    console.error("getHouseholdInvoices: failed to read partner Sheet", e);
    return mine;
  }
}

/** Combined income from your own Sheet and, when configured, a partner's Sheet. See getHouseholdInvoices. */
export async function getHouseholdIncome(): Promise<IncomeRow[]> {
  const mine = (await getIncome()).map((r) => ({ ...r, owner: "you" }));
  const partnerSheetId = getPartnerSheetId();
  if (!partnerSheetId) return mine;

  try {
    const theirs = (await getIncome(partnerSheetId)).map((r) => ({ ...r, owner: "partner" }));
    return [...mine, ...theirs];
  } catch (e) {
    console.error("getHouseholdIncome: failed to read partner Sheet", e);
    return mine;
  }
}
