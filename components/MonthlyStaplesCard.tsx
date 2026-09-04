import { MonthlyStapleNeed } from "@/lib/analytics";
import { CATEGORY_LABEL } from "@/lib/labels";

interface Props {
  staples: MonthlyStapleNeed[];
  windowDays: number;
}

export default function MonthlyStaplesCard({ staples, windowDays }: Props) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="text-base font-semibold">Staples to restock monthly</h2>
      <p className="text-sm text-gray-500">
        Estimated from the last {windowDays} days of orders — quantity is a planning estimate, not an
        exact count for every source
      </p>
      <div className="mt-4 overflow-x-auto">
        {staples.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-500">
            No recurring staples yet — items need to be ordered 2+ times to show up here.
          </p>
        ) : (
          <table className="w-full min-w-[480px] text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-gray-500">
                <th className="py-2 pr-4 font-medium">Item</th>
                <th className="py-2 pr-4 font-medium">Category</th>
                <th className="py-2 pr-4 font-medium">Est. quantity / month</th>
                <th className="py-2 pr-4 font-medium">Times ordered</th>
                <th className="py-2 pr-4 font-medium">Last ordered</th>
              </tr>
            </thead>
            <tbody>
              {staples.map((row) => (
                <tr key={row.item} className="border-b border-gray-100 last:border-0">
                  <td className="py-2 pr-4 capitalize">{row.item}</td>
                  <td className="py-2 pr-4 text-gray-600">{CATEGORY_LABEL[row.category]}</td>
                  <td className="py-2 pr-4 tabular-nums">{row.avgQuantityPerMonth.toFixed(1)}</td>
                  <td className="py-2 pr-4 tabular-nums">{row.orderCount}</td>
                  <td className="py-2 pr-4 text-gray-500">{row.lastOrdered}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
