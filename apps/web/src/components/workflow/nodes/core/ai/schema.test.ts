// apps/web/src/components/workflow/nodes/core/ai/schema.test.ts

import { describe, expect, it } from 'vitest'
import type { UnifiedVariable } from '~/components/workflow/types'
import { BaseType } from '~/components/workflow/types'
import { aiDefinition } from './schema'
import type { AiNodeData } from './types'

const NODE_ID = 'ai-1'

/**
 * The AI node stores structured output at `<nodeId>.structured_output` (plus a flat copy
 * of each TOP-LEVEL key) — see `storeAIResponse` in
 * `packages/lib/src/workflow-engine/nodes/base-ai-node.ts`. The execution context resolves
 * deeper reads by longest-prefix match into that object, so every path the picker
 * advertises must be reachable from `structured_output`.
 */
const outputsFor = (schema: Record<string, unknown>): UnifiedVariable[] =>
  aiDefinition.outputVariables(
    { structured_output: { enabled: true, schema } } as unknown as AiNodeData,
    NODE_ID,
    { allResources: [], resolveVariable: () => undefined }
  )

const structuredOutputOf = (schema: Record<string, unknown>): UnifiedVariable => {
  const variable = outputsFor(schema).find((v) => v.id === `${NODE_ID}.structured_output`)
  if (!variable) throw new Error('structured_output variable missing')
  return variable
}

/** Collect every id in the variable tree, so a whole schema can be asserted at once. */
const collectIds = (variable: UnifiedVariable): string[] => {
  const ids = [variable.id]
  for (const prop of Object.values(variable.properties ?? {})) ids.push(...collectIds(prop))
  if (variable.items) ids.push(...collectIds(variable.items))
  return ids
}

describe('AI node output variables', () => {
  it('always exposes the raw text response as a string', () => {
    const text = outputsFor({ type: 'object', properties: {} }).find(
      (v) => v.id === `${NODE_ID}.text`
    )

    expect(text?.type).toBe(BaseType.STRING)
    // `.output` / `.text` are `response.content`, a raw string — never indexed into.
    expect(text?.properties).toBeUndefined()
    expect(text?.items).toBeUndefined()
  })

  it('prefixes nested object properties with the structured_output path', () => {
    const structured = structuredOutputOf({
      type: 'object',
      properties: {
        order: {
          type: 'object',
          properties: { id: { type: 'string' }, total: { type: 'number' } },
        },
      },
    })

    expect(collectIds(structured)).toEqual([
      'ai-1.structured_output',
      'ai-1.structured_output.order',
      'ai-1.structured_output.order.id',
      'ai-1.structured_output.order.total',
    ])
  })

  it('addresses array items through the parent array with [*]', () => {
    const structured = structuredOutputOf({
      type: 'object',
      properties: {
        lines: {
          type: 'array',
          items: { type: 'object', properties: { sku: { type: 'string' } } },
        },
        tags: { type: 'array', items: { type: 'string' } },
      },
    })

    expect(collectIds(structured)).toEqual([
      'ai-1.structured_output',
      'ai-1.structured_output.lines',
      'ai-1.structured_output.lines[*]',
      'ai-1.structured_output.lines[*].sku',
      'ai-1.structured_output.tags',
      'ai-1.structured_output.tags[*]',
    ])
    // The old `<name>_item` synthetic key was not a path the engine could resolve.
    expect(collectIds(structured).some((id) => id.includes('_item'))).toBe(false)
  })

  it('keeps the full path through 3+ levels of nesting', () => {
    const structured = structuredOutputOf({
      type: 'object',
      properties: {
        order: {
          type: 'object',
          properties: {
            customer: {
              type: 'object',
              properties: {
                address: { type: 'object', properties: { city: { type: 'string' } } },
              },
            },
            lines: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  product: { type: 'object', properties: { sku: { type: 'string' } } },
                },
              },
            },
          },
        },
      },
    })

    expect(collectIds(structured)).toEqual([
      'ai-1.structured_output',
      'ai-1.structured_output.order',
      'ai-1.structured_output.order.customer',
      'ai-1.structured_output.order.customer.address',
      'ai-1.structured_output.order.customer.address.city',
      'ai-1.structured_output.order.lines',
      'ai-1.structured_output.order.lines[*]',
      'ai-1.structured_output.order.lines[*].product',
      'ai-1.structured_output.order.lines[*].product.sku',
    ])
  })

  it('carries types and enums through the nested tree', () => {
    const structured = structuredOutputOf({
      type: 'object',
      properties: {
        order: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['open', 'closed'], description: 'Order status' },
            lines: { type: 'array', items: { type: 'integer' } },
          },
        },
      },
    })

    const status = structured.properties?.order?.properties?.status
    expect(status?.id).toBe('ai-1.structured_output.order.status')
    expect(status?.type).toBe(BaseType.STRING)
    expect(status?.enum).toEqual(['open', 'closed'])
    expect(status?.description).toBe('Order status')

    expect(structured.properties?.order?.properties?.lines?.items?.type).toBe(BaseType.NUMBER)
  })

  it('omits structured_output entirely when it is disabled', () => {
    const outputs = aiDefinition.outputVariables(
      { structured_output: { enabled: false } } as unknown as AiNodeData,
      NODE_ID,
      { allResources: [], resolveVariable: () => undefined }
    )

    expect(outputs.map((v) => v.id)).toEqual([`${NODE_ID}.text`])
  })

  /**
   * `tool_results` is written by both engine paths — `ai-v2.ts` on the
   * tools branch and `base-ai-node.ts` on the plain one — and was advertised
   * by neither side of the builder until now.
   */
  describe('tool_results', () => {
    const outputsWithTools = (toolsEnabled: boolean) =>
      aiDefinition.outputVariables(
        { structured_output: { enabled: false }, toolsEnabled } as unknown as AiNodeData,
        NODE_ID,
        { allResources: [], resolveVariable: () => undefined }
      )

    it('is not offered on a node that cannot call tools', () => {
      expect(outputsWithTools(false).map((v) => v.id)).toEqual([`${NODE_ID}.text`])
    })

    it('is offered as an array of call results once tools are enabled', () => {
      const toolResults = outputsWithTools(true).find(
        (v) => v.id === `${NODE_ID}.tool_results`
      ) as UnifiedVariable

      expect(toolResults.type).toBe(BaseType.ARRAY)
      expect(collectIds(toolResults)).toEqual([
        'ai-1.tool_results',
        'ai-1.tool_results[*]',
        'ai-1.tool_results[*].toolCallId',
        'ai-1.tool_results[*].toolName',
        'ai-1.tool_results[*].success',
        'ai-1.tool_results[*].output',
        'ai-1.tool_results[*].error',
      ])
    })

    it('offers no per-call alias — the tool a model picks is a run-time fact', () => {
      const ids = outputsWithTools(true).flatMap(collectIds)
      expect(ids.some((id) => /\.tool_(?!results)/.test(id))).toBe(false)
    })
  })
})
