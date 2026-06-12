// packages/lib/src/agents/__tests__/filter-tools.test.ts

import { describe, expect, it } from 'vitest'
import type { AgentToolDefinition } from '../../ai/agent-framework/types'
import { filterToolsByToolsets } from '../filter-tools'
import type { ResolvedAgentConfig } from '../resolve-agent-config'

function tool(name: string, slug?: string): AgentToolDefinition {
  return {
    name,
    description: `${name} description`,
    parameters: { type: 'object', properties: {} },
    execute: async () => ({ success: true, output: {} }),
    ...(slug ? { toolsetSlug: slug } : {}),
  }
}

const masterEmpty: ResolvedAgentConfig = {
  agentId: null,
  name: 'Kopilot',
  userId: null,
  prompt: null,
  description: null,
  toolsets: [],
  appAccounts: {},
  toolRestrictions: {},
  modelId: null,
}

function agent(
  toolsets: Array<{ slug: string; enabledTools?: string[] | null }>
): ResolvedAgentConfig {
  return {
    agentId: 'agent_1',
    name: 'Test Agent',
    userId: 'user_1',
    prompt: {},
    description: null,
    toolsets: toolsets.map((t) => ({
      slug: t.slug,
      enabledTools:
        t.enabledTools === undefined || t.enabledTools === null ? null : new Set(t.enabledTools),
    })),
    appAccounts: {},
    toolRestrictions: {},
    modelId: null,
  }
}

describe('filterToolsByToolsets', () => {
  const findThreads = tool('find_threads', 'auxx:mail:threads')
  const getThread = tool('get_thread_detail', 'auxx:mail:threads')
  const replyToThread = tool('reply_to_thread', 'auxx:mail:compose')
  const planCreate = tool('plan_create')

  it('returns input unchanged for undefined config', () => {
    const tools = [findThreads, replyToThread]
    expect(filterToolsByToolsets(tools, undefined)).toBe(tools)
  })

  it('applies the same slug filter for master sessions (no pass-through)', () => {
    // Master with empty toolsets drops everything that has a slug; plan tools
    // (no slug) still flow through.
    const result = filterToolsByToolsets([findThreads, replyToThread, planCreate], masterEmpty)
    expect(result.map((t) => t.name)).toEqual(['plan_create'])
  })

  it('drops tools whose slug is not enabled', () => {
    const result = filterToolsByToolsets(
      [findThreads, replyToThread, planCreate],
      agent([{ slug: 'auxx:mail:threads' }])
    )
    expect(result.map((t) => t.name)).toEqual(['find_threads', 'plan_create'])
  })

  it('keeps always-on (untagged) tools regardless of enabled toolsets', () => {
    const result = filterToolsByToolsets([planCreate], agent([]))
    expect(result.map((t) => t.name)).toEqual(['plan_create'])
  })

  it('passes every member tool when the entry carries no list (explicit bundle)', () => {
    const result = filterToolsByToolsets(
      [findThreads, getThread],
      agent([{ slug: 'auxx:mail:threads', enabledTools: null }])
    )
    expect(result.map((t) => t.name)).toEqual(['find_threads', 'get_thread_detail'])
  })

  it('keeps exactly the allow-listed tools inside an enabled toolset', () => {
    const result = filterToolsByToolsets(
      [findThreads, getThread],
      agent([{ slug: 'auxx:mail:threads', enabledTools: ['get_thread_detail'] }])
    )
    expect(result.map((t) => t.name)).toEqual(['get_thread_detail'])
  })

  it('drops every tool of an entry with an empty allow-list', () => {
    const result = filterToolsByToolsets(
      [findThreads, getThread],
      agent([{ slug: 'auxx:mail:threads', enabledTools: [] }])
    )
    expect(result).toEqual([])
  })

  it('fails closed for a tool the server shipped after the list was written', () => {
    // The allow-list predates `get_thread_detail` — the new tool stays off.
    const result = filterToolsByToolsets(
      [findThreads, getThread],
      agent([{ slug: 'auxx:mail:threads', enabledTools: ['find_threads'] }])
    )
    expect(result.map((t) => t.name)).toEqual(['find_threads'])
  })

  it('gates an app tool by its registered name', () => {
    // Runtime app tools are named by the registered name (`<slug>_<id>`); the
    // catalog/builder persist that same name into `enabledTools`, so per-tool
    // selection lands instead of silently no-op'ing on the manifest id.
    const findOrder = tool('shopify_find_shopify_order', 'app:shopify:orders.read')
    const cancelOrder = tool('shopify_cancel_shopify_order', 'app:shopify:orders.read')
    const result = filterToolsByToolsets(
      [findOrder, cancelOrder],
      agent([{ slug: 'app:shopify:orders.read', enabledTools: ['shopify_cancel_shopify_order'] }])
    )
    expect(result.map((t) => t.name)).toEqual(['shopify_cancel_shopify_order'])
  })

  it('silently ignores unknown slugs in config', () => {
    const result = filterToolsByToolsets(
      [findThreads],
      agent([{ slug: 'auxx:mail:threads' }, { slug: 'nonexistent.slug' }])
    )
    expect(result.map((t) => t.name)).toEqual(['find_threads'])
  })

  it('keeps MCP tools when the agent enables the mcp:<serverId> toolset', () => {
    // The agent path passes arbitrary enabled slugs through unvalidated, so an
    // `mcp:<serverId>` toolset enables its tools with zero special-casing.
    const mcpEcho = tool('mcp__demo__echo', 'mcp:srv-1')
    const mcpWrite = tool('mcp__demo__do_write', 'mcp:srv-1')
    const result = filterToolsByToolsets(
      [mcpEcho, mcpWrite, findThreads],
      agent([{ slug: 'mcp:srv-1', enabledTools: ['mcp__demo__echo'] }])
    )
    expect(result.map((t) => t.name)).toEqual(['mcp__demo__echo'])
  })
})
