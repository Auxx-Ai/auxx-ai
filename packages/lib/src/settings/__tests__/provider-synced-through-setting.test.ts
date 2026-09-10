// packages/lib/src/settings/__tests__/provider-synced-through-setting.test.ts
//
// `accounting.providerSyncedThrough` (task 20 §7.3), and the one fact about it
// that is easy to get wrong by accident.
//
// 🛑 **It must NOT be frozen.** `FROZEN_SETUP_SETTING_KEYS` refuses a write to
// any `accounting.opening*` key, plus five named ones, once the org holds a
// `GlPosting` - correctly, because every posted entry was computed from those.
// This key is the other way round: it is computed FROM the ledger, it changes
// on every sync forever, and it only ever moves on an org that by definition
// holds postings. Freezing it would stop the very first sync after the very
// first entry and leave the marker permanently stale, which is the failure it
// exists to prevent. Nothing in the freeze list catches it today; this test is
// what notices if a future prefix does.

import { describe, expect, it } from 'vitest'
import { PROVIDER_SYNCED_THROUGH_SETTING_KEY } from '../../postings/provider-sync/client'
import { isFrozenSetupSettingKey } from '../../postings/settled-periods'
import { SETTINGS_CATALOG } from '../catalog'
import { normalizeSettingValue } from '../normalize-setting-value'

const KEY = PROVIDER_SYNCED_THROUGH_SETTING_KEY
const config = SETTINGS_CATALOG[KEY]

describe('accounting.providerSyncedThrough', () => {
  it('is an org-scoped TEXT key that starts unset', () => {
    expect(config.fieldType).toBe('TEXT')
    expect(config.scope).toBe('GENERAL')
    expect(config.access).toBe('org')
    // Null is "nothing has ever been read", which is a different statement from
    // "this run read nothing new".
    expect(config.defaultValue).toBeNull()
  })

  it('🛑 is NOT caught by the frozen setup keys', () => {
    expect(isFrozenSetupSettingKey(KEY)).toBe(false)
    // And the reason, stated so a rename cannot make it pass by accident: it
    // does not begin with the frozen prefix.
    expect(KEY.startsWith('accounting.opening')).toBe(false)
  })

  it('round-trips a day key through the write path', () => {
    expect(normalizeSettingValue(KEY, config, '2026-11-30')).toBe('2026-11-30')
  })
})
