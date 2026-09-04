// packages/lib/src/postings/__tests__/settled-periods.test.ts
//
// `isFrozenSetupSettingKey` is the whole of the setup freeze's key vocabulary:
// `setting.update`, `setting.batchUpdate` and `saveOpeningTrialBalance` all
// refuse through `assertAccountingSetupUnfrozen`, which filters on this. A key
// missing from it is not a smaller freeze - it is an unguarded door onto the
// baseline every posted entry was computed against.

import { describe, expect, it } from 'vitest'
import { FROZEN_SETUP_SETTING_KEYS, isFrozenSetupSettingKey } from '../settled-periods'
import { OPENING_BASELINE_SETTING_KEYS, SETUP_READINESS_SETTING_KEYS } from '../setup-readiness'

describe('isFrozenSetupSettingKey', () => {
  it('freezes every accounting.opening* key, by prefix', () => {
    for (const key of Object.values(OPENING_BASELINE_SETTING_KEYS)) {
      if (!key.startsWith('accounting.opening')) continue
      expect(isFrozenSetupSettingKey(key)).toBe(true)
    }
    // Including the one that is not a catalog key at all - the trial balance's
    // own freeze token.
    expect(isFrozenSetupSettingKey('accounting.openingTrialBalance')).toBe(true)
  })

  it('freezes the two keys that define the period keyspace', () => {
    expect(isFrozenSetupSettingKey('accounting.bookTimeZone')).toBe(true)
    expect(isFrozenSetupSettingKey('accounting.cutoffPeriod')).toBe(true)
  })

  it('freezes the three qboOpening* keys, which the prefix does NOT reach', () => {
    // 🛑 The other half of every readiness comparison. `openingDifference` and
    // the reconciliation panel put `accounting.opening<X>` beside
    // `accounting.qboOpening<X>`; freezing one side and leaving the other
    // editable means a settled cutover can be made to reconcile after the fact
    // by rewriting the unguarded half.
    expect(isFrozenSetupSettingKey('accounting.qboOpeningRawMaterials')).toBe(true)
    expect(isFrozenSetupSettingKey('accounting.qboOpeningWip')).toBe(true)
    expect(isFrozenSetupSettingKey('accounting.qboOpeningFinishedGoods')).toBe(true)
  })

  it('freezes BOTH halves of every AMOUNT pair the readiness check compares', () => {
    // Derived rather than restated, so a fourth inventory pair added to the
    // baseline keys fails here until its QuickBooks twin is frozen too. The
    // twin's name is the auxx key with `opening` -> `qboOpening`, which is the
    // convention `openingDifference` pairs them on.
    const auxxAmountKeys = Object.values(OPENING_BASELINE_SETTING_KEYS).filter((key) =>
      key.startsWith('accounting.opening')
    )
    expect(auxxAmountKeys.length).toBeGreaterThan(0)

    for (const auxxKey of auxxAmountKeys) {
      const qboKey = auxxKey.replace('accounting.opening', 'accounting.qboOpening')
      expect(SETUP_READINESS_SETTING_KEYS as readonly string[]).toContain(qboKey)
      expect({ auxxKey, frozen: isFrozenSetupSettingKey(auxxKey) }).toEqual({
        auxxKey,
        frozen: true,
      })
      expect({ qboKey, frozen: isFrozenSetupSettingKey(qboKey) }).toEqual({ qboKey, frozen: true })
    }
  })

  it('does NOT freeze accounting.qboOpeningJournalRef, which feeds no comparison', () => {
    // It is a pointer at a QuickBooks document, not an amount any check reads:
    // `openingDifference` never touches it, so freezing it would only stop a
    // bookkeeper correcting a typo in a reference with no accounting effect.
    expect(isFrozenSetupSettingKey('accounting.qboOpeningJournalRef')).toBe(false)
  })

  it('leaves unrelated settings alone', () => {
    expect(isFrozenSetupSettingKey('accounting.paymentRoute.check')).toBe(false)
    expect(isFrozenSetupSettingKey('manufacturing.overheadCostPerUnit')).toBe(false)
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
