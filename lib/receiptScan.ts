import Anthropic from "@anthropic-ai/sdk";
import { CATEGORIES, isCategory } from "./types";

export interface ScannedItem {
  item: string;
  category: string; // validated against CATEGORIES before use
  amount: number;
  quantity: number;
}

export interface ScanReceiptResult {
  vendor: string | null;
  date: string | null; // YYYY-MM-DD if the model could read it
  items: ScannedItem[];
  warning?: string; // set when the model returned something we had to drop/clean
}

const SUPPORTED_MEDIA_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type SupportedMediaType = (typeof SUPPORTED_MEDIA_TYPES)[number];

export function isSupportedMediaType(mediaType: string): mediaType is SupportedMediaType {
  return (SUPPORTED_MEDIA_TYPES as readonly string[]).includes(mediaType);
}

function buildSystemPrompt(): string {
  return [
    "You are a grocery/retail receipt parser for a personal finance app.",
    "You will be shown a photo of a paper or digital receipt.",
    "",
    "Extract every purchased line item. Ignore the subtotal, tax, and total lines themselves",
    "(they are not items), but do include separate delivery/packing fee lines if the receipt",
    "shows them as their own line.",
    "",
    "For each item, choose the single best-fit category from this exact list (use the slug",
    `exactly as written, do not invent new categories): ${CATEGORIES.join(", ")}.`,
    "",
    "Respond with ONLY a single JSON object and nothing else - no markdown fences, no",
    "explanation before or after. Match this shape exactly:",
    "",
    "{",
    '  "vendor": string | null,',
    '  "date": string | null,   // receipt date as YYYY-MM-DD if visible, else null',
    '  "items": [',
    '    { "item": string, "category": string, "amount": number, "quantity": number }',
    "  ]",
    "}",
    "",
    "quantity defaults to 1 when the receipt does not show one. amount is the price paid for",
    "that line (not a per-unit price) as a plain number, no currency symbol. If you cannot",
    'read the receipt at all, return {"vendor": null, "date": null, "items": []}.',
  ].join("\n");
}

export async function scanReceipt(
  imageBase64: string,
  mediaType: SupportedMediaType
): Promise<ScanReceiptResult> {
  const client = new Anthropic();

  const response = await client.messages.create({
    model: "claude-opus-5",
    max_tokens: 4096,
    system: buildSystemPrompt(),
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
          { type: "text", text: "Extract the line items from this receipt as JSON." },
        ],
      },
    ],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude did not return a text response");
  }

  const raw = textBlock.text.trim();
  const jsonText = raw.startsWith("```")
    ? raw.replace(/^```(?:json)?\s*/, "").replace(/```\s*$/, "")
    : raw;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error("Could not parse a receipt from that photo - try a clearer image");
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Unexpected response shape from receipt scan");
  }
  const obj = parsed as Record<string, unknown>;

  const vendor = typeof obj.vendor === "string" && obj.vendor.trim() ? obj.vendor.trim() : null;
  const date = typeof obj.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(obj.date) ? obj.date : null;

  const rawItems = Array.isArray(obj.items) ? obj.items : [];
  let droppedAny = false;
  const items: ScannedItem[] = [];
  for (const raw of rawItems) {
    if (typeof raw !== "object" || raw === null) {
      droppedAny = true;
      continue;
    }
    const r = raw as Record<string, unknown>;
    const name = typeof r.item === "string" ? r.item.trim() : "";
    const amount = typeof r.amount === "number" && Number.isFinite(r.amount) ? r.amount : NaN;
    const category = typeof r.category === "string" && isCategory(r.category) ? r.category : "other";
    const quantity =
      typeof r.quantity === "number" && Number.isFinite(r.quantity) && r.quantity > 0
        ? r.quantity
        : 1;

    if (!name || Number.isNaN(amount)) {
      droppedAny = true;
      continue;
    }
    items.push({ item: name, category, amount, quantity });
  }

  return {
    vendor,
    date,
    items,
    warning: droppedAny
      ? "Some lines on the receipt couldn't be read cleanly and were skipped - double check nothing important is missing below."
      : undefined,
  };
}
