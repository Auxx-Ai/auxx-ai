// packages/sdk/src/shared/__tests__/scopes.test.ts

import { describe, expect, it, vi } from 'vitest'
import { parseScopeString, resolveCapabilities } from '../scopes'

const GRANTS = {
  read_orders: ['orders:read'],
  write_orders: ['orders:read', 'orders:write'],
  read_all_orders: ['orders:history-full'],
  read_merchant_managed_fulfillment_orders: ['fulfillment:read'],
  read_assigned_fulfillment_orders: ['fulfillment:read'],
} as const

describe('parseScopeString', () => {
  it('accepts both space and comma delimiters', () => {
    expect(parseScopeString('a b')).toEqual(['a', 'b'])
    expect(parseScopeString('a,b')).toEqual(['a', 'b'])
    expect(parseScopeString('a, b   c')).toEqual(['a', 'b', 'c'])
  })

  it('yields nothing for empty input', () => {
    expect(parseScopeString('')).toEqual([])
    expect(parseScopeString(undefined)).toEqual([])
    expect(parseScopeString(null)).toEqual([])
  })
})

describe('resolveCapabilities', () => {
  it('unions the capabilities of every granted scope', () => {
    const caps = resolveCapabilities(GRANTS, 'read_orders read_all_orders')
    expect([...caps].sort()).toEqual(['orders:history-full', 'orders:read'])
  })

  it('needs no implication rule: a write scope grants its read capability directly', () => {
    // The point of the scope->capability direction. `write_orders` alone must satisfy a
    // read check, with no prefix manipulation anywhere.
    const caps = resolveCapabilities(GRANTS, 'write_orders')
    expect(caps.has('orders:read')).toBe(true)
    expect(caps.has('orders:write')).toBe(true)
  })

  it('needs no any-of rule: two scopes granting the same capability is the or-condition', () => {
    for (const scope of [
      'read_merchant_managed_fulfillment_orders',
      'read_assigned_fulfillment_orders',
    ]) {
      expect(resolveCapabilities(GRANTS, scope).has('fulfillment:read')).toBe(true)
    }
  })

  it('accepts an already-split list as well as a raw string', () => {
    expect([...resolveCapabilities(GRANTS, ['write_orders'])].sort()).toEqual([
      'orders:read',
      'orders:write',
    ])
  })

  it('reports an unknown scope instead of failing silently', () => {
    const onUnknownScope = vi.fn()
    const caps = resolveCapabilities(GRANTS, 'read_orders read_invented', onUnknownScope)
    expect(onUnknownScope).toHaveBeenCalledExactlyOnceWith('read_invented')
    expect([...caps]).toEqual(['orders:read'])
  })

  it('yields nothing for an absent grant', () => {
    expect(resolveCapabilities(GRANTS, undefined).size).toBe(0)
    expect(resolveCapabilities(GRANTS, '').size).toBe(0)
  })
})
