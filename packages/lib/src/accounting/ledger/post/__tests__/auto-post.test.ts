// packages/lib/src/accounting/ledger/post/__tests__/auto-post.test.ts

import { describe, expect, it } from 'vitest'
import { SETTINGS_CATALOG } from '../../../../settings/catalog'
import { AUTO_POST_AVENUES, autoPostSettingKey } from '../auto-post'

describe('autoPostSettingKey', () => {
  it('names a real catalog key for every avenue', () => {
    for (const avenue of AUTO_POST_AVENUES) {
      const key = autoPostSettingKey(avenue)
      expect(key).toBe(`accounting.autoPost.${avenue}`)
      expect(SETTINGS_CATALOG[key]).toBeDefined()
    }
  })
})
