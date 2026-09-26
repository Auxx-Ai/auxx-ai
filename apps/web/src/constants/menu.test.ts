// apps/web/src/constants/menu.test.ts

import { DEFAULT_SIDEBAR_NAV_IDS } from '@auxx/lib/sidebar-layout/client'
import { describe, expect, it } from 'vitest'
import { SIDEBAR_MENU } from './menu'

describe('SIDEBAR_MENU', () => {
  it('top-level ids are exactly the sidebar layout default nav ids, in order', () => {
    expect(SIDEBAR_MENU.map((item) => item.id)).toEqual([...DEFAULT_SIDEBAR_NAV_IDS])
  })

  it('dispatch is a plain leaf (its record types are ENTITY_DEFINITION rows)', () => {
    const dispatch = SIDEBAR_MENU.find((item) => item.id === 'dispatch')
    expect(dispatch?.items).toBeUndefined()
    expect(dispatch?.skipParentSlug).toBeUndefined()
  })
})
