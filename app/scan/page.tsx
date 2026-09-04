"use client";

import { useRef, useState } from "react";
import { CATEGORIES, Category } from "@/lib/types";
import { CATEGORY_LABEL } from "@/lib/labels";

interface DraftItem {
  item: string;
  category: Category;
  amount: string;
  quantity: string;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function fileToBase64(file: File): Promise<{ data: string; mediaType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const [prefix, data] = result.split(",", 2);
      const mediaType = prefix.match(/^data:(.*);base64$/)?.[1] ?? file.type;
      if (!data) {
        reject(new Error("Could not read image file"));
        return;
      }
      resolve({ data, mediaType });
    };
    reader.onerror = () => reject(reader.error ?? new Error("Could not read image file"));
    reader.readAsDataURL(file);
  });
}

export default function ScanReceiptPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const [vendor, setVendor] = useState("");
  const [date, setDate] = useState(todayIso());
  const [items, setItems] = useState<DraftItem[] | null>(null);
  const [orderId] = useState(() => `SCAN-${Date.now()}`);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setError(null);
    setSaveMessage(null);
    setItems(null);
    setPendingFile(file);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(file ? URL.createObjectURL(file) : null);
  }

  async function handleScan() {
    if (!pendingFile) return;
    setScanning(true);
    setError(null);
    setWarning(null);
    setSaveMessage(null);
    try {
      const { data, mediaType } = await fileToBase64(pendingFile);
      const res = await fetch("/api/invoices/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: data, mediaType }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error ?? "Failed to scan receipt");
      }
      setVendor(body.vendor ?? "");
      setDate(body.date ?? todayIso());
      setItems(
        (body.items as { item: string; category: string; amount: number; quantity: number }[]).map(
          (it) => ({
            item: it.item,
            category: (it.category as Category) ?? "other",
            amount: String(it.amount),
            quantity: String(it.quantity),
          })
        )
      );
      if (body.warning) setWarning(body.warning);
      if (!body.items?.length) {
        setError("No items were found on that receipt - try a clearer, well-lit photo.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to scan receipt");
    } finally {
      setScanning(false);
    }
  }

  function updateItem(index: number, patch: Partial<DraftItem>) {
    setItems((prev) => (prev ? prev.map((it, i) => (i === index ? { ...it, ...patch } : it)) : prev));
  }

  function removeItem(index: number) {
    setItems((prev) => (prev ? prev.filter((_, i) => i !== index) : prev));
  }

  function addBlankItem() {
    setItems((prev) => [...(prev ?? []), { item: "", category: "other", amount: "", quantity: "1" }]);
  }

  async function handleSave() {
    if (!items || items.length === 0) return;
    if (!vendor.trim()) {
      setError("Enter a store name before saving.");
      return;
    }
    for (const it of items) {
      if (!it.item.trim() || !Number.isFinite(Number(it.amount)) || Number(it.amount) <= 0) {
        setError("Every line needs an item name and a positive amount before saving.");
        return;
      }
    }

    setSaving(true);
    setError(null);
    try {
      const payload = items.map((it) => ({
        date,
        vendor: vendor.trim(),
        orderId,
        item: it.item.trim(),
        category: it.category,
        amount: Number(it.amount),
        quantity: Number(it.quantity) > 0 ? Number(it.quantity) : 1,
      }));
      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: payload }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error ?? "Failed to save to the sheet");
      }
      setSaveMessage(`Added ${payload.length} item${payload.length === 1 ? "" : "s"} to SpendSense.`);
      setItems(null);
      setPendingFile(null);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save to the sheet");
    } finally {
      setSaving(false);
    }
  }

  const total = items?.reduce((sum, it) => sum + (Number(it.amount) || 0), 0) ?? 0;

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
      <div>
        <h1 className="text-xl font-semibold">Scan a receipt</h1>
        <p className="mt-1 text-sm text-gray-500">
          Photograph a grocery store receipt and Claude will read the items, guess a category for
          each, and let you review everything before it&apos;s added to the sheet.
        </p>
      </div>

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFileChange}
          className="block w-full text-sm text-gray-600 file:mr-4 file:rounded-md file:border-0 file:bg-gray-900 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-gray-700"
        />

        {previewUrl && (
          <div className="mt-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewUrl} alt="Receipt preview" className="max-h-80 rounded-md border border-gray-200" />
          </div>
        )}

        {pendingFile && !items && (
          <button
            onClick={handleScan}
            disabled={scanning}
            className="mt-4 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
          >
            {scanning ? "Reading receipt…" : "Scan receipt"}
          </button>
        )}
      </section>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}
      {warning && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
          {warning}
        </div>
      )}
      {saveMessage && (
        <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700">
          {saveMessage}
        </div>
      )}

      {items && (
        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-base font-semibold">Review before saving</h2>
          <p className="text-sm text-gray-500">
            Nothing is written to the sheet until you press &quot;Add to SpendSense&quot; - fix anything
            Claude misread first.
          </p>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-gray-600">Store</span>
              <input
                value={vendor}
                onChange={(e) => setVendor(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-2 py-1.5"
                placeholder="Store name"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-gray-600">Date</span>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-2 py-1.5"
              />
            </label>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-gray-500">
                  <th className="py-2 pr-3 font-medium">Item</th>
                  <th className="py-2 pr-3 font-medium">Category</th>
                  <th className="py-2 pr-3 font-medium">Qty</th>
                  <th className="py-2 pr-3 font-medium">Amount</th>
                  <th className="py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i} className="border-b border-gray-100 last:border-0">
                    <td className="py-2 pr-3">
                      <input
                        value={it.item}
                        onChange={(e) => updateItem(i, { item: e.target.value })}
                        className="w-full rounded-md border border-gray-300 px-2 py-1"
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <select
                        value={it.category}
                        onChange={(e) => updateItem(i, { category: e.target.value as Category })}
                        className="w-full rounded-md border border-gray-300 px-2 py-1"
                      >
                        {CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {CATEGORY_LABEL[c]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={it.quantity}
                        onChange={(e) => updateItem(i, { quantity: e.target.value })}
                        className="w-20 rounded-md border border-gray-300 px-2 py-1"
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={it.amount}
                        onChange={(e) => updateItem(i, { amount: e.target.value })}
                        className="w-24 rounded-md border border-gray-300 px-2 py-1"
                      />
                    </td>
                    <td className="py-2 text-right">
                      <button
                        onClick={() => removeItem(i)}
                        className="text-xs text-gray-400 hover:text-red-600"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex items-center justify-between">
            <button onClick={addBlankItem} className="text-sm text-gray-600 hover:text-gray-900">
              + Add line
            </button>
            <span className="text-sm font-medium text-gray-700">
              Total: {total.toLocaleString(undefined, { style: "currency", currency: "INR" })}
            </span>
          </div>

          <button
            onClick={handleSave}
            disabled={saving || items.length === 0}
            className="mt-4 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Add to SpendSense"}
          </button>
        </section>
      )}
    </main>
  );
}
