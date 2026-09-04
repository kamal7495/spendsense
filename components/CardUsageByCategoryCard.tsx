"use client";

import { useState } from "react";
import { CategoryVendorBreakdown } from "@/lib/analytics";
import { CATEGORY_LABEL } from "@/lib/labels";
import { currency } from "@/lib/format";

const BAR_COLOR = "#2a78d6";

interface Props {
  breakdown: CategoryVendorBreakdown[];
}

export default function CardUsageByCategoryCard({ breakdown }: Props) {
  const [openCategory, setOpenCategory] = useState<string | null>(breakdown[0]?.category ?? null);

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="text-base font-semibold">Which card was used where</h2>
      <p className="text-sm text-gray-500">Click a category to see the vendor/card split behind it</p>
      <div className="mt-4 flex flex-col gap-1">
        {breakdown.map((row) => {
          const isOpen = openCategory === row.category;
          return (
            <div key={row.category} className="rounded-md border border-gray-100">
              <button
                onClick={() => setOpenCategory(isOpen ? null : row.category)}
                className="flex w-full items-center justify-between px-3 py-2 text-left"
              >
                <span className="text-sm font-medium text-gray-900">{CATEGORY_LABEL[row.category]}</span>
                <span className="flex items-center gap-2 text-sm text-gray-500">
                  {currency.format(row.total)}
                  <span className={`transition-transform ${isOpen ? "rotate-180" : ""}`}>▾</span>
                </span>
              </button>
              {isOpen && (
                <div className="flex flex-col gap-2 border-t border-gray-100 px-3 py-3">
                  {row.vendors.map((v) => {
                    const pct = row.total > 0 ? (v.total / row.total) * 100 : 0;
                    return (
                      <div key={v.vendor}>
                        <div className="flex items-center justify-between text-xs text-gray-600">
                          <span>{v.vendor}</span>
                          <span className="tabular-nums">
                            {currency.format(v.total)} ({pct.toFixed(0)}%)
                          </span>
                        </div>
                        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${pct}%`, backgroundColor: BAR_COLOR }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
