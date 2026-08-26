// packages/credentials/src/connections/__tests__/requested-scopes.test.ts

import { describe, expect, it } from 'vitest'
import { parseScopeAddParam, resolveRequestedScopes } from '../resolve-connection-definition'

describe('parseScopeAddParam', () => {
  it('accepts repeated params', () => {
    expect(parseScopeAddParam(['read_all_orders', 'read_customers'])).toEqual([
      'read_all_orders',
      'read_customers',
    ])
  })

  it('accepts a single comma-separated value', () => {
    expect(parseScopeAddParam(['read_all_orders,read_customers'])).toEqual([
      'read_all_orders',
      'read_customers',
    ])
  })

  it('accepts a single space-separated value', () => {
    expect(parseScopeAddParam(['read_all_orders read_customers'])).toEqual([
      'read_all_orders',
      'read_customers',
    ])
  })

  it('trims and drops empties from mixed separators', () => {
    expect(
      parseScopeAddParam(['read_all_orders, , read_customers', '  ', 'read_products'])
    ).toEqual(['read_all_orders', 'read_customers', 'read_products'])
  })

  it('treats a missing param as no picks', () => {
    expect(parseScopeAddParam(null)).toEqual([])
    expect(parseScopeAddParam(undefined)).toEqual([])
    expect(parseScopeAddParam([])).toEqual([])
  })
})

describe('resolveRequestedScopes', () => {
  it('returns the floor alone when the definition declares no optional scopes', () => {
    expect(
      resolveRequestedScopes(
        { oauth2Scopes: ['read_orders', 'write_orders'], oauth2OptionalScopes: [] },
        ['read_all_orders']
      )
    ).toEqual(['read_orders', 'write_orders'])
  })

  it('adds a picked scope the definition declares optional', () => {
    expect(
      resolveRequestedScopes(
        { oauth2Scopes: ['read_orders'], oauth2OptionalScopes: ['read_all_orders'] },
        ['read_all_orders']
      )
    ).toEqual(['read_orders', 'read_all_orders'])
  })

  it('never requests an optional scope nobody picked', () => {
    expect(
      resolveRequestedScopes(
        { oauth2Scopes: ['read_orders'], oauth2OptionalScopes: ['read_all_orders'] },
        []
      )
    ).toEqual(['read_orders'])
  })

  it('drops an undeclared scope silently rather than throwing', () => {
    // `scope_add` is a URL param anyone can craft — the picker is a hint, never the authority.
    // A stale bookmark must degrade to the floor, not 500 mid-connect.
    expect(
      resolveRequestedScopes(
        { oauth2Scopes: ['read_orders'], oauth2OptionalScopes: ['read_all_orders'] },
        ['write_customers', 'read_all_orders']
      )
    ).toEqual(['read_orders', 'read_all_orders'])
  })

  it('does not duplicate a pick that is already in the floor', () => {
    expect(
      resolveRequestedScopes(
        { oauth2Scopes: ['read_orders', 'write_orders'], oauth2OptionalScopes: ['read_orders'] },
        ['read_orders']
      )
    ).toEqual(['read_orders', 'write_orders'])
  })

  it('dedupes repeated picks and keeps the floor first', () => {
    expect(
      resolveRequestedScopes(
        { oauth2Scopes: ['read_orders'], oauth2OptionalScopes: ['read_all_orders'] },
        ['read_all_orders', 'read_all_orders']
      )
    ).toEqual(['read_orders', 'read_all_orders'])
  })

  it('treats null/undefined columns as empty lists', () => {
    expect(
      resolveRequestedScopes({ oauth2Scopes: null, oauth2OptionalScopes: null }, ['x'])
    ).toEqual([])
    expect(
      resolveRequestedScopes({ oauth2Scopes: undefined, oauth2OptionalScopes: undefined }, [])
    ).toEqual([])
    expect(
      resolveRequestedScopes({ oauth2Scopes: ['read_orders'], oauth2OptionalScopes: null }, [
        'read_all_orders',
      ])
    ).toEqual(['read_orders'])
    expect(
      resolveRequestedScopes({ oauth2Scopes: null, oauth2OptionalScopes: ['read_all_orders'] }, [
        'read_all_orders',
      ])
    ).toEqual(['read_all_orders'])
  })

  it('composes with the parser end to end', () => {
    const def = {
      oauth2Scopes: ['read_orders'],
      oauth2OptionalScopes: ['read_all_orders', 'read_customers'],
    }
    const picked = parseScopeAddParam(['read_all_orders,write_products', 'read_customers'])
    expect(resolveRequestedScopes(def, picked)).toEqual([
      'read_orders',
      'read_all_orders',
      'read_customers',
    ])
  })
})
