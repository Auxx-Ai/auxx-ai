// packages/lib/src/ai/mcp/connections/__tests__/ensure-fresh-mcp-token.test.ts
//
// Redis and the (lazily imported) oauth2-workflow are mocked wholesale; the tests assert the
// skip/refresh/lock decisions and the adaptive expiry skew.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const refreshCalls: { credentialId: string; organizationId: string }[] = []
const redisState = {
  available: true,
  /** Lock value returned by `set NX` — null simulates "already held". */
  setResult: 'OK' as string | null,
  /** Values returned by successive `get` polls on the lock key. */
  getResults: [] as (string | null)[],
  setCalls: [] as unknown[][],
  delCalls: [] as string[],
}

vi.mock('@auxx/redis', () => ({
  getRedisClient: async () => {
    if (!redisState.available) return undefined
    return {
      set: async (...args: unknown[]) => {
        redisState.setCalls.push(args)
        return redisState.setResult
      },
      get: async () => redisState.getResults.shift() ?? null,
      del: async (key: string) => {
        redisState.delCalls.push(key)
        return 1
      },
    }
  },
}))

vi.mock('../../../../workflows/oauth2-workflow', () => ({
  refreshCredentialTokens: async (credentialId: string, organizationId: string) => {
    refreshCalls.push({ credentialId, organizationId })
    return { success: true, expiresAt: new Date(Date.now() + 3600_000) }
  },
}))

import { ensureFreshMcpToken } from '../ensure-fresh-mcp-token'

const base = {
  credentialId: 'cred-1',
  organizationId: 'org-1',
  hasRefreshToken: true,
}

beforeEach(() => {
  refreshCalls.length = 0
  redisState.available = true
  redisState.setResult = 'OK'
  redisState.getResults = []
  redisState.setCalls = []
  redisState.delCalls = []
})

describe('ensureFreshMcpToken', () => {
  it('skips when there is no refresh token', async () => {
    const changed = await ensureFreshMcpToken({
      ...base,
      hasRefreshToken: false,
      expiresAt: new Date(Date.now() - 1000),
    })
    expect(changed).toBe(false)
    expect(refreshCalls).toHaveLength(0)
  })

  it('skips when no expiresAt is stored (401 path owns it)', async () => {
    const changed = await ensureFreshMcpToken({ ...base, expiresAt: null })
    expect(changed).toBe(false)
    expect(refreshCalls).toHaveLength(0)
  })

  it('skips when the token is comfortably fresh', async () => {
    const changed = await ensureFreshMcpToken({
      ...base,
      expiresAt: new Date(Date.now() + 3600_000),
      createdAt: new Date(),
    })
    expect(changed).toBe(false)
    expect(refreshCalls).toHaveLength(0)
  })

  it('refreshes an expired token and releases the lock', async () => {
    const changed = await ensureFreshMcpToken({
      ...base,
      expiresAt: new Date(Date.now() - 1000),
      createdAt: new Date(Date.now() - 3600_000),
    })
    expect(changed).toBe(true)
    expect(refreshCalls).toEqual([{ credentialId: 'cred-1', organizationId: 'org-1' }])
    expect(redisState.setCalls[0]?.[0]).toBe('mcp:token-refresh:cred-1')
    expect(redisState.delCalls).toEqual(['mcp:token-refresh:cred-1'])
  })

  it('refreshes a 1h token inside the 120s window', async () => {
    const changed = await ensureFreshMcpToken({
      ...base,
      expiresAt: new Date(Date.now() + 60_000),
      lastRefreshAt: new Date(Date.now() - 3540_000), // 1h lifetime → 120s skew applies
    })
    expect(changed).toBe(true)
    expect(refreshCalls).toHaveLength(1)
  })

  it('adapts the skew for short-lived tokens — a fresh 60s token is NOT "expiring"', async () => {
    const changed = await ensureFreshMcpToken({
      ...base,
      expiresAt: new Date(Date.now() + 50_000),
      lastRefreshAt: new Date(Date.now() - 10_000), // 60s lifetime → 15s skew, 50s left
    })
    expect(changed).toBe(false)
    expect(refreshCalls).toHaveLength(0)
  })

  it('force bypasses the expiry check entirely', async () => {
    const changed = await ensureFreshMcpToken({ ...base, force: true })
    expect(changed).toBe(true)
    expect(refreshCalls).toHaveLength(1)
  })

  it('waits out a held lock without refreshing, and reports a possible rotation', async () => {
    redisState.setResult = null // lock held elsewhere
    redisState.getResults = ['1', null] // released on the second poll
    const changed = await ensureFreshMcpToken({
      ...base,
      expiresAt: new Date(Date.now() - 1000),
      createdAt: new Date(Date.now() - 3600_000),
    })
    expect(changed).toBe(true)
    expect(refreshCalls).toHaveLength(0)
    expect(redisState.delCalls).toHaveLength(0)
  })

  it('still refreshes when Redis is unavailable', async () => {
    redisState.available = false
    const changed = await ensureFreshMcpToken({
      ...base,
      expiresAt: new Date(Date.now() - 1000),
      createdAt: new Date(Date.now() - 3600_000),
    })
    expect(changed).toBe(true)
    expect(refreshCalls).toHaveLength(1)
  })
})
