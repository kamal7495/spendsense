import { InvoiceRow } from "./types";

const ZERODHA_VENDOR = "Coin by Zerodha";

/**
 * Collapses a fund name down to its distinguishing tokens (AMC + category),
 * stripping filler words and punctuation. Necessary because Zerodha's own
 * allotment/redemption emails spell the SAME fund differently across
 * different months (real, observed cases): "KOTAK MID CAP FUND DIRECT PLAN
 * GROWTH" vs "KOTAK MIDCAP FUND - DIRECT PLAN - GROWTH" vs "KOTAK MIDCAP
 * FUND- DIRECT PLAN-GROWTH", and one Parag Parikh entry is even missing the
 * word "GROWTH" entirely. Verified against all real fund-name strings seen
 * in this account's emails to collapse to exactly the right number of
 * distinct funds - not guessed.
 */
export function normalizeFundName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(erstwhile[^)]*\)/gi, "")
    .replace(/[^a-z0-9]/g, "")
    .replace(/fund|direct|plan|growth|option/g, "");
}

/**
 * Normalized fund name -> AMFI scheme code, hand-verified against
 * api.mfapi.in's search endpoint for each of this account's real holdings
 * (confirmed via real Zerodha emails, not guessed). A fund that shows up in
 * a future email but isn't in this map won't get a current-value estimate -
 * intentional: better to show "value unknown" than silently fuzzy-match to
 * the wrong scheme at runtime.
 */
export const FUND_SCHEME_CODES: Record<string, number> = {
  kotakmidcap: 119775, // Kotak Mid Cap Fund - Direct Plan - Growth
  sbilargecap: 119598, // SBI Large Cap Fund - Direct Plan - Growth
  hdfcmidcap: 118989, // HDFC Mid Cap Fund - Direct Plan - Growth Option
  iciciprudentialvalue: 120323, // ICICI Prudential Value Fund (erstwhile Value Discovery Fund) - Direct Plan - Growth
  paragparikhflexicap: 122639, // Parag Parikh Flexi Cap Fund - Direct Plan - Growth
  axiselsstaxsaver: 120503, // Axis ELSS- Tax Saver Fund - Direct Plan - Growth Option
  kotakelsstaxsaver: 119773, // Kotak ELSS Tax Saver Fund - Direct Plan - Growth
};

export interface FundHolding {
  displayName: string;
  normalizedKey: string;
  unitsHeld: number;
  netInvested: number; // sum of contributions minus redemptions, in rupees
}

const MIN_UNITS_HELD = 0.001; // below this, treat as fully redeemed (floating-point dust)

/**
 * Groups "Coin by Zerodha" invoice rows into per-fund holdings: units held
 * (allotment units minus redemption units, both already signed in
 * Invoices_Raw) and net rupees invested. Excludes funds that have been
 * fully redeemed (~0 units left).
 */
export function computeFundHoldings(rows: InvoiceRow[]): FundHolding[] {
  const byKey = new Map<string, { displayName: string; unitsHeld: number; netInvested: number }>();

  for (const row of rows) {
    if (row.vendor !== ZERODHA_VENDOR) continue;

    const displayName = row.item.replace(/\s*\(redemption\)\s*$/i, "").trim();
    const key = normalizeFundName(displayName);

    const existing = byKey.get(key);
    if (existing) {
      existing.unitsHeld += row.quantity;
      existing.netInvested += row.amount;
    } else {
      byKey.set(key, { displayName, unitsHeld: row.quantity, netInvested: row.amount });
    }
  }

  return Array.from(byKey.entries())
    .filter(([, v]) => v.unitsHeld > MIN_UNITS_HELD)
    .map(([normalizedKey, v]) => ({ normalizedKey, ...v }));
}

interface MfApiResponse {
  data?: { date: string; nav: string }[];
}

/** Current NAV for a scheme, or null if the lookup fails (network error, unknown code). */
export async function getCurrentNav(schemeCode: number): Promise<number | null> {
  try {
    const res = await fetch(`https://api.mfapi.in/mf/${schemeCode}`, {
      next: { revalidate: 3600 }, // NAV updates a few times/day, not intraday - hourly cache is plenty
    });
    if (!res.ok) return null;
    const json = (await res.json()) as MfApiResponse;
    const nav = parseFloat(json.data?.[0]?.nav ?? "");
    return Number.isFinite(nav) ? nav : null;
  } catch {
    return null;
  }
}

export interface FundValuation extends FundHolding {
  currentNav: number | null; // null when unmatched or the NAV lookup failed
  currentValue: number | null; // unitsHeld * currentNav, null when currentNav is null
  gainLoss: number | null; // currentValue - netInvested, null when currentValue is null
}

export interface MutualFundPortfolio {
  funds: FundValuation[];
  totalCurrentValue: number; // sum over funds with a known value only
  totalInvested: number; // sum over ALL held funds, known value or not
  unvaluedCount: number; // funds held but with no scheme-code mapping or failed NAV lookup
}

/**
 * Live portfolio valuation: current units held per fund x today's NAV
 * (fetched from the free, keyless api.mfapi.in). An estimate, not the
 * broker's own figure - NAV lookups can fail per-fund without breaking the
 * whole portfolio view; those funds' value is reported as unknown rather
 * than guessed.
 */
export async function getMutualFundPortfolio(rows: InvoiceRow[]): Promise<MutualFundPortfolio> {
  const holdings = computeFundHoldings(rows);

  const funds: FundValuation[] = await Promise.all(
    holdings.map(async (h) => {
      const schemeCode = FUND_SCHEME_CODES[h.normalizedKey];
      const currentNav = schemeCode ? await getCurrentNav(schemeCode) : null;
      const currentValue = currentNav !== null ? h.unitsHeld * currentNav : null;
      const gainLoss = currentValue !== null ? currentValue - h.netInvested : null;
      return { ...h, currentNav, currentValue, gainLoss };
    })
  );

  return {
    funds: funds.sort((a, b) => (b.currentValue ?? 0) - (a.currentValue ?? 0)),
    totalCurrentValue: funds.reduce((sum, f) => sum + (f.currentValue ?? 0), 0),
    totalInvested: funds.reduce((sum, f) => sum + f.netInvested, 0),
    unvaluedCount: funds.filter((f) => f.currentValue === null).length,
  };
}
