// packages/sdk/src/root/fields/__tests__/define-field.test.ts

import { describe, expect, it } from 'vitest'
import { defineField, defineFields } from '../define-field.js'

describe('identity field validation', () => {
  it('allows identity: true on a scalar TEXT field', () => {
    expect(() =>
      defineField({
        key: 'customerId',
        targetEntity: 'contact',
        scope: 'connection',
        name: 'Shopify customer ID',
        type: 'TEXT',
        identity: true,
      })
    ).not.toThrow()
  })

  it('allows a plain (non-identity) field of any type', () => {
    expect(() =>
      defineField({
        key: 'storeDomain',
        targetEntity: 'contact',
        scope: 'connection',
        name: 'Shopify store',
        type: 'TEXT',
      })
    ).not.toThrow()
  })

  it('rejects identity: true on a SELECT field', () => {
    expect(() =>
      defineField({
        key: 'status',
        targetEntity: 'contact',
        scope: 'connection',
        name: 'Status',
        type: 'SINGLE_SELECT',
        options: [{ value: 'active' }],
        identity: true,
      })
    ).toThrow(/identity/i)
  })

  it('rejects identity: true on a RELATIONSHIP field', () => {
    expect(() =>
      defineField({
        key: 'owner',
        targetEntity: 'contact',
        scope: 'connection',
        name: 'Owner',
        type: 'RELATIONSHIP',
        relationship: {
          target: { entityKind: 'contact' },
          cardinality: 'belongs_to',
        },
        identity: true,
      })
    ).toThrow(/identity/i)
  })

  it('rejects identity: true on a JSON field', () => {
    expect(() =>
      defineField({
        key: 'raw',
        targetEntity: 'contact',
        scope: 'connection',
        name: 'Raw payload',
        type: 'JSON',
        identity: true,
      })
    ).toThrow(/identity/i)
  })

  it('rejects identity: true on an ADDRESS_STRUCT field', () => {
    expect(() =>
      defineField({
        key: 'address',
        targetEntity: 'contact',
        scope: 'connection',
        name: 'Address',
        type: 'ADDRESS_STRUCT',
        identity: true,
      })
    ).toThrow(/identity/i)
  })

  it('validates every field in defineFields, not just the first', () => {
    expect(() =>
      defineFields([
        {
          key: 'customerId',
          targetEntity: 'contact',
          scope: 'connection',
          name: 'Shopify customer ID',
          type: 'TEXT',
          identity: true,
        },
        {
          key: 'tags',
          targetEntity: 'contact',
          scope: 'connection',
          name: 'Tags',
          type: 'TAGS',
          options: [{ value: 'vip' }],
          identity: true,
        },
      ])
    ).toThrow(/identity/i)
  })
})

describe('identity field link templates', () => {
  const identityField = {
    key: 'shopifyOrderId',
    targetEntity: 'order',
    scope: 'connection',
    name: 'Shopify order ID',
    type: 'TEXT',
    identity: true,
  } as const

  it('accepts a valid link on an identity field', () => {
    const field = defineField({
      ...identityField,
      link: 'https://{connection.identity}/admin/orders/{externalId}',
    })
    expect(field.link).toBe('https://{connection.identity}/admin/orders/{externalId}')
  })

  it('accepts a template that is a single {field.<key>} variable', () => {
    expect(() => defineField({ ...identityField, link: '{field.url}' })).not.toThrow()
  })

  it('rejects a link on a non-identity field', () => {
    expect(() =>
      defineField({
        key: 'storeDomain',
        targetEntity: 'order',
        scope: 'connection',
        name: 'Store',
        type: 'TEXT',
        link: 'https://acme.test/{externalId}',
      })
    ).toThrow(/only valid on an identity field/i)
  })

  it('rejects an unknown variable', () => {
    expect(() =>
      defineField({ ...identityField, link: 'https://{shop}/admin/orders/{externalId}' })
    ).toThrow(/Unsupported link variable \{shop\}/)
  })

  it('rejects a two-hop via', () => {
    expect(() => defineField({ ...identityField, link: 'https://acme.test/{via.a.b.c}' })).toThrow(
      /Unsupported link variable \{via\.a\.b\.c\}/
    )
  })

  it('rejects a template that starts with neither https:// nor {field.', () => {
    expect(() => defineField({ ...identityField, link: '/admin/orders/{externalId}' })).toThrow(
      /must start with/i
    )
  })

  it('validates links in defineFields too', () => {
    expect(() =>
      defineFields([{ ...identityField, link: 'ftp://acme.test/{externalId}' }])
    ).toThrow(/must start with/i)
  })
})

describe('key validation', () => {
  it('rejects an invalid key', () => {
    expect(() =>
      defineField({
        key: '1bad',
        targetEntity: 'contact',
        scope: 'connection',
        name: 'Bad',
        type: 'TEXT',
      })
    ).toThrow(/invalid key/i)
  })

  it('rejects duplicate keys on the same target entity', () => {
    expect(() =>
      defineFields([
        { key: 'a', targetEntity: 'contact', scope: 'connection', name: 'A', type: 'TEXT' },
        { key: 'a', targetEntity: 'contact', scope: 'connection', name: 'A again', type: 'TEXT' },
      ])
    ).toThrow(/duplicate key/i)
  })

  it('allows the same key on two different target entities', () => {
    expect(() =>
      defineFields([
        { key: 'a', targetEntity: 'contact', scope: 'connection', name: 'A', type: 'TEXT' },
        { key: 'a', targetEntity: 'company', scope: 'connection', name: 'A', type: 'TEXT' },
      ])
    ).not.toThrow()
  })
})

describe('select fields', () => {
  it('requires options on a SINGLE_SELECT field (compile-time — this is a runtime smoke check)', () => {
    expect(() =>
      defineField({
        key: 'tier',
        targetEntity: 'contact',
        scope: 'installation',
        name: 'Tier',
        type: 'SINGLE_SELECT',
        options: [{ value: 'gold' }, { value: 'silver' }],
      })
    ).not.toThrow()
  })
})

describe('pii and addressComponents', () => {
  it('carries pii through untouched', () => {
    const field = defineField({
      key: 'email',
      targetEntity: 'contact',
      scope: 'connection',
      name: 'Email',
      type: 'EMAIL',
      pii: true,
    })
    expect(field.pii).toBe(true)
  })

  it('accepts addressComponents on an ADDRESS_STRUCT field', () => {
    const field = defineField({
      key: 'shippingAddress',
      targetEntity: 'order',
      scope: 'installation',
      name: 'Shipping Address',
      type: 'ADDRESS_STRUCT',
      addressComponents: ['street', 'city', 'state', 'country'],
    })
    expect(field.addressComponents).toEqual(['street', 'city', 'state', 'country'])
  })
})

describe('relationship fields', () => {
  it('accepts an entityKey target (another entity of the same app)', () => {
    expect(() =>
      defineField({
        key: 'lineItems',
        targetEntity: 'order',
        scope: 'installation',
        name: 'Line Items',
        type: 'RELATIONSHIP',
        relationship: {
          target: { entityKey: 'line_items' },
          cardinality: 'has_many',
          inverseName: 'Order',
        },
      })
    ).not.toThrow()
  })

  it('accepts an entityKind target (a platform kind)', () => {
    expect(() =>
      defineField({
        key: 'customer',
        targetEntity: 'order',
        scope: 'installation',
        name: 'Customer',
        type: 'RELATIONSHIP',
        relationship: { target: { entityKind: 'contact' }, cardinality: 'belongs_to' },
      })
    ).not.toThrow()
  })
})
