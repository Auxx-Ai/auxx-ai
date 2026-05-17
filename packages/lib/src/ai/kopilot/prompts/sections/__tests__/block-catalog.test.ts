// packages/lib/src/ai/kopilot/prompts/sections/__tests__/block-catalog.test.ts

import { describe, expect, it } from 'vitest'
import { makeCtx } from '../__test-helpers'
import { blockCatalog } from '../block-catalog'

describe('blockCatalog', () => {
  it('always renders the entity-card / entity-list schemas', () => {
    const out = blockCatalog.render(makeCtx({ runMode: 'interactive' }))
    expect(out).toContain('auxx:entity-card')
    expect(out).toContain('auxx:entity-list')
  })

  it('includes draft-list schema only when list_drafts is registered', () => {
    const without = blockCatalog.render(makeCtx({ runMode: 'interactive' }))
    expect(without).not.toContain('auxx:draft-list')

    const withDrafts = blockCatalog.render(
      makeCtx({ runMode: 'interactive', toolNames: new Set(['list_drafts']) })
    )
    expect(withDrafts).toContain('auxx:draft-list')
  })

  it('includes doc inline example only when a docs tool is registered', () => {
    const without = blockCatalog.render(makeCtx({ runMode: 'interactive' }))
    expect(without).not.toContain('auxx://doc/')

    const withDocs = blockCatalog.render(
      makeCtx({ runMode: 'interactive', toolNames: new Set(['search_docs']) })
    )
    expect(withDocs).toContain('auxx://doc/')
  })
})
