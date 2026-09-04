import { HealthSnapshot } from "@/lib/analytics";
import { currency } from "@/lib/format";

const HOME_COOKED_COLOR = "#1baf7a";
const CONVENIENCE_COLOR = "#eb6834";

interface Props {
  snapshot: HealthSnapshot;
}

export default function HealthSnapshotCard({ snapshot }: Props) {
  const { homeCookedSpend, convenienceSpend, homeCookedRatio, diningOutOrders, diningOutPerWeek, windowDays, topConvenienceItems } =
    snapshot;
  const foodTotal = homeCookedSpend + convenienceSpend;
  const homeCookedPct = foodTotal > 0 ? (homeCookedSpend / foodTotal) * 100 : 0;
  const conveniencePct = 100 - homeCookedPct;

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="text-base font-semibold">Eating habits</h2>
      <p className="text-sm text-gray-500">Last {windowDays} days, from what you&apos;ve bought and ordered</p>

      {foodTotal === 0 ? (
        <p className="py-6 text-center text-sm text-gray-500">No grocery or dining data in this window yet.</p>
      ) : (
        <>
          <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-8">
            <div>
              <p className="text-3xl font-semibold tabular-nums">{homeCookedPct.toFixed(0)}%</p>
              <p className="text-sm text-gray-500">home-cooked share of food spend</p>
            </div>
            <div>
              <p className="text-3xl font-semibold tabular-nums">{diningOutPerWeek.toFixed(1)}×</p>
              <p className="text-sm text-gray-500">
                eating out per week ({diningOutOrders} order{diningOutOrders === 1 ? "" : "s"})
              </p>
            </div>
          </div>

          <div className="mt-4">
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-gray-100">
              <div style={{ width: `${homeCookedPct}%`, backgroundColor: HOME_COOKED_COLOR }} />
              <div style={{ width: `${conveniencePct}%`, backgroundColor: CONVENIENCE_COLOR }} />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: HOME_COOKED_COLOR }} />
                Home-cooked (produce, dairy, staples): {currency.format(homeCookedSpend)}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: CONVENIENCE_COLOR }} />
                Dining out & snacks: {currency.format(convenienceSpend)}
              </span>
            </div>
          </div>

          {topConvenienceItems.length > 0 && (
            <div className="mt-4">
              <p className="text-sm font-medium text-gray-700">Most frequent convenience orders</p>
              <ul className="mt-1 flex flex-col gap-1 text-sm text-gray-600">
                {topConvenienceItems.slice(0, 5).map((item) => (
                  <li key={item.item} className="flex justify-between capitalize">
                    <span>{item.item}</span>
                    <span className="tabular-nums text-gray-400">{item.count}×</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
