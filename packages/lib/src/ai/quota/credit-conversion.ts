// packages/lib/src/ai/quota/credit-conversion.ts

/**
 * Credit ↔ USD anchor. Credits meter actual provider COGS (list price):
 * `1 credit = $0.0001 of list-price COGS` → 10,000 credits = $1.
 *
 * Margin lives in plan grants, not here — this conversion is pure list-price
 * COGS with no per-model markup knobs (that would recreate the old
 * multiplier-tuning problem). Client-safe: no imports, no server deps.
 */
export const CREDIT_USD_VALUE = 0.0001

/**
 * Defensive charge for a SYSTEM call whose model has no registry price (it
 * should have been filtered out of the SYSTEM-eligible set; if one slips
 * through we charge $0.01 and log an error rather than bill 0).
 */
export const UNPRICED_FALLBACK_CREDITS = 100

/** Convert estimated USD COGS to credits. Rounds to the nearest integer credit. */
export function usdToCredits(usd: number): number {
  return Math.round(usd / CREDIT_USD_VALUE)
}
