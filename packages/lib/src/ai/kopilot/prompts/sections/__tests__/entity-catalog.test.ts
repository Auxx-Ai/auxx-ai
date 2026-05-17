// packages/lib/src/ai/kopilot/prompts/sections/__tests__/entity-catalog.test.ts

import { describe, expect, it } from 'vitest'
import { makeCtx } from '../__test-helpers'
import { entityCatalog } from '../entity-catalog'

describe('entityCatalog', () => {
  it('returns null when catalog is empty', () => {
    expect(entityCatalog.render(makeCtx({ runMode: 'interactive' }))).toBeNull()
  })

  it('renders the apiSlug in backticks', () => {
    const out = entityCatalog.render(
      makeCtx({
        runMode: 'interactive',
        entityCatalog: [
          { apiSlug: 'contacts', label: 'Contact', plural: 'contacts', entityDefinitionId: 'd1' },
        ],
      })
    )
    expect(out).toContain('- **Contact** (contacts) — `contacts`')
  })
})
