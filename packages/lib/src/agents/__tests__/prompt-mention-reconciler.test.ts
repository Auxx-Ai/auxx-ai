// packages/lib/src/agents/__tests__/prompt-mention-reconciler.test.ts

import { describe, expect, it } from 'vitest'
import {
  type KnowledgeEntry,
  reconcileKnowledgeMentions,
  reconcilePromptMentions,
  reconcileToolsetMentions,
  type ToolsetEntry,
  type ToolsetMention,
  type WalkedToolsetLock,
  walkPromptDoc,
  walkPromptDocs,
} from '../prompt-mention-reconciler'
import type { FlatToolCatalogEntry } from '../toolset-catalog'

function catalogEntry(
  name: string,
  toolsetSlug: string,
  toolsetImplicit = false
): FlatToolCatalogEntry {
  return {
    name,
    displayName: name,
    description: '',
    toolsetSlug,
    toolsetLabel: '',
    toolsetIconId: '',
    toolsetColor: '',
    path: [],
    toolsetImplicit,
  }
}

const TOOL_CATALOG: FlatToolCatalogEntry[] = [
  // Explicit bundles — `tool:` chips pin the whole bundle.
  catalogEntry('list_threads', 'auxx:mail:threads'),
  catalogEntry('get_thread_detail', 'auxx:mail:threads'),
  catalogEntry('search_articles', 'auxx:knowledge'),
  // App-tool entries carry the registered name (`<slug>_<id>`), so two apps
  // publishing the same manifest id (`send_message`) stay distinguishable.
  catalogEntry('slack_send_message', 'app:slack:messages'),
  catalogEntry('teams_send_message', 'app:teams:messages'),
  // Implicit MCP server — `tool:` chips lock just the mentioned tool.
  catalogEntry('mcp__demo__echo', 'mcp:srv-1', true),
  catalogEntry('mcp__demo__do_write', 'mcp:srv-1', true),
  catalogEntry('mcp__demo__read_file', 'mcp:srv-1', true),
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

/** Shorthand for the locks map reconcileToolsetMentions consumes. */
function locks(
  ...entries: Array<[slug: string, targets: string[], opts?: Partial<WalkedToolsetLock>]>
): Map<string, WalkedToolsetLock> {
  const map = new Map<string, WalkedToolsetLock>()
  for (const [slug, targets, opts] of entries) {
    map.set(slug, {
      targets: new Set(targets),
      allNames: opts?.allNames ?? [],
      implicit: opts?.implicit ?? false,
    })
  }
  return map
}

function targetsOf(walk: { toolsetLocks: Map<string, WalkedToolsetLock> }, slug: string): string[] {
  return [...(walk.toolsetLocks.get(slug)?.targets ?? [])].sort()
}

describe('walkPromptDoc', () => {
  it('returns empty sets for an empty doc', () => {
    const result = walkPromptDoc(doc(), TOOL_CATALOG)
    expect(result.toolsetLocks.size).toBe(0)
    expect(result.recordIds.size).toBe(0)
  })

  it("resolves a tool chip in an explicit bundle to a '*' lock (whole bundle pins)", () => {
    const result = walkPromptDoc(doc(paragraph(reference('tool:list_threads'))), TOOL_CATALOG)
    expect([...result.toolsetLocks.keys()]).toEqual(['auxx:mail:threads'])
    expect(targetsOf(result, 'auxx:mail:threads')).toEqual(['*'])
  })

  it('resolves a tool chip in an implicit toolset to a tool-name lock', () => {
    const result = walkPromptDoc(doc(paragraph(reference('tool:mcp__demo__echo'))), TOOL_CATALOG)
    expect(targetsOf(result, 'mcp:srv-1')).toEqual(['mcp__demo__echo'])
    const lock = result.toolsetLocks.get('mcp:srv-1')
    expect(lock?.implicit).toBe(true)
    expect(lock?.allNames.sort()).toEqual([
      'mcp__demo__do_write',
      'mcp__demo__echo',
      'mcp__demo__read_file',
    ])
  })

  it('maps an app-tool registered-name chip to its toolset slug', () => {
    const result = walkPromptDoc(doc(paragraph(reference('tool:slack_send_message'))), TOOL_CATALOG)
    expect(targetsOf(result, 'app:slack:messages')).toEqual(['*'])
  })

  it('resolves a same-id collision unambiguously by registered name', () => {
    const result = walkPromptDoc(
      doc(paragraph(reference('tool:slack_send_message'), reference('tool:teams_send_message'))),
      TOOL_CATALOG
    )
    expect([...result.toolsetLocks.keys()].sort()).toEqual([
      'app:slack:messages',
      'app:teams:messages',
    ])
  })

  it("toolset: references always resolve to '*'", () => {
    const result = walkPromptDoc(doc(paragraph(reference('toolset:mcp:srv-1'))), TOOL_CATALOG)
    expect(targetsOf(result, 'mcp:srv-1')).toEqual(['*'])
    expect(result.toolsetLocks.get('mcp:srv-1')?.implicit).toBe(true)
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
    expect(result.toolsetLocks.size).toBe(0)
    expect(result.recordIds.size).toBe(0)
  })

  it('recurses into nested content', () => {
    const nested = doc(paragraph(reference('tool:list_threads')), {
      type: 'block',
      content: [paragraph(reference('article:abc'))],
    })
    const result = walkPromptDoc(nested, TOOL_CATALOG)
    expect([...result.toolsetLocks.keys()]).toEqual(['auxx:mail:threads'])
    expect([...result.recordIds]).toEqual(['article:abc'])
  })
})

describe('walkPromptDocs', () => {
  it('unions locks and recordIds across many docs', () => {
    const result = walkPromptDocs(
      [
        doc(paragraph(reference('tool:mcp__demo__echo'), reference('article:abc'))),
        doc(paragraph(reference('tool:mcp__demo__do_write'), reference('article:abc'))),
      ],
      TOOL_CATALOG
    )
    expect(targetsOf(result, 'mcp:srv-1')).toEqual(['mcp__demo__do_write', 'mcp__demo__echo'])
    expect([...result.recordIds]).toEqual(['article:abc'])
  })

  it('returns empty for no docs', () => {
    const result = walkPromptDocs([], TOOL_CATALOG)
    expect(result.toolsetLocks.size).toBe(0)
    expect(result.recordIds.size).toBe(0)
  })
})

describe('reconcileToolsetMentions', () => {
  function mention(target: string, source: ToolsetMention['source']): ToolsetMention {
    return { target, source }
  }

  it("inserts a '*' mention row with no per-tool config for an explicit bundle", () => {
    const next = reconcileToolsetMentions([], locks(['auxx:mail:threads', ['*']]), 'prompt')
    expect(next).toEqual([
      {
        slug: 'auxx:mail:threads',
        config: {},
        enabled: true,
        source: 'mention',
        mentions: [mention('*', 'prompt')],
      },
    ])
  })

  it('fresh tool-target insert enables exactly the mentioned tools (1 of 40 rule)', () => {
    const next = reconcileToolsetMentions(
      [],
      locks([
        'mcp:srv-1',
        ['mcp__demo__echo'],
        { implicit: true, allNames: ['mcp__demo__echo', 'mcp__demo__do_write'] },
      ]),
      'prompt'
    )
    expect(next).toHaveLength(1)
    expect(next[0]).toMatchObject({
      slug: 'mcp:srv-1',
      enabled: true,
      source: 'mention',
      mentions: [mention('mcp__demo__echo', 'prompt')],
      config: {
        enabledTools: ['mcp__demo__echo'],
        mentionOverrides: { addedNames: ['mcp__demo__echo'] },
      },
    })
  })

  it("fresh '*' insert on an implicit set snapshots the catalog", () => {
    const next = reconcileToolsetMentions(
      [],
      locks([
        'mcp:srv-1',
        ['*'],
        { implicit: true, allNames: ['mcp__demo__echo', 'mcp__demo__do_write'] },
      ]),
      'prompt'
    )
    expect(next[0]?.config).toEqual({
      enabledTools: ['mcp__demo__echo', 'mcp__demo__do_write'],
      mentionOverrides: { addedNames: ['mcp__demo__echo', 'mcp__demo__do_write'] },
    })
  })

  it('drops a prompt-only mention row when no longer mentioned', () => {
    const current: ToolsetEntry[] = [
      {
        slug: 'mcp:srv-1',
        config: {
          enabledTools: ['mcp__demo__echo'],
          mentionOverrides: { addedNames: ['mcp__demo__echo'] },
        },
        enabled: true,
        source: 'mention',
        mentions: [mention('mcp__demo__echo', 'prompt')],
      },
    ]
    expect(reconcileToolsetMentions(current, locks(), 'prompt')).toEqual([])
  })

  it('a mention-created row with user-customized siblings survives unmention', () => {
    const current: ToolsetEntry[] = [
      {
        slug: 'mcp:srv-1',
        config: {
          // User checked do_write after the chip installed echo.
          enabledTools: ['mcp__demo__echo', 'mcp__demo__do_write'],
          mentionOverrides: { addedNames: ['mcp__demo__echo'] },
        },
        enabled: true,
        source: 'mention',
        mentions: [mention('mcp__demo__echo', 'prompt')],
      },
    ]
    const next = reconcileToolsetMentions(current, locks(), 'prompt')
    expect(next).toHaveLength(1)
    expect(next[0]).toMatchObject({
      slug: 'mcp:srv-1',
      enabled: true,
      source: 'mention',
      config: { enabledTools: ['mcp__demo__do_write'] },
    })
    expect(next[0]?.mentions).toBeUndefined()
    expect((next[0]?.config as { mentionOverrides?: unknown }).mentionOverrides).toBeUndefined()
  })

  it('does NOT promote a manual row — source stays creation provenance', () => {
    const next = reconcileToolsetMentions(
      [{ slug: 'auxx:mail:threads', config: {}, enabled: true, source: 'manual' }],
      locks(['auxx:mail:threads', ['*']]),
      'procedure'
    )
    expect(next[0]).toMatchObject({
      source: 'manual',
      enabled: true,
      mentions: [mention('*', 'procedure')],
    })
  })

  it('round-trip: pre-chip unchecked tool is re-unchecked after unmention', () => {
    // User manually denied echo, then mentions it, then removes the chip.
    const manual: ToolsetEntry[] = [
      {
        slug: 'mcp:srv-1',
        config: { enabledTools: ['mcp__demo__do_write'] },
        enabled: true,
        source: 'manual',
      },
    ]
    const mentioned = reconcileToolsetMentions(
      manual,
      locks(['mcp:srv-1', ['mcp__demo__echo'], { implicit: true }]),
      'prompt'
    )
    expect(mentioned[0]?.config).toEqual({
      enabledTools: ['mcp__demo__do_write', 'mcp__demo__echo'],
      mentionOverrides: { addedNames: ['mcp__demo__echo'] },
    })
    const restored = reconcileToolsetMentions(mentioned, locks(), 'prompt')
    expect(restored).toEqual(manual)
  })

  it('round-trip: pre-chip disabled entry returns to disabled, siblings never activated', () => {
    const manual: ToolsetEntry[] = [
      {
        slug: 'mcp:srv-1',
        config: { enabledTools: ['mcp__demo__do_write'] },
        enabled: false,
        source: 'manual',
      },
    ]
    const mentioned = reconcileToolsetMentions(
      manual,
      locks(['mcp:srv-1', ['mcp__demo__echo'], { implicit: true }]),
      'prompt'
    )
    expect(mentioned[0]).toMatchObject({
      enabled: true,
      config: {
        enabledTools: ['mcp__demo__do_write', 'mcp__demo__echo'],
        mentionOverrides: { enabledWas: false, addedNames: ['mcp__demo__echo'] },
      },
    })
    const restored = reconcileToolsetMentions(mentioned, locks(), 'prompt')
    expect(restored).toEqual(manual)
  })

  it('re-asserts a mentioned tool missing from the allow-list (mentioned-but-unavailable fix)', () => {
    const next = reconcileToolsetMentions(
      [
        {
          slug: 'mcp:srv-1',
          config: { enabledTools: ['mcp__demo__do_write'] },
          enabled: true,
          source: 'manual',
          mentions: [mention('mcp__demo__echo', 'prompt')],
        },
      ],
      locks(['mcp:srv-1', ['mcp__demo__echo'], { implicit: true }]),
      'prompt'
    )
    expect((next[0]?.config as { enabledTools?: string[] }).enabledTools).toContain(
      'mcp__demo__echo'
    )
  })

  it('re-heals an out-of-band disable without clobbering the pre-image', () => {
    // Row was enabled at lock time (no enabledWas), then Kopilot disabled it.
    const next = reconcileToolsetMentions(
      [
        {
          slug: 'auxx:mail:threads',
          config: {},
          enabled: false,
          source: 'manual',
          mentions: [mention('*', 'prompt')],
        },
      ],
      locks(['auxx:mail:threads', ['*']]),
      'prompt'
    )
    expect(next[0]?.enabled).toBe(true)
    // No enabledWas recorded — unmention must NOT disable a row the user had on.
    expect((next[0]?.config as { mentionOverrides?: unknown }).mentionOverrides).toBeUndefined()
  })

  it('a prompt-only call leaves a procedure lock intact', () => {
    const current: ToolsetEntry[] = [
      {
        slug: 'app:shopify:orders.read',
        config: {},
        enabled: true,
        source: 'mention',
        mentions: [mention('*', 'procedure')],
      },
    ]
    expect(reconcileToolsetMentions(current, locks(), 'prompt')).toEqual(current)
  })

  it('a slug locked by both tags survives clearing one tag, drops after both', () => {
    const both: ToolsetEntry[] = [
      {
        slug: 'app:shopify:orders.read',
        config: {},
        enabled: true,
        source: 'mention',
        mentions: [mention('*', 'prompt'), mention('*', 'procedure')],
      },
    ]
    const afterPrompt = reconcileToolsetMentions(both, locks(), 'prompt')
    expect(afterPrompt[0]?.mentions).toEqual([mention('*', 'procedure')])
    const afterBoth = reconcileToolsetMentions(afterPrompt, locks(), 'procedure')
    expect(afterBoth).toEqual([])
  })

  it('per-name restore: a name stays asserted while another source still covers it', () => {
    const current: ToolsetEntry[] = [
      {
        slug: 'mcp:srv-1',
        config: {
          enabledTools: ['mcp__demo__echo'],
          mentionOverrides: { addedNames: ['mcp__demo__echo'] },
        },
        enabled: true,
        source: 'mention',
        mentions: [mention('mcp__demo__echo', 'prompt'), mention('mcp__demo__echo', 'procedure')],
      },
    ]
    const afterPrompt = reconcileToolsetMentions(current, locks(), 'prompt')
    // Procedure still covers echo — assertion and pre-image stand.
    expect((afterPrompt[0]?.config as { enabledTools?: string[] }).enabledTools).toEqual([
      'mcp__demo__echo',
    ])
    const afterBoth = reconcileToolsetMentions(afterPrompt, locks(), 'procedure')
    expect(afterBoth).toEqual([])
  })

  it('adds the second tag when both inputs mention the same slug', () => {
    const promptOnly = reconcileToolsetMentions([], locks(['auxx:knowledge', ['*']]), 'prompt')
    const both = reconcileToolsetMentions(promptOnly, locks(['auxx:knowledge', ['*']]), 'procedure')
    expect(both[0]?.mentions).toEqual([mention('*', 'prompt'), mention('*', 'procedure')])
  })

  it('is idempotent — re-running the same pass changes nothing', () => {
    const theLocks = locks([
      'mcp:srv-1',
      ['mcp__demo__echo'],
      { implicit: true, allNames: ['mcp__demo__echo', 'mcp__demo__do_write'] },
    ])
    const once = reconcileToolsetMentions([], theLocks, 'prompt')
    const twice = reconcileToolsetMentions(once, theLocks, 'prompt')
    expect(twice).toEqual(once)
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
        mentions: [{ target: '*', source: 'prompt' }],
      },
    ])
    expect(result.knowledge).toEqual([
      { recordId: 'article:abc', mode: 'include_one', source: 'mention', mentionedBy: ['prompt'] },
    ])
  })

  it('does not clear a procedure lock (regression guard)', () => {
    const result = reconcilePromptMentions({
      prompt: doc(), // empty prompt — no mentions
      current: {
        toolsets: [
          {
            slug: 'app:shopify:orders.read',
            config: {},
            enabled: true,
            source: 'mention',
            mentions: [{ target: '*', source: 'procedure' }],
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
        mentions: [{ target: '*', source: 'procedure' }],
      },
    ])
  })
})
