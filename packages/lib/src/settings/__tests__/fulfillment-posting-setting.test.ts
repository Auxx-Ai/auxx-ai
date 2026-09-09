// packages/lib/src/settings/__tests__/fulfillment-posting-setting.test.ts
//
// `accounting.fulfillmentPosting` (49 §2.4), through the write path a form
// actually uses.
//
// 🛑 The property under test is not "the catalog has a key". It is that the two
// modes the RUNNER understands are exactly the two the write path accepts.
// `normalizeSettingValue` rejects a `SINGLE_SELECT` value that is not in
// `config.options.options`, so a catalog whose option list drifted from
// `FULFILLMENT_POSTING_MODES` would either refuse a mode the runner honours or
// store one it silently reads as `manual`. Both are invisible until somebody's
// books are a month short.

import { describe, expect, it } from 'vitest'
import { FULFILLMENT_POSTING_MODES } from '../../money/fulfillment-posting/types'
import { SETTINGS_CATALOG } from '../catalog'
import { normalizeSettingValue } from '../normalize-setting-value'

const KEY = 'accounting.fulfillmentPosting'
const config = SETTINGS_CATALOG[KEY]

describe('accounting.fulfillmentPosting', () => {
  it('is a SINGLE_SELECT that defaults to manual', () => {
    expect(config.fieldType).toBe('SINGLE_SELECT')
    // ⚠️ `manual` is the safe default: `auto` posts without anybody looking, and
    // a first connector sync can carry a year of history.
    expect(config.defaultValue).toBe('manual')
    expect(config.scope).toBe('GENERAL')
    expect(config.access).toBe('org')
  })

  it('offers exactly the modes the runner understands, with labels', () => {
    expect(config.options?.options?.map((option) => option.value)).toEqual([
      ...FULFILLMENT_POSTING_MODES,
    ])
    expect(config.options?.options?.map((option) => option.label)).toEqual([
      'Manual, run the posting dialog',
      'Automatic after every sync',
    ])
  })

  it('round-trips every mode through the write path', () => {
    for (const mode of FULFILLMENT_POSTING_MODES) {
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
