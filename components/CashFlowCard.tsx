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

export default function CashFlowCard({ events }: Props) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="text-base font-semibold">Cash flow</h2>
      <p className="text-sm text-gray-500">
        Salary credit vs. card bill due dates &mdash; bill amounts are spend logged since the last
        due date, not the actual statement total
      </p>

      <div className="relative mt-6 mb-2 h-1.5 rounded-full bg-gray-100">
        <div
          className="absolute -top-1.5 h-4 w-0.5 bg-gray-400"
          style={{ left: "0%" }}
          title="Today"
        />
        {events.map((e) => {
          const pct = Math.min(100, (e.daysAway / TRACK_DAYS) * 100);
          const color = e.type === "salary" ? "#2f6d45" : "#b3542a";
          return (
            <div
              key={e.label}
              className="absolute -top-1 h-3.5 w-3.5 -translate-x-1/2 rounded-full border-2 border-white shadow"
              style={{ left: `${pct}%`, backgroundColor: color }}
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
        {events.map((e) => (
          <div key={e.label} className="flex items-center justify-between gap-3 border-t border-gray-100 pt-3 first:border-0 first:pt-0">
            <div className="flex items-center gap-2.5">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: e.type === "salary" ? "#2f6d45" : "#b3542a" }}
              />
              <div>
                <p className="text-sm font-medium text-gray-900">{e.label}</p>
                <p className="text-xs text-gray-500">
                  {formatDay(e.nextDate)} &middot; {awayLabel(e.daysAway)}
                  {e.cycleStart && ` · spend since ${formatDay(e.cycleStart)}`}
                </p>
              </div>
            </div>
            <span className="whitespace-nowrap text-sm font-medium tabular-nums text-gray-900">
              {e.type === "salary" ? SALARY_TYPICAL_AMOUNT : currency.format(e.amount ?? 0)}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
