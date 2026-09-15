// apps/web/src/components/icons/__tests__/source-brands.test.ts

import { describe, expect, it } from 'vitest'
import { BRAND_ICONS } from '../brands'
import { SOURCE_BRANDS, sourceBrandSlug, sourceVisualRef } from '../source-brands'

describe('SOURCE_BRANDS', () => {
  // 🛑 This is the assertion that makes a dangling `brand:` ref unconstructible.
  // `brands.test.ts` proves every `BrandSlug` has a file on disk; this proves
  // every slug this map can return is a `BrandSlug`. Together they rule out the
  // silent empty frame `VisualIcon`'s non-falling-back brand branch renders.
  it('only maps to slugs that exist in BRAND_ICONS', () => {
    for (const slug of Object.values(SOURCE_BRANDS)) {
      expect(slug in BRAND_ICONS, `${slug} is not a BrandSlug`).toBe(true)
    }
  })

  it('keys are lowercase, because the resolver case-folds before lookup', () => {
    for (const key of Object.keys(SOURCE_BRANDS)) {
      expect(key).toBe(key.toLowerCase())
    }
  })
})

describe('sourceBrandSlug', () => {
  it('resolves the provider keys in the source namespace', () => {
    expect(sourceBrandSlug('shopify')).toBe('shopify')
    expect(sourceBrandSlug('stripe')).toBe('stripe')
  })

  // The store and its processor are two rows, two keys, one logo.
  it('gives the store and Shopify Payments the same mark', () => {
    expect(sourceBrandSlug('shopify_payments')).toBe('shopify')
    expect(sourceBrandSlug('shopify_payments')).toBe(sourceBrandSlug('shopify'))
  })

  it('case-folds and trims, because that is the only normalization there is', () => {
    expect(sourceBrandSlug('  Shopify_Payments  ')).toBe('shopify')
    expect(sourceBrandSlug('STRIPE')).toBe('stripe')
  })

  // 🛑 No prefix matching. `shopifyx` must not wear Shopify's logo - a wrong
  // logo looks deliberate, and nothing errors.
  it('does not match a prefix or a near miss', () => {
    expect(sourceBrandSlug('shopifyx')).toBeNull()
    expect(sourceBrandSlug('shopify payments')).toBeNull()
    expect(sourceBrandSlug('shopify_payments_v2')).toBeNull()
    expect(sourceBrandSlug('stripe_connect')).toBeNull()
  })

  // The manual sentinel is not a connected account, so it gets no brand mark:
  // `SourceProviderIcon` draws a lucide `Store` for it instead.
  it('gives the manual bucket no mark', () => {
    expect(sourceBrandSlug('auxx')).toBeNull()
    expect(sourceBrandSlug('manual')).toBeNull()
  })

  it('handles the empty cases', () => {
    expect(sourceBrandSlug('')).toBeNull()
    expect(sourceBrandSlug('   ')).toBeNull()
  })
})

describe('sourceVisualRef', () => {
  it('emits a brand ref only for a proven mark', () => {
    expect(sourceVisualRef('shopify_payments')).toBe('brand:shopify')
    expect(sourceVisualRef('stripe')).toBe('brand:stripe')
  })

  // A null ref is what sends the caller to its own lucide glyph. `VisualIcon`'s
  // brand branch does NOT fall back, so emitting an unproven ref would render an
  // empty frame with no error.
  it('emits null rather than an unresolvable brand ref', () => {
    expect(sourceVisualRef('auxx')).toBeNull()
    expect(sourceVisualRef('braintree')).toBeNull()
  })
})
