// apps/web/src/components/records/layout/__tests__/layout-icon.test.ts

import { describe, expect, it } from 'vitest'
import { resolveLayoutIcon } from '../layout-icon'

// A layout stores an icon NAME, and the two tables that can name one only
// partly overlap: `IconPicker` offers `ICON_DATA` ('home', 'settings', ...),
// while the registry and both surfaces resolved through `ICON_MAP` ('house',
// 'messages', ...). Resolving through one table alone is why an admin-picked
// tab or section icon rendered as the generic fallback box.
describe('resolveLayoutIcon', () => {
  it('resolves a name only the PICKER knows, which registry lookup missed', () => {
    expect(resolveLayoutIcon('home')).not.toBeNull()
    expect(resolveLayoutIcon('settings')).not.toBeNull()
  })

  it('still resolves a name only the REGISTRY map knows', () => {
    expect(resolveLayoutIcon('house')).not.toBeNull()
    expect(resolveLayoutIcon('messages')).not.toBeNull()
  })

  it('gives the two tables different components for their own names', () => {
    // Guards against a lookup that silently hands back one fallback for
    // everything and so only LOOKS like it resolved both tables. Deliberately
    // not 'home' vs 'house': those are aliases for the same Lucide component,
    // so they would be equal even when the lookup is correct.
    expect(resolveLayoutIcon('settings')).not.toBe(resolveLayoutIcon('messages'))
  })

  it('returns null only when no name is stored, so callers pick the fallback', () => {
    expect(resolveLayoutIcon(undefined)).toBeNull()
    expect(resolveLayoutIcon('')).toBeNull()
  })

  it('falls back to the registry map for an unknown name rather than throwing', () => {
    expect(resolveLayoutIcon('not-a-real-icon')).not.toBeNull()
  })
})
