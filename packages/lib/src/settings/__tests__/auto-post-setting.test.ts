// packages/lib/src/settings/__tests__/auto-post-setting.test.ts
//
// `accounting.autoPost.<avenue>` (MIGRATION.md step 1b), through the write path
// a form actually uses. Replaces `fulfillment-posting-setting.test.ts` and
// `credit-memo-posting-setting.test.ts`, whose keys and reader modules are gone.

import { describe, expect, it } from 'vitest'
import { AUTO_POST_AVENUES, autoPostSettingKey } from '../../accounting/ledger/post/auto-post'
import { SETTINGS_CATALOG } from '../catalog'
import { normalizeSettingValue } from '../normalize-setting-value'

describe.each(AUTO_POST_AVENUES)('accounting.autoPost.%s', (avenue) => {
  const key = autoPostSettingKey(avenue)
  const config = SETTINGS_CATALOG[key]

  it('is an org-scoped checkbox that defaults off', () => {
    expect(config.fieldType).toBe('CHECKBOX')
    expect(config.defaultValue).toBe(false)
    expect(config.scope).toBe('GENERAL')
    expect(config.access).toBe('org')
  })

  it('round-trips true and false through the write path', () => {
    expect(normalizeSettingValue(key, config, true)).toBe(true)
    expect(normalizeSettingValue(key, config, false)).toBe(false)
  })
})
