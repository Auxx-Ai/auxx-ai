// apps/web/src/components/agents/ui/detail/knowledge/__tests__/derive-scope-mode.test.ts

import { describe, expect, it } from 'vitest'
import { deriveEffectiveMode } from '../derive-scope-mode'

type AgentScopes = Parameters<typeof deriveEffectiveMode>[0]

function row(
  entityDefinitionId: string,
  entityInstanceId: string | null,
  mode: 'include_descendants' | 'include_one' | 'exclude'
): AgentScopes[number] {
  return {
    id: `r-${entityDefinitionId}-${entityInstanceId ?? 'def'}`,
    agentId: 'agent-1',
    organizationId: 'org-1',
    entityDefinitionId,
    entityInstanceId,
    mode,
    source: 'manual',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as AgentScopes[number]
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
    const scopes = [row('kb', 'A', 'include_descendants')]
    expect(deriveEffectiveMode(scopes, articleX, { ancestorRecordIds: [kbA] })).toBe(
      'inherited_include_descendants'
    )
  })

  it('inherits exclude from KB ancestor when no own row', () => {
    const scopes = [row('kb', 'A', 'exclude')]
    expect(deriveEffectiveMode(scopes, articleX, { ancestorRecordIds: [kbA] })).toBe(
      'inherited_exclude'
    )
  })

  it('own include_one wins over ancestor exclude', () => {
    const scopes = [row('kb', 'A', 'exclude'), row('article', 'X', 'include_one')]
    expect(deriveEffectiveMode(scopes, articleX, { ancestorRecordIds: [kbA] })).toBe('include_one')
  })

  it('own exclude wins over ancestor include_descendants', () => {
    const scopes = [row('kb', 'A', 'include_descendants'), row('article', 'X', 'exclude')]
    expect(deriveEffectiveMode(scopes, articleX, { ancestorRecordIds: [kbA] })).toBe('exclude')
  })

  it('nearest article ancestor exclude wins over no own row', () => {
    const scopes = [row('article', 'P', 'exclude')]
    // P is the parent, A is the KB further up.
    expect(deriveEffectiveMode(scopes, articleY, { ancestorRecordIds: [articleParent, kbA] })).toBe(
      'inherited_exclude'
    )
  })

  it('nearest ancestor include_descendants beats more-distant exclude', () => {
    const scopes = [row('kb', 'A', 'exclude'), row('article', 'P', 'include_descendants')]
    expect(deriveEffectiveMode(scopes, articleY, { ancestorRecordIds: [articleParent, kbA] })).toBe(
      'inherited_include_descendants'
    )
  })

  it('ancestor include_one does NOT inherit to descendants', () => {
    // include_one is "this one record only" — descendants stay none.
    const scopes = [row('article', 'P', 'include_one')]
    expect(deriveEffectiveMode(scopes, articleY, { ancestorRecordIds: [articleParent] })).toBe(
      'none'
    )
  })

  it('falls through to definition-level rule when no ancestor matches', () => {
    const scopes = [row('article', null, 'include_descendants')]
    expect(deriveEffectiveMode(scopes, articleX, { ancestorRecordIds: [kbA] })).toBe(
      'inherited_include_descendants'
    )
  })

  it('ancestor rule wins over definition-level rule', () => {
    const scopes = [row('article', null, 'exclude'), row('kb', 'A', 'include_descendants')]
    expect(deriveEffectiveMode(scopes, articleX, { ancestorRecordIds: [kbA] })).toBe(
      'inherited_include_descendants'
    )
  })

  it('works without ancestors arg (back-compat for depth-0 callers)', () => {
    const scopes = [row('kb', 'A', 'include_descendants')]
    expect(deriveEffectiveMode(scopes, kbA)).toBe('include_descendants')
  })
})
