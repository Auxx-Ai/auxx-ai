// packages/lib/src/postings/provider-sync/__tests__/provider-sync-marker-write.test.ts
//
// The one door onto `accounting.providerSyncedThrough`.
//
// ⚠️ **`updateOrganizationSetting` does NOT invalidate the `orgSettings`
// cache** - its callers do (plans/accounting/HANDOFF §10.5). A writer that
// forgets leaves every server reading a stale snapshot, which for THIS key
// means every statement keeps rendering the old marker after a sync that moved
// it: a statement claiming a completeness it does not have, which is the exact
// failure §7.3 exists to prevent. So the event is asserted here rather than
// left to review.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UnprocessableEntityError } from '../../../errors'
import { PROVIDER_SYNCED_THROUGH_SETTING_KEY } from '../client'
import { recordProviderSyncedThrough } from '../marker-writes'

const updateOrganizationSetting = vi.hoisted(() => vi.fn())
const onCacheEvent = vi.hoisted(() => vi.fn())

vi.mock('../../../settings/settings-service', () => ({ updateOrganizationSetting }))
vi.mock('../../../cache/invalidate', () => ({ onCacheEvent }))

const ORG = 'org_1'

beforeEach(() => {
  vi.clearAllMocks()
  updateOrganizationSetting.mockResolvedValue(undefined)
  onCacheEvent.mockResolvedValue(undefined)
})

describe('recordProviderSyncedThrough', () => {
  it('writes the catalog key and busts the org settings cache', async () => {
    const result = await recordProviderSyncedThrough(ORG, '2026-11-30')

    expect(result.isOk()).toBe(true)
    expect(updateOrganizationSetting).toHaveBeenCalledWith({
      organizationId: ORG,
      key: PROVIDER_SYNCED_THROUGH_SETTING_KEY,
      value: '2026-11-30',
    })
    // `broadcastUserKeys: true` is load-bearing: the browser's settings store
    // hydrates from the per-user `userSettings` cache, which the
    // `org.settings.changed` edge reaches only when the event broadcasts to
    // user keys. Brief 19's fill path learned this by driving.
    expect(onCacheEvent).toHaveBeenCalledWith('org.settings.changed', {
      orgId: ORG,
      broadcastUserKeys: true,
    })
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
    expect(onCacheEvent).not.toHaveBeenCalled()
  })
})
