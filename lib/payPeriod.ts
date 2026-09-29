import { SALARY_DAY } from "./cashflow";

export interface PayPeriod {
  start: Date;
  end: Date; // inclusive
  /**
   * Same boundaries as plain "YYYY-MM-DD" strings, for filtering InvoiceRow
   * dates — those are UTC-midnight-parsed elsewhere in this app (see
   * `parseDate` in lib/analytics.ts), so comparing them against a
   * locally-constructed `Date`'s epoch value directly (`<`/`>`) can be off
   * by the local UTC offset right at a period boundary. Comparing ISO
   * strings instead sidesteps that entirely.
   */
  startIso: string;
  endIso: string;
  daysElapsed: number; // 1-indexed day of the period `now` (or the period's own end, if already closed) falls on
  daysInPeriod: number;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function daysInCalendarMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function buildPeriod(startYear: number, startMonth: number, now: Date): PayPeriod {
  const start = new Date(startYear, startMonth, SALARY_DAY);
  const end = new Date(startYear, startMonth + 1, SALARY_DAY - 1);
  const daysInPeriod = daysInCalendarMonth(startYear, startMonth);

  const clampedNow = startOfDay(now) > end ? end : startOfDay(now);
  const daysElapsed = Math.round((clampedNow.getTime() - start.getTime()) / 86400000) + 1;

  return { start, end, startIso: toIso(start), endIso: toIso(end), daysElapsed, daysInPeriod };
}

/**
 * The pay-cycle "month" containing `now`: SALARY_DAY of one calendar month
 * through SALARY_DAY-1 of the next (confirmed by the user: salary lands on
 * the 25th, so this is the period a paycheck actually has to stretch
 * across) — used for Budget pacing and Savings rate, which are both about
 * "money available vs. spent," not calendar-month bookkeeping. The
 * Dashboard's This month/Last month tiles intentionally stay on the
 * calendar month instead (out of scope for this switch).
 */
export function getCurrentPayPeriod(now: Date = new Date()): PayPeriod {
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();

  return d >= SALARY_DAY ? buildPeriod(y, m, now) : buildPeriod(y, m - 1, now);
}

/**
 * The pay period immediately before the given one. Passing `period.start`
 * (one day past the previous period's own end) as `now` makes `buildPeriod`
 * clamp `daysElapsed` to the full period length, correctly marking it as
 * fully elapsed.
 */
export function previousPayPeriod(period: PayPeriod): PayPeriod {
  const prevStartMonth = period.start.getMonth() - 1;
  const prevYear = period.start.getFullYear();
  return buildPeriod(prevYear, prevStartMonth, period.start);
}
