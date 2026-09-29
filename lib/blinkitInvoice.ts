import type { ScannedItem } from "./receiptScan";
import { categorizeGroceryItem } from "./categorize";

export interface ParsedBlinkitInvoice {
  date: string | null;
  items: ScannedItem[];
}

/** True when this is a Blinkit-style GST tax invoice, not a plain receipt/photo. */
export function isBlinkitTaxInvoice(text: string): boolean {
  return /blink commerce|blinkit/i.test(text) && /item description/i.test(text);
}

const HEADER_WORDS = new Set([
  "sr", "no", "upc", "item", "description", "mrp", "discou", "discount",
  "nt", "qty", "taxable", "value", "cgst", "sgst", "cess", "addition", "additional", "al", "val",
  "(%)", "(inr)",
]);

function isHeaderNoise(line: string): boolean {
  const tokens = line.toLowerCase().replace(/\./g, "").split(/\s+/).filter(Boolean);
  return tokens.length > 0 && tokens.every((t) => HEADER_WORDS.has(t));
}

function splitTokens(line: string): string[] {
  return line.split(/\t+| {2,}/).map((t) => t.trim()).filter(Boolean);
}

/**
 * Blinkit's downloadable invoice is a real GST tax invoice, not a simple
 * receipt: each purchased item is a wrapped multi-line table row (the item
 * description alone can span 1-3 lines, split unpredictably depending on
 * name length and page breaks), followed by 11 tab-separated numeric
 * columns (MRP, Discount, Qty, Taxable Value, CGST%, CGST, SGST%, SGST,
 * Cess%, Additional Cess, Total), followed by a "Delivery and other
 * charges" row allocating a slice of the order's delivery/handling fee to
 * that line for GST purposes. A single PDF can contain multiple "Tax
 * Invoice" sections (Blinkit splits fulfillment across seller entities
 * under one order).
 *
 * Verified against a real downloaded invoice: every extracted item's
 * amount, plus one aggregated "Delivery & handling charges" line, sums to
 * exactly the invoice's own printed section totals to the paisa. Item
 * *names* can still end up slightly truncated when a row happens to span a
 * PDF page break (a real observed case) — amounts and quantities are
 * unaffected since those come from the numeric row itself, not the
 * multi-line description.
 */
export function parseBlinkitTaxInvoice(text: string): ParsedBlinkitInvoice {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^--\s*\d+\s+of\s+\d+\s*--$/.test(l));

  const items: ScannedItem[] = [];
  let deliveryFeeTotal = 0;
  let inTable = false;
  let pending: string[] = [];
  let invoiceDate: string | null = null;

  for (const line of lines) {
    if (!invoiceDate) {
      const dateMatch = line.match(/Invoice Date\s*[:\t]?\s*(\d{4}-\d{2}-\d{2})/i);
      if (dateMatch) invoiceDate = dateMatch[1];
    }

    if (/Item Description/i.test(line)) {
      inTable = true;
      pending = [];
      continue;
    }
    if (!inTable) continue;

    // The wrapped column header's last word ("...Additional Cess Val Total")
    // lands on its own "Total" line — distinct from the real summary row,
    // which is "Total" followed by numbers on the same line.
    if (/^Total(\s|\t)/.test(line) && splitTokens(line).length > 1) {
      inTable = false;
      pending = [];
      continue;
    }
    if (line === "Total") continue;

    if (/Delivery and other charges/i.test(line)) {
      const nums = splitTokens(line).filter((t) => /^[\d.]+$/.test(t));
      if (nums.length) deliveryFeeTotal += parseFloat(nums[nums.length - 1]);
      continue;
    }

    const tokens = splitTokens(line);
    let numEnd = tokens.length;
    while (numEnd > 0 && /^[\d.]+$/.test(tokens[numEnd - 1])) numEnd--;
    const numericSuffix = tokens.slice(numEnd);

    if (numericSuffix.length >= 9) {
      const prefixText = tokens.slice(0, numEnd).join(" ");
      let desc = `${pending.join(" ")} ${prefixText}`.trim();
      desc = desc.replace(/^\d+\s+\d+\s*/, "").trim(); // leading sr.no + UPC-start
      desc = desc.replace(/^\d{3,}\s+/, "").trim(); // stray leading UPC-continuation digits
      desc = desc.replace(/\s*\(HSN-[\d\s]*\)?\s*$/i, "").trim(); // trailing tax-classification code

      const quantity = parseInt(numericSuffix[2], 10) || 1;
      const amount = parseFloat(numericSuffix[numericSuffix.length - 1]);

      if (desc.length >= 2 && Number.isFinite(amount) && amount > 0) {
        items.push({ item: desc, category: categorizeGroceryItem(desc), amount, quantity });
      }
      pending = [];
    } else if (numericSuffix.length === 0 && !isHeaderNoise(line) && !/^\d+$/.test(line)) {
      pending.push(line);
    }
  }

  if (deliveryFeeTotal > 0) {
    items.push({
      item: "Delivery & handling charges",
      category: "fees",
      amount: Math.round(deliveryFeeTotal * 100) / 100,
      quantity: 1,
    });
  }

  return { date: invoiceDate, items };
}
