// packages/lib/src/agents/__tests__/resolve-knowledge-scope.test.ts

import type { KnowledgeEntry } from '@auxx/database'
import { describe, expect, it } from 'vitest'
import { parseAgentKnowledgeScope, scopeHasIncludes } from '../knowledge-scope'
import { selectScopedSources } from '../resolve-knowledge-scope'

function entry(recordId: string, mode: KnowledgeEntry['mode']): KnowledgeEntry {
  return { recordId, mode, source: 'manual' }
}

const KB_IDS = ['kb1', 'kb2', 'kb3']
const RAG_IDS = ['ds1', 'ds2']

/**
 * Drive the precedence core the way `resolveAgentKnowledgeScope` does, so the
 * cases read as "these scope rows produce these sources".
 */
function select(
  rows: KnowledgeEntry[],
  opts: {
    kbIdsWithScopedArticles?: string[]
    viewableKbIds?: string[]
    viewableDatasetIds?: string[]
  } = {}
) {
  const scope = parseAgentKnowledgeScope(rows)
  if (!scope) throw new Error('expected a scope — the caller should pass scope rows')

  const capabilities =
    opts.viewableKbIds || opts.viewableDatasetIds
      ? ({
          canViewInstance: (key: string, id: string) =>
            key === 'kb'
              ? (opts.viewableKbIds ?? KB_IDS).includes(id)
              : (opts.viewableDatasetIds ?? RAG_IDS).includes(id),
          // Only `canViewInstance` is read by the core under test.
        } as never)
      : undefined

  const out = selectScopedSources({
    scope,
    hasIncludes: scopeHasIncludes(scope),
    kbIds: KB_IDS,
    ragDatasetIds: RAG_IDS,
    kbIdsWithScopedArticles: new Set(opts.kbIdsWithScopedArticles ?? []),
    capabilities,
  })
  return {
    included: [...out.includedKbIds].sort(),
    partial: [...out.partialKbIds].sort(),
    datasets: [...out.includedDatasetIds].sort(),
  }
}

describe('selectScopedSources', () => {
  it('treats any include mode on a KB as the whole KB', () => {
    // Mentions write `include_one` for a `kb:` chip; the builder writes
    // `include_descendants`. Both mean "this KB's content".
    expect(select([entry('kb:kb1', 'include_one')]).included).toEqual(['kb1'])
    expect(select([entry('kb:kb1', 'include_descendants')]).included).toEqual(['kb1'])
  })

  it('an allowlist scope omits everything not named', () => {
    const out = select([entry('kb:kb1', 'include_descendants')])
    expect(out.included).toEqual(['kb1'])
    expect(out.partial).toEqual([])
    // Naming a KB does not drag the RAG datasets along.
    expect(out.datasets).toEqual([])
  })

  it('an exclude-only scope starts org-wide and carves out', () => {
    const out = select([entry('kb:kb2', 'exclude')])
    expect(out.included).toEqual(['kb1', 'kb3'])
    expect(out.datasets).toEqual(['ds1', 'ds2'])
  })

  it('honours the definition-level rows for kb and dataset', () => {
    const allKbs = select([entry('kb', 'include_descendants')])
    expect(allKbs.included).toEqual(KB_IDS)
    expect(allKbs.datasets).toEqual([])

    const allDatasets = select([entry('dataset', 'include_descendants')])
    expect(allDatasets.included).toEqual([])
    expect(allDatasets.datasets).toEqual(RAG_IDS)
  })

  it('lets a specific KB row override the definition-level row (most-specific-wins)', () => {
    const out = select([entry('kb', 'exclude'), entry('kb:kb2', 'include_descendants')])
    expect(out.included).toEqual(['kb2'])
  })

  it('marks a KB partial when it only contributes individually scoped articles', () => {
    const out = select([entry('article:a1', 'include_one')], { kbIdsWithScopedArticles: ['kb3'] })
    expect(out.included).toEqual([])
    // kb3's dataset still has to be searchable, or the article post-filter has
    // nothing to narrow.
    expect(out.partial).toEqual(['kb3'])
  })

  it('an included article outranks the exclusion of its KB', () => {
    const out = select([entry('kb:kb1', 'exclude'), entry('article:a1', 'include_one')], {
      kbIdsWithScopedArticles: ['kb1'],
    })
    expect(out.included).toEqual([])
    expect(out.partial).toEqual(['kb1'])
  })

  it('a whole-KB include beats the same KB being partial', () => {
    const out = select([entry('kb:kb1', 'include_descendants')], {
      kbIdsWithScopedArticles: ['kb1'],
    })
    expect(out.included).toEqual(['kb1'])
    expect(out.partial).toEqual([])
  })

  it('drops sources the capability view cannot see (§0.4 — narrow, never widen)', () => {
    const out = select(
      [entry('kb', 'include_descendants'), entry('dataset', 'include_descendants')],
      {
        viewableKbIds: ['kb2'],
        viewableDatasetIds: ['ds1'],
      }
    )
    expect(out.included).toEqual(['kb2'])
    expect(out.datasets).toEqual(['ds1'])
  })

  it('drops a partial KB the capability view cannot see', () => {
    const out = select([entry('article:a1', 'include_one')], {
      kbIdsWithScopedArticles: ['kb1'],
      viewableKbIds: ['kb2'],
    })
    expect(out.partial).toEqual([])
  })

  it('silently drops dangling ids rather than failing', () => {
    // `kb:gone` no longer exists in the org, so nothing matches it.
    const out = select([entry('kb:gone', 'include_descendants')])
    expect(out.included).toEqual([])
    expect(out.partial).toEqual([])
    expect(out.datasets).toEqual([])
  })
})
