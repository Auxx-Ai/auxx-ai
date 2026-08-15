// packages/lib/src/utils/rate-limiter/__tests__/quota.test.ts

import { IntegrationProviderType } from '@auxx/database/enums'
import { describe, expect, it } from 'vitest'
import { ENHANCED_PROVIDER_LIMITS } from '../provider-configs'
import {
  connectionQuota,
  DEFAULT_BURST_MS,
  DEFAULT_CONNECTION_RPS,
  DEFAULT_RPS,
  hashScopeId,
  quotaCursorKey,
  resolveQuota,
} from '../quota'

describe('hashScopeId', () => {
  it('is stable and never leaks the secret', () => {
    const secret = 'op_live_abcdef0123456789'
    const hashed = hashScopeId(secret)

    expect(hashed).toBe(hashScopeId(secret))
    expect(hashed).toHaveLength(16)
    expect(hashed).toMatch(/^[0-9a-f]{16}$/)
    expect(hashed).not.toContain(secret.slice(0, 8))
  })

  it('separates different secrets', () => {
    expect(hashScopeId('a')).not.toBe(hashScopeId('b'))
  })
})

describe('resolveQuota', () => {
  it('reads the rate from provider-configs — the file is load-bearing, not decorative', () => {
    const declared = ENHANCED_PROVIDER_LIMITS[IntegrationProviderType.openphone]?.requestsPerSecond
    const quota = resolveQuota(IntegrationProviderType.openphone, 'apiKey', 'abc')

    expect(declared).toBeDefined()
    expect(quota.rps).toBe(declared)
    expect(quota.burstMs).toBe(DEFAULT_BURST_MS)
  })

  it('keeps Quo at the documented headroom value', () => {
    // The plan's DoD: api.ts carries no rate constant, and this is the single source.
    expect(resolveQuota(IntegrationProviderType.openphone, 'apiKey', 'x').rps).toBe(8)
  })

  it('falls back conservatively for a provider with no declared rate', () => {
    const quota = resolveQuota(IntegrationProviderType.outlook, 'account', 'mbx')
    expect(quota.rps).toBe(DEFAULT_RPS)
  })

  it('honors explicit overrides', () => {
    const quota = resolveQuota(IntegrationProviderType.shopify, 'shop', 'acme.myshopify.com', {
      rps: 4,
      burstMs: 1_000,
    })
    expect(quota).toMatchObject({ rps: 4, burstMs: 1_000, scope: 'shop' })
  })
})

describe('quotaCursorKey', () => {
  it('partitions on provider + scope + scopeId', () => {
    const a = resolveQuota(IntegrationProviderType.openphone, 'apiKey', 'one')
    const b = resolveQuota(IntegrationProviderType.openphone, 'apiKey', 'two')
    const c = resolveQuota(IntegrationProviderType.shopify, 'shop', 'one')

    expect(quotaCursorKey(a)).toBe('pace:openphone:apiKey:one')
    expect(new Set([quotaCursorKey(a), quotaCursorKey(b), quotaCursorKey(c)]).size).toBe(3)
  })

  it('gives two callers on the same metered identity the SAME key', () => {
    const key = 'op_live_shared'
    const fromChannelA = resolveQuota(IntegrationProviderType.openphone, 'apiKey', hashScopeId(key))
    const fromChannelB = resolveQuota(IntegrationProviderType.openphone, 'apiKey', hashScopeId(key))

    expect(quotaCursorKey(fromChannelA)).toBe(quotaCursorKey(fromChannelB))
  })
})

describe('connectionQuota', () => {
  it('defaults to the connection rate and its own namespace', () => {
    const quota = connectionQuota('conn_1')
    expect(quota).toEqual({
      provider: 'connection',
      scope: 'connection',
      scopeId: 'conn_1',
      rps: DEFAULT_CONNECTION_RPS,
      burstMs: DEFAULT_BURST_MS,
    })
    expect(quotaCursorKey(quota)).toBe('pace:connection:connection:conn_1')
  })
})
