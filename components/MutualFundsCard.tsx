import { MutualFundPortfolio } from "@/lib/mutualFunds";
import { currency } from "@/lib/format";

interface Props {
  portfolio: MutualFundPortfolio;
}

export default function MutualFundsCard({ portfolio }: Props) {
  const { funds, totalCurrentValue, totalInvested, unvaluedCount } = portfolio;
  const gainLoss = totalCurrentValue - totalInvested;
  const gainLossPct = totalInvested > 0 ? (gainLoss / totalInvested) * 100 : 0;

  if (funds.length === 0) {
    return (
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-base font-semibold">Mutual funds</h2>
        <p className="py-6 text-center text-sm text-gray-500">
          No SIP holdings found yet in Invoices_Raw.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="text-base font-semibold">Mutual funds</h2>
      <p className="text-sm text-gray-500">
        Estimated current value &mdash; units held &times; today&apos;s NAV, not your broker&apos;s
        own figure. {unvaluedCount > 0 &&
          `${unvaluedCount} fund${unvaluedCount === 1 ? "" : "s"} couldn't be valued.`}
      </p>

      <div className="mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <div>
          <p className="text-2xl font-semibold tabular-nums">{currency.format(totalCurrentValue)}</p>
          <p className="text-xs text-gray-500">current value</p>
        </div>
        <div>
          <p className="text-sm tabular-nums text-gray-700">{currency.format(totalInvested)}</p>
          <p className="text-xs text-gray-500">net invested</p>
        </div>
        <div>
          <p
            className="text-sm font-medium tabular-nums"
            style={{ color: gainLoss >= 0 ? "#1baf7a" : "#d03b3b" }}
          >
            {gainLoss >= 0 ? "+" : ""}
            {currency.format(gainLoss)} ({gainLoss >= 0 ? "+" : ""}
            {gainLossPct.toFixed(1)}%)
          </p>
          <p className="text-xs text-gray-500">gain / loss</p>
        </div>
      </div>

      <ul className="mt-4 flex flex-col divide-y divide-gray-100">
        {funds.map((f) => {
          const fundGainLoss = f.gainLoss;
          return (
            <li key={f.normalizedKey} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-gray-900">{f.displayName}</p>
                <p className="text-xs text-gray-500">
                  {f.unitsHeld.toFixed(3)} units
                  {f.currentNav !== null && ` · NAV ${currency.format(f.currentNav)}`}
                  {f.currentValue === null && " · value unknown"}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-medium tabular-nums text-gray-900">
                  {f.currentValue !== null ? currency.format(f.currentValue) : "—"}
                </p>
                {fundGainLoss !== null && (
                  <p
                    className="text-xs tabular-nums"
                    style={{ color: fundGainLoss >= 0 ? "#1baf7a" : "#d03b3b" }}
                  >
                    {fundGainLoss >= 0 ? "+" : ""}
                    {currency.format(fundGainLoss)}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
