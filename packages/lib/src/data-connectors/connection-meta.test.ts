// packages/lib/src/data-connectors/connection-meta.test.ts

import { describe, expect, it } from 'vitest'
import { flattenConnectionMeta } from './connection-meta'

describe('flattenConnectionMeta', () => {
  it('hoists connectionVariables to the top level so `from: <var>` resolves', () => {
    const flat = flattenConnectionMeta({
      label: 'auxxai.myshopify.com',
      metadata: { scope: 'read_customers', connectionVariables: { shop: 'auxxai' } },
    })
    expect(flat.shop).toBe('auxxai')
  })

  it('exposes the connection label so `from: "label"` resolves (shop domain / email)', () => {
    const flat = flattenConnectionMeta({
      label: 'auxxai.myshopify.com',
      metadata: { connectionVariables: { shop: 'auxxai' } },
    })
    expect(flat.label).toBe('auxxai.myshopify.com')
  })

  it('keeps raw top-level metadata keys', () => {
    const flat = flattenConnectionMeta({
      label: null,
      metadata: { scope: 'read_customers', connectionVariables: {} },
    })
    expect(flat.scope).toBe('read_customers')
  })

  it('omits label when null (never writes a null label key)', () => {
    const flat = flattenConnectionMeta({ label: null, metadata: {} })
    expect('label' in flat).toBe(false)
  })

  it('lets a connection variable win over a same-named metadata key', () => {
    const flat = flattenConnectionMeta({
      label: null,
      metadata: { region: 'meta', connectionVariables: { region: 'var' } },
    })
    expect(flat.region).toBe('var')
  })

  it('tolerates missing connectionVariables', () => {
    const flat = flattenConnectionMeta({ label: 'x', metadata: { scope: 'a' } })
    expect(flat).toEqual({ scope: 'a', label: 'x' })
  })
})
