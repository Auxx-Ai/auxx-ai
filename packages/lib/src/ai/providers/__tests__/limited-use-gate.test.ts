// packages/lib/src/ai/providers/__tests__/limited-use-gate.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Google Workspace Limited Use gate — see `plans/google-limited-use-provider-gate.md`.
 *
 * The gate bars AI providers whose terms permit training on submitted data from any org
 * with a connected Google account, because ticket bodies and calendar/spreadsheet content
 * reaching a model are Workspace-derived data.
 *
 * The fail-closed cases below are the ones that matter most: when they regress, nothing
 * visibly breaks — the gate just silently stops applying.
 */

const hasAccess = vi.fn()
const cacheGet = vi.fn()

vi.mock('../../../cache/singletons', () => ({
  getOrgCache: () => ({ get: cacheGet }),
}))

vi.mock('../../../permissions/feature-permission-service', () => ({
  FeaturePermissionService: class {
    hasAccess = hasAccess
  },
}))

const { assertProviderAllowed, isOrgLimitedUseGated } = await import('../config/limited-use')
const { LIMITED_USE_SAFE_PROVIDERS, isProviderLimitedUseBlocked } = await import(
  '../config/context'
)

const ORG = 'org_1'
const googleChannel = [{ provider: 'google' }]
const outlookOnly = [{ provider: 'outlook' }]

beforeEach(() => {
  vi.clearAllMocks()
  hasAccess.mockResolvedValue(false)
  cacheGet.mockResolvedValue(googleChannel)
})

describe('isOrgLimitedUseGated', () => {
  it('gates an org with a connected Google channel', async () => {
    await expect(isOrgLimitedUseGated(ORG)).resolves.toBe(true)
  })

  it('does not gate an org with no Google channel', async () => {
    cacheGet.mockResolvedValue(outlookOnly)
    await expect(isOrgLimitedUseGated(ORG)).resolves.toBe(false)
  })

  it('does not gate an org with no channels at all', async () => {
    cacheGet.mockResolvedValue([])
    await expect(isOrgLimitedUseGated(ORG)).resolves.toBe(false)
  })

  it('un-gates when unrestrictedAiProviders is explicitly granted', async () => {
    hasAccess.mockResolvedValue(true)
    await expect(isOrgLimitedUseGated(ORG)).resolves.toBe(false)
  })

  // The `channels` cache provider filters soft-deleted rows, so a disconnected Google
  // channel must not leave the org gated forever.
  it('un-gates once the Google channel is disconnected', async () => {
    cacheGet.mockResolvedValue([])
    await expect(isOrgLimitedUseGated(ORG)).resolves.toBe(false)
  })

  describe('fails closed', () => {
    it('gates when the channels read throws', async () => {
      cacheGet.mockRejectedValue(new Error('redis down'))
      await expect(isOrgLimitedUseGated(ORG)).resolves.toBe(true)
    })

    it('gates when the feature read throws', async () => {
      hasAccess.mockRejectedValue(new Error('plan lookup failed'))
      await expect(isOrgLimitedUseGated(ORG)).resolves.toBe(true)
    })

    // A plan row predating this release has no `unrestrictedAiProviders` key at all.
    // `hasAccess` reads a missing boolean gate as false, which must leave the org GATED.
    it('gates when the feature key is absent from the plan', async () => {
      hasAccess.mockResolvedValue(false)
      await expect(isOrgLimitedUseGated(ORG)).resolves.toBe(true)
    })
  })
})

describe('assertProviderAllowed', () => {
  it.each([...LIMITED_USE_SAFE_PROVIDERS])('allows %s on a gated org', async (provider) => {
    await expect(assertProviderAllowed(provider, ORG)).resolves.toBeUndefined()
  })

  it.each([
    'deepseek',
    'qwen',
    'kimi',
    'zai',
    'grok',
  ])('blocks %s on a gated org', async (provider) => {
    await expect(assertProviderAllowed(provider, ORG)).rejects.toMatchObject({
      code: 'LIMITED_USE_BLOCKED',
    })
  })

  it.each([
    'deepseek',
    'qwen',
    'kimi',
    'zai',
    'grok',
  ])('allows %s on an org with no Google channel', async (provider) => {
    cacheGet.mockResolvedValue(outlookOnly)
    await expect(assertProviderAllowed(provider, ORG)).resolves.toBeUndefined()
  })

  it('allows a blocked provider once unrestrictedAiProviders is granted', async () => {
    hasAccess.mockResolvedValue(true)
    await expect(assertProviderAllowed('deepseek', ORG)).resolves.toBeUndefined()
  })
})

describe('isProviderLimitedUseBlocked', () => {
  it('blocks nothing when the org is not gated', () => {
    expect(isProviderLimitedUseBlocked('deepseek', false)).toBe(false)
  })

  it('blocks a non-allowlisted provider when gated', () => {
    expect(isProviderLimitedUseBlocked('deepseek', true)).toBe(true)
  })

  it('never blocks an allowlisted provider', () => {
    expect(isProviderLimitedUseBlocked('anthropic', true)).toBe(false)
  })
})
