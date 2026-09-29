import { MonthlySavingsRate } from "@/lib/analytics";
import { currency } from "@/lib/format";

interface Props {
  months: MonthlySavingsRate[];
}

function rateColor(rate: number | null): string {
  if (rate === null) return "#c3c2b7";
  if (rate < 0) return "#d03b3b";
  if (rate < 0.2) return "#d99a1f";
  return "#1baf7a";
}

export default function SavingsRateCard({ months }: Props) {
  const latest = months[months.length - 1];
  const hasAnyIncome = months.some((m) => m.income > 0);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-sm text-gray-500">Savings rate (3 pay cycles)</p>

      {!hasAnyIncome ? (
        <p className="mt-2 text-sm text-gray-400">
          No income recorded yet — run the salary sync in Apps Script to populate this.
        </p>
      ) : (
        <>
          <p className="mt-1 text-2xl font-semibold tabular-nums" style={{ color: rateColor(latest.savingsRate) }}>
            {latest.savingsRate === null ? "—" : `${Math.round(latest.savingsRate * 100)}%`}
          </p>
          <div className="mt-3 flex items-end gap-2">
            {months.map((m) => {
              const heightPct = m.savingsRate === null ? 4 : Math.max(4, Math.min(100, Math.abs(m.savingsRate) * 100));
              return (
                <div key={`${m.year}-${m.month}`} className="flex flex-1 flex-col items-center gap-1">
                  <div className="flex h-12 w-full items-end">
                    <div
                      className="w-full rounded-sm"
                      style={{ height: `${heightPct}%`, backgroundColor: rateColor(m.savingsRate) }}
                      title={
                        m.income > 0
                          ? `${m.label}: saved ${currency.format(m.income - m.expense)} of ${currency.format(m.income)} income`
                          : `${m.label}: no income recorded`
                      }
                    />
                  </div>
                  <span className="text-[11px] text-gray-400">{m.shortLabel}</span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
