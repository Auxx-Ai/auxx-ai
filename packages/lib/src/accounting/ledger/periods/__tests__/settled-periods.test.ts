// packages/lib/src/accounting/ledger/periods/__tests__/settled-periods.test.ts
//
// `isFrozenSetupSettingKey` is the whole of the setup freeze's key vocabulary:
// `setting.update`, `setting.batchUpdate` and `saveOpeningTrialBalance` all
// refuse through `assertAccountingSetupUnfrozen`, which filters on this. A key
// missing from it is not a smaller freeze - it is an unguarded door onto the
// baseline every posted entry was computed against.

import { describe, expect, it } from 'vitest'
import { SETUP_READINESS_SETTING_KEYS } from '../../setup/setup-readiness'
import { FROZEN_SETUP_SETTING_KEYS, isFrozenSetupSettingKey } from '../settled-periods'

describe('isFrozenSetupSettingKey', () => {
  it('freezes every accounting.opening* key, by prefix', () => {
    for (const key of SETUP_READINESS_SETTING_KEYS) {
      if (!key.startsWith('accounting.opening')) continue
      expect(isFrozenSetupSettingKey(key)).toBe(true)
    }
    expect(isFrozenSetupSettingKey('accounting.openingSource')).toBe(true)
    // Including the one that is not a catalog key at all - the trial balance's
    // own freeze token.
    expect(isFrozenSetupSettingKey('accounting.openingTrialBalance')).toBe(true)
  })

  it('exempts the in-books answer, which is given after finalize (111 Q19)', () => {
    expect(isFrozenSetupSettingKey('accounting.openingInventoryInBooks')).toBe(false)
    expect(
      FROZEN_SETUP_SETTING_KEYS.except.every((key) => key.startsWith('accounting.opening'))
    ).toBe(true)
  })

  it('freezes the two keys that define the period keyspace', () => {
    expect(isFrozenSetupSettingKey('accounting.bookTimeZone')).toBe(true)
    expect(isFrozenSetupSettingKey('accounting.cutoffPeriod')).toBe(true)
  })

  it('leaves unrelated settings alone', () => {
    expect(isFrozenSetupSettingKey('accounting.autoSend.receipt')).toBe(false)
    expect(isFrozenSetupSettingKey('manufacturing.autoRollFirstStandard')).toBe(false)
    expect(isFrozenSetupSettingKey('organization.currency')).toBe(false)
    // Near misses, both directions.
    expect(isFrozenSetupSettingKey('accounting.opening')).toBe(true)
    expect(isFrozenSetupSettingKey('accounting.bookTimeZones')).toBe(false)
  })

  it('declares no duplicate exact key, and no exact key the prefix already covers', () => {
    const exact = [...FROZEN_SETUP_SETTING_KEYS.exact]
    expect(new Set(exact).size).toBe(exact.length)
    for (const key of exact) {
      expect(key.startsWith(FROZEN_SETUP_SETTING_KEYS.prefix)).toBe(false)
    }
  })
})
