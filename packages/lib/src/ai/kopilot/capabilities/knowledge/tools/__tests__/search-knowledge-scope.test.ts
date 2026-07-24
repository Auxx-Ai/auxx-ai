// packages/lib/src/ai/kopilot/capabilities/knowledge/tools/__tests__/search-knowledge-scope.test.ts
//
// Permissions v2 §1.2/1.3 (agent knowledge scope): the article-level
// post-filter search_knowledge applies on top of the dataset-level filter,
// so a partially-scoped KB's out-of-scope articles never surface even though
// they share the KB's dataset with in-scope ones. Pure/DB-free — exercises
// `isSegmentInKnowledgeScope` directly against fabricated `ResolvedKnowledgeScope`
// values.

import { describe, expect, it } from 'vitest'
import type { ResolvedKnowledgeScope } from '../../../../../../agents/resolve-knowledge-scope'
import { isSegmentInKnowledgeScope } from '../search-knowledge'

function scope(over: Partial<ResolvedKnowledgeScope> = {}): ResolvedKnowledgeScope {
  return {
    datasetIds: new Set(),
    fullKbIds: new Set(),
    articleIds: new Set(),
    excludedArticleIds: new Set(),
    ...over,
  }
}

describe('isSegmentInKnowledgeScope', () => {
  it('null/undefined scope is a no-op — always keeps', () => {
    expect(isSegmentInKnowledgeScope({ source: 'kb', articleId: 'a1', kbId: 'kb1' }, null)).toBe(
      true
    )
    expect(
      isSegmentInKnowledgeScope({ source: 'kb', articleId: 'a1', kbId: 'kb1' }, undefined)
    ).toBe(true)
  })

  it('always keeps a RAG segment regardless of scope', () => {
    const s = scope({ fullKbIds: new Set(['kb_other']) })
    expect(isSegmentInKnowledgeScope({ source: 'rag', articleId: 'a1', kbId: 'kb1' }, s)).toBe(true)
    // Even with no metadata at all.
    expect(isSegmentInKnowledgeScope({ source: 'rag' }, s)).toBe(true)
  })

  it('keeps a KB segment whose kbId is fully in scope', () => {
    const s = scope({ fullKbIds: new Set(['kb1']) })
    expect(isSegmentInKnowledgeScope({ source: 'kb', articleId: 'a1', kbId: 'kb1' }, s)).toBe(true)
  })

  it('in a partially-included KB, keeps only articles individually in scope', () => {
    const s = scope({ articleIds: new Set(['a1']) })
    expect(isSegmentInKnowledgeScope({ source: 'kb', articleId: 'a1', kbId: 'kb1' }, s)).toBe(true)
    expect(isSegmentInKnowledgeScope({ source: 'kb', articleId: 'a2', kbId: 'kb1' }, s)).toBe(false)
  })

  it('drops an excluded article even inside a fully-included KB', () => {
    const s = scope({ fullKbIds: new Set(['kb1']), excludedArticleIds: new Set(['a1']) })
    expect(isSegmentInKnowledgeScope({ source: 'kb', articleId: 'a1', kbId: 'kb1' }, s)).toBe(false)
    // A sibling article in the same fully-included KB still passes.
    expect(isSegmentInKnowledgeScope({ source: 'kb', articleId: 'a2', kbId: 'kb1' }, s)).toBe(true)
  })

  it('drops a KB segment with no kbId/articleId when neither fullKbIds nor articleIds match', () => {
    const s = scope({ fullKbIds: new Set(['kb_other']), articleIds: new Set(['a_other']) })
    expect(isSegmentInKnowledgeScope({ source: 'kb' }, s)).toBe(false)
  })
})
