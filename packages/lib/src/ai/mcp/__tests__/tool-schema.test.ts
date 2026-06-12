// packages/lib/src/ai/mcp/__tests__/tool-schema.test.ts

import type { McpToolDescriptor } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const updates: Array<Record<string, unknown>> = []
const stubs = { install: undefined as undefined | { id: string; tools: McpToolDescriptor[] } }

vi.mock('@auxx/database', () => ({
  database: {
    query: { McpInstallation: { findFirst: async () => stubs.install } },
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updates.push(values)
        return { where: async () => undefined }
      },
    }),
  },
  schema: { McpInstallation: {} },
}))

const onCacheEvent = vi.fn(async () => {})
vi.mock('../../../cache/invalidate', () => ({
  onCacheEvent: (...a: unknown[]) => onCacheEvent(...a),
}))

import { updateMcpToolSchema } from '../tool-schema'

const tool = (over: Partial<McpToolDescriptor> = {}): McpToolDescriptor => ({
  name: 'echo',
  inputSchema: { type: 'object' },
  ...over,
})

const lastTools = () => (updates.at(-1)?.tools as McpToolDescriptor[] | undefined) ?? []
const echo = () => lastTools().find((t) => t.name === 'echo')

beforeEach(() => {
  updates.length = 0
  stubs.install = { id: 'inst-1', tools: [tool()] }
  onCacheEvent.mockClear()
})

describe('updateMcpToolSchema', () => {
  const objSchema = { type: 'object', properties: { a: { type: 'string' } } }

  it('sets a schema as manual by default and fires the cache event', async () => {
    const result = await updateMcpToolSchema({
      organizationId: 'org-1',
      serverId: 'srv-1',
      toolName: 'echo',
      outputSchema: objSchema,
    })
    expect(result.ok).toBe(true)
    expect(echo()?.outputSchema).toEqual(objSchema)
    expect(echo()?.outputSchemaSource).toBe('manual')
    expect(onCacheEvent).toHaveBeenCalledWith('mcp.tools.synced', { orgId: 'org-1' })
  })

  it('honors an explicit inferred source', async () => {
    await updateMcpToolSchema({
      organizationId: 'org-1',
      serverId: 'srv-1',
      toolName: 'echo',
      outputSchema: objSchema,
      source: 'inferred',
    })
    expect(echo()?.outputSchemaSource).toBe('inferred')
  })

  it('resets to none when outputSchema is null', async () => {
    stubs.install = {
      id: 'inst-1',
      tools: [tool({ outputSchema: objSchema, outputSchemaSource: 'manual' })],
    }
    await updateMcpToolSchema({
      organizationId: 'org-1',
      serverId: 'srv-1',
      toolName: 'echo',
      outputSchema: null,
    })
    expect(echo()?.outputSchema).toBeUndefined()
    expect(echo()?.outputSchemaSource).toBeUndefined()
  })

  it('stores and clears the example output', async () => {
    await updateMcpToolSchema({
      organizationId: 'org-1',
      serverId: 'srv-1',
      toolName: 'echo',
      exampleOutput: { ok: true },
    })
    expect(echo()?.exampleOutput).toEqual({ ok: true })

    stubs.install = { id: 'inst-1', tools: [tool({ exampleOutput: { ok: true } })] }
    await updateMcpToolSchema({
      organizationId: 'org-1',
      serverId: 'srv-1',
      toolName: 'echo',
      clearExampleOutput: true,
    })
    expect(echo()?.exampleOutput).toBeUndefined()
  })

  it('rejects a structurally invalid schema before writing', async () => {
    const result = await updateMcpToolSchema({
      organizationId: 'org-1',
      serverId: 'srv-1',
      toolName: 'echo',
      outputSchema: { type: 'object', properties: 'not-an-object' },
    })
    expect(result.ok).toBe(false)
    expect(updates).toHaveLength(0)
  })

  it('errors on an unknown tool', async () => {
    const result = await updateMcpToolSchema({
      organizationId: 'org-1',
      serverId: 'srv-1',
      toolName: 'missing',
      outputSchema: objSchema,
    })
    expect(result.ok).toBe(false)
    expect(updates).toHaveLength(0)
  })
})
