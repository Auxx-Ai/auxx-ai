// packages/lib/src/ai/kopilot/prompts/sections/__tests__/block-catalog.test.ts

import { describe, expect, it } from 'vitest'
import { makeCtx } from '../__test-helpers'
import { blockCatalog } from '../block-catalog'
import { SYSTEM_PROMPT_SECTIONS } from '../registry'
import { renderSections } from '../render'

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

  it('includes the app-install schema only when list_app_blocks is registered', () => {
    // The only source of an UNINSTALLED app's slug is `list_app_blocks`'
    // `notInstalled`; without that tool the model could only invent one.
    const without = blockCatalog.render(makeCtx({ runMode: 'interactive' }))
    expect(without).not.toContain('auxx:app-install')

    const withAppBlocks = blockCatalog.render(
      makeCtx({ runMode: 'interactive', toolNames: new Set(['list_app_blocks']) })
    )
    expect(withAppBlocks).toContain('auxx:app-install')
    expect(withAppBlocks).toContain('{"appSlug": "ups"}')
    expect(withAppBlocks).toContain('`notInstalled`')
    expect(withAppBlocks).toContain('Never invent one')
  })

  it('keeps the app-install fence off every non-builder surface', () => {
    // `auxx:*` fences only render in the in-app builder renderer — on chat or
    // email they would be literal backticks. The section-level gate carries it.
    expect(blockCatalog.surfaces?.has('builder')).toBe(true)
    expect(blockCatalog.surfaces?.has('chat')).toBe(false)
    expect(blockCatalog.surfaces?.has('email')).toBe(false)

    const prompt = renderSections(
      SYSTEM_PROMPT_SECTIONS,
      makeCtx({
        runMode: 'interactive',
        surface: 'chat',
        toolNames: new Set(['list_app_blocks']),
      })
    )
    expect(prompt).not.toContain('auxx:app-install')
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
