// packages/lib/src/prompt-templates/__tests__/template-registry.test.ts

import { describe, expect, it } from 'vitest'
import { getPromptTemplateById, listPromptTemplates } from '../template-registry'

describe('template-registry', () => {
  it('compiles every system template at module load', () => {
    const templates = listPromptTemplates()
    expect(templates.length).toBe(13)
    for (const t of templates) {
      expect(t.id).toBeTruthy()
      expect(t.name).toBeTruthy()
      expect(t.description).toBeTruthy()
      expect(t.categories.length).toBeGreaterThan(0)
      expect(t.icon.iconId).toBeTruthy()
      expect(t.prompt.type).toBe('doc')
      expect(Array.isArray(t.prompt.content)).toBe(true)
      expect(t.prompt.content.length).toBeGreaterThan(0)
    }
  })

  it('filters by category', () => {
    const support = listPromptTemplates('customer-support')
    expect(support.length).toBeGreaterThan(0)
    expect(support.every((t) => t.categories.includes('customer-support'))).toBe(true)
  })

  it('looks up by id', () => {
    const t = getPromptTemplateById('draft-reply')
    expect(t).toBeDefined()
    expect(t?.name).toBe('Draft Reply')
  })
})
