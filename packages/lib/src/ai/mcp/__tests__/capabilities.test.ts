// packages/lib/src/ai/mcp/__tests__/capabilities.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CachedMcpServer } from '../types'

const cacheStore: { mcpServers: CachedMcpServer[] } = { mcpServers: [] }
vi.mock('../../../cache', () => ({
  getOrgCache: () => ({ get: async (_org: string, _key: string) => cacheStore.mcpServers }),
}))

const access = { mcp: true }
vi.mock('../../../permissions', () => ({
  FeaturePermissionService: class {
    async hasAccess() {
      return access.mcp
    }
  },
}))

import { createMcpCapabilities } from '../capabilities'

function server(overrides: Partial<CachedMcpServer> = {}): CachedMcpServer {
  return {
    serverId: 'srv-1',
    slug: 'demo',
    name: 'Demo',
    description: null,
    iconUrl: null,
    isCustom: true,
    toolsetSlug: 'mcp:srv-1',
    connectionType: 'secret',
    connectionPresent: true,
    connectionExpiresAt: null,
    needsReconnect: false,
    lastSyncedAt: null,
    lastSyncError: null,
    tools: [
      {
        name: 'echo',
        title: null,
        description: 'Echo',
        readOnlyHint: true,
        trusted: false,
        inputSchema: { type: 'object' },
      },
    ],
    ...overrides,
  }
}

beforeEach(() => {
  cacheStore.mcpServers = []
  access.mcp = true
})

describe('createMcpCapabilities', () => {
  it('returns no tools when the mcp feature is off', async () => {
    access.mcp = false
    cacheStore.mcpServers = [server()]
    const cap = await createMcpCapabilities({ organizationId: 'org-1', autonomous: false })
    expect(cap.tools).toHaveLength(0)
  })

  it('skips servers with no connection', async () => {
    cacheStore.mcpServers = [server({ connectionPresent: false, connectionType: 'secret' })]
    const cap = await createMcpCapabilities({ organizationId: 'org-1', autonomous: false })
    expect(cap.tools).toHaveLength(0)
  })

  it('skips servers with no tools', async () => {
    cacheStore.mcpServers = [server({ tools: [] })]
    const cap = await createMcpCapabilities({ organizationId: 'org-1', autonomous: false })
    expect(cap.tools).toHaveLength(0)
  })

  it('includes none-auth servers even without a credential', async () => {
    cacheStore.mcpServers = [server({ connectionPresent: false, connectionType: 'none' })]
    const cap = await createMcpCapabilities({ organizationId: 'org-1', autonomous: false })
    expect(cap.tools).toHaveLength(1)
  })

  it('emits the injection-hardening prompt only when an mcp__ tool survives', async () => {
    cacheStore.mcpServers = [server()]
    const cap = await createMcpCapabilities({ organizationId: 'org-1', autonomous: false })
    const fn = cap.systemPromptAddition as (ctx: { toolNames: Set<string> }) => string

    expect(fn({ toolNames: new Set(['mcp__demo__echo']) })).toContain('mcp_tool_output')
    expect(fn({ toolNames: new Set(['some_other_tool']) })).toBe('')
  })
})
