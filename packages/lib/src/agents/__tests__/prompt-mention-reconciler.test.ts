// packages/lib/src/agents/__tests__/prompt-mention-reconciler.test.ts

import { describe, expect, it } from 'vitest'
import {
  type KnowledgeEntry,
  reconcileKnowledgeMentions,
  reconcilePromptMentions,
  reconcileToolsetMentions,
  type ToolsetEntry,
  walkPromptDoc,
  walkPromptDocs,
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
  // App-tool entries carry the registered name (`<slug>_<id>`), so two apps
  // publishing the same manifest id (`send_message`) stay distinguishable.
  {
    name: 'slack_send_message',
    displayName: 'Send message',
    description: '',
    toolsetSlug: 'app:slack:messages',
    toolsetLabel: '',
    toolsetIconId: '',
    toolsetColor: '',
    path: [],
  },
  {
    name: 'teams_send_message',
    displayName: 'Send message',
    description: '',
    toolsetSlug: 'app:teams:messages',
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

  it('maps an app-tool registered-name chip to its toolset slug', () => {
    const result = walkPromptDoc(doc(paragraph(reference('tool:slack_send_message'))), TOOL_CATALOG)
    expect([...result.toolsetSlugs]).toEqual(['app:slack:messages'])
  })

  it('resolves a same-id collision unambiguously by registered name', () => {
    const result = walkPromptDoc(
      doc(paragraph(reference('tool:slack_send_message'), reference('tool:teams_send_message'))),
      TOOL_CATALOG
    )
    expect([...result.toolsetSlugs].sort()).toEqual(['app:slack:messages', 'app:teams:messages'])
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

describe('walkPromptDocs', () => {
  it('unions slugs and recordIds across many docs', () => {
    const result = walkPromptDocs(
      [
        doc(paragraph(reference('tool:list_threads'), reference('article:abc'))),
        doc(paragraph(reference('tool:search_articles'), reference('article:abc'))),
      ],
      TOOL_CATALOG
    )
    expect([...result.toolsetSlugs].sort()).toEqual(['auxx:knowledge', 'auxx:mail:threads'])
    expect([...result.recordIds]).toEqual(['article:abc'])
  })

  it('resolves a same-id collision across docs by registered name', () => {
    const result = walkPromptDocs(
      [
        doc(paragraph(reference('tool:slack_send_message'))),
        doc(paragraph(reference('tool:teams_send_message'))),
      ],
      TOOL_CATALOG
    )
    expect([...result.toolsetSlugs].sort()).toEqual(['app:slack:messages', 'app:teams:messages'])
  })

  it('returns empty for no docs', () => {
    const result = walkPromptDocs([], TOOL_CATALOG)
    expect(result.toolsetSlugs.size).toBe(0)
    expect(result.recordIds.size).toBe(0)
  })
})

describe('reconcileToolsetMentions', () => {
  function ts(
    slug: string,
    source: ToolsetEntry['source'],
    mentionedBy?: ToolsetEntry['mentionedBy']
  ): ToolsetEntry {
    return { slug, config: {}, enabled: true, source, ...(mentionedBy ? { mentionedBy } : {}) }
  }

  it('inserts a new prompt-tagged mention row when slug is not covered', () => {
    const next = reconcileToolsetMentions([], new Set(['auxx:mail:threads']), 'prompt')
    expect(next).toEqual([ts('auxx:mail:threads', 'mention', ['prompt'])])
  })

  it('drops a prompt-only mention row when no longer mentioned', () => {
    const next = reconcileToolsetMentions(
      [ts('auxx:mail:threads', 'mention', ['prompt'])],
      new Set(),
      'prompt'
    )
    expect(next).toEqual([])
  })

  it('promotes a manual row to a tagged mention when mentioned', () => {
    const next = reconcileToolsetMentions(
      [ts('auxx:mail:threads', 'manual')],
      new Set(['auxx:mail:threads']),
      'procedure'
    )
    expect(next).toEqual([ts('auxx:mail:threads', 'mention', ['procedure'])])
  })

  it('re-enables a disabled manual row when mentioned', () => {
    const next = reconcileToolsetMentions(
      [{ slug: 'auxx:mail:threads', config: {}, enabled: false, source: 'manual' }],
      new Set(['auxx:mail:threads']),
      'prompt'
    )
    expect(next).toEqual([ts('auxx:mail:threads', 'mention', ['prompt'])])
  })

  it('a prompt-only call leaves a procedure-tagged row intact', () => {
    const next = reconcileToolsetMentions(
      [ts('app:shopify:orders.read', 'mention', ['procedure'])],
      new Set(),
      'prompt'
    )
    expect(next).toEqual([ts('app:shopify:orders.read', 'mention', ['procedure'])])
  })

  it('a procedure-only call leaves a prompt-tagged row intact', () => {
    const next = reconcileToolsetMentions(
      [ts('auxx:mail:threads', 'mention', ['prompt'])],
      new Set(),
      'procedure'
    )
    expect(next).toEqual([ts('auxx:mail:threads', 'mention', ['prompt'])])
  })

  it('a slug locked by both tags survives clearing one tag', () => {
    const both = ts('app:shopify:orders.read', 'mention', ['prompt', 'procedure'])
    const afterPrompt = reconcileToolsetMentions([both], new Set(), 'prompt')
    expect(afterPrompt).toEqual([ts('app:shopify:orders.read', 'mention', ['procedure'])])
    // ...and drops only when the other tag is cleared too.
    const afterBoth = reconcileToolsetMentions(afterPrompt, new Set(), 'procedure')
    expect(afterBoth).toEqual([])
  })

  it('adds the second tag when both inputs mention the same slug', () => {
    const promptOnly = reconcileToolsetMentions([], new Set(['auxx:knowledge']), 'prompt')
    const both = reconcileToolsetMentions(promptOnly, new Set(['auxx:knowledge']), 'procedure')
    expect(both).toEqual([ts('auxx:knowledge', 'mention', ['prompt', 'procedure'])])
  })
})

describe('reconcileKnowledgeMentions', () => {
  function k(
    recordId: string,
    mode: KnowledgeEntry['mode'],
    source: KnowledgeEntry['source'],
    mentionedBy?: KnowledgeEntry['mentionedBy']
  ): KnowledgeEntry {
    return { recordId, mode, source, ...(mentionedBy ? { mentionedBy } : {}) }
  }

  it('inserts a new prompt-tagged mention entry when not covered', () => {
    const next = reconcileKnowledgeMentions([], new Set(['article:abc']), 'prompt')
    expect(next).toEqual([k('article:abc', 'include_one', 'mention', ['prompt'])])
  })

  it('drops a prompt-only mention entry when no longer mentioned', () => {
    const next = reconcileKnowledgeMentions(
      [k('article:abc', 'include_one', 'mention', ['prompt'])],
      new Set(),
      'prompt'
    )
    expect(next).toEqual([])
  })

  it('keeps manual include entries and skips the duplicate mention', () => {
    const next = reconcileKnowledgeMentions(
      [k('article:abc', 'include_descendants', 'manual')],
      new Set(['article:abc']),
      'procedure'
    )
    expect(next).toEqual([k('article:abc', 'include_descendants', 'manual')])
  })

  it('drops a manual exclude colliding with a mention (mention wins)', () => {
    const next = reconcileKnowledgeMentions(
      [k('article:abc', 'exclude', 'manual')],
      new Set(['article:abc']),
      'procedure'
    )
    expect(next).toEqual([k('article:abc', 'include_one', 'mention', ['procedure'])])
  })

  it('a prompt-only call leaves a procedure-tagged record intact', () => {
    const next = reconcileKnowledgeMentions(
      [k('article:abc', 'include_one', 'mention', ['procedure'])],
      new Set(),
      'prompt'
    )
    expect(next).toEqual([k('article:abc', 'include_one', 'mention', ['procedure'])])
  })

  it('a record locked by both tags survives clearing one tag', () => {
    const both = k('article:abc', 'include_one', 'mention', ['prompt', 'procedure'])
    const afterProcedure = reconcileKnowledgeMentions([both], new Set(), 'procedure')
    expect(afterProcedure).toEqual([k('article:abc', 'include_one', 'mention', ['prompt'])])
  })
})

describe('reconcilePromptMentions', () => {
  it('returns combined next state tagged prompt', () => {
    const result = reconcilePromptMentions({
      prompt: doc(paragraph(reference('tool:list_threads'), reference('article:abc'))),
      current: { toolsets: [], knowledge: [] },
      toolCatalog: TOOL_CATALOG,
    })
    expect(result.toolsets).toEqual([
      {
        slug: 'auxx:mail:threads',
        config: {},
        enabled: true,
        source: 'mention',
        mentionedBy: ['prompt'],
      },
    ])
    expect(result.knowledge).toEqual([
      { recordId: 'article:abc', mode: 'include_one', source: 'mention', mentionedBy: ['prompt'] },
    ])
  })

  it('does not clear a procedure-tagged toolset (regression guard)', () => {
    const result = reconcilePromptMentions({
      prompt: doc(), // empty prompt — no mentions
      current: {
        toolsets: [
          {
            slug: 'app:shopify:orders.read',
            config: {},
            enabled: true,
            source: 'mention',
            mentionedBy: ['procedure'],
          },
        ],
        knowledge: [],
      },
      toolCatalog: TOOL_CATALOG,
    })
    expect(result.toolsets).toEqual([
      {
        slug: 'app:shopify:orders.read',
        config: {},
        enabled: true,
        source: 'mention',
        mentionedBy: ['procedure'],
      },
    ])
  })
})
