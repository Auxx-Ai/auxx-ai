// apps/web/src/components/icons/source-brands.ts

import { BRAND_ICONS, type BrandSlug } from './brands'

/**
 * `FinancialSourceAccount.providerKey` values, verbatim and lowercased, mapped
 * to a brand mark in `BRAND_ICONS`.
 *
 * Unlike `STRIPE_INSTITUTIONS` these keys are not observed free text — they are
 * the provider namespace our own connectors write, so the map is closed and
 * short. Today it is `shopify` (the store, whose `externalAccountId` is the shop
 * domain), `shopify_payments` (the Shopify Payments balance account), `stripe`,
 * and `auxx` — the manual sentinel bucket, which deliberately gets no mark
 * because it is not a connected account at all.
 *
 * The map is many-to-one on purpose: a store and its processor are two rows with
 * two provider keys and one logo.
 *
 * 🛑 **Exact keys only, case-folded.** No prefixes, no `startsWith('shopify')`.
 * A wrong logo looks deliberate, and the failure is silent.
 */
export const SOURCE_BRANDS: Record<string, BrandSlug> = {
  shopify: 'shopify',
  shopify_payments: 'shopify',
  stripe: 'stripe',
}

/**
 * The brand mark for a source account's provider, or `null` when there is none
 * to show.
 *
 * The `BrandSlug` return type is what makes a dangling `brand:` ref
 * unconstructible. `VisualIcon`'s brand branch renders a bare `<img>` and does
 * NOT fall back, so a slug with no file on disk is an empty frame with no error.
 * Every `BrandSlug` is proven to have a file by `__tests__/brands.test.ts`.
 *
 * @param providerKey `FinancialSourceAccount.providerKey`, e.g. `shopify_payments`.
 */
export function sourceBrandSlug(providerKey: string): BrandSlug | null {
  const key = providerKey?.trim().toLowerCase()
  if (!key) return null
  const slug = SOURCE_BRANDS[key]
  // The map's type already says this, but the runtime check costs nothing and
  // is the difference between a missing file and a blank square on a screen.
  return slug && slug in BRAND_ICONS ? slug : null
}

/**
 * The visual-ref for a source account's provider: `brand:<slug>` when a mark is
 * proven, otherwise `null` so the caller renders its own lucide fallback.
 *
 * @see sourceBrandSlug for why null rather than an unresolvable ref.
 */
export function sourceVisualRef(providerKey: string): string | null {
  const slug = sourceBrandSlug(providerKey)
  return slug ? `brand:${slug}` : null
}
