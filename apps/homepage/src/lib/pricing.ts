// apps/homepage/src/lib/pricing.ts
// Canonical plan prices — the single source of truth shared by the pricing page and the
// startup-offer calculations. Lives in a plain (non-'use client') module so Server Components
// can read the literal values directly (importing constants from a 'use client' module into a
// Server Component turns them into client-reference proxies).

/** Discount applied to annual billing vs. paying month-to-month. */
export const ANNUAL_DISCOUNT = 0.3

/** Monthly / annual list prices per plan, in whole USD. */
export const PLAN_PRICES = {
  free: { monthly: 0, annually: 0 },
  starter: { monthly: 20, annually: Math.round(20 * (1 - ANNUAL_DISCOUNT)) },
  growth: { monthly: 50, annually: Math.round(50 * (1 - ANNUAL_DISCOUNT)) },
} as const
