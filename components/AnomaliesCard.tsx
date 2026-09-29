import { AnomalyFlag } from "@/lib/anomalies";
import { currency } from "@/lib/format";

interface Props {
  duplicates: AnomalyFlag[];
  outliers: AnomalyFlag[];
}

const MAX_OUTLIERS_SHOWN = 10;

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" });
}

function FlagRow({ flag, tone }: { flag: AnomalyFlag; tone: "critical" | "watch" }) {
  const bg = tone === "critical" ? "bg-red-50" : "bg-amber-50";
  const text = tone === "critical" ? "text-red-800" : "text-amber-800";
  return (
    <div className={`flex items-center justify-between gap-3 rounded-md px-3 py-2 ${bg}`}>
      <div>
        <p className="text-sm font-medium text-gray-900">
          {flag.item} <span className="font-normal text-gray-500">&middot; {flag.vendor}</span>
        </p>
        <p className={`text-xs ${text}`}>{flag.reason}</p>
      </div>
      <div className="text-right">
        <p className="whitespace-nowrap text-sm font-medium tabular-nums text-gray-900">
          {currency.format(flag.amount)}
        </p>
        <p className="text-xs text-gray-400">{formatDay(flag.date)}</p>
      </div>
    </div>
  );
}

export default function AnomaliesCard({ duplicates, outliers }: Props) {
  const shownOutliers = outliers.slice(0, MAX_OUTLIERS_SHOWN);
  const hiddenOutliers = outliers.length - shownOutliers.length;

  if (duplicates.length === 0 && outliers.length === 0) {
    return null;
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="text-base font-semibold">Flagged for review</h2>
      <p className="text-sm text-gray-500">
        Possible duplicate charges and amounts that stand out from what you usually pay in that
        category &mdash; not errors, just worth a second look
      </p>

      {duplicates.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">
            Possible duplicates
          </p>
          <div className="flex flex-col gap-2">
            {duplicates.map((f, i) => (
              <FlagRow key={i} flag={f} tone="critical" />
            ))}
          </div>
        </div>
      )}

      {shownOutliers.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">
            Unusual amounts
          </p>
          <div className="flex flex-col gap-2">
            {shownOutliers.map((f, i) => (
              <FlagRow key={i} flag={f} tone="watch" />
            ))}
          </div>
          {hiddenOutliers > 0 && (
            <p className="mt-2 text-xs text-gray-400">+{hiddenOutliers} more not shown</p>
          )}
        </div>
      )}
    </section>
  );
}
