// packages/lib/src/agents/__tests__/compute-auto-restrictions.test.ts

import type { ToolRestrictionMap, ToolsetEntry } from '@auxx/database'
import { describe, expect, it } from 'vitest'
import {
  type AutoRestrictionTool,
  buildResolvableVarIdSet,
  computeAutoRestrictions,
} from '../compute-auto-restrictions'

function toolset(slug: string, enabled: boolean): ToolsetEntry {
  return { slug, config: {}, enabled, source: 'manual' }
}

const SHOPIFY_TOOL: AutoRestrictionTool = {
  registeredName: 'shopify_list_orders',
  identityScopedInputs: [{ name: 'customerId', suggestedVar: 'visitor:shopify:customerId' }],
}

const toolsBySlug = new Map<string, AutoRestrictionTool[]>([['shopify-orders', [SHOPIFY_TOOL]]])

const resolvable = buildResolvableVarIdSet(['visitor:self'], ['visitor:shopify:customerId'])

describe('computeAutoRestrictions', () => {
  it('binds a resolvable suggestedVar on a chat-kind enable transition', () => {
    const result = computeAutoRestrictions(
      'chat',
      [toolset('shopify-orders', false)],
      [toolset('shopify-orders', true)],
      {},
      toolsBySlug,
      resolvable
    )
    expect(result).toEqual({
      shopify_list_orders: {
        customerId: { source: 'var', var: 'visitor:shopify:customerId', required: true },
      },
    })
  })

  it('does nothing for internal agents', () => {
    const current: ToolRestrictionMap = {}
    const result = computeAutoRestrictions(
      'internal',
      [toolset('shopify-orders', false)],
      [toolset('shopify-orders', true)],
      current,
      toolsBySlug,
      resolvable
    )
    expect(result).toBe(current)
  })

  it('never clobbers an existing binding', () => {
    const current: ToolRestrictionMap = {
      shopify_list_orders: { customerId: { source: 'constant', value: 'pinned' } },
    }
    const result = computeAutoRestrictions(
      'chat',
      [toolset('shopify-orders', false)],
      [toolset('shopify-orders', true)],
      current,
      toolsBySlug,
      resolvable
    )
    expect(result).toBe(current)
  })

  it('does not bind on a re-save of an already-enabled toolset (not a transition)', () => {
    const current: ToolRestrictionMap = {}
    const result = computeAutoRestrictions(
      'chat',
      [toolset('shopify-orders', true)],
      [toolset('shopify-orders', true)],
      current,
      toolsBySlug,
      resolvable
    )
    expect(result).toBe(current)
  })

  it('leaves the arg unbound when the suggestedVar is unresolvable', () => {
    const current: ToolRestrictionMap = {}
    const result = computeAutoRestrictions(
      'chat',
      [toolset('shopify-orders', false)],
      [toolset('shopify-orders', true)],
      current,
      toolsBySlug,
      // empty resolvable set — store not connected yet
      new Set<string>()
    )
    expect(result).toBe(current)
  })
})

describe('buildResolvableVarIdSet', () => {
  it('accepts registry ids and well-formed anchor ids not in the registry', () => {
    const set = buildResolvableVarIdSet(
      ['visitor:self', 'visitor:contact:primary_email'],
      ['visitor:shopify:customerId', 'thread:self']
    )
    expect(set.has('visitor:self')).toBe(true)
    expect(set.has('visitor:shopify:customerId')).toBe(true)
    expect(set.has('thread:self')).toBe(true)
  })

  it('rejects malformed ids', () => {
    const set = buildResolvableVarIdSet([], ['noanchor', 'visitor:', ':ref', 'bogus:x'])
    expect(set.has('noanchor')).toBe(false)
    expect(set.has('visitor:')).toBe(false)
    expect(set.has(':ref')).toBe(false)
    expect(set.has('bogus:x')).toBe(false)
  })
})
