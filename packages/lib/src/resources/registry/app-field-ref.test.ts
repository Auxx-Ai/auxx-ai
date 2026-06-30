// packages/lib/src/resources/registry/app-field-ref.test.ts
// Late-bound `@app:` ref grammar (@auxx/types/field) + display resolver (field-utils).

import {
  isAppFieldRef,
  parseAppFieldRef,
  toAppFieldRef,
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
    id: 'cf_1',
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
})
