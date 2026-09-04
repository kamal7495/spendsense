import { NextRequest, NextResponse } from "next/server";
import { isSupportedMediaType, scanReceipt } from "@/lib/receiptScan";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }

  const { imageBase64, mediaType } = (body ?? {}) as {
    imageBase64?: unknown;
    mediaType?: unknown;
  };

  if (typeof imageBase64 !== "string" || !imageBase64) {
    return NextResponse.json({ error: "Missing \"imageBase64\"" }, { status: 400 });
  }
  if (typeof mediaType !== "string" || !isSupportedMediaType(mediaType)) {
    return NextResponse.json(
      { error: "Unsupported image type - use JPEG, PNG, GIF, or WebP" },
      { status: 400 }
    );
  }

  try {
    const result = await scanReceipt(imageBase64, mediaType);
    return NextResponse.json(result);
  } catch (error) {
    console.error("POST /api/invoices/scan failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to scan receipt" },
      { status: 500 }
    );
  }
}
