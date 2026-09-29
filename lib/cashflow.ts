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
  /**
   * Day of month the statement/billing cycle closes (spend tracking resets)
   * — NOT the payment due date, which is typically ~2-3 weeks later and
   * isn't tracked here yet. Confirmed by the user: all cards share the 21st.
   */
  statementCloseDay: number;
}

export const BILL_CYCLES: BillCycle[] = [
  { label: "Axis Neo Rupay", vendors: ["Axis Neo Rupay (XX82)"], statementCloseDay: 21 },
  { label: "Scapia (Federal Bank)", vendors: ["Federal Bank (Scapia Card)"], statementCloseDay: 21 },
  { label: "ICICI Bank", vendors: ["ICICI Bank Credit Card"], statementCloseDay: 21 },
];

// Confirmed by the user: all three cards' payment is due 3 weeks (21 days)
// after their statement closes.
export const PAYMENT_DUE_OFFSET_DAYS = 21;

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

function addDays(d: Date, days: number): Date {
  const result = new Date(d);
  result.setDate(result.getDate() + days);
  return result;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export interface CashFlowEvent {
  type: "salary" | "statement_close" | "payment_due";
  label: string;
  nextDate: string; // ISO date of the next occurrence
  daysAway: number; // 0 = today, positive = upcoming, this is always the NEXT occurrence so never negative
  amount: number | null; // known spend-so-far this cycle; null for salary (not tracked)
  cycleStart: string | null; // for cards: day after the last statement close, i.e. start of the current spend window
  /**
   * For "payment_due" only: true when `amount` is the final total of an
   * already-closed cycle (the real bill amount); false when the cycle this
   * due date belongs to hasn't closed yet, so `amount` is still a running
   * total that will keep growing until it closes.
   */
  amountIsFinal?: boolean;
}

/**
 * Where you are in the month relative to salary credit, each card's
 * statement close date, and each card's payment due date (confirmed by the
 * user: 3 weeks after close, all cards). Emits both a "statement_close"
 * event (spend so far in the currently-open cycle) and a "payment_due"
 * event per card - the due-date amount is the FINAL total of the most
 * recently closed cycle when that bill hasn't been paid yet, or a running
 * (not-yet-final) total of the still-open cycle once the prior bill's due
 * date has passed. Spend figures come from real itemized transactions, not
 * the actual bank statement total - statements are password-protected PDFs
 * this app can't read - so treat them as a floor, not the exact statement
 * amount (interest/fees/cashback aren't reflected).
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
    const { prev, next } = occurrencesAround(cycle.statementCloseDay, now);
    const cycleStart = addDays(prev, 1);

    const cardRows = rows.filter((r) => cycle.vendors.includes(r.vendor));
    const spendInWindow = (from: Date, to: Date) =>
      cardRows
        .filter((r) => {
          const d = new Date(r.date);
          return d >= from && d <= to;
        })
        .reduce((s, r) => s + lineTotal(r), 0);

    const openCycleSpend = spendInWindow(cycleStart, now);

    events.push({
      type: "statement_close",
      label: cycle.label,
      nextDate: toLocalIsoDate(next),
      daysAway: daysUntil(next, now),
      amount: openCycleSpend,
      cycleStart: toLocalIsoDate(cycleStart),
    });

    // Payment due: 3 weeks after whichever statement close this due date
    // belongs to. If that close (`prev`) already happened and its due date
    // hasn't passed yet, this is the final bill for that closed cycle. If
    // the due date from `prev` has already passed (presumably paid), the
    // next relevant due date is 3 weeks after the cycle that's still open
    // (`next`) - not final yet, since that cycle hasn't closed.
    const dueFromPrevClose = addDays(prev, PAYMENT_DUE_OFFSET_DAYS);
    const dueFromNextClose = addDays(next, PAYMENT_DUE_OFFSET_DAYS);
    const today = startOfDay(now);

    let dueDate: Date;
    let dueAmount: number;
    let amountIsFinal: boolean;

    if (dueFromPrevClose >= today) {
      const priorClose = new Date(prev.getFullYear(), prev.getMonth() - 1, cycle.statementCloseDay);
      dueAmount = spendInWindow(addDays(priorClose, 1), prev);
      dueDate = dueFromPrevClose;
      amountIsFinal = true;
    } else {
      dueAmount = openCycleSpend;
      dueDate = dueFromNextClose;
      amountIsFinal = false;
    }

    events.push({
      type: "payment_due",
      label: `${cycle.label} payment due`,
      nextDate: toLocalIsoDate(dueDate),
      daysAway: daysUntil(dueDate, now),
      amount: dueAmount,
      cycleStart: null,
      amountIsFinal,
    });
  }

  return events.sort((a, b) => a.daysAway - b.daysAway);
}
