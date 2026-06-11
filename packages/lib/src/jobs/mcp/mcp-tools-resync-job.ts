// packages/lib/src/jobs/mcp/mcp-tools-resync-job.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Job } from 'bullmq'
import { and, eq } from 'drizzle-orm'
import pLimit from 'p-limit'
import { syncMcpTools } from '../../ai/mcp/sync'

const logger = createScopedLogger('mcp-tools-resync-job')

/** Re-sync job payload. */
export interface McpToolsResyncJobData {
  /** Cap on concurrent server syncs (default 5). */
  concurrency?: number
}

/** Re-sync run statistics. */
interface ResyncStats {
  installationsScanned: number
  synced: number
  failed: number
  skippedNotConnected: number
}

/**
 * Nightly MCP tool re-sync.
 *
 * Iterates every McpInstallation that is actually connected — `none`-auth servers (connected by
 * the installation's existence) and secret/OAuth servers with a stored `mcp-connection`
 * credential — and re-snapshots each server's `tools/list` via `syncMcpTools`. Installations
 * created mid-OAuth-flow (no credential yet) are skipped so we don't spam them with auth errors.
 *
 * Runs with bounded concurrency; a single server's failure is recorded as `lastSyncError`
 * (by `syncMcpTools`) and never aborts the batch.
 */
export const mcpToolsResyncJob = async (job: Job<McpToolsResyncJobData>) => {
  const concurrency = job.data.concurrency ?? 5

  const stats: ResyncStats = {
    installationsScanned: 0,
    synced: 0,
    failed: 0,
    skippedNotConnected: 0,
  }

  // Join each installation to its server's connection definition (for connectionType) and to a
  // stored credential, if any. A row is syncable when it's `none`-auth or has a credential.
  const rows = await db
    .select({
      mcpServerId: schema.McpInstallation.mcpServerId,
      organizationId: schema.McpInstallation.organizationId,
      connectionType: schema.ConnectionDefinition.connectionType,
      credentialId: schema.WorkflowCredentials.id,
    })
    .from(schema.McpInstallation)
    .innerJoin(
      schema.ConnectionDefinition,
      eq(schema.ConnectionDefinition.mcpServerId, schema.McpInstallation.mcpServerId)
    )
    .leftJoin(
      schema.WorkflowCredentials,
      and(
        eq(schema.WorkflowCredentials.mcpServerId, schema.McpInstallation.mcpServerId),
        eq(schema.WorkflowCredentials.organizationId, schema.McpInstallation.organizationId),
        eq(schema.WorkflowCredentials.type, 'mcp-connection')
      )
    )

  stats.installationsScanned = rows.length

  const connected = rows.filter((r) => r.connectionType === 'none' || r.credentialId !== null)
  stats.skippedNotConnected = rows.length - connected.length

  logger.info('Starting MCP tools re-sync', {
    installations: rows.length,
    connected: connected.length,
    concurrency,
    jobId: job.id,
  })

  const limit = pLimit(concurrency)
  await Promise.all(
    connected.map((row) =>
      limit(async () => {
        const result = await syncMcpTools({
          mcpServerId: row.mcpServerId,
          organizationId: row.organizationId,
        })
        if (result.ok) stats.synced++
        else stats.failed++
      })
    )
  )

  logger.info('MCP tools re-sync complete', { stats, jobId: job.id })
  return { success: true, stats }
}
