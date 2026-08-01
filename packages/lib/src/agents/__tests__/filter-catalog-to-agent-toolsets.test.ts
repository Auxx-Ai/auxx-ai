// packages/lib/src/agents/__tests__/filter-catalog-to-agent-toolsets.test.ts

import { describe, expect, it } from 'vitest'
import type { AgentToolDefinition } from '../../ai/agent-framework/types'
import {
  type AgentToolsetSelection,
  type FlatToolsetCatalogEntry,
  filterCatalogToAgentToolsets,
} from '../client'
import { filterToolsByToolsets } from '../filter-tools'
import type { ResolvedAgentConfig } from '../resolve-agent-config'

/** One catalog universe expressed both ways: flat toolset entries + runtime defs. */
const UNIVERSE: Array<{ slug: string; tools: string[] }> = [
  { slug: 'auxx:mail:threads', tools: ['find_threads', 'get_thread_detail'] },
  { slug: 'auxx:mail:compose', tools: ['reply_to_thread'] },
  { slug: 'app:shopify', tools: ['shopify_find_order', 'shopify_cancel_order'] },
  { slug: 'mcp:srv-1', tools: ['mcp__demo__echo', 'mcp__demo__do_write'] },
]

const flatEntries: FlatToolsetCatalogEntry[] = UNIVERSE.map(({ slug, tools }) => ({
  slug,
  label: slug,
  fullLabel: slug,
  description: '',
  iconId: 'wrench',
  color: '',
  path: [],
  isDefault: false,
  isPopular: false,
  implicit: false,
  tools: tools.map((name) => ({ name, displayName: name, description: '' })),
}))

const runtimeTools: AgentToolDefinition[] = UNIVERSE.flatMap(({ slug, tools }) =>
  tools.map(
    (name) =>
      ({
        name,
        displayName: name,
        description: '',
        parameters: { type: 'object', properties: {} },
        execute: async () => ({ success: true, output: {} }),
        toolsetSlug: slug,
      }) as AgentToolDefinition
  )
)

function agentConfig(selections: AgentToolsetSelection[]): ResolvedAgentConfig {
  return {
    agentId: 'agent_1',
    kind: 'chat',
    name: 'Test Agent',
    userId: 'user_1',
    prompt: {},
    description: null,
    toolsets: selections.map((s) => ({
      slug: s.slug,
      enabledTools: s.enabledTools == null ? null : new Set(s.enabledTools),
    })),
    knowledge: [],
    appAccounts: {},
    toolRestrictions: {},
    modelId: null,
  }
}

/** Kept tool names via the client filter. */
function clientKept(selections: AgentToolsetSelection[]): string[] {
  return filterCatalogToAgentToolsets(flatEntries, selections)
    .flatMap((e) => e.tools.map((t) => t.name))
    .sort()
}

/** Kept tool names via the runtime filter (slug-tagged tools only — the catalog has no untagged tools). */
function runtimeKept(selections: AgentToolsetSelection[]): string[] {
  return filterToolsByToolsets(runtimeTools, agentConfig(selections))
    .map((t) => t.name)
    .sort()
}

describe('filterCatalogToAgentToolsets — parity with filterToolsByToolsets', () => {
  const cases: Array<[string, AgentToolsetSelection[]]> = [
    ['no toolsets enabled', []],
    ['one explicit bundle (no allow-list)', [{ slug: 'auxx:mail:threads' }]],
    ['explicit null allow-list', [{ slug: 'auxx:mail:compose', enabledTools: null }]],
    [
      'per-tool allow-list keeps exactly the listed names',
      [{ slug: 'auxx:mail:threads', enabledTools: ['get_thread_detail'] }],
    ],
    ['empty allow-list fails closed', [{ slug: 'app:shopify', enabledTools: [] }]],
    [
      'unknown name in the allow-list stays off',
      [{ slug: 'app:shopify', enabledTools: ['shopify_find_order', 'shipped_later_tool'] }],
    ],
    ['unknown slug is ignored', [{ slug: 'nonexistent.slug' }, { slug: 'mcp:srv-1' }]],
    [
      'mixed app + mcp + native selections',
      [
        { slug: 'auxx:mail:threads', enabledTools: ['find_threads'] },
        { slug: 'app:shopify' },
        { slug: 'mcp:srv-1', enabledTools: ['mcp__demo__echo'] },
      ],
    ],
  ]

  for (const [label, selections] of cases) {
    it(label, () => {
      expect(clientKept(selections)).toEqual(runtimeKept(selections))
    })
  }

  it('drops a toolset entry left with zero tools (no empty group rows)', () => {
    const result = filterCatalogToAgentToolsets(flatEntries, [
      { slug: 'auxx:mail:threads', enabledTools: [] },
    ])
    expect(result).toEqual([])
  })
})
