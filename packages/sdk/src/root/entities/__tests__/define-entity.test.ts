// packages/sdk/src/root/entities/__tests__/define-entity.test.ts

import { describe, expect, it } from 'vitest'
import { defineEntity } from '../define-entity.js'

describe('defineEntity', () => {
  it('accepts a minimal valid entity', () => {
    expect(() =>
      defineEntity({
        key: 'orders',
        apiSlug: 'shopify_orders',
        singular: 'Shopify Order',
        plural: 'Shopify Orders',
        primaryDisplayField: 'name',
        fields: [
          { key: 'shopifyId', type: 'TEXT', name: 'Shopify Order ID', identity: true },
          { key: 'name', type: 'TEXT', name: 'Order Name' },
        ],
      })
    ).not.toThrow()
  })

  it('rejects an invalid key', () => {
    expect(() =>
      defineEntity({
        key: '1bad',
        apiSlug: 'orders',
        singular: 'Order',
        plural: 'Orders',
        primaryDisplayField: 'name',
        fields: [{ key: 'name', type: 'TEXT', name: 'Name' }],
      })
    ).toThrow(/invalid key/i)
  })

  it('rejects an invalid apiSlug', () => {
    expect(() =>
      defineEntity({
        key: 'orders',
        apiSlug: 'Shopify Orders',
        singular: 'Order',
        plural: 'Orders',
        primaryDisplayField: 'name',
        fields: [{ key: 'name', type: 'TEXT', name: 'Name' }],
      })
    ).toThrow(/invalid apiSlug/i)
  })

  it('rejects duplicate field keys', () => {
    expect(() =>
      defineEntity({
        key: 'orders',
        apiSlug: 'orders',
        singular: 'Order',
        plural: 'Orders',
        primaryDisplayField: 'name',
        fields: [
          { key: 'name', type: 'TEXT', name: 'Name' },
          { key: 'name', type: 'TEXT', name: 'Name again' },
        ],
      })
    ).toThrow(/duplicate field key/i)
  })

  it('rejects more than one identity field', () => {
    expect(() =>
      defineEntity({
        key: 'orders',
        apiSlug: 'orders',
        singular: 'Order',
        plural: 'Orders',
        primaryDisplayField: 'name',
        fields: [
          { key: 'shopifyId', type: 'TEXT', name: 'Shopify ID', identity: true },
          { key: 'legacyId', type: 'TEXT', name: 'Legacy ID', identity: true },
        ],
      })
    ).toThrow(/more than one identity field/i)
  })

  it('rejects an identity field of a non-scalar type', () => {
    expect(() =>
      defineEntity({
        key: 'orders',
        apiSlug: 'orders',
        singular: 'Order',
        plural: 'Orders',
        primaryDisplayField: 'name',
        fields: [
          {
            key: 'status',
            type: 'SINGLE_SELECT',
            name: 'Status',
            options: [{ value: 'a' }],
            identity: true,
          },
        ],
      })
    ).toThrow(/identity/i)
  })

  it('rejects a primaryDisplayField that is not a declared field', () => {
    expect(() =>
      defineEntity({
        key: 'orders',
        apiSlug: 'orders',
        singular: 'Order',
        plural: 'Orders',
        primaryDisplayField: 'nope',
        fields: [{ key: 'name', type: 'TEXT', name: 'Name' }],
      })
    ).toThrow(/primaryDisplayField "nope" is not a declared field/i)
  })

  it('rejects a secondaryDisplayField that is not a declared field', () => {
    expect(() =>
      defineEntity({
        key: 'orders',
        apiSlug: 'orders',
        singular: 'Order',
        plural: 'Orders',
        primaryDisplayField: 'name',
        secondaryDisplayField: 'nope',
        fields: [{ key: 'name', type: 'TEXT', name: 'Name' }],
      })
    ).toThrow(/secondaryDisplayField "nope" is not a declared field/i)
  })

  it('rejects an avatarField that is not a declared field', () => {
    expect(() =>
      defineEntity({
        key: 'orders',
        apiSlug: 'orders',
        singular: 'Order',
        plural: 'Orders',
        primaryDisplayField: 'name',
        avatarField: 'nope',
        fields: [{ key: 'name', type: 'TEXT', name: 'Name' }],
      })
    ).toThrow(/avatarField "nope" is not a declared field/i)
  })

  it('accepts a RELATIONSHIP field targeting another entity by entityKey', () => {
    // defineEntity can't see sibling entities — cross-entity resolution is the
    // extractor's job (see compile-and-extract-catalog.ts). Locally it must
    // accept any entityKey target.
    expect(() =>
      defineEntity({
        key: 'orders',
        apiSlug: 'orders',
        singular: 'Order',
        plural: 'Orders',
        primaryDisplayField: 'name',
        fields: [
          { key: 'name', type: 'TEXT', name: 'Name' },
          {
            key: 'lineItems',
            type: 'RELATIONSHIP',
            name: 'Line Items',
            relationship: { target: { entityKey: 'line_items' }, cardinality: 'has_many' },
          },
        ],
      })
    ).not.toThrow()
  })

  it('accepts a RELATIONSHIP field targeting a platform kind by entityKind', () => {
    expect(() =>
      defineEntity({
        key: 'orders',
        apiSlug: 'orders',
        singular: 'Order',
        plural: 'Orders',
        primaryDisplayField: 'name',
        fields: [
          { key: 'name', type: 'TEXT', name: 'Name' },
          {
            key: 'customer',
            type: 'RELATIONSHIP',
            name: 'Customer',
            relationship: { target: { entityKind: 'contact' }, cardinality: 'belongs_to' },
          },
        ],
      })
    ).not.toThrow()
  })

  it('defaults capabilities to author-declared values (no forced defaults at author time)', () => {
    const entity = defineEntity({
      key: 'orders',
      apiSlug: 'orders',
      singular: 'Order',
      plural: 'Orders',
      primaryDisplayField: 'name',
      fields: [{ key: 'name', type: 'TEXT', name: 'Name', capabilities: { updatable: true } }],
    })
    expect(entity.fields[0]?.capabilities).toEqual({ updatable: true })
  })
})
