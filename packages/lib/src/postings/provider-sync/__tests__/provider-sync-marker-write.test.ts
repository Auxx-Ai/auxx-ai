// packages/lib/src/postings/provider-sync/__tests__/provider-sync-marker-write.test.ts
//
// The one door onto `accounting.providerSyncedThrough`.
//
// ⚠️ The cache bust lives in `updateOrganizationSetting` now, so it is not
// observable here - this file mocks that function. What still matters on THIS
// key is that the write is not skipped and carries the day value verbatim: a
// stale marker means every statement keeps claiming a completeness it does not
// have, the failure §7.3 exists to prevent.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UnprocessableEntityError } from '../../../errors'
import { PROVIDER_SYNCED_THROUGH_SETTING_KEY } from '../client'
import { recordProviderSyncedThrough } from '../marker-writes'

const updateOrganizationSetting = vi.hoisted(() => vi.fn())

vi.mock('../../../settings/settings-service', () => ({ updateOrganizationSetting }))

const ORG = 'org_1'

beforeEach(() => {
  vi.clearAllMocks()
  updateOrganizationSetting.mockResolvedValue(undefined)
})

describe('recordProviderSyncedThrough', () => {
  it('writes the catalog key, and does not opt out of the cache bust', async () => {
    const result = await recordProviderSyncedThrough(ORG, '2026-11-30')

    expect(result.isOk()).toBe(true)
    expect(updateOrganizationSetting).toHaveBeenCalledWith({
      organizationId: ORG,
      key: PROVIDER_SYNCED_THROUGH_SETTING_KEY,
      value: '2026-11-30',
    })
    // 🛑 No `skipCacheInvalidation`. The browser's settings store hydrates from
    // the per-user `userSettings` cache, so an un-busted write leaves a full
    // reload rendering the previous marker. Brief 19's fill path learned it by
    // driving; the opt-out exists for per-slice writers, never for this key.
    expect(updateOrganizationSetting.mock.calls[0]![0]).not.toHaveProperty('skipCacheInvalidation')
  })

  it('refuses anything that is not a YYYY-MM-DD day, and writes nothing', async () => {
    // The statement pages compare this against their own end date with a plain
    // string compare. A month key would compare as "behind everything" forever,
    // with nothing on any page able to say why.
    for (const bad of ['2026-11', '30/11/2026', '', 'never']) {
      const result = await recordProviderSyncedThrough(ORG, bad)
      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(UnprocessableEntityError)
    }
    expect(updateOrganizationSetting).not.toHaveBeenCalled()
  })
})
