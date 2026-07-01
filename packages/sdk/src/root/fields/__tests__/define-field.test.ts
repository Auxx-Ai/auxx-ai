// packages/sdk/src/root/fields/__tests__/define-field.test.ts

import { describe, expect, it } from 'vitest'
import { defineField, defineFields } from '../define-field.js'

describe('identity field validation', () => {
  it('allows identity: true on a scalar TEXT field', () => {
    expect(() =>
      defineField({
        appFieldKey: 'customerId',
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
        appFieldKey: 'storeDomain',
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
        appFieldKey: 'status',
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
        appFieldKey: 'owner',
        targetEntity: 'contact',
        scope: 'connection',
        name: 'Owner',
        type: 'RELATIONSHIP',
        relationship: { targetEntity: 'contact', cardinality: 'one' },
        identity: true,
      })
    ).toThrow(/identity/i)
  })

  it('rejects identity: true on a JSON field', () => {
    expect(() =>
      defineField({
        appFieldKey: 'raw',
        targetEntity: 'contact',
        scope: 'connection',
        name: 'Raw payload',
        type: 'JSON',
        identity: true,
      })
    ).toThrow(/identity/i)
  })

  it('validates every field in defineFields, not just the first', () => {
    expect(() =>
      defineFields([
        {
          appFieldKey: 'customerId',
          targetEntity: 'contact',
          scope: 'connection',
          name: 'Shopify customer ID',
          type: 'TEXT',
          identity: true,
        },
        {
          appFieldKey: 'tags',
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
