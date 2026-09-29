import { PDFParse } from "pdf-parse";
import { createWorker } from "tesseract.js";
import { categorizeGroceryItem } from "./categorize";
import { isBlinkitTaxInvoice, parseBlinkitTaxInvoice } from "./blinkitInvoice";

export interface ScannedItem {
  item: string;
  category: string; // validated against CATEGORIES before use
  amount: number;
  quantity: number;
}

export interface ScanReceiptResult {
  vendor: string | null;
  date: string | null; // YYYY-MM-DD if a date could be found
  items: ScannedItem[];
  warning?: string;
}

const SUPPORTED_MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
] as const;
type SupportedMediaType = (typeof SUPPORTED_MEDIA_TYPES)[number];

export function isSupportedMediaType(mediaType: string): mediaType is SupportedMediaType {
  return (SUPPORTED_MEDIA_TYPES as readonly string[]).includes(mediaType);
}

// Lines containing any of these are structural/summary text, never a
// purchased item — matched even though a real line item could coincidentally
// contain one of these words, because skipping a genuine item (fixable by
// hand in the review step) is a smaller problem than double-counting a
// total/subtotal as if it were a line item.
const NOISE_KEYWORDS = [
  "subtotal", "grand total", "total", "balance due", "amount due", "amount paid",
  "cash", "change due", "tax", "gst", "cgst", "sgst", "vat", "discount",
  "invoice no", "invoice #", "order id", "order no", "bill no", "table no",
  "gstin", "fssai", "cashier", "thank you", "customer copy", "www.", "http",
  "phone", "tel:", "date:", "time:", "qty  price", "item  qty",
];

function isNoiseLine(line: string): boolean {
  const lower = line.toLowerCase();
  return NOISE_KEYWORDS.some((k) => lower.includes(k));
}

// Matches "<item text> <amount>" where amount is the last number on the
// line, optionally with a currency symbol/decimals — the near-universal
// shape of a receipt line item. Requires the item text to contain a letter
// so barcode/reference-number lines don't get mistaken for items.
const ITEM_LINE_RE = /^(.*[a-zA-Z].*?)[\s.]*(?:₹|rs\.?|inr)?\s*([\d,]+(?:\.\d{1,2})?)\s*$/i;

// Leading "2 x Milk" or "2x Milk"
const LEADING_QTY_RE = /^(\d+)\s*[xX]\s*(.+)$/;
// Trailing "Milk x2" or "Milk (x2)"
const TRAILING_QTY_RE = /^(.+?)\s*\(?[xX]\s*(\d+)\)?$/;

function parseAmount(raw: string): number {
  return parseFloat(raw.replace(/,/g, ""));
}

function parseItemLines(text: string): ScannedItem[] {
  const items: ScannedItem[] = [];

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || isNoiseLine(line)) continue;

    const match = line.match(ITEM_LINE_RE);
    if (!match) continue;

    const amount = parseAmount(match[2]);
    if (!Number.isFinite(amount) || amount <= 0) continue;

    let name = match[1].trim().replace(/[.\s]+$/, "");
    let quantity = 1;

    const leadingQty = name.match(LEADING_QTY_RE);
    const trailingQty = name.match(TRAILING_QTY_RE);
    if (leadingQty) {
      quantity = parseInt(leadingQty[1], 10) || 1;
      name = leadingQty[2].trim();
    } else if (trailingQty) {
      quantity = parseInt(trailingQty[2], 10) || 1;
      name = trailingQty[1].trim();
    }

    if (name.length < 2) continue;
    items.push({ item: name, category: categorizeGroceryItem(name), amount, quantity });
  }

  return items;
}

function findVendor(text: string): string | null {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines.slice(0, 5)) {
    if (isNoiseLine(line)) continue;
    if (!/[a-zA-Z]{3,}/.test(line)) continue; // needs a real word, not just digits/symbols
    if (/^\d+$/.test(line.replace(/\s/g, ""))) continue;
    if (line.length > 3 && line.length < 50) return line;
  }
  return null;
}

function findDate(text: string): string | null {
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // DD-MM-YYYY / DD/MM/YYYY (Indian date ordering, matching the rest of this app)
  const dmy = text.match(/\b(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})\b/);
  if (dmy) {
    const day = dmy[1].padStart(2, "0");
    const month = dmy[2].padStart(2, "0");
    const year = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
    if (Number(month) <= 12 && Number(day) <= 31) return `${year}-${month}-${day}`;
  }

  return null;
}

async function extractText(fileBase64: string, mediaType: SupportedMediaType): Promise<string> {
  if (mediaType === "application/pdf") {
    const parser = new PDFParse({ data: Buffer.from(fileBase64, "base64") });
    try {
      const result = await parser.getText();
      return result.text;
    } finally {
      await parser.destroy();
    }
  }

  const worker = await createWorker("eng");
  try {
    const { data } = await worker.recognize(`data:${mediaType};base64,${fileBase64}`);
    return data.text;
  } finally {
    await worker.terminate();
  }
}

/**
 * Free, local receipt/invoice reading - no API calls, no per-scan cost.
 * PDFs (e.g. an app's downloaded invoice) get their embedded text extracted
 * directly, which is exact since there's no OCR involved. Photos go through
 * Tesseract OCR, then both paths run the same heuristic line-item parser and
 * keyword-based categorizer used elsewhere in this app. This is meaningfully
 * rougher than an AI reader - no semantic understanding, just pattern
 * matching - so results need real review before saving (which the existing
 * scan-review UI already requires for everything).
 */
export async function scanReceipt(
  fileBase64: string,
  mediaType: SupportedMediaType
): Promise<ScanReceiptResult> {
  const text = await extractText(fileBase64, mediaType);

  if (!text.trim()) {
    return {
      vendor: null,
      date: null,
      items: [],
      warning:
        mediaType === "application/pdf"
          ? "Couldn't find any text in that PDF - it may be a scanned image rather than a real text PDF."
          : "Couldn't read any text from that photo - try better lighting or a straighter angle.",
    };
  }

  if (isBlinkitTaxInvoice(text)) {
    const { date, items } = parseBlinkitTaxInvoice(text);
    return {
      vendor: "Blinkit",
      date: date ?? findDate(text),
      items,
      warning:
        "Read with free local text extraction (exact for the item names/amounts/quantities " +
        "themselves - no OCR guessing involved), but categories are still keyword guesses and a " +
        "row split across a PDF page break can occasionally lose a few trailing words from an " +
        "item's name. Double-check before saving.",
    };
  }

  const items = parseItemLines(text);

  return {
    vendor: findVendor(text),
    date: findDate(text),
    items,
    warning:
      "Read with free local text extraction/OCR, not AI - it can't guess categories reliably or " +
      "tell a line item from a fee/summary line as well as a human can. Double-check every row " +
      "below before saving.",
  };
}
