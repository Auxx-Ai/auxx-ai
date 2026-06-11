// packages/lib/src/cache/__tests__/mcp-servers-provider.test.ts

import type { Database } from '@auxx/database'
import { describe, expect, it } from 'vitest'
import { mcpServersProvider } from '../providers/mcp-servers-provider'

interface FakeRows {
  servers: unknown[]
  installations: unknown[]
  connectionDefs: unknown[]
  creds: unknown[]
}

function makeFakeDb(rows: FakeRows): Database {
  const selectChain = (resolved: unknown[]) => {
    const proxy: unknown = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === 'then') return Promise.resolve(resolved).then.bind(Promise.resolve(resolved))
          return () => proxy
        },
      }
    )
    return proxy
  }
  return {
    query: {
      McpServer: { findMany: async () => rows.servers },
      McpInstallation: { findMany: async () => rows.installations },
      ConnectionDefinition: { findMany: async () => rows.connectionDefs },
    },
    select: () => selectChain(rows.creds),
  } as unknown as Database
}

describe('mcpServersProvider', () => {
  it('derives trust + readOnly and includes curated-unconnected servers', async () => {
    const db = makeFakeDb({
      servers: [
        {
          id: 'srv-curated',
          organizationId: null,
          slug: 'linear',
          name: 'Linear',
          description: 'desc',
          iconUrl: null,
          endpoint: 'https://mcp.linear.app/mcp',
        },
        {
          id: 'srv-custom',
          organizationId: 'org-1',
          slug: 'custom',
          name: 'Custom',
          description: null,
          iconUrl: 'https://x/icon.png',
          endpoint: 'https://custom/mcp',
        },
      ],
      installations: [
        {
          mcpServerId: 'srv-custom',
          trust: { tools: ['do_write'] },
          tools: [
            { name: 'echo', annotations: { readOnlyHint: true }, inputSchema: { type: 'object' } },
            { name: 'do_write', inputSchema: { type: 'object' } },
          ],
          lastSyncedAt: new Date('2026-01-01T00:00:00Z'),
          lastSyncError: null,
        },
      ],
      connectionDefs: [{ mcpServerId: 'srv-custom', connectionType: 'secret' }],
      creds: [{ mcpServerId: 'srv-custom', expiresAt: null, consecutiveRefreshFailures: 0 }],
    })

    const result = await mcpServersProvider.compute('org-1', db)

    const curated = result.find((s) => s.serverId === 'srv-curated')!
    expect(curated.isCustom).toBe(false)
    expect(curated.tools).toEqual([])
    expect(curated.connectionPresent).toBe(false)
    expect(curated.connectionType).toBeNull()

    const custom = result.find((s) => s.serverId === 'srv-custom')!
    expect(custom.isCustom).toBe(true)
    expect(custom.toolsetSlug).toBe('mcp:srv-custom')
    expect(custom.connectionPresent).toBe(true)
    expect(custom.connectionType).toBe('secret')
    const echo = custom.tools.find((t) => t.name === 'echo')!
    expect(echo.readOnlyHint).toBe(true)
    expect(echo.trusted).toBe(false)
    const write = custom.tools.find((t) => t.name === 'do_write')!
    expect(write.readOnlyHint).toBe(false)
    expect(write.trusted).toBe(true) // trust.tools includes 'do_write'
  })

  it('marks needsReconnect when the circuit is open', async () => {
    const db = makeFakeDb({
      servers: [
        {
          id: 'srv-1',
          organizationId: 'org-1',
          slug: 's',
          name: 'S',
          description: null,
          iconUrl: null,
          endpoint: 'https://x/mcp',
        },
      ],
      installations: [{ mcpServerId: 'srv-1', trust: { allTools: true }, tools: [] }],
      connectionDefs: [{ mcpServerId: 'srv-1', connectionType: 'oauth2-code' }],
      creds: [{ mcpServerId: 'srv-1', expiresAt: null, consecutiveRefreshFailures: 5 }],
    })

    const [server] = await mcpServersProvider.compute('org-1', db)
    expect(server.needsReconnect).toBe(true)
  })
})
