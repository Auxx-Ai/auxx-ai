// apps/web/src/components/agents/ui/detail/knowledge/__tests__/derive-scope-mode.test.ts

import { describe, expect, it } from 'vitest'
import { deriveEffectiveMode } from '../derive-scope-mode'

type AgentScopes = Parameters<typeof deriveEffectiveMode>[0]
type KnowledgeEntry = AgentScopes[number]

function row(
  recordId: string,
  mode: 'include_descendants' | 'include_one' | 'exclude'
): KnowledgeEntry {
  return { recordId, mode, source: 'manual' }
}

describe('deriveEffectiveMode', () => {
  const kbA = 'kb:A'
  const articleX = 'article:X'
  const articleY = 'article:Y'
  const articleParent = 'article:P'

  it('returns none when neither own row nor ancestor exists', () => {
    expect(deriveEffectiveMode([], articleX, { ancestorRecordIds: [kbA] })).toBe('none')
  })

  it('inherits include_descendants from KB ancestor when no own row', () => {
    const scopes = [row(kbA, 'include_descendants')]
    expect(deriveEffectiveMode(scopes, articleX, { ancestorRecordIds: [kbA] })).toBe(
      'inherited_include_descendants'
    )
  })

  it('inherits exclude from KB ancestor when no own row', () => {
    const scopes = [row(kbA, 'exclude')]
    expect(deriveEffectiveMode(scopes, articleX, { ancestorRecordIds: [kbA] })).toBe(
      'inherited_exclude'
    )
  })

  it('own include_one wins over ancestor exclude', () => {
    const scopes = [row(kbA, 'exclude'), row(articleX, 'include_one')]
    expect(deriveEffectiveMode(scopes, articleX, { ancestorRecordIds: [kbA] })).toBe('include_one')
  })

  it('own exclude wins over ancestor include_descendants', () => {
    const scopes = [row(kbA, 'include_descendants'), row(articleX, 'exclude')]
    expect(deriveEffectiveMode(scopes, articleX, { ancestorRecordIds: [kbA] })).toBe('exclude')
  })

  it('nearest article ancestor exclude wins over no own row', () => {
    const scopes = [row(articleParent, 'exclude')]
    // P is the parent, A is the KB further up.
    expect(deriveEffectiveMode(scopes, articleY, { ancestorRecordIds: [articleParent, kbA] })).toBe(
      'inherited_exclude'
    )
  })

  it('nearest ancestor include_descendants beats more-distant exclude', () => {
    const scopes = [row(kbA, 'exclude'), row(articleParent, 'include_descendants')]
    expect(deriveEffectiveMode(scopes, articleY, { ancestorRecordIds: [articleParent, kbA] })).toBe(
      'inherited_include_descendants'
    )
  })

  it('ancestor include_one does NOT inherit to descendants', () => {
    // include_one is "this one record only" — descendants stay none.
    const scopes = [row(articleParent, 'include_one')]
    expect(deriveEffectiveMode(scopes, articleY, { ancestorRecordIds: [articleParent] })).toBe(
      'none'
    )
  })

  // The definition-level fallback is resource-agnostic. These two cases use a
  // bare `article` row to exercise it against an article target — reachable in
  // stored data, though no longer writable: `isKnowledgeScopeRecordId` accepts
  // a bare row only for `kb`/`dataset` (the depth-0 container rows).
  it('falls through to definition-level rule when no ancestor matches', () => {
    const scopes = [row('article', 'include_descendants')]
    expect(deriveEffectiveMode(scopes, articleX, { ancestorRecordIds: [kbA] })).toBe(
      'inherited_include_descendants'
    )
  })

  it('ancestor rule wins over definition-level rule', () => {
    const scopes = [row('article', 'exclude'), row(kbA, 'include_descendants')]
    expect(deriveEffectiveMode(scopes, articleX, { ancestorRecordIds: [kbA] })).toBe(
      'inherited_include_descendants'
    )
  })

  it('works without ancestors arg (back-compat for depth-0 callers)', () => {
    const scopes = [row(kbA, 'include_descendants')]
    expect(deriveEffectiveMode(scopes, kbA)).toBe('include_descendants')
  })
})
