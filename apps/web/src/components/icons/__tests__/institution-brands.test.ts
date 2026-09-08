// apps/web/src/components/icons/__tests__/institution-brands.test.ts

import { describe, expect, it } from 'vitest'
import { institutionBrandSlug, institutionVisualRef } from '../institution-brands'

/** A feed account: the only kind that can carry a mark. */
const feed = (institution: string | null) => ({ institution, connectorId: 'conn_1' })
/** A hand-added account. Its institution is whatever a person typed. */
const manual = (institution: string | null) => ({ institution, connectorId: null })

describe('institutionBrandSlug', () => {
  it('resolves a proven Stripe institution name on a feed account', () => {
    expect(institutionBrandSlug(feed('StripeBank'))).toBe('stripe')
  })

  it('case-folds and trims, because that is the only normalization there is', () => {
    expect(institutionBrandSlug(feed('  stripebank  '))).toBe('stripe')
    expect(institutionBrandSlug(feed('STRIPEBANK'))).toBe('stripe')
  })

  // 🛑 The gate, and the reason this module exists. Every string below is really
  // in the dev database, typed by a person into the manual add form.
  it('never resolves a MANUAL account, however good its institution looks', () => {
    expect(institutionBrandSlug(manual('StripeBank'))).toBeNull()
    expect(institutionBrandSlug(manual('Bank of America'))).toBeNull()
    expect(institutionBrandSlug(manual('Wells'))).toBeNull()
  })

  // 🛑 No prefix or token matching. `Wells` must not become Wells Fargo and
  // `Bank` must not become Bank of America - a wrong logo looks deliberate.
  it('does not match a partial or generic name on a feed account', () => {
    expect(institutionBrandSlug(feed('Wells'))).toBeNull()
    expect(institutionBrandSlug(feed('Bank'))).toBeNull()
    expect(institutionBrandSlug(feed('StripeBank, N.A.'))).toBeNull()
  })

  it('handles the empty cases', () => {
    expect(institutionBrandSlug(feed(null))).toBeNull()
    expect(institutionBrandSlug(feed(''))).toBeNull()
    expect(institutionBrandSlug(feed('   '))).toBeNull()
  })
})

describe('institutionVisualRef', () => {
  it('emits a brand ref only for a proven mark', () => {
    expect(institutionVisualRef(feed('StripeBank'))).toBe('brand:stripe')
  })

  // A null ref is what sends the caller to its own `Landmark`. `VisualIcon`'s
  // brand branch does NOT fall back, so emitting an unproven ref would render
  // an empty frame with no error.
  it('emits null rather than an unresolvable brand ref', () => {
    expect(institutionVisualRef(feed('Some Credit Union'))).toBeNull()
    expect(institutionVisualRef(manual('StripeBank'))).toBeNull()
  })
})
