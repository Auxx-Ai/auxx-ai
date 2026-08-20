// packages/lib/src/workflows/graph-edit/__tests__/normalize.test.ts

/**
 * Golden friendly → persisted normalization for a representative set of
 * migrated node types (`03-graph-edit-service.md` §3/§9): ai prompts, if-else
 * bare refs, resource slug → CUID resolution, and after/branch → edge wiring
 * through `manifest.connection.branches`.
 */

import { describe, expect, it, vi } from 'vitest'

// Partial mock — the cache barrel is imported by half of lib; replacing it
// wholesale dies at collection. Only the one read resource-refs makes is stubbed.
const getCachedResources = vi.fn()
vi.mock('../../../cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../cache')>()),
  getCachedResources: (...args: unknown[]) => getCachedResources(...args),
  // No installed apps: these suites exercise CORE node types, so the manifest
  // lookup `loadDraftContext` builds must resolve to the registry alone.
  getCachedInstalledApps: async () => [],
}))

const { resolveConnectionSpec } = await import('../normalize/connection')
const { normalizeFriendlyRefs } = await import('../normalize/friendly-refs')
const { normalizeAiPromptConfig } = await import('../normalize/prompt')
const { buildResourceAliasIndex, normalizeResourceConfig, resolveResourceRef } = await import(
  '../normalize/resource-refs'
)

import { getManifest } from '../../../workflow-engine/catalog/registry'
import type { NodeMeta } from '../types'

/** The core registry alone — no app installed in these fixtures. */
const coreLookup = getManifest

const ORG = 'org_1'
const TICKET_ID = 'i5aezsg4bc6n8gof2uan3wcf'
const ORDERS_ID = 'xhahogeml2s9utggipn2jr1i'

/** Minimal `Resource` fixtures — one tier-A system row, one tier B, one tier C. */
const RESOURCES = [
  {
    id: 'thread',
    type: 'system',
    label: 'Thread',
    plural: 'Threads',
    apiSlug: 'threads',
    entityType: 'thread',
    entityDefinitionId: 'thread',
    isVisible: true,
    fields: [],
  },
  {
    id: TICKET_ID,
    type: 'custom',
    label: 'Ticket',
    plural: 'Tickets',
    apiSlug: 'tickets',
    entityType: 'ticket',
    entityDefinitionId: TICKET_ID,
    isVisible: true,
    fields: [],
  },
  {
    id: ORDERS_ID,
    type: 'custom',
    label: 'Order',
    plural: 'Orders',
    apiSlug: 'orders',
    entityType: 'order',
    entityDefinitionId: ORDERS_ID,
    isVisible: true,
    fields: [],
  },
]

const withResources = () => {
  getCachedResources.mockReset()
  getCachedResources.mockResolvedValue(RESOURCES)
}

const node = (id: string, title: string, data: Record<string, unknown> = {}): NodeMeta => ({
  id,
  type: 'standard',
  data: { id, title, type: 'find', ...data },
})

describe('normalizeAiPromptConfig (golden)', () => {
  it('converts a friendly `prompt` string into a prompt_template Tiptap entry', () => {
    // Refs are normalized first (normalizeFriendlyRefs), then the prompt pass
    // turns each {{…}} span into a variable-node chip via textToDoc.
    const nodes = [node('n1aaaaaaaaaaaaaaaaaaaa', 'Find Contact')]
    const { data: withRefs } = normalizeFriendlyRefs(
      { prompt: 'Summarize {{Find Contact.body}} briefly' },
      { nodes }
    )
    const config = normalizeAiPromptConfig('ai', withRefs)

    expect(config).toEqual({
      prompt_template: [
        {
          role: 'system',
          json: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [
                  { type: 'text', text: 'Summarize ' },
                  {
                    type: 'variable-node',
                    attrs: { variableId: 'n1aaaaaaaaaaaaaaaaaaaa.body' },
                  },
                  { type: 'text', text: ' briefly' },
                ],
              },
            ],
          },
        },
      ],
    })
  })

  it('converts legacy { role, text } entries and bare strings; keeps Tiptap docs untouched', () => {
    const doc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'kept' }] }],
    }
    const config = normalizeAiPromptConfig('ai', {
      prompt_template: [
        'be brief',
        { role: 'user', text: 'hi {{env.NAME}}' },
        { role: 'user', json: doc },
      ],
    })

    const entries = config.prompt_template as Array<{ role: string; json: unknown }>
    expect(entries).toHaveLength(3)
    expect(entries[0]).toMatchObject({ role: 'system' })
    expect(entries[1]).toMatchObject({ role: 'user' })
    expect(JSON.stringify(entries[1]!.json)).toContain('env.NAME')
    expect(entries[2]!.json).toEqual(doc)
  })

  it('is a no-op for non-ai node types', () => {
    const config = { prompt: 'plain {{x.y}}' }
    expect(normalizeAiPromptConfig('answer', config)).toBe(config)
  })
})

describe('resolveResourceRef', () => {
  it('leaves tier-A system slugs alone (thread) without reading the cache', async () => {
    withResources()
    const result = await resolveResourceRef(ORG, 'thread')
    expect(result._unsafeUnwrap()).toBe('thread')
    expect(getCachedResources).not.toHaveBeenCalled()
  })

  it.each([
    'ticket',
    'tickets',
    'Ticket',
  ])('resolves the tier-B alias %s to the org EntityDefinition CUID', async (alias) => {
    withResources()
    expect((await resolveResourceRef(ORG, alias))._unsafeUnwrap()).toBe(TICKET_ID)
  })

  it('resolves a tier-C custom apiSlug to its CUID', async () => {
    withResources()
    expect((await resolveResourceRef(ORG, 'orders'))._unsafeUnwrap()).toBe(ORDERS_ID)
  })

  it('passes an already-canonical CUID through', async () => {
    withResources()
    expect((await resolveResourceRef(ORG, TICKET_ID))._unsafeUnwrap()).toBe(TICKET_ID)
  })

  it('errors on an unknown slug with a did-you-mean candidate — never persists it', async () => {
    withResources()
    const result = await resolveResourceRef(ORG, 'tickett')
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toContain('ticket')
  })
})

describe('normalizeResourceConfig (golden: find)', () => {
  it('rewrites resourceType slug → CUID and leaves the rest of the config alone', async () => {
    withResources()
    const { config, issues } = await normalizeResourceConfig(ORG, 'find', {
      resourceType: 'ticket',
      mode: 'findOne',
    })
    expect(config).toEqual({ resourceType: TICKET_ID, mode: 'findOne' })
    expect(issues).toEqual([])
  })

  it('reports an unresolvable resource as an error issue carrying the field', async () => {
    withResources()
    const { config, issues } = await normalizeResourceConfig(ORG, 'find', {
      resourceType: 'no-such-thing',
    })
    expect(config.resourceType).toBe('no-such-thing')
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ severity: 'error', field: 'resourceType' })
  })

  it('skips node types without resource keys', async () => {
    withResources()
    const input = { text: 'hello' }
    const { config, issues } = await normalizeResourceConfig(ORG, 'wait', input)
    expect(config).toBe(input)
    expect(issues).toEqual([])
  })
})

describe('buildResourceAliasIndex', () => {
  it('indexes tier B/C aliases only, both directions', async () => {
    withResources()
    const index = await buildResourceAliasIndex(ORG)
    expect(index.aliasToId.get('ticket')).toBe(TICKET_ID)
    expect(index.aliasToId.get('tickets')).toBe(TICKET_ID)
    expect(index.aliasToId.get('orders')).toBe(ORDERS_ID)
    expect(index.idToSlug.get(TICKET_ID)).toBe('ticket')
    // Tier A never enters the index — its canonical id IS the slug.
    expect(index.aliasToId.has('thread')).toBe(false)
    expect(index.idToSlug.has('thread')).toBe(false)
  })
})

describe('resolveConnectionSpec', () => {
  const ifElse = node('if1aaaaaaaaaaaaaaaaaaa', 'Route It', {
    type: 'if-else',
    cases: [{ case_id: 'case-a', logical_operator: 'and', conditions: [] }],
  })
  const wait = node('w1aaaaaaaaaaaaaaaaaaaa', 'Wait A Bit', { type: 'wait' })
  const http = node('h1aaaaaaaaaaaaaaaaaaaa', 'Call API', {
    type: 'http',
    error_strategy: 'fail',
  })
  const nodes = [ifElse, wait, http]

  it('connects after a branchless node on the default source handle', () => {
    expect(
      resolveConnectionSpec(nodes, { after: 'Wait A Bit' }, coreLookup)._unsafeUnwrap()
    ).toEqual({
      sourceNodeId: 'w1aaaaaaaaaaaaaaaaaaaa',
      sourceHandle: 'source',
    })
  })

  it('resolves a STABLE display name through manifest.connection.branches', () => {
    // `ELSE` is derived from the reserved `false` id, not from position, so it
    // stays a legal address. `IF`/`CASE n` do not — see the positional suite in
    // `branch-authoring.test.ts`.
    expect(
      resolveConnectionSpec(
        nodes,
        { after: 'Route It', branch: 'else' },
        coreLookup
      )._unsafeUnwrap()
    ).toEqual({ sourceNodeId: 'if1aaaaaaaaaaaaaaaaaaa', sourceHandle: 'false' })
    expect(
      resolveConnectionSpec(
        nodes,
        { after: 'Route It', branch: 'case-a' },
        coreLookup
      )._unsafeUnwrap()
    ).toEqual({ sourceNodeId: 'if1aaaaaaaaaaaaaaaaaaa', sourceHandle: 'case-a' })
  })

  it('resolves a branch by handle id', () => {
    expect(
      resolveConnectionSpec(
        nodes,
        { after: 'Call API', branch: 'fail' },
        coreLookup
      )._unsafeUnwrap()
    ).toEqual({ sourceNodeId: 'h1aaaaaaaaaaaaaaaaaaaa', sourceHandle: 'fail' })
  })

  it('uses the single default branch when none is specified (http)', () => {
    expect(resolveConnectionSpec(nodes, { after: 'Call API' }, coreLookup)._unsafeUnwrap()).toEqual(
      {
        sourceNodeId: 'h1aaaaaaaaaaaaaaaaaaaa',
        sourceHandle: 'source',
      }
    )
  })

  it('errors when a multi-branch node gets no branch, naming every branch', () => {
    const result = resolveConnectionSpec(nodes, { after: 'Route It' }, coreLookup)
    expect(result.isErr()).toBe(true)
    const message = result._unsafeUnwrapErr().message
    expect(message).toContain('case-a')
    expect(message).toContain('false')
  })

  it('errors on an unknown branch, naming the candidates', () => {
    const result = resolveConnectionSpec(
      nodes,
      { after: 'Route It', branch: 'no match' },
      coreLookup
    )
    expect(result.isErr()).toBe(true)
    const message = result._unsafeUnwrapErr().message
    expect(message).toContain('No branch "no match"')
    expect(message).toContain('IF')
    expect(message).toContain('ELSE')
  })

  it('errors when a branch is named on a branchless node', () => {
    const result = resolveConnectionSpec(nodes, { after: 'Wait A Bit', branch: 'fail' }, coreLookup)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toContain('has no branches')
  })

  it('propagates node-ref resolution errors (unknown after)', () => {
    expect(resolveConnectionSpec(nodes, { after: 'Ghost' }, coreLookup).isErr()).toBe(true)
  })
})
