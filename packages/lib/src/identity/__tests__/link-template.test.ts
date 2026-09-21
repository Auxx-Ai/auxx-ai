// packages/lib/src/identity/__tests__/link-template.test.ts

import { describe, expect, it } from 'vitest'
import { interpolateLinkTemplate, type LinkVariable, parseLinkTemplate } from '../link-template'

/** Duplicated verbatim in `packages/sdk/src/root/fields/__tests__/link-template.test.ts`
 *  — the two grammar copies must fail together, so keep the tables identical. */
const VALID_LINK_TEMPLATES: Array<{ template: string; variables: LinkVariable[] }> = [
  {
    template: 'https://acme.myshopify.com/admin/orders/{externalId}',
    variables: [{ kind: 'externalId' }],
  },
  {
    template: 'https://{connection.identity}/admin/customers/{externalId}',
    variables: [{ kind: 'connection', key: 'identity' }, { kind: 'externalId' }],
  },
  {
    template: 'https://{connection.__identity}/admin/products/{externalId}',
    variables: [{ kind: 'connection', key: '__identity' }, { kind: 'externalId' }],
  },
  {
    template:
      'https://{connection.identity}/admin/products/{via.part_product.productId}/variants/{externalId}',
    variables: [
      { kind: 'connection', key: 'identity' },
      { kind: 'via', relationship: 'part_product', appFieldKey: 'productId' },
      { kind: 'externalId' },
    ],
  },
  { template: '{field.url}', variables: [{ kind: 'field', key: 'url' }] },
  {
    template: 'https://app.qbo.intuit.com/app/customerdetail?nameId={externalId}',
    variables: [{ kind: 'externalId' }],
  },
  { template: 'https://dashboard.stripe.com/customers', variables: [] },
]

const INVALID_LINK_TEMPLATES: Array<{ template: string; match: RegExp }> = [
  { template: 'http://acme.test/orders/{externalId}', match: /must start with/ },
  { template: '/admin/orders/{externalId}', match: /must start with/ },
  { template: '{externalId}', match: /must start with/ },
  { template: '{field}', match: /must start with/ },
  { template: 'https://acme.test/{shop}/orders', match: /Unsupported link variable \{shop\}/ },
  { template: 'https://acme.test/{external_id}', match: /Unsupported link variable/ },
  { template: 'https://acme.test/{connection}', match: /Unsupported link variable/ },
  { template: 'https://acme.test/{connection.}', match: /Unsupported link variable/ },
  { template: 'https://acme.test/{connection.1bad}', match: /Unsupported link variable/ },
  { template: 'https://acme.test/{via.a}', match: /Unsupported link variable/ },
  {
    template: 'https://acme.test/{via.a.b.c}',
    match: /Unsupported link variable \{via\.a\.b\.c\}/,
  },
  { template: 'https://acme.test/{field.a.b}', match: /Unsupported link variable/ },
]

describe('parseLinkTemplate', () => {
  for (const { template, variables } of VALID_LINK_TEMPLATES) {
    it(`accepts ${template}`, () => {
      expect(parseLinkTemplate(template)).toEqual(variables)
    })
  }

  for (const { template, match } of INVALID_LINK_TEMPLATES) {
    it(`rejects ${template}`, () => {
      expect(() => parseLinkTemplate(template)).toThrow(match)
    })
  }
})

describe('interpolateLinkTemplate', () => {
  it('substitutes every variable in source order', () => {
    const href = interpolateLinkTemplate(
      'https://{connection.identity}/admin/products/{via.part_product.productId}/variants/{externalId}',
      (v) => {
        if (v.kind === 'connection') return 'shop.myshopify.com'
        if (v.kind === 'via') return '77'
        return '99'
      }
    )
    expect(href).toBe('https://shop.myshopify.com/admin/products/77/variants/99')
  })

  it('returns null when a variable resolves to null', () => {
    expect(interpolateLinkTemplate('https://x/{externalId}', () => null)).toBeNull()
  })

  it('returns null when a variable resolves to the empty string', () => {
    expect(interpolateLinkTemplate('https://x/{externalId}', () => '')).toBeNull()
  })

  it('returns a template with no variables unchanged', () => {
    expect(interpolateLinkTemplate('https://x/admin', () => null)).toBe('https://x/admin')
  })

  it('throws on an invalid template rather than leaving the token literal', () => {
    expect(() => interpolateLinkTemplate('https://x/{nope}', () => 'v')).toThrow()
  })
})
