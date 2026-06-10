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

function agent(toolsets: Array<{ slug: string; disabledTools?: string[] }>): ResolvedAgentConfig {
  return {
    agentId: 'agent_1',
    name: 'Test Agent',
    userId: 'user_1',
    prompt: {},
    description: null,
    toolsets: toolsets.map((t) => ({
      slug: t.slug,
      disabledTools: new Set(t.disabledTools ?? []),
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

  it('honors per-tool disable inside an enabled toolset', () => {
    const result = filterToolsByToolsets(
      [findThreads, getThread],
      agent([{ slug: 'auxx:mail:threads', disabledTools: ['find_threads'] }])
    )
    expect(result.map((t) => t.name)).toEqual(['get_thread_detail'])
  })

  it('disables an app tool by its registered name', () => {
    // Runtime app tools are named by the registered name (`<slug>_<id>`); now
    // that the catalog/builder persist that same name into `disabledTools`,
    // per-tool disable lands instead of silently no-op'ing on the manifest id.
    const findOrder = tool('shopify_find_shopify_order', 'app:shopify:orders.read')
    const cancelOrder = tool('shopify_cancel_shopify_order', 'app:shopify:orders.read')
    const result = filterToolsByToolsets(
      [findOrder, cancelOrder],
      agent([{ slug: 'app:shopify:orders.read', disabledTools: ['shopify_find_shopify_order'] }])
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
})
