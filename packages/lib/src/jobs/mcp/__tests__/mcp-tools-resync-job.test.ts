// packages/lib/src/jobs/mcp/__tests__/mcp-tools-resync-job.test.ts

import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'

interface ResyncRow {
  mcpServerId: string
  organizationId: string
  connectionType: 'none' | 'secret' | 'oauth2-code'
  credentialId: string | null
}

const state = {
  rows: [] as ResyncRow[],
  /** mcpServerId → sync result. Defaults to ok. */
  syncResults: {} as Record<string, { ok: boolean; error?: string }>,
}

const syncCalls: Array<{ mcpServerId: string; organizationId: string }> = []

vi.mock('@auxx/database', () => ({
  database: {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          leftJoin: () => state.rows,
        }),
      }),
    }),
  },
  schema: { McpInstallation: {}, ConnectionDefinition: {}, Credential: {} },
}))

vi.mock('../../../ai/mcp/sync', () => ({
  syncMcpTools: async (opts: { mcpServerId: string; organizationId: string }) => {
    syncCalls.push(opts)
    return state.syncResults[opts.mcpServerId] ?? { ok: true }
  },
}))

import { mcpToolsResyncJob } from '../mcp-tools-resync-job'

function makeJob(): Job {
  return { id: 'job-1', data: {} } as unknown as Job
}

beforeEach(() => {
  state.rows = []
  state.syncResults = {}
  syncCalls.length = 0
})

describe('mcpToolsResyncJob', () => {
  it('syncs none-auth and credentialed installations, skips OAuth-without-credential', async () => {
    state.rows = [
      {
        mcpServerId: 'shopify',
        organizationId: 'org-1',
        connectionType: 'none',
        credentialId: null,
      },
      {
        mcpServerId: 'linear',
        organizationId: 'org-1',
        connectionType: 'oauth2-code',
        credentialId: 'cred-1',
      },
      {
        mcpServerId: 'notion',
        organizationId: 'org-1',
        connectionType: 'oauth2-code',
        credentialId: null,
      },
    ]

    const result = (await mcpToolsResyncJob(makeJob())) as {
      success: boolean
      stats: Record<string, number>
    }

    expect(result.success).toBe(true)
    expect(result.stats.installationsScanned).toBe(3)
    expect(result.stats.synced).toBe(2)
    expect(result.stats.skippedNotConnected).toBe(1)
    // The mid-OAuth-flow installation (no credential) is never synced.
    const synced = syncCalls.map((c) => c.mcpServerId).sort()
    expect(synced).toEqual(['linear', 'shopify'])
  })

  it('counts per-server failures without aborting the batch', async () => {
    state.rows = [
      { mcpServerId: 'a', organizationId: 'org-1', connectionType: 'none', credentialId: null },
      {
        mcpServerId: 'b',
        organizationId: 'org-1',
        connectionType: 'secret',
        credentialId: 'cred-b',
      },
    ]
    state.syncResults = { b: { ok: false, error: 'network down' } }

    const result = (await mcpToolsResyncJob(makeJob())) as { stats: Record<string, number> }
    expect(result.stats.synced).toBe(1)
    expect(result.stats.failed).toBe(1)
    expect(syncCalls).toHaveLength(2)
  })

  it('does nothing when there are no installations', async () => {
    const result = (await mcpToolsResyncJob(makeJob())) as {
      success: boolean
      stats: Record<string, number>
    }
    expect(result.success).toBe(true)
    expect(result.stats.installationsScanned).toBe(0)
    expect(syncCalls).toHaveLength(0)
  })
})
