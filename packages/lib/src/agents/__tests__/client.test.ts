// packages/lib/src/agents/__tests__/client.test.ts

import { describe, expect, it } from 'vitest'
import { type FlatToolsetCatalogEntry, matchesToolsetSearch } from '../client'

const entry = (over: Partial<FlatToolsetCatalogEntry>): FlatToolsetCatalogEntry => ({
  slug: 'auxx:entities:search',
  label: 'Search',
  fullLabel: 'Entities — Search',
  description: 'Read records',
  iconId: 'search',
  color: '',
  path: ['Auxx.ai'],
  isDefault: false,
  isPopular: false,
  tools: [],
  ...over,
})

const tool = (name: string, displayName = name) => ({ name, displayName, description: '' })

describe('matchesToolsetSearch', () => {
  const e = entry({ tools: [tool('search_entities', 'Search records')] })

  it('matches everything on an empty query', () => {
    expect(matchesToolsetSearch(e, '')).toBe(true)
    expect(matchesToolsetSearch(e, '   ')).toBe(true)
  })

  it('matches on slug, labels, description, path, and member tool names', () => {
    expect(matchesToolsetSearch(e, 'auxx:entities')).toBe(true)
    expect(matchesToolsetSearch(e, 'search')).toBe(true)
    expect(matchesToolsetSearch(e, 'Entities —')).toBe(true)
    expect(matchesToolsetSearch(e, 'read records')).toBe(true)
    expect(matchesToolsetSearch(e, 'auxx.ai')).toBe(true)
    expect(matchesToolsetSearch(e, 'search_entities')).toBe(true)
    expect(matchesToolsetSearch(e, 'Search records')).toBe(true)
  })

  it('is case-insensitive and returns false on no match', () => {
    expect(matchesToolsetSearch(e, 'ENTITIES')).toBe(true)
    expect(matchesToolsetSearch(e, 'nonsense')).toBe(false)
  })
})
