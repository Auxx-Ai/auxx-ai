// packages/lib/src/agents/__tests__/prompt-mention-reconciler.test.ts

import { describe, expect, it } from 'vitest'
import {
  type KnowledgeEntry,
  reconcileKnowledge,
  reconcilePromptMentions,
  reconcileToolsets,
  type ToolsetEntry,
  walkPromptDoc,
} from '../prompt-mention-reconciler'
import type { FlatToolCatalogEntry } from '../toolset-catalog'

const TOOL_CATALOG: FlatToolCatalogEntry[] = [
  {
    name: 'list_threads',
    displayName: 'List threads',
    description: '',
    toolsetSlug: 'auxx:mail:threads',
    toolsetLabel: '',
    toolsetIconId: '',
    toolsetColor: '',
    path: [],
  },
  {
    name: 'search_articles',
    displayName: 'Search articles',
    description: '',
    toolsetSlug: 'auxx:knowledge',
    toolsetLabel: '',
    toolsetIconId: '',
    toolsetColor: '',
    path: [],
  },
]

function doc(...children: unknown[]): Record<string, unknown> {
  return { type: 'doc', content: children }
}

function paragraph(...nodes: unknown[]): Record<string, unknown> {
  return { type: 'paragraph', content: nodes }
}

function reference(id: string): Record<string, unknown> {
  return { type: 'reference', attrs: { id } }
}

describe('walkPromptDoc', () => {
  it('returns empty sets for an empty doc', () => {
    const result = walkPromptDoc(doc(), TOOL_CATALOG)
    expect(result.toolsetSlugs.size).toBe(0)
    expect(result.recordIds.size).toBe(0)
  })

  it('maps tool: references to their toolset slug via the catalog', () => {
    const result = walkPromptDoc(doc(paragraph(reference('tool:list_threads'))), TOOL_CATALOG)
    expect([...result.toolsetSlugs]).toEqual(['auxx:mail:threads'])
    expect(result.recordIds.size).toBe(0)
  })

  it('accepts direct toolset: references', () => {
    const result = walkPromptDoc(doc(paragraph(reference('toolset:auxx:knowledge'))), TOOL_CATALOG)
    expect([...result.toolsetSlugs]).toEqual(['auxx:knowledge'])
  })

  it('collects record RecordIds for known prefixes', () => {
    const result = walkPromptDoc(
      doc(paragraph(reference('article:abc'), reference('entity:def'), reference('ticket:ghi'))),
      TOOL_CATALOG
    )
    expect([...result.recordIds].sort()).toEqual(['article:abc', 'entity:def', 'ticket:ghi'])
  })

  it('ignores unknown prefixes and malformed ids', () => {
    const result = walkPromptDoc(
      doc(
        paragraph(
          reference('user:abc'),
          reference('noprefix'),
          reference(':missingPrefix'),
          reference('tool:unknown_tool')
        )
      ),
      TOOL_CATALOG
    )
    expect(result.toolsetSlugs.size).toBe(0)
    expect(result.recordIds.size).toBe(0)
  })

  it('recurses into nested content', () => {
    const nested = doc(paragraph(reference('tool:list_threads')), {
      type: 'block',
      content: [paragraph(reference('article:abc'))],
    })
    const result = walkPromptDoc(nested, TOOL_CATALOG)
    expect([...result.toolsetSlugs]).toEqual(['auxx:mail:threads'])
    expect([...result.recordIds]).toEqual(['article:abc'])
  })
})

describe('reconcileToolsets', () => {
  function ts(slug: string, source: ToolsetEntry['source']): ToolsetEntry {
    return { slug, config: {}, enabled: true, source }
  }

  it('inserts a new mention row when slug is not covered', () => {
    const next = reconcileToolsets([], new Set(['auxx:mail:threads']))
    expect(next).toEqual([ts('auxx:mail:threads', 'mention')])
  })

  it('drops stale mention rows', () => {
    const next = reconcileToolsets([ts('auxx:mail:threads', 'mention')], new Set())
    expect(next).toEqual([])
  })

  it('promotes a manual row to mention when its slug is mentioned', () => {
    const next = reconcileToolsets(
      [ts('auxx:mail:threads', 'manual')],
      new Set(['auxx:mail:threads'])
    )
    expect(next).toEqual([ts('auxx:mail:threads', 'mention')])
  })

  it('promotes an auto_default row to mention when its slug is mentioned', () => {
    const next = reconcileToolsets(
      [ts('auxx:mail:threads', 'auto_default')],
      new Set(['auxx:mail:threads'])
    )
    expect(next).toEqual([ts('auxx:mail:threads', 'mention')])
  })

  it('re-enables a disabled manual row when its slug is mentioned', () => {
    const next = reconcileToolsets(
      [{ slug: 'auxx:mail:threads', config: {}, enabled: false, source: 'manual' }],
      new Set(['auxx:mail:threads'])
    )
    expect(next).toEqual([ts('auxx:mail:threads', 'mention')])
  })

  it('handles a mention→remove cycle', () => {
    const first = reconcileToolsets([], new Set(['auxx:knowledge']))
    const second = reconcileToolsets(first, new Set())
    expect(second).toEqual([])
  })
})

describe('reconcileKnowledge', () => {
  function k(
    recordId: string,
    mode: KnowledgeEntry['mode'],
    source: KnowledgeEntry['source']
  ): KnowledgeEntry {
    return { recordId, mode, source }
  }

  it('inserts a new mention entry when recordId is not covered', () => {
    const next = reconcileKnowledge([], new Set(['article:abc']))
    expect(next).toEqual([k('article:abc', 'include_one', 'mention')])
  })

  it('drops stale mention entries', () => {
    const next = reconcileKnowledge([k('article:abc', 'include_one', 'mention')], new Set())
    expect(next).toEqual([])
  })

  it('keeps manual include entries and skips the duplicate mention', () => {
    const next = reconcileKnowledge(
      [k('article:abc', 'include_descendants', 'manual')],
      new Set(['article:abc'])
    )
    expect(next).toEqual([k('article:abc', 'include_descendants', 'manual')])
  })

  it('drops a manual exclude when conflicting with a mention (mention wins)', () => {
    const next = reconcileKnowledge(
      [k('article:abc', 'exclude', 'manual')],
      new Set(['article:abc'])
    )
    expect(next).toEqual([k('article:abc', 'include_one', 'mention')])
  })

  it('preserves manual entries on unrelated keys when reconciling mentions', () => {
    const next = reconcileKnowledge(
      [
        k('article:keep', 'include_descendants', 'manual'),
        k('article:stale', 'include_one', 'mention'),
      ],
      new Set(['article:new'])
    )
    expect(next.sort((a, b) => a.recordId.localeCompare(b.recordId))).toEqual([
      k('article:keep', 'include_descendants', 'manual'),
      k('article:new', 'include_one', 'mention'),
    ])
  })
})

describe('reconcilePromptMentions', () => {
  it('returns combined next state', () => {
    const result = reconcilePromptMentions({
      prompt: doc(paragraph(reference('tool:list_threads'), reference('article:abc'))),
      current: { toolsets: [], knowledge: [] },
      toolCatalog: TOOL_CATALOG,
    })
    expect(result.toolsets).toEqual([
      { slug: 'auxx:mail:threads', config: {}, enabled: true, source: 'mention' },
    ])
    expect(result.knowledge).toEqual([
      { recordId: 'article:abc', mode: 'include_one', source: 'mention' },
    ])
  })
})
