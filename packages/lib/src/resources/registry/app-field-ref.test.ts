// packages/lib/src/resources/registry/app-field-ref.test.ts
// Late-bound `@app:` ref grammar (@auxx/types/field) + display resolver (field-utils).

import {
  isAppFieldRef,
  parseAppFieldRef,
  toAppFieldRef,
  toFieldId,
  toResourceFieldId,
} from '@auxx/types/field'
import { describe, expect, it } from 'vitest'
import type { ResourceField } from './field-types'
import { fieldMatchesRef, resolveFieldRef } from './field-utils'

const field = (over: Partial<ResourceField>): ResourceField =>
  ({ id: 'x', label: 'X', ...over }) as ResourceField

describe('@app: ref grammar', () => {
  it('detects and parses a late-bound ref', () => {
    const ref = 'shopify_orders:@app:shopify:id'
    expect(isAppFieldRef(ref)).toBe(true)
    expect(parseAppFieldRef(ref)).toEqual({
      defSegment: 'shopify_orders',
      appSlug: 'shopify',
      appFieldKey: 'id',
    })
  })

  it('handles dotted app field keys', () => {
    expect(parseAppFieldRef('shopify_line_items:@app:shopify:lineItems.title')).toEqual({
      defSegment: 'shopify_line_items',
      appSlug: 'shopify',
      appFieldKey: 'lineItems.title',
    })
  })

  it('returns null / false for a concrete ref', () => {
    expect(isAppFieldRef('contact:abc123')).toBe(false)
    expect(parseAppFieldRef('contact:abc123')).toBeNull()
  })

  it('round-trips through toAppFieldRef', () => {
    const ref = toAppFieldRef('shopify_orders', 'shopify', 'lineItems.title')
    expect(ref).toBe('shopify_orders:@app:shopify:lineItems.title')
    expect(parseAppFieldRef(ref)?.appFieldKey).toBe('lineItems.title')
  })
})

describe('fieldMatchesRef / resolveFieldRef', () => {
  const idField = field({
    id: toFieldId('cf_1'),
    resourceFieldId: toResourceFieldId('def_orders', 'cf_1'),
    appFieldKey: 'id',
    appInstallationId: 'inst_1',
  })
  const fields = [idField]

  it('matches a concrete ref directly', () => {
    expect(fieldMatchesRef(idField, 'def_orders', 'def_orders:cf_1')).toBe(true)
  })

  it('matches a late-bound @app: ref by appFieldKey', () => {
    expect(fieldMatchesRef(idField, 'def_orders', 'shopify_orders:@app:shopify:id')).toBe(true)
  })

  it('rejects a different appFieldKey', () => {
    expect(fieldMatchesRef(idField, 'def_orders', 'shopify_orders:@app:shopify:name')).toBe(false)
  })

  it('disambiguates by installation→slug when a slug map is supplied', () => {
    const slugMap = new Map([['inst_1', 'shopify']])
    expect(fieldMatchesRef(idField, 'def_orders', 'x:@app:shopify:id', slugMap)).toBe(true)
    expect(fieldMatchesRef(idField, 'def_orders', 'x:@app:other:id', slugMap)).toBe(false)
  })

  it('resolves a late-bound ref to its concrete id', () => {
    const r = resolveFieldRef(fields, 'def_orders', 'shopify_orders:@app:shopify:id')
    expect(r?.field).toBe(idField)
    expect(r?.concreteRef).toBe('def_orders:cf_1')
  })

  it('returns null when nothing matches', () => {
    expect(resolveFieldRef(fields, 'def_orders', 'x:@app:shopify:missing')).toBeNull()
    expect(resolveFieldRef(fields, 'def_orders', null)).toBeNull()
  })

  describe('two apps sharing an appFieldKey on one definition', () => {
    // Stripe and Shopify both declare `customerId` on contacts. The Stripe rows predate
    // slug stamping (`appSlug` undefined); the Shopify row is stamped.
    const stripeLegacy = field({
      id: toFieldId('cf_stripe'),
      resourceFieldId: toResourceFieldId('def_contacts', 'cf_stripe'),
      appFieldKey: 'customerId',
      appInstallationId: 'inst_stripe',
    })
    const shopify = field({
      id: toFieldId('cf_shopify'),
      resourceFieldId: toResourceFieldId('def_contacts', 'cf_shopify'),
      appFieldKey: 'customerId',
      appInstallationId: 'inst_shopify',
      appSlug: 'shopify',
    })
    const stripeStamped = field({
      id: toFieldId('cf_stripe2'),
      resourceFieldId: toResourceFieldId('def_contacts', 'cf_stripe2'),
      appFieldKey: 'customerId',
      appInstallationId: 'inst_stripe',
      appSlug: 'stripe',
    })

    it('a slug-stamped row rejects a ref for another app', () => {
      expect(fieldMatchesRef(shopify, 'def_contacts', 'x:@app:stripe:customerId')).toBe(false)
      expect(fieldMatchesRef(stripeStamped, 'def_contacts', 'x:@app:shopify:customerId')).toBe(
        false
      )
    })

    it('an unstamped legacy row stays eligible for either app', () => {
      expect(fieldMatchesRef(stripeLegacy, 'def_contacts', 'x:@app:shopify:customerId')).toBe(true)
    })

    it('resolves to the stamped match even when the legacy row is listed first', () => {
      const r = resolveFieldRef(
        [stripeLegacy, shopify],
        'def_contacts',
        'x:@app:shopify:customerId'
      )
      expect(r?.field).toBe(shopify)
    })

    it('falls back to the legacy row when no stamped row matches', () => {
      const r = resolveFieldRef([stripeLegacy, shopify], 'def_contacts', 'x:@app:stripe:customerId')
      expect(r?.field).toBe(stripeLegacy)
    })

    it('never returns a stamped row that belongs to another app', () => {
      const r = resolveFieldRef([shopify, stripeStamped], 'def_contacts', 'x:@app:other:customerId')
      expect(r).toBeNull()
    })
  })
})
