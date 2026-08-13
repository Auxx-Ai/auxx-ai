// packages/credentials/src/connections/__tests__/ensure-fresh-credential-token.test.ts
//
// The lock provider is injected (a fake, here) and the lazily imported oauth2-token-grants is
// mocked wholesale; the tests assert the skip/refresh/lock decisions and the adaptive expiry skew.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CredentialLockProvider } from '../ensure-fresh-credential-token'

const refreshCalls: { credentialId: string; organizationId: string }[] = []
const mintCalls: { credentialId: string; organizationId: string }[] = []
const lockState = {
  /** When true every method rejects — simulates Redis being unreachable. */
  unavailable: false,
  /** Result of `acquire` — false simulates "already held". */
  acquireResult: true,
  /** Values returned by successive `isHeld` polls. */
  isHeldResults: [] as boolean[],
  acquireCalls: [] as { key: string; ttlSeconds: number }[],
  releaseCalls: [] as string[],
}

const lock: CredentialLockProvider = {
  async acquire(key, ttlSeconds) {
    if (lockState.unavailable) throw new Error('Redis unavailable')
    lockState.acquireCalls.push({ key, ttlSeconds })
    return lockState.acquireResult
  },
  async isHeld() {
    if (lockState.unavailable) throw new Error('Redis unavailable')
    return lockState.isHeldResults.shift() ?? false
  },
  async release(key) {
    if (lockState.unavailable) throw new Error('Redis unavailable')
    lockState.releaseCalls.push(key)
  },
}

vi.mock('../oauth2-token-grants', () => ({
  refreshCredentialTokens: async (credentialId: string, organizationId: string) => {
    refreshCalls.push({ credentialId, organizationId })
    return { success: true, expiresAt: new Date(Date.now() + 3600_000) }
  },
  mintClientCredentialToken: async (credentialId: string, organizationId: string) => {
    mintCalls.push({ credentialId, organizationId })
    return { success: true, expiresAt: new Date(Date.now() + 3600_000) }
  },
}))

import { ensureFreshCredentialToken } from '../ensure-fresh-credential-token'

const base = {
  credentialId: 'cred-1',
  organizationId: 'org-1',
  hasRefreshToken: true,
  lock,
}

beforeEach(() => {
  refreshCalls.length = 0
  mintCalls.length = 0
  lockState.unavailable = false
  lockState.acquireResult = true
  lockState.isHeldResults = []
  lockState.acquireCalls = []
  lockState.releaseCalls = []
})

describe('ensureFreshCredentialToken', () => {
  it('skips when there is no refresh token', async () => {
    const changed = await ensureFreshCredentialToken({
      ...base,
      hasRefreshToken: false,
      expiresAt: new Date(Date.now() - 1000),
    })
    expect(changed).toBe(false)
    expect(refreshCalls).toHaveLength(0)
  })

  it('skips when no expiresAt is stored (401 path owns it)', async () => {
    const changed = await ensureFreshCredentialToken({ ...base, expiresAt: null })
    expect(changed).toBe(false)
    expect(refreshCalls).toHaveLength(0)
  })

  it('skips when the token is comfortably fresh', async () => {
    const changed = await ensureFreshCredentialToken({
      ...base,
      expiresAt: new Date(Date.now() + 3600_000),
      createdAt: new Date(),
    })
    expect(changed).toBe(false)
    expect(refreshCalls).toHaveLength(0)
  })

  it('refreshes an expired token and releases the lock', async () => {
    const changed = await ensureFreshCredentialToken({
      ...base,
      expiresAt: new Date(Date.now() - 1000),
      createdAt: new Date(Date.now() - 3600_000),
    })
    expect(changed).toBe(true)
    expect(refreshCalls).toEqual([{ credentialId: 'cred-1', organizationId: 'org-1' }])
    expect(lockState.acquireCalls[0]?.key).toBe('credential:token-refresh:cred-1')
    expect(lockState.releaseCalls).toEqual(['credential:token-refresh:cred-1'])
  })

  it('refreshes a 1h token inside the 120s window', async () => {
    const changed = await ensureFreshCredentialToken({
      ...base,
      expiresAt: new Date(Date.now() + 60_000),
      lastRefreshAt: new Date(Date.now() - 3540_000), // 1h lifetime → 120s skew applies
    })
    expect(changed).toBe(true)
    expect(refreshCalls).toHaveLength(1)
  })

  it('adapts the skew for short-lived tokens — a fresh 60s token is NOT "expiring"', async () => {
    const changed = await ensureFreshCredentialToken({
      ...base,
      expiresAt: new Date(Date.now() + 50_000),
      lastRefreshAt: new Date(Date.now() - 10_000), // 60s lifetime → 15s skew, 50s left
    })
    expect(changed).toBe(false)
    expect(refreshCalls).toHaveLength(0)
  })

  it('force bypasses the expiry check entirely', async () => {
    const changed = await ensureFreshCredentialToken({ ...base, force: true })
    expect(changed).toBe(true)
    expect(refreshCalls).toHaveLength(1)
  })

  it('waits out a held lock without refreshing, and reports a possible rotation', async () => {
    lockState.acquireResult = false // lock held elsewhere
    lockState.isHeldResults = [true, false] // released on the second poll
    const changed = await ensureFreshCredentialToken({
      ...base,
      expiresAt: new Date(Date.now() - 1000),
      createdAt: new Date(Date.now() - 3600_000),
    })
    expect(changed).toBe(true)
    expect(refreshCalls).toHaveLength(0)
    expect(lockState.releaseCalls).toHaveLength(0)
  })

  it('still refreshes when the lock provider is unavailable', async () => {
    lockState.unavailable = true
    const changed = await ensureFreshCredentialToken({
      ...base,
      expiresAt: new Date(Date.now() - 1000),
      createdAt: new Date(Date.now() - 3600_000),
    })
    expect(changed).toBe(true)
    expect(refreshCalls).toHaveLength(1)
  })

  it('still refreshes when no lock provider is supplied at all', async () => {
    const changed = await ensureFreshCredentialToken({
      ...base,
      lock: undefined,
      expiresAt: new Date(Date.now() - 1000),
      createdAt: new Date(Date.now() - 3600_000),
    })
    expect(changed).toBe(true)
    expect(refreshCalls).toHaveLength(1)
  })

  describe('client-credentials grant', () => {
    const cc = { ...base, hasRefreshToken: false, grant: 'client-credentials' as const }

    it('mints when no token has been minted yet (!expiresAt)', async () => {
      const changed = await ensureFreshCredentialToken({ ...cc, expiresAt: null })
      expect(changed).toBe(true)
      expect(mintCalls).toEqual([{ credentialId: 'cred-1', organizationId: 'org-1' }])
      expect(refreshCalls).toHaveLength(0)
    })

    it('mints when the token is near expiry', async () => {
      const changed = await ensureFreshCredentialToken({
        ...cc,
        expiresAt: new Date(Date.now() + 60_000),
        lastRefreshAt: new Date(Date.now() - 3540_000), // 1h lifetime → 120s skew applies
      })
      expect(changed).toBe(true)
      expect(mintCalls).toHaveLength(1)
    })

    it('does not mint a comfortably fresh token', async () => {
      const changed = await ensureFreshCredentialToken({
        ...cc,
        expiresAt: new Date(Date.now() + 3600_000),
        createdAt: new Date(),
      })
      expect(changed).toBe(false)
      expect(mintCalls).toHaveLength(0)
    })

    it('reports a possible rotation under lock contention without minting', async () => {
      lockState.acquireResult = false // lock held elsewhere
      lockState.isHeldResults = [true, false]
      const changed = await ensureFreshCredentialToken({ ...cc, expiresAt: null })
      expect(changed).toBe(true)
      expect(mintCalls).toHaveLength(0)
    })
  })
})
