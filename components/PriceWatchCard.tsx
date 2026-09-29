import { PriceChangeWatch } from "@/lib/analytics";
import { CATEGORY_LABEL } from "@/lib/labels";
import { currency } from "@/lib/format";

interface Props {
  watches: PriceChangeWatch[];
}

export default function PriceWatchCard({ watches }: Props) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold">Price watch</h2>
        <span className="rounded-md bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-700">NEW</span>
      </div>
      <p className="text-sm text-gray-500">
        Latest price paid vs. your typical (median) price for the same item — per purchase, not
        per kg/L (item names here don&apos;t carry a reliable pack size, so a different pack
        showing up as the same name would look like a price move too)
      </p>
      <div className="mt-4">
        {watches.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-500">
            No notable price changes on repeat items yet.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-gray-100">
            {watches.slice(0, 8).map((w) => {
              const up = w.percentChange > 0;
              return (
                <li key={w.item} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium capitalize text-gray-900">{w.item}</p>
                    <p className="text-xs text-gray-500">
                      {CATEGORY_LABEL[w.category]} · usually {currency.format(w.previousPrice)} → now{" "}
                      {currency.format(w.currentPrice)}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${
                      up ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-[#1baf7a]"
                    }`}
                  >
                    {up ? "+" : ""}
                    {Math.round(w.percentChange)}%
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
