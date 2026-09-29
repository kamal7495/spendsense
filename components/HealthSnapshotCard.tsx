import Link from "next/link";
import { GroceryCategoryTrend, HealthSnapshot } from "@/lib/analytics";
import { currency } from "@/lib/format";

const HOME_COOKED_COLOR = "#1baf7a";
const CONVENIENCE_COLOR = "#eb6834";

// Whether a rising share of this group is the good direction or the bad one
// — more fresh produce is good; more snacks/instant food is not.
const TREND_RISING_IS_GOOD: Record<string, boolean> = {
  "Fresh produce": true,
  "Snacks & sugary items": false,
  "Instant / packaged food": false,
};

const TREND_BAR_COLOR: Record<string, string> = {
  "Fresh produce": "#1baf7a",
  "Snacks & sugary items": "#eb6834",
  "Instant / packaged food": "#898781",
};

function trendChangeLabel(t: GroceryCategoryTrend): { text: string; className: string } {
  if (t.pointChangeVsLastPeriod === null) return { text: "no prior period to compare", className: "text-gray-400" };
  const rounded = Math.round(t.pointChangeVsLastPeriod);
  if (rounded === 0) return { text: "flat vs last period", className: "text-gray-400" };
  const risingIsGood = TREND_RISING_IS_GOOD[t.label] ?? true;
  const rising = rounded > 0;
  const isGood = rising === risingIsGood;
  const arrow = rising ? "▲" : "▼";
  return {
    text: `${arrow} ${Math.abs(rounded)} pt${Math.abs(rounded) === 1 ? "" : "s"} vs last period`,
    className: isGood ? "text-[#1baf7a]" : "text-[#d03b3b]",
  };
}

interface Props {
  snapshot: HealthSnapshot;
  /** Category-share trend rows (Fresh produce / Snacks / Instant food). Omitted on the compact preview. */
  categoryTrend?: GroceryCategoryTrend[];
  /** Dashboard preview: headline stats + bar only, no item breakdown. */
  compact?: boolean;
}

export default function HealthSnapshotCard({ snapshot, categoryTrend, compact = false }: Props) {
  const { homeCookedSpend, convenienceSpend, diningOutOrders, diningOutPerWeek, windowDays, topConvenienceItems } =
    snapshot;
  const foodTotal = homeCookedSpend + convenienceSpend;
  const homeCookedPct = foodTotal > 0 ? (homeCookedSpend / foodTotal) * 100 : 0;
  const conveniencePct = 100 - homeCookedPct;

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">Eating habits snapshot</h2>
          {!compact && (
            <p className="text-sm text-gray-500">
              Last {windowDays} days, from what you&apos;ve bought and ordered
            </p>
          )}
        </div>
        {compact && (
          <Link href="/groceries" className="whitespace-nowrap text-xs font-medium text-[#2a78d6] hover:underline">
            View details →
          </Link>
        )}
      </div>

      {foodTotal === 0 ? (
        <p className="py-6 text-center text-sm text-gray-500">No grocery or dining data in this window yet.</p>
      ) : (
        <>
          <div className={`mt-4 flex flex-col gap-4 sm:flex-row sm:items-center ${compact ? "sm:gap-6" : "sm:gap-8"}`}>
            <div>
              <p className={compact ? "text-2xl font-semibold tabular-nums" : "text-3xl font-semibold tabular-nums"}>
                {homeCookedPct.toFixed(0)}%
              </p>
              <p className="text-sm text-gray-500">home-cooked share of food spend</p>
            </div>
            <div>
              <p className={compact ? "text-2xl font-semibold tabular-nums" : "text-3xl font-semibold tabular-nums"}>
                {diningOutPerWeek.toFixed(1)}×
              </p>
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
            {!compact && (
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
            )}
          </div>

          {!compact && categoryTrend && categoryTrend.length > 0 && (
            <div className="mt-5 flex flex-col gap-3 border-t border-gray-100 pt-4">
              {categoryTrend.map((t) => {
                const change = trendChangeLabel(t);
                return (
                  <div key={t.label}>
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-sm font-medium text-gray-700">{t.label}</p>
                      <p className="text-sm tabular-nums text-gray-500">
                        {t.pctOfGrocerySpend.toFixed(0)}% of grocery spend
                      </p>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.min(100, t.pctOfGrocerySpend)}%`,
                          backgroundColor: TREND_BAR_COLOR[t.label] ?? "#898781",
                        }}
                      />
                    </div>
                    <p className={`mt-1 text-xs ${change.className}`}>{change.text}</p>
                  </div>
                );
              })}
            </div>
          )}

          {!compact && topConvenienceItems.length > 0 && (
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
