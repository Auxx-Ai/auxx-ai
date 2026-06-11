// packages/lib/src/ai/mcp/__tests__/sync.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const updates: Array<Record<string, unknown>> = []
const inserts: Array<Record<string, unknown>> = []
const stubs = {
  existingInstallation: undefined as undefined | { id: string },
  listToolsImpl: undefined as undefined | (() => Promise<unknown>),
}

vi.mock('@auxx/database', () => {
  const database = {
    query: {
      McpInstallation: { findFirst: async () => stubs.existingInstallation },
    },
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updates.push(values)
        return { where: async () => undefined }
      },
    }),
    insert: () => ({
      values: async (values: Record<string, unknown>) => {
        inserts.push(values)
      },
    }),
  }
  return { database, schema: { McpInstallation: {} } }
})

vi.mock('../auth', () => ({
  buildMcpRequestContext: async () => {
    const { ok } = await import('neverthrow')
    return ok({ endpoint: 'https://x/mcp', headers: {} })
  },
}))

vi.mock('../client', () => ({
  mcpListTools: async () => {
    if (stubs.listToolsImpl) return stubs.listToolsImpl()
    return {
      tools: [{ name: 'echo', inputSchema: { type: 'object' } }],
      serverInfo: { name: 'mock', version: '1' },
      protocolVersion: '2025-06-18',
    }
  },
}))

const onCacheEvent = vi.fn(async () => {})
vi.mock('../../../cache/invalidate', () => ({
  onCacheEvent: (...a: unknown[]) => onCacheEvent(...a),
}))

import { syncMcpTools } from '../sync'

beforeEach(() => {
  updates.length = 0
  inserts.length = 0
  stubs.existingInstallation = undefined
  stubs.listToolsImpl = undefined
  onCacheEvent.mockClear()
})

describe('syncMcpTools', () => {
  it('inserts a fresh snapshot and fires the cache event', async () => {
    const result = await syncMcpTools({ mcpServerId: 'srv-1', organizationId: 'org-1' })
    expect(result.ok).toBe(true)
    expect(result.toolCount).toBe(1)
    expect(inserts[0]?.tools).toHaveLength(1)
    expect(inserts[0]?.lastSyncError).toBeNull()
    expect(onCacheEvent).toHaveBeenCalledWith('mcp.tools.synced', { orgId: 'org-1' })
  })

  it('on failure sets lastSyncError WITHOUT clearing the tools snapshot', async () => {
    stubs.existingInstallation = { id: 'inst-1' }
    stubs.listToolsImpl = () => {
      throw new Error('network down')
    }

    const result = await syncMcpTools({ mcpServerId: 'srv-1', organizationId: 'org-1' })
    expect(result.ok).toBe(false)
    expect(result.error).toBe('network down')

    // Only lastSyncError + updatedAt are set — no `tools` key in the update payload.
    expect(updates).toHaveLength(1)
    expect(updates[0]?.lastSyncError).toBe('network down')
    expect('tools' in (updates[0] ?? {})).toBe(false)
    expect(onCacheEvent).toHaveBeenCalledWith('mcp.tools.synced', { orgId: 'org-1' })
  })
})
