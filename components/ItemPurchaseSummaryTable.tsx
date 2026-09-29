"use client";

import { useMemo, useState } from "react";
import { ItemPurchaseSummary } from "@/lib/analytics";
import { CATEGORY_LABEL } from "@/lib/labels";
import { currency } from "@/lib/format";
import { Category } from "@/lib/types";

type SortKey = "item" | "category" | "quantity" | "orders" | "amount";

interface Props {
  items: ItemPurchaseSummary[];
  windowDays: number;
}

export default function ItemPurchaseSummaryTable({ items, windowDays }: Props) {
  const [categoryFilter, setCategoryFilter] = useState<Category | "all">("all");
  const [sortKey, setSortKey] = useState<SortKey>("quantity");
  const [sortAsc, setSortAsc] = useState(false);

  const categoriesPresent = useMemo(() => {
    const set = new Set<Category>(items.map((i) => i.category));
    return Array.from(set).sort((a, b) => CATEGORY_LABEL[a].localeCompare(CATEGORY_LABEL[b]));
  }, [items]);

  const visibleItems = useMemo(() => {
    const filtered =
      categoryFilter === "all" ? items : items.filter((i) => i.category === categoryFilter);
    const sorted = [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "item") cmp = a.item.localeCompare(b.item);
      else if (sortKey === "category") cmp = CATEGORY_LABEL[a.category].localeCompare(CATEGORY_LABEL[b.category]);
      else if (sortKey === "quantity") cmp = a.totalQuantity - b.totalQuantity;
      else if (sortKey === "orders") cmp = a.orderCount - b.orderCount;
      else cmp = a.totalAmount - b.totalAmount;
      return sortAsc ? cmp : -cmp;
    });
    return sorted;
  }, [items, categoryFilter, sortKey, sortAsc]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(key === "item" || key === "category");
    }
  }

  function SortHeader({ label, sortableKey, right }: { label: string; sortableKey: SortKey; right?: boolean }) {
    const active = sortKey === sortableKey;
    return (
      <th className={`py-2 pr-4 font-medium ${right ? "text-right" : ""}`}>
        <button
          onClick={() => toggleSort(sortableKey)}
          className={`flex items-center gap-1 hover:text-gray-900 ${right ? "ml-auto" : ""} ${active ? "text-gray-900" : ""}`}
        >
          {label}
          <span className="text-gray-400">{active ? (sortAsc ? "▲" : "▼") : ""}</span>
        </button>
      </th>
    );
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">What you bought</h2>
          <p className="text-sm text-gray-500">
            Every item purchased in the last {windowDays} days — quantity is a unit count (e.g.
            &quot;3 packs&quot;), not a converted weight or volume
          </p>
        </div>
        {categoriesPresent.length > 1 && (
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as Category | "all")}
            className="rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-700 focus:border-gray-500 focus:outline-none"
          >
            <option value="all">All categories</option>
            {categoriesPresent.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="mt-4 overflow-x-auto">
        {items.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-500">
            Nothing purchased in the last {windowDays} days.
          </p>
        ) : visibleItems.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-500">No items match that filter.</p>
        ) : (
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-gray-500">
                <SortHeader label="Item" sortableKey="item" />
                <SortHeader label="Category" sortableKey="category" />
                <SortHeader label="Quantity" sortableKey="quantity" right />
                <SortHeader label="Orders" sortableKey="orders" right />
                <SortHeader label="Total spent" sortableKey="amount" right />
              </tr>
            </thead>
            <tbody>
              {visibleItems.map((row) => (
                <tr key={row.item} className="border-b border-gray-100 last:border-0">
                  <td className="py-2 pr-4 capitalize">{row.item}</td>
                  <td className="py-2 pr-4 text-gray-600">{CATEGORY_LABEL[row.category]}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{row.totalQuantity}</td>
                  <td className="py-2 pr-4 text-right tabular-nums text-gray-600">{row.orderCount}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{currency.format(row.totalAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
