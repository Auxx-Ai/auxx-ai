// packages/lib/src/ai/kopilot/capabilities/__tests__/registry.test.ts

import { describe, expect, it } from 'vitest'
import type { AgentToolDefinition } from '../../../agent-framework/types'
import { createCapabilityRegistry } from '../registry'

function tool(name: string): AgentToolDefinition {
  return {
    name,
    description: name,
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    execute: async () => ({ success: true, output: null }),
  }
}

describe('capability registry — excludeGlobalTools', () => {
  it('excludes a global tool by literal name', () => {
    const r = createCapabilityRegistry()
    r.register({ page: '__global__', tools: [tool('keep_me'), tool('drop_me')] })
    r.register({ page: 'focus', tools: [], excludeGlobalTools: ['drop_me'] })

    const names = r.getTools('focus').map((t) => t.name)
    expect(names).toEqual(['keep_me'])
  })

  it('excludes via trailing-* prefix glob', () => {
    const r = createCapabilityRegistry()
    r.register({
      page: '__global__',
      tools: [tool('mail_send'), tool('mail_list'), tool('search_entities')],
    })
    r.register({ page: 'focus', tools: [], excludeGlobalTools: ['mail_*'] })

    const names = r
      .getTools('focus')
      .map((t) => t.name)
      .sort()
    expect(names).toEqual(['search_entities'])
  })

  it('excludes via predicate function', () => {
    const r = createCapabilityRegistry()
    r.register({
      page: '__global__',
      tools: [tool('a_one'), tool('b_two'), tool('c_three')],
    })
    r.register({
      page: 'focus',
      tools: [],
      excludeGlobalTools: (name) => name.startsWith('b_') || name === 'c_three',
    })

    const names = r.getTools('focus').map((t) => t.name)
    expect(names).toEqual(['a_one'])
  })

  it('never filters page-local tools, only globals', () => {
    const r = createCapabilityRegistry()
    r.register({ page: '__global__', tools: [tool('mail_send')] })
    r.register({
      page: 'focus',
      tools: [tool('mail_send_local')],
      excludeGlobalTools: ['mail_*'],
    })

    const names = r.getTools('focus').map((t) => t.name)
    expect(names).toEqual(['mail_send_local'])
  })

  it('reports excluded names via getExcludedGlobalToolNames', () => {
    const r = createCapabilityRegistry()
    r.register({
      page: '__global__',
      tools: [tool('mail_send'), tool('mail_list'), tool('search_entities')],
    })
    r.register({ page: 'focus', tools: [], excludeGlobalTools: ['mail_*'] })

    expect(r.getExcludedGlobalToolNames('focus').sort()).toEqual(['mail_list', 'mail_send'])
    expect(r.getExcludedGlobalToolNames('other')).toEqual([])
  })

  it('returns the unfiltered global set when no excludes are declared', () => {
    const r = createCapabilityRegistry()
    r.register({ page: '__global__', tools: [tool('a'), tool('b')] })
    r.register({ page: 'focus', tools: [tool('c')] })

    const names = r
      .getTools('focus')
      .map((t) => t.name)
      .sort()
    expect(names).toEqual(['a', 'b', 'c'])
  })
})

describe('capability registry — capabilities summary', () => {
  it('resolves functional capabilities against the live tool set', () => {
    const r = createCapabilityRegistry()
    r.register({
      page: '__global__',
      tools: [tool('alpha'), tool('beta')],
      capabilities: ({ toolNames }) => {
        const out: string[] = []
        if (toolNames.has('alpha')) out.push('alpha bullet')
        if (toolNames.has('beta')) out.push('beta bullet')
        return out
      },
    })

    const all = r.getCapabilitiesSummary({ toolNames: new Set(['alpha', 'beta']) })
    expect(all).toEqual(['alpha bullet', 'beta bullet'])

    const alphaOnly = r.getCapabilitiesSummary({ toolNames: new Set(['alpha']) })
    expect(alphaOnly).toEqual(['alpha bullet'])
  })

  it('still supports plain string[] capability arrays', () => {
    const r = createCapabilityRegistry()
    r.register({
      page: '__global__',
      tools: [tool('alpha')],
      capabilities: ['static bullet'],
    })

    expect(r.getCapabilitiesSummary({ toolNames: new Set(['alpha']) })).toEqual(['static bullet'])
  })
})
