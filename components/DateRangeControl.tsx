"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";

const OPTIONS: { label: string; value: string }[] = [
  { label: "30d", value: "30" },
  { label: "60d", value: "60" },
  { label: "90d", value: "90" },
  { label: "180d", value: "180" },
  { label: "All time", value: "all" },
];

export default function DateRangeControl({ current }: { current: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function selectRange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "60") {
      params.delete("days"); // 60 is the default, keep the URL clean
    } else {
      params.set("days", value);
    }
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <div className="flex flex-wrap gap-1 rounded-lg border border-gray-200 bg-white p-1">
      {OPTIONS.map((opt) => {
        const active = opt.value === current;
        return (
          <button
            key={opt.value}
            onClick={() => selectRange(opt.value)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              active ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
