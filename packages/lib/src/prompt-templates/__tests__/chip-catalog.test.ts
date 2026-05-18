// packages/lib/src/prompt-templates/__tests__/chip-catalog.test.ts

import { describe, expect, it } from 'vitest'
import type { DocJSON, InlineJSON } from '../../kb/markdown'
import { resolveTemplateChip } from '../template-chip-catalog'
import { listPromptTemplates } from '../template-registry'

/**
 * Walk a compiled template's `DocJSON` and collect every inline `reference`
 * id. We only care about the block schema (`type: 'block'`, `content: InlineJSON[]`)
 * — system templates don't use tabs/accordion/table containers today.
 */
function collectChipIds(doc: DocJSON): string[] {
  const ids: string[] = []
  for (const node of doc.content ?? []) {
    if (node?.type !== 'block') continue
    walkInline(node.content as InlineJSON[] | undefined, ids)
  }
  return ids
}

function walkInline(inline: InlineJSON[] | undefined, out: string[]): void {
  if (!inline) return
  for (const node of inline) {
    if (node.type === 'reference') {
      const id = node.attrs?.id
      if (typeof id === 'string') out.push(id)
    }
  }
}

describe('template chip catalog', () => {
  const templates = listPromptTemplates()

  it('every template chip resolves against the catalog', () => {
    const unresolved: { template: string; chipId: string; reason: string }[] = []
    for (const t of templates) {
      for (const chipId of collectChipIds(t.prompt)) {
        const r = resolveTemplateChip(chipId)
        if (!r.ok) unresolved.push({ template: t.id, chipId, reason: r.reason })
      }
    }
    expect(unresolved).toEqual([])
  })

  it('at least one chip per non-content-only template', () => {
    // Content-only templates (translation, sentiment) per plan §8.1 may stay
    // chip-light. Everything else should have at least one chip.
    const CONTENT_ONLY = new Set(['translate-message'])
    const missing: string[] = []
    for (const t of templates) {
      if (CONTENT_ONLY.has(t.id)) continue
      const ids = collectChipIds(t.prompt)
      if (ids.length === 0) missing.push(t.id)
    }
    expect(missing).toEqual([])
  })
})
