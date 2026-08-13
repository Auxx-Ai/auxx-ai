// packages/lib/src/cache/canonicalize-entity-definition-id.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { canonicalizeEntityDefinitionId } from './org-cache-helpers'

const ORG = 'org_1'
const TICKET_DEF = 'i5aezsg4bc6n8gof2uan3wcf'

/**
 * The entityDefs cache maps entityType → id for EVERY EntityDefinition row
 * (`entity-defs-provider.ts`), which in a real org includes `thread` and
 * `article`. That is the whole point of these tests: the cache resolving a
 * value must NOT be what decides whether it gets rewritten.
 */
const ENTITY_DEFS: Record<string, string> = {
  ticket: TICKET_DEF,
  contact: 'mzxt3cxyzhm3cbtgcbpmeir1',
  thread: 'thread_def_cuid',
  article: 'article_def_cuid',
}

const get = vi.fn(async () => ENTITY_DEFS)

vi.mock('./singletons', () => ({
  getOrgCache: () => ({ get }),
}))

describe('canonicalizeEntityDefinitionId', () => {
  beforeEach(() => {
    get.mockClear()
  })

  it.each(['ticket', 'contact'])('resolves the tier-B slug %s to the org id', async (slug) => {
    expect(await canonicalizeEntityDefinitionId(ORG, slug)).toBe(ENTITY_DEFS[slug])
  })

  it.each([
    'thread',
    'article',
  ])('leaves the tier-A slug %s alone even though the cache resolves it', async (slug) => {
    // Regression guard for the trap that broke earlier attempts at this fix:
    // `thread`/`article` have EntityDefinition rows in every org, but they are
    // table-backed system resources whose ids stay slug-keyed everywhere
    // (`thread:<id>` RecordIds), because canonicalization is gated on
    // `isEntityDefinitionType`. Normalizing on "the cache resolved it" would
    // rewrite them and break every reference that works today.
    expect(await canonicalizeEntityDefinitionId(ORG, slug)).toBe(slug)
    expect(get).not.toHaveBeenCalled()
  })

  it('passes a CUID through untouched without reading the cache', async () => {
    expect(await canonicalizeEntityDefinitionId(ORG, TICKET_DEF)).toBe(TICKET_DEF)
    expect(get).not.toHaveBeenCalled()
  })

  it('falls back to the slug when the org has no definition for it', async () => {
    get.mockResolvedValueOnce({})
    expect(await canonicalizeEntityDefinitionId(ORG, 'ticket')).toBe('ticket')
  })
})
