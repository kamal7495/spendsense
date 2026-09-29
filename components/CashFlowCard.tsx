import { CashFlowEvent, SALARY_TYPICAL_AMOUNT } from "@/lib/cashflow";
import { currency } from "@/lib/format";

interface Props {
  events: CashFlowEvent[];
}

const TRACK_DAYS = 35; // forward-looking window the mini-timeline covers

function formatDay(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function awayLabel(daysAway: number): string {
  if (daysAway === 0) return "today";
  if (daysAway === 1) return "tomorrow";
  return `in ${daysAway} days`;
}

const EVENT_COLOR: Record<CashFlowEvent["type"], string> = {
  salary: "#2f6d45",
  statement_close: "#b3542a",
  payment_due: "#d03b3b",
};

interface CardGroup {
  key: string;
  label: string;
  statementClose?: CashFlowEvent;
  paymentDue?: CashFlowEvent;
  sortDaysAway: number;
}

// statement_close and payment_due are two dates for the SAME physical card
// - grouped into one row so a card doesn't visually read as two different
// cards just because it has two upcoming dates.
function groupByCard(events: CashFlowEvent[]): { salary: CashFlowEvent | null; cards: CardGroup[] } {
  let salary: CashFlowEvent | null = null;
  const groups = new Map<string, CardGroup>();

  for (const e of events) {
    if (e.type === "salary") {
      salary = e;
      continue;
    }
    const cardLabel = e.type === "payment_due" ? e.label.replace(/ payment due$/, "") : e.label;
    const existing = groups.get(cardLabel);
    const group: CardGroup = existing ?? { key: cardLabel, label: cardLabel, sortDaysAway: e.daysAway };
    if (e.type === "statement_close") group.statementClose = e;
    else group.paymentDue = e;
    group.sortDaysAway = Math.min(group.sortDaysAway, e.daysAway);
    groups.set(cardLabel, group);
  }

  return { salary, cards: Array.from(groups.values()).sort((a, b) => a.sortDaysAway - b.sortDaysAway) };
}

export default function CashFlowCard({ events }: Props) {
  const { salary, cards } = groupByCard(events);

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="text-base font-semibold">Cash flow</h2>
      <p className="text-sm text-gray-500">
        Salary credit, card billing cycle close dates, and payment due dates (3 weeks after
        close) &mdash; amounts come from spend logged here, not the actual bank statement, so
        treat them as a floor
      </p>

      <div className="relative mt-6 mb-2 h-1.5 rounded-full bg-gray-100">
        <div
          className="absolute -top-1.5 h-4 w-0.5 bg-gray-400"
          style={{ left: "0%" }}
          title="Today"
        />
        {events.map((e) => {
          const pct = Math.min(100, (e.daysAway / TRACK_DAYS) * 100);
          return (
            <div
              key={e.label}
              className="absolute -top-1 h-3.5 w-3.5 -translate-x-1/2 rounded-full border-2 border-white shadow"
              style={{ left: `${pct}%`, backgroundColor: EVENT_COLOR[e.type] }}
              title={`${e.label} — ${formatDay(e.nextDate)}`}
            />
          );
        })}
      </div>
      <div className="flex justify-between text-[11px] text-gray-400">
        <span>Today</span>
        <span>+{TRACK_DAYS}d</span>
      </div>

      <div className="mt-5 flex flex-col gap-3">
        {salary && (
          <div className="flex items-center justify-between gap-3 border-t border-gray-100 pt-3 first:border-0 first:pt-0">
            <div className="flex items-center gap-2.5">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: EVENT_COLOR.salary }} />
              <div>
                <p className="text-sm font-medium text-gray-900">{salary.label}</p>
                <p className="text-xs text-gray-500">
                  {formatDay(salary.nextDate)} &middot; {awayLabel(salary.daysAway)}
                </p>
              </div>
            </div>
            <span className="whitespace-nowrap text-sm font-medium tabular-nums text-gray-900">
              {SALARY_TYPICAL_AMOUNT}
            </span>
          </div>
        )}

        {cards.map((c) => {
          const due = c.paymentDue;
          const close = c.statementClose;
          return (
            <div key={c.key} className="flex items-center justify-between gap-3 border-t border-gray-100 pt-3 first:border-0 first:pt-0">
              <div className="flex items-center gap-2.5">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: EVENT_COLOR.payment_due }} />
                <div>
                  <p className="text-sm font-medium text-gray-900">{c.label}</p>
                  <p className="text-xs text-gray-500">
                    {due && (
                      <>
                        Due {formatDay(due.nextDate)} &middot; {awayLabel(due.daysAway)}
                        {!due.amountIsFinal && " · still accumulating"}
                      </>
                    )}
                    {due && close && " · "}
                    {close && `Cycle closes ${formatDay(close.nextDate)}`}
                  </p>
                </div>
              </div>
              <span className="whitespace-nowrap text-sm font-medium tabular-nums text-gray-900">
                {due
                  ? due.amountIsFinal
                    ? currency.format(due.amount ?? 0)
                    : `≈ ${currency.format(due.amount ?? 0)}`
                  : currency.format(close?.amount ?? 0)}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
