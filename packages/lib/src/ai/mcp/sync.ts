// packages/lib/src/ai/mcp/sync.ts

import { database as db, type McpToolDescriptor, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { onCacheEvent } from '../../cache/invalidate'
import { buildMcpRequestContext } from './auth'
import { mcpListTools } from './client'

const logger = createScopedLogger('mcp-sync')

export interface SyncMcpToolsResult {
  ok: boolean
  toolCount?: number
  error?: string
}

/**
 * Merge an incoming `tools/list` snapshot with the existing one, per tool by name. Pure.
 *
 * - **Server wins, manual is sticky.** A server-declared schema replaces an `inferred` one but is
 *   held back when the local schema is `manual` (the user reset it to take the server schema).
 * - If the server declares nothing, the existing local schema (inferred or manual) survives.
 * - `exampleOutput` always carries over by tool name.
 * - New tools are taken as-is; tools dropped from the incoming list are not carried over.
 */
export function mergeToolSnapshots(
  incoming: McpToolDescriptor[],
  existing: McpToolDescriptor[] | undefined
): McpToolDescriptor[] {
  const prev = new Map((existing ?? []).map((t) => [t.name, t]))
  return incoming.map((next) => {
    const old = prev.get(next.name)
    if (!old) return next

    const merged: McpToolDescriptor = { ...next }
    if (old.exampleOutput !== undefined) merged.exampleOutput = old.exampleOutput

    if (next.outputSchema && next.outputSchemaSource === 'server') {
      // Server declares a schema — keep a sticky manual override, otherwise the server wins.
      if (old.outputSchemaSource === 'manual') {
        merged.outputSchema = old.outputSchema
        merged.outputSchemaSource = old.outputSchemaSource
      }
    } else if (old.outputSchema) {
      // Server declares nothing — keep whatever was inferred/edited locally.
      merged.outputSchema = old.outputSchema
      merged.outputSchemaSource = old.outputSchemaSource
    }
    return merged
  })
}

/**
 * Snapshot a server's `tools/list` into McpInstallation for an org.
 *
 * On success: upsert tools + serverInfo + protocolVersion + lastSyncedAt, clear lastSyncError.
 * On failure: set lastSyncError only — never clear the previous good `tools` snapshot.
 * Always fires `mcp.tools.synced` so the cache reflects the new state.
 */
export async function syncMcpTools(opts: {
  mcpServerId: string
  organizationId: string
}): Promise<SyncMcpToolsResult> {
  const { mcpServerId, organizationId } = opts

  const ctxResult = await buildMcpRequestContext({ mcpServerId, organizationId })
  if (ctxResult.isErr()) {
    await recordSyncError(mcpServerId, organizationId, ctxResult.error.message)
    await onCacheEvent('mcp.tools.synced', { orgId: organizationId })
    return { ok: false, error: ctxResult.error.message }
  }

  try {
    const { tools, serverInfo, protocolVersion } = await mcpListTools({
      endpoint: ctxResult.value.endpoint,
      headers: ctxResult.value.headers,
    })

    const now = new Date()
    const existing = await db.query.McpInstallation.findFirst({
      where: and(
        eq(schema.McpInstallation.organizationId, organizationId),
        eq(schema.McpInstallation.mcpServerId, mcpServerId)
      ),
      columns: { id: true, tools: true },
    })

    // Preserve inferred/manual output schemas + captured examples across the re-snapshot.
    const merged = mergeToolSnapshots(tools, existing?.tools)

    if (existing) {
      await db
        .update(schema.McpInstallation)
        .set({ tools: merged, serverInfo, protocolVersion, lastSyncedAt: now, lastSyncError: null })
        .where(eq(schema.McpInstallation.id, existing.id))
    } else {
      await db.insert(schema.McpInstallation).values({
        organizationId,
        mcpServerId,
        tools: merged,
        serverInfo,
        protocolVersion,
        lastSyncedAt: now,
        lastSyncError: null,
      })
    }

    await onCacheEvent('mcp.tools.synced', { orgId: organizationId })
    logger.info('Synced MCP tools', { mcpServerId, organizationId, toolCount: tools.length })
    return { ok: true, toolCount: tools.length }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await recordSyncError(mcpServerId, organizationId, message)
    await onCacheEvent('mcp.tools.synced', { orgId: organizationId })
    logger.warn('MCP tool sync failed', { mcpServerId, organizationId, error: message })
    return { ok: false, error: message }
  }
}

/** Set lastSyncError without touching the existing tools snapshot. Creates an empty row if none. */
async function recordSyncError(
  mcpServerId: string,
  organizationId: string,
  message: string
): Promise<void> {
  const existing = await db.query.McpInstallation.findFirst({
    where: and(
      eq(schema.McpInstallation.organizationId, organizationId),
      eq(schema.McpInstallation.mcpServerId, mcpServerId)
    ),
    columns: { id: true },
  })
  if (existing) {
    await db
      .update(schema.McpInstallation)
      .set({ lastSyncError: message, updatedAt: new Date() })
      .where(eq(schema.McpInstallation.id, existing.id))
  } else {
    await db
      .insert(schema.McpInstallation)
      .values({ organizationId, mcpServerId, lastSyncError: message })
  }
}
