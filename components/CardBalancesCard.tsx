"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { EstimatedCardBalance } from "@/lib/analytics";
import { currency } from "@/lib/format";

interface Props {
  balances: EstimatedCardBalance[];
  trackableAccounts: string[]; // vendors not yet tracked, for the "add" dropdown
}

function todayIso(): string {
  return new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD in local time, no UTC-shift risk
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export default function CardBalancesCard({ balances, trackableAccounts }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { openingBalance: string; asOfDate: string }>>({});
  const [adding, setAdding] = useState(false);
  const [newAccount, setNewAccount] = useState({ account: "", openingBalance: "", asOfDate: todayIso() });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(account: string, openingBalance: string, asOfDate: string) {
    const amount = parseFloat(openingBalance);
    if (!openingBalance || Number.isNaN(amount) || amount < 0) {
      setError("Enter a valid non-negative opening balance");
      return;
    }
    if (!asOfDate) {
      setError("Pick a reference date");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/balances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account, openingBalance: amount, asOfDate }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to save");
      }
      setEditing(null);
      setAdding(false);
      setNewAccount({ account: "", openingBalance: "", asOfDate: todayIso() });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="text-base font-semibold">Card balances (estimated)</h2>
      <p className="text-sm text-gray-500">
        Not a real balance — SpendSense never sees payments you make toward a card, only new
        charges. This only ever grows; reset it to a fresh number right after you check your real
        balance or pay a bill, or it&apos;ll drift.
      </p>

      {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="mt-4 flex flex-col gap-3">
        {balances.length === 0 && !adding && (
          <p className="py-4 text-center text-sm text-gray-500">
            No cards tracked yet — add one below.
          </p>
        )}

        {balances.map((b) => {
          const isEditing = editing === b.account;
          const draft = drafts[b.account] ?? {
            openingBalance: String(b.openingBalance),
            asOfDate: b.asOfDate,
          };
          return (
            <div key={b.account} className="rounded-md border border-gray-100 px-3 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-gray-900">{b.account}</span>
                <span className="text-lg font-semibold tabular-nums text-gray-900">
                  {currency.format(b.estimatedBalance)}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-gray-500">
                {currency.format(b.openingBalance)} as of {formatDay(b.asOfDate)} +{" "}
                {currency.format(b.spendSince)} spent since
              </p>

              {isEditing ? (
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <label className="text-xs">
                    <span className="mb-1 block text-gray-500">Actual balance now</span>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={draft.openingBalance}
                      onChange={(e) =>
                        setDrafts((d) => ({ ...d, [b.account]: { ...draft, openingBalance: e.target.value } }))
                      }
                      className="w-28 rounded-md border border-gray-300 px-2 py-1"
                    />
                  </label>
                  <label className="text-xs">
                    <span className="mb-1 block text-gray-500">As of</span>
                    <input
                      type="date"
                      value={draft.asOfDate}
                      onChange={(e) =>
                        setDrafts((d) => ({ ...d, [b.account]: { ...draft, asOfDate: e.target.value } }))
                      }
                      className="rounded-md border border-gray-300 px-2 py-1"
                    />
                  </label>
                  <button
                    onClick={() => save(b.account, draft.openingBalance, draft.asOfDate)}
                    disabled={saving}
                    className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-50"
                  >
                    {saving ? "Saving…" : "Save"}
                  </button>
                  <button
                    onClick={() => setEditing(null)}
                    className="text-xs text-gray-500 hover:text-gray-800"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setEditing(b.account)}
                  className="mt-1.5 text-xs text-gray-500 underline hover:text-gray-800"
                >
                  Reset reference point
                </button>
              )}
            </div>
          );
        })}
      </div>

      {adding ? (
        <div className="mt-4 flex flex-wrap items-end gap-2 rounded-md border border-gray-100 p-3">
          <label className="text-xs">
            <span className="mb-1 block text-gray-500">Card</span>
            <select
              value={newAccount.account}
              onChange={(e) => setNewAccount((a) => ({ ...a, account: e.target.value }))}
              className="rounded-md border border-gray-300 px-2 py-1"
            >
              <option value="">Select a card…</option>
              {trackableAccounts.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <span className="mb-1 block text-gray-500">Actual balance now</span>
            <input
              type="number"
              min={0}
              step="any"
              value={newAccount.openingBalance}
              onChange={(e) => setNewAccount((a) => ({ ...a, openingBalance: e.target.value }))}
              className="w-28 rounded-md border border-gray-300 px-2 py-1"
            />
          </label>
          <label className="text-xs">
            <span className="mb-1 block text-gray-500">As of</span>
            <input
              type="date"
              value={newAccount.asOfDate}
              onChange={(e) => setNewAccount((a) => ({ ...a, asOfDate: e.target.value }))}
              className="rounded-md border border-gray-300 px-2 py-1"
            />
          </label>
          <button
            onClick={() => {
              if (!newAccount.account) {
                setError("Pick a card");
                return;
              }
              save(newAccount.account, newAccount.openingBalance, newAccount.asOfDate);
            }}
            disabled={saving}
            className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Add"}
          </button>
          <button onClick={() => setAdding(false)} className="text-xs text-gray-500 hover:text-gray-800">
            Cancel
          </button>
        </div>
      ) : (
        trackableAccounts.length > 0 && (
          <button
            onClick={() => setAdding(true)}
            className="mt-4 text-sm text-gray-600 hover:text-gray-900"
          >
            + Track a card
          </button>
        )
      )}
    </section>
  );
}
