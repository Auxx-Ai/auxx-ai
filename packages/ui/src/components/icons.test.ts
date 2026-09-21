// packages/ui/src/components/icons.test.ts
//
// The ICON_COLORS half of the palette guard (plans/icons/entity-def-palette.md §1.3). The
// other half — OPTION_COLORS, and the entity definitions themselves — is in
// `packages/lib/src/seed/entity-seeder/__tests__/palette.test.ts`, because `@auxx/lib` has
// no `@auxx/ui` dependency and cannot see this file.

import { ENTITY_COLORS } from '@auxx/types/entity-color'
import { describe, expect, it } from 'vitest'
import { ICON_DATA } from './icon-data'
import { ICON_COLORS } from './icons'

describe('ICON_COLORS', () => {
  it('is the twelve palette ids, in the same order', () => {
    expect(ICON_COLORS.map((c) => c.id)).toEqual([...ENTITY_COLORS])
  })

  it('gives every colour all five class fields', () => {
    for (const color of ICON_COLORS) {
      expect(color.label, color.id).toBeTruthy()
      expect(color.swatch, color.id).toMatch(/^bg-/)
      expect(color.iconColor, color.id).toContain('dark:')
      expect(color.bgClasses, color.id).toContain('dark:')
      expect(color.groupClasses, color.id).toContain('--icon-color')
    }
  })

  it('has no duplicate icon ids in the catalog', () => {
    const ids = ICON_DATA.map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
