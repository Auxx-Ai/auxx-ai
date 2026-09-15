// packages/lib/src/settings/__tests__/credit-memo-posting-setting.test.ts
//
// `accounting.creditMemoPosting` and the two default-grouping settings
// (accounting brief 28 §3.1), through the write path a form actually uses.
//
// The property under test is not "the catalog has a key". It is that the values
// the READERS understand are exactly the values the write path accepts.
// `normalizeSettingValue` rejects a `SINGLE_SELECT` value that is not in
// `config.options.options`, so a catalog whose option list drifted from
// `CREDIT_MEMO_POSTING_MODES` or `BATCH_POSTING_GROUPINGS` would either refuse a
// value the reader honours or store one it silently reads as the default.

import { describe, expect, it } from 'vitest'
import { BATCH_POSTING_GROUPINGS } from '../../money/batch-posting/types'
import { CREDIT_MEMO_POSTING_MODES } from '../../money/credit-memo-posting/types'
import { SETTINGS_CATALOG } from '../catalog'
import { normalizeSettingValue } from '../normalize-setting-value'

describe('accounting.creditMemoPosting', () => {
  const KEY = 'accounting.creditMemoPosting'
  const config = SETTINGS_CATALOG[KEY]

  it('is a SINGLE_SELECT that defaults to manual', () => {
    expect(config.fieldType).toBe('SINGLE_SELECT')
    // `manual` is the safe default: `auto` issues and posts without anybody
    // looking, and a first connector sync can carry a year of channel memos.
    expect(config.defaultValue).toBe('manual')
    expect(config.scope).toBe('GENERAL')
    expect(config.access).toBe('org')
  })

  it('offers exactly the modes the reader understands, with labels', () => {
    expect(config.options?.options?.map((option) => option.value)).toEqual([
      ...CREDIT_MEMO_POSTING_MODES,
    ])
    expect(config.options?.options?.map((option) => option.label)).toEqual([
      'Manual, run the posting dialog',
      'Automatic after every sync',
    ])
  })

  it('round-trips every mode through the write path', () => {
    for (const mode of CREDIT_MEMO_POSTING_MODES) {
      expect(normalizeSettingValue(KEY, config, mode)).toBe(mode)
    }
  })

  it('refuses a mode that is not on the list', () => {
    expect(() => normalizeSettingValue(KEY, config, 'automatic')).toThrow(/expects one of/)
  })

  it('accepts null, which resets it to manual', () => {
    expect(normalizeSettingValue(KEY, config, null)).toBeNull()
  })
})

// Fulfillments default to a day; channel credit memos default to a month, the
// grouping brief 25 §6 chose for them and the one the dialog opened on before
// the setting existed (brief 28 §10 decision 6).
describe.each([
  ['accounting.fulfillmentGrouping', 'day'],
  ['accounting.creditMemoGrouping', 'month'],
] as const)('%s', (KEY, defaultGrouping) => {
  const config = SETTINGS_CATALOG[KEY]

  it(`is a SINGLE_SELECT that defaults to ${defaultGrouping}`, () => {
    expect(config.fieldType).toBe('SINGLE_SELECT')
    expect(config.defaultValue).toBe(defaultGrouping)
    expect(config.scope).toBe('GENERAL')
    expect(config.access).toBe('org')
  })

  it('offers exactly the groupings the posters share', () => {
    expect(config.options?.options?.map((option) => option.value)).toEqual([
      ...BATCH_POSTING_GROUPINGS,
    ])
  })

  it('round-trips every grouping through the write path', () => {
    for (const grouping of BATCH_POSTING_GROUPINGS) {
      expect(normalizeSettingValue(KEY, config, grouping)).toBe(grouping)
    }
  })

  it('refuses week, which brief 25 §6.4 removed', () => {
    expect(() => normalizeSettingValue(KEY, config, 'week')).toThrow(/expects one of/)
  })
})
