// packages/services/src/app-connections/__tests__/granted-scopes.test.ts

import { describe, expect, it, vi } from 'vitest'

const listCredentials = vi.fn()

vi.mock('@auxx/credentials/store', () => ({
  listCredentials: (...args: unknown[]) => listCredentials(...args),
}))

vi.mock('@auxx/database', () => ({
  database: {},
  schema: { App: { id: 'id', title: 'title' } },
}))

import { listAppConnections, parseGrantedScopes } from '../list-app-connections'

/** A credential row shaped like `listCredentials` returns it, with no appId so the App
 *  title lookup is skipped entirely (`appIds.length === 0`). */
function credential(metadata: Record<string, unknown>) {
  return {
    id: 'cred_1',
    appId: null,
    appInstallationId: null,
    label: null,
    consecutiveRefreshFailures: 0,
    expiresAt: null,
    lastRefreshError: null,
    lastRefreshFailureAt: null,
    createdByName: null,
    createdAt: new Date('2026-01-01'),
    userId: null,
    connectionDefinitionId: 'cd_1',
    isDefault: false,
    metadata,
  }
}

describe('parseGrantedScopes', () => {
  it('splits a comma-separated Shopify-style scope string', () => {
    expect(parseGrantedScopes('read_orders,write_orders,read_all_orders')).toEqual([
      'read_orders',
      'write_orders',
      'read_all_orders',
    ])
  })

  it('splits a space-separated RFC 6749 scope string', () => {
    expect(parseGrantedScopes('openid email profile')).toEqual(['openid', 'email', 'profile'])
  })

  it('tolerates mixed separators and repeated whitespace', () => {
    expect(parseGrantedScopes('a, b   c,,d')).toEqual(['a', 'b', 'c', 'd'])
  })

  it('returns [] for empty, absent and non-string values', () => {
    expect(parseGrantedScopes('')).toEqual([])
    expect(parseGrantedScopes(undefined)).toEqual([])
    expect(parseGrantedScopes(null)).toEqual([])
    expect(parseGrantedScopes(['read_orders'])).toEqual([])
  })
})

describe('listAppConnections grantedScopes', () => {
  it('exposes the granted scope from a comma-separated stored value', async () => {
    listCredentials.mockResolvedValue({
      isErr: () => false,
      value: [credential({ scope: 'read_orders,read_all_orders' })],
    })

    const result = await listAppConnections('org_1')

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()[0]?.grantedScopes).toEqual(['read_orders', 'read_all_orders'])
  })

  it('exposes the granted scope from a space-separated stored value', async () => {
    listCredentials.mockResolvedValue({
      isErr: () => false,
      value: [credential({ scope: 'openid https://www.googleapis.com/auth/calendar' })],
    })

    const result = await listAppConnections('org_1')

    expect(result._unsafeUnwrap()[0]?.grantedScopes).toEqual([
      'openid',
      'https://www.googleapis.com/auth/calendar',
    ])
  })

  it('returns [] when no scope is stored, never null or undefined', async () => {
    listCredentials.mockResolvedValue({
      isErr: () => false,
      value: [credential({ connectionVariables: { shop: 'auxx-lift' } })],
    })

    const result = await listAppConnections('org_1')

    expect(result._unsafeUnwrap()[0]?.grantedScopes).toEqual([])
  })
})
