// packages/lib/src/cache/providers/installed-apps-block-ops.test.ts
// The `toolMap` → `catalog.tools` join that gives the server its only view of
// what an app workflow block produces. Pure function over catalog shapes — no
// DB, no cache. See plans/kopilot/workflow/17-app-block-authoring-and-connections.md §4 A2.

import type { CatalogBlock, CatalogTool } from '@auxx/database'
import { describe, expect, it } from 'vitest'
import { projectWorkflowBlocks } from './installed-apps-provider'

function tool(id: string, overrides: Partial<CatalogTool> = {}): CatalogTool {
  return {
    id,
    name: id,
    description: `${id} description`,
    inputsJsonSchema: { type: 'object', properties: { trackingNumber: { type: 'string' } } },
    outputsJsonSchema: { type: 'object', properties: { statusType: { type: 'string' } } },
    requiresConnection: true,
    timeoutMs: 30_000,
    streaming: false,
    refs: [],
    ...overrides,
  }
}

function block(toolMap: Record<string, string>): CatalogBlock {
  return {
    id: 'fedex',
    label: 'FedEx',
    iconKey: null,
    inputsJsonSchema: {},
    toolMap,
    refs: [],
  }
}

describe('projectWorkflowBlocks', () => {
  it('resolves each toolMap entry to its dispatched tool contract', () => {
    const result = projectWorkflowBlocks(
      [block({ 'shipment.track': 'fedex_block_track' })],
      [tool('fedex_block_track')]
    )

    expect(result?.[0]?.ops).toEqual([
      {
        key: 'shipment.track',
        resource: 'shipment',
        operation: 'track',
        toolId: 'fedex_block_track',
        inputsJsonSchema: { type: 'object', properties: { trackingNumber: { type: 'string' } } },
        outputsJsonSchema: { type: 'object', properties: { statusType: { type: 'string' } } },
        requiresConnection: true,
      },
    ])
  })

  it('carries the whole CatalogBlock through alongside ops', () => {
    const source = block({ 'shipment.track': 'fedex_block_track' })
    const result = projectWorkflowBlocks([source], [tool('fedex_block_track')])

    expect(result?.[0]).toMatchObject({ id: 'fedex', label: 'FedEx', toolMap: source.toolMap })
  })

  it('forwards exampleOutput only when the tool declares one', () => {
    const [withExample, without] =
      projectWorkflowBlocks(
        [block({ 'a.one': 'has_example', 'b.two': 'no_example' })],
        [tool('has_example', { exampleOutput: { statusType: 'delivered' } }), tool('no_example')]
      )?.[0]?.ops ?? []

    expect(withExample?.exampleOutput).toEqual({ statusType: 'delivered' })
    expect(without).not.toHaveProperty('exampleOutput')
  })

  it('drops a dangling toolMap entry instead of throwing', () => {
    const result = projectWorkflowBlocks(
      [block({ 'shipment.track': 'fedex_block_track', 'shipment.gone': 'deleted_tool' })],
      [tool('fedex_block_track')]
    )

    expect(result?.[0]?.ops.map((o) => o.key)).toEqual(['shipment.track'])
  })

  it('drops malformed keys — no dot, empty half, or an extra segment', () => {
    const result = projectWorkflowBlocks(
      [
        block({
          track: 't',
          '.track': 't',
          'shipment.': 't',
          'a.b.c': 't',
          'shipment.track': 't',
        }),
      ],
      [tool('t')]
    )

    expect(result?.[0]?.ops.map((o) => o.key)).toEqual(['shipment.track'])
  })

  it('gives a block with no toolMap an empty ops list, not undefined', () => {
    expect(projectWorkflowBlocks([block({})], [tool('t')])?.[0]?.ops).toEqual([])
  })

  it('preserves an open (property-less) output schema verbatim', () => {
    // 190 of 261 published ops declare `z.record(z.string(), z.unknown())`. That
    // is "unknown shape", not "produces nothing" — callers must be able to tell
    // the difference, so the projection must not normalize it away.
    const open = { type: 'object', propertyNames: { type: 'string' }, additionalProperties: {} }
    const result = projectWorkflowBlocks(
      [block({ 'issue.create': 'github_issue_create' })],
      [tool('github_issue_create', { outputsJsonSchema: open })]
    )

    expect(result?.[0]?.ops[0]?.outputsJsonSchema).toEqual(open)
  })

  it('returns undefined for a deployment with no catalog blocks', () => {
    expect(projectWorkflowBlocks(undefined, [tool('t')])).toBeUndefined()
  })

  it('drops every op when the catalog carries no tools at all', () => {
    expect(projectWorkflowBlocks([block({ 'shipment.track': 't' })], undefined)?.[0]?.ops).toEqual(
      []
    )
  })
})
