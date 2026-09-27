import { InvoiceRow } from "./types";

// Salary lands via NEFT to the Axis Bank savings account on the 24th or 25th
// most months (confirmed against real credit alerts, Apr-Sep 2026: 24th or
// 25th, ~2.15-2.17L). This app doesn't ingest account credits/income at all
// today (Invoices_Raw is spend-only) so the date and amount here are a known
// fixed fact, not derived from sheet data.
export const SALARY_DAY = 25;
export const SALARY_TYPICAL_AMOUNT = "~₹2.15–2.17L";

export interface BillCycle {
  label: string;
  /** Vendor name(s) exactly as they appear in Invoices_Raw for this card. */
  vendors: string[];
  dueDay: number;
}

export const BILL_CYCLES: BillCycle[] = [
  { label: "Axis Neo Rupay", vendors: ["Axis Neo Rupay (XX82)"], dueDay: 21 },
  { label: "Scapia (Federal Bank)", vendors: ["Federal Bank (Scapia Card)"], dueDay: 21 },
  { label: "ICICI Bank", vendors: ["ICICI Bank Credit Card"], dueDay: 28 },
];

function lineTotal(r: InvoiceRow): number {
  return r.amount + r.fee;
}

// toISOString() converts to UTC first, which silently shifts the date back a
// day for any local timezone ahead of UTC (e.g. IST) when the time is near
// midnight - format from local date components instead.
function toLocalIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** The most recent occurrence of `day` on/before `now`, and the next one after it. */
function occurrencesAround(day: number, now: Date): { prev: Date; next: Date } {
  const y = now.getFullYear();
  const m = now.getMonth();
  const thisMonth = new Date(y, m, day);
  if (thisMonth.getTime() <= now.getTime()) {
    return { prev: thisMonth, next: new Date(y, m + 1, day) };
  }
  return { prev: new Date(y, m - 1, day), next: thisMonth };
}

function daysUntil(target: Date, now: Date): number {
  const a = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const b = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

export interface CashFlowEvent {
  type: "salary" | "bill_due";
  label: string;
  nextDate: string; // ISO date of the next occurrence
  daysAway: number; // 0 = today, positive = upcoming, this is always the NEXT occurrence so never negative
  amount: number | null; // known spend-so-far for bills; null for salary (not tracked)
  cycleStart: string | null; // for bills: day after the last due date, i.e. start of the current spend window
}

/**
 * Where you are in the month relative to salary credit and each card's bill
 * due date, plus how much has been spent on each card since its last due
 * date (a proxy for "what the next bill will look like"), from real
 * itemized transactions. Not the actual bank statement total - statements
 * are password-protected PDFs this app can't read - so treat bill amounts
 * as a floor, not the exact due amount (interest/fees/cashback aren't
 * reflected).
 */
export function cashFlowTimeline(rows: InvoiceRow[], now: Date = new Date()): CashFlowEvent[] {
  const events: CashFlowEvent[] = [];

  const salary = occurrencesAround(SALARY_DAY, now);
  events.push({
    type: "salary",
    label: "Salary credit",
    nextDate: toLocalIsoDate(salary.next),
    daysAway: daysUntil(salary.next, now),
    amount: null,
    cycleStart: null,
  });

  for (const cycle of BILL_CYCLES) {
    const { prev, next } = occurrencesAround(cycle.dueDay, now);
    const cycleStart = new Date(prev);
    cycleStart.setDate(cycleStart.getDate() + 1);

    const spend = rows
      .filter((r) => cycle.vendors.includes(r.vendor))
      .filter((r) => {
        const d = new Date(r.date);
        return d >= cycleStart && d <= now;
      })
      .reduce((s, r) => s + lineTotal(r), 0);

    events.push({
      type: "bill_due",
      label: cycle.label,
      nextDate: toLocalIsoDate(next),
      daysAway: daysUntil(next, now),
      amount: spend,
      cycleStart: toLocalIsoDate(cycleStart),
    });
  }

  return events.sort((a, b) => a.daysAway - b.daysAway);
}
