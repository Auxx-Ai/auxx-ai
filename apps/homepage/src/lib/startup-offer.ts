// apps/homepage/src/lib/startup-offer.ts
// Startup program offer, computed from a single source of truth. The base price is the Growth
// monthly price (~/lib/pricing); change it there (or the discount tiers below) and every price
// shown on the /startups page recalculates automatically.

import { PLAN_PRICES } from './pricing'

/** The platform (Growth plan) monthly price the startup discount applies to, in whole USD. */
export const STARTUP_BASE_MONTHLY_PRICE = PLAN_PRICES.growth.monthly

/**
 * Discount fraction per program year. The discount steps down over the first three years; the
 * step-down is applied manually by a super-admin each anniversary (no scheduler).
 */
export const STARTUP_DISCOUNT_TIERS = [
  { year: 'Year 1', discount: 0.9 },
  { year: 'Year 2', discount: 0.5 },
  { year: 'Year 3', discount: 0.25 },
] as const

/** Formats a USD amount, rounding to cents and dropping decimals when whole (e.g. `$5`, `$37.50`). */
export function formatUsd(amount: number): string {
  const rounded = Math.round(amount * 100) / 100
  return Number.isInteger(rounded) ? `$${rounded}` : `$${rounded.toFixed(2)}`
}

/** Per-year pricing shown on the startup page, derived from the base price + discount tiers. */
export interface StartupTierPricing {
  /** Program year label, e.g. "Year 1". */
  year: string
  /** Discount headline, e.g. "90% off". */
  discountLabel: string
  /** Discounted monthly price, e.g. "$5". */
  priceLabel: string
  /** The undiscounted base monthly price, e.g. "$50". */
  originalPriceLabel: string
}

/** Computes the startup pricing tiers from the single base price + discount fractions. */
export function getStartupTierPricing(): StartupTierPricing[] {
  return STARTUP_DISCOUNT_TIERS.map(({ year, discount }) => ({
    year,
    discountLabel: `${Math.round(discount * 100)}% off`,
    priceLabel: formatUsd(STARTUP_BASE_MONTHLY_PRICE * (1 - discount)),
    originalPriceLabel: formatUsd(STARTUP_BASE_MONTHLY_PRICE),
  }))
}
